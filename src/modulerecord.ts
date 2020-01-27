import path from "path";

// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { EnvironmentRecord } from "./environment";
import { ModuleHost } from "./host";
import { assert, internalError, IssueType, Severity, buildLintMessage, IssueError } from "./issue";

// This is all mostly based on the ES spec: https://tc39.es/ecma262/#sec-modules
// Plus some additions for better reporting.

enum Status {
  unlinked = "unlinked",
  linking = "linking",
  linked = "linked",
  evaluating = "evaluating",
  evaluated = "evaluated",
}

export class ImportEntry {
  public constructor(
    // The import declaration.
    public readonly node: ESTree.Node,
    // The module specifier.
    public readonly moduleRequest: string,
    // The name of the export, may be "*" or "default".
    public readonly importName: string,
    // The name that is used locally.
    public readonly localName: string
  ) {}
}

export function loggableImportEntry(entry: ImportEntry): Omit<ImportEntry, "node"> {
  return {
    moduleRequest: entry.moduleRequest,
    importName: entry.importName,
    localName: entry.localName,
  };
}

export interface ExportEntry {
  readonly node: ESTree.Node;
  readonly exportName: string | null;
  readonly moduleRequest: string | null;
  readonly importName: string | null;
  readonly localName: string | null;
}

export function loggableExportEntry(entry: ExportEntry): Omit<ExportEntry, "node"> {
  return {
    exportName: entry.exportName,
    moduleRequest: entry.moduleRequest,
    importName: entry.importName,
    localName: entry.localName,
  };
}

export class LocalExportEntry implements ExportEntry {
  public readonly filePath: string;
  public readonly node: ESTree.Node;
  public readonly exportName: string;
  public readonly moduleRequest: null = null;
  public readonly importName: null = null;
  public readonly localName: string;

  public constructor(filePath: string, entry: ExportEntry) {
    if (entry.moduleRequest || entry.importName || !entry.exportName || !entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry (${JSON.stringify(loggableExportEntry(entry))}) as a LocalExportEntry.`,
        filePath, entry.node);
    }

    this.filePath = filePath;
    this.node = entry.node;
    this.exportName = entry.exportName;
    this.localName = entry.localName;
  }
}

export class IndirectExportEntry implements ExportEntry {
  public readonly filePath: string;
  public readonly node: ESTree.Node;
  public readonly exportName: string;
  public readonly moduleRequest: string;
  public readonly importName: string;
  public readonly localName: null = null;

  public constructor(filePath: string, entry: ExportEntry) {
    if (!entry.moduleRequest || !entry.importName || !entry.exportName || entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry (${JSON.stringify(loggableExportEntry(entry))}) as a IndirectExportEntry.`,
        filePath, entry.node);
    }

    this.filePath = filePath;
    this.node = entry.node;
    this.moduleRequest = entry.moduleRequest;
    this.exportName = entry.exportName;
    this.importName = entry.importName;
  }
}

export class StarExportEntry implements ExportEntry {
  public readonly filePath: string;
  public readonly node: ESTree.Node;
  public readonly exportName: null = null;
  public readonly moduleRequest: string;
  public readonly importName: "*" = "*";
  public readonly localName: null = null;

  public constructor(filePath: string, entry: ExportEntry) {
    if (!entry.moduleRequest || entry.importName != "*" || entry.exportName || entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry (${JSON.stringify(loggableExportEntry(entry))}) as a StarExportEntry.`,
        filePath, entry.node);
    }

    this.filePath = filePath;
    this.node = entry.node;
    this.moduleRequest = entry.moduleRequest;
  }
}

export interface ModuleNamespace {
  module: SourceTextModuleRecord;
  exports: string[];
}

interface ResolvedBinding {
  module: SourceTextModuleRecord;
  bindingName: string;
}

interface ExportBinding {
  module: SourceTextModuleRecord;
  exportName: string;
}

interface RequestedModule {
  specifier: string;
  node: ESTree.Node;
}

abstract class ModuleRecord {
  public environmentRecord: EnvironmentRecord | undefined = undefined;
  public namespace: ModuleNamespace | undefined = undefined;

  public constructor(public readonly host: ModuleHost) {
  }

  public abstract link(): void;

  public abstract evaluate(): void;

  public abstract getExportedNames(exportStarSet: SourceTextModuleRecord[] | undefined): string[];

  public abstract resolveExport(exportName: string, resolveSet?: ExportBinding[]): ResolvedBinding | "ambiguous" | null;

  public abstract getModuleNamespace(): ModuleNamespace;
}

export abstract class CyclicModuleRecord extends ModuleRecord {
  public status: Status = Status.unlinked;
  public index: number | undefined = undefined;
  public ancestorIndex: number | undefined = undefined;
  public readonly relativePath: string;

  public constructor(workingDirectory: string, host: ModuleHost, public readonly script: string) {
    super(host);
    this.relativePath = path.relative(workingDirectory, script);
  }

  protected abstract namespaceCreate(names: string[]): ModuleNamespace;

  public getModuleNamespace(): ModuleNamespace {
    let algorithm = "https://tc39.es/ecma262/#sec-getmodulenamespace";

    // Step 2.
    assert(
      this.status != Status.unlinked,
      algorithm,
      "2",
      this.script,
      null,
    );

    // Step 3.
    let namespace = this.namespace;

    //.Step 4.
    if (!namespace) {
      let exportedNames = this.getExportedNames([]);
      let unambiguousNames: string[] = [];
      for (let name of exportedNames) {
        let resolution = this.resolveExport(name);
        if (resolution && resolution != "ambiguous") {
          unambiguousNames.push(name);
        }
      }

      namespace = this.namespaceCreate(unambiguousNames);
    }

    return namespace;
  }

  protected abstract innerModuleLinking(stack: SourceTextModuleRecord[], index: number): number;

  public link(): void {
    let algorithm = "https://tc39.es/ecma262/#sec-moduledeclarationlinking";

    // Step 2.
    assert(
      ![Status.linking, Status.evaluating].includes(this.status),
      algorithm,
      "2",
      this.script,
      null
    );

    // Steps 3-4.
    this.innerModuleLinking([], 0);

    // Steps 6-7.
    assert(
      [Status.linked, Status.evaluated].includes(this.status),
      algorithm,
      "6",
      this.script,
      null
    );
  }

  protected abstract innerModuleEvaluation(stack: CyclicModuleRecord[], executeStack: SourceTextModuleRecord[], index: number): number;

  public evaluate(): void {
    let algorithm = "https://tc39.es/ecma262/#sec-moduleevaluation";

    // Step 2.
    assert(
      [Status.linked, Status.evaluated].includes(this.status),
      algorithm,
      "2",
      this.script,
      null,
    );

    // Steps 3-4.
    let stack = [];
    let executeStack = [];
    this.innerModuleEvaluation(stack, executeStack, 0);

    // Steps 6-7.
    assert(
      this.status == Status.evaluated,
      algorithm,
      "6",
      this.script,
      null,
    );
    assert(
      stack.length == 0,
      algorithm,
      "7",
      this.script,
      null,
    );
    assert(
      executeStack.length == 0,
      algorithm,
      "7.x.1",
      this.script,
      null,
    );
  }

  public abstract getRequestedModules(): RequestedModule[];

  protected abstract initializeEnvironment(): void;

  protected abstract executeModule(): void;
}

export class SourceTextModuleRecord extends CyclicModuleRecord {
  public readonly importEntries: ImportEntry[] = [];
  public readonly localExportEntries: LocalExportEntry[] = [];
  public readonly indirectExportEntries: IndirectExportEntry[] = [];
  public readonly starExportEntries: StarExportEntry[] = [];
  private hasExecuted: boolean = false;

  public constructor(
    host: ModuleHost,
    script: string,
    public readonly node: ESTree.Program
  ) {
    super(host.workingDirectory, host, script);
  }

  protected namespaceCreate(names: string[]): ModuleNamespace {
    let algorithm = "https://tc39.es/ecma262/#sec-modulenamespacecreate";

    // Step 2.
    assert(
      !this.namespace,
      algorithm,
      "2",
      this.script,
      null,
    );

    // Slightly out of order here as we can't create the namespace with empty
    // properties.

    // Stap 7.
    let sortedExports = [...names];
    sortedExports.sort();

    // Steps 4, 6, and 8.
    let namespace: ModuleNamespace = {
      module: this,
      exports: sortedExports,
    };

    // Step s 10-11.
    this.namespace = namespace;
    return namespace;
  }

  private maybeReportImportCycle(stack: SourceTextModuleRecord[], requiredModule: SourceTextModuleRecord, node: ESTree.Node): void {
    if (!stack.includes(requiredModule) || requiredModule.hasExecuted) {
      return;
    }

    // This indicates a module cycle.
    let cycleStack = [...stack];
    cycleStack.push(requiredModule);
    while (cycleStack[0] != requiredModule) {
      cycleStack.shift();
    }

    let lintMessage = buildLintMessage(
      IssueType.ImportCycle,
      `Import cycle: ${cycleStack.map((mod: SourceTextModuleRecord): string => mod.relativePath).join(" -> ")}`,
      node,
      1
    );
    this.host.addIssue({
      severity: Severity.Warning,
      filePath: this.script,
      lintMessage,
      type: IssueType.ImportCycle,
      stack: cycleStack,
    });
  }

  protected innerModuleLinking(stack: SourceTextModuleRecord[], index: number): number {
    let algorithm = "https://tc39.es/ecma262/#sec-InnerModuleLinking";

    // Step 2.
    if ([Status.linking, Status.linked, Status.evaluated].includes(this.status)) {
      return index;
    }

    // Step 3.
    assert(
      this.status == Status.unlinked,
      algorithm,
      "3",
      this.script,
      null
    );

    // Steps 4-8.
    this.status = Status.linking;
    this.index = index;
    this.ancestorIndex = index;
    index++;
    stack.push(this);

    // Step 9.
    for (let required of this.getRequestedModules()) {
      let requiredModule = this.host.resolveImportedModule(this, required.node, required.specifier);

      index = requiredModule.innerModuleLinking(stack, index);

      assert(
        [Status.linking, Status.linked, Status.evaluated].includes(requiredModule.status),
        algorithm,
        "9.c.i",
        this.script,
        required.node,
      );

      if (requiredModule.status == Status.linking) {
        assert(
          stack.includes(requiredModule),
          algorithm,
          "9.c.ii",
          this.script,
          required.node
        );

        if (typeof requiredModule.ancestorIndex != "number") {
          internalError("Expected ancestorIndex to have been set by now.", this.script, required.node);
        }

        this.ancestorIndex = Math.min(this.ancestorIndex, requiredModule.ancestorIndex);
      }
    }

    // Step 10.
    this.initializeEnvironment();

    // Steps 11-12.
    assert(
      stack.filter((mod: CyclicModuleRecord) => mod === this).length == 1,
      algorithm,
      "11",
      this.script,
      null,
    );
    assert(
      this.ancestorIndex <= this.index,
      algorithm,
      "12",
      this.script,
      null,
    );

    // Step 13.
    if (this.index == this.ancestorIndex) {
      while (stack.length > 0) {
        let requiredModule = stack.pop() as CyclicModuleRecord;
        requiredModule.status = Status.linked;
        if (requiredModule === this) {
          break;
        }
      }
    }

    // Step 14.
    return index;
  }

  protected innerModuleEvaluation(stack: CyclicModuleRecord[], executeStack: SourceTextModuleRecord[], index: number): number {
    let algorithm = "https://tc39.es/ecma262/#sec-innermoduleevaluation";

    // Steps 2-4.
    if ([Status.evaluated, Status.evaluating].includes(this.status)) {
      return index;
    }
    assert(
      this.status == Status.linked,
      algorithm,
      "4",
      this.script,
      null
    );

    // Steps 5-9.
    this.status = Status.evaluating;
    this.index = index;
    this.ancestorIndex = index;
    index++;
    stack.push(this);
    executeStack.push(this);

    // Step 10.
    for (let required of this.getRequestedModules()) {
      let requiredModule = this.host.resolveImportedModule(this, required.node, required.specifier);
      index = requiredModule.innerModuleEvaluation(stack, executeStack, index);

      assert(
        [Status.evaluating, Status.evaluated].includes(requiredModule.status),
        algorithm,
        "10.d.i",
        this.script,
        required.node,
      );

      if (requiredModule.status == Status.evaluating) {
        assert(
          stack.includes(requiredModule),
          algorithm,
          "10.d.ii",
          this.script,
          required.node
        );

        this.maybeReportImportCycle(executeStack, requiredModule, required.node);

        if (typeof requiredModule.ancestorIndex != "number") {
          internalError("Expected ancestorIndex to have been set by now.", this.script, required.node);
        }

        this.ancestorIndex = Math.min(this.ancestorIndex, requiredModule.ancestorIndex);
      }
    }

    // Step 11.
    this.executeModule();
    assert(
      executeStack.length > 0 && executeStack[executeStack.length - 1] == this,
      algorithm,
      "11.x.1",
      this.script,
      null,
    );
    executeStack.pop();
    this.hasExecuted = true;

    // Steps 12-13.
    assert(
      stack.filter((mod: CyclicModuleRecord) => mod === this).length == 1,
      algorithm,
      "12",
      this.script,
      null,
    );
    assert(
      this.ancestorIndex <= this.index,
      algorithm,
      "13",
      this.script,
      null,
    );

    // Step 14.
    if (this.index == this.ancestorIndex) {
      while (stack.length > 0) {
        let requiredModule = stack.pop() as CyclicModuleRecord;
        requiredModule.status = Status.evaluated;
        if (requiredModule === this) {
          break;
        }
      }
    }

    // Step 15.
    return index;
  }

  public getRequestedModules(): RequestedModule[] {
    let list: Map<string, RequestedModule> = new Map();

    for (let importEntry of this.importEntries) {
      list.set(importEntry.moduleRequest, {
        specifier: importEntry.moduleRequest,
        node: importEntry.node,
      });
    }

    for (let exportEntry of this.indirectExportEntries) {
      list.set(exportEntry.moduleRequest, {
        specifier: exportEntry.moduleRequest,
        node: exportEntry.node,
      });
    }

    for (let exportEntry of this.starExportEntries) {
      list.set(exportEntry.moduleRequest, {
        specifier: exportEntry.moduleRequest,
        node: exportEntry.node,
      });
    }

    return Array.from(list.values());
  }

  public getImportEntry(localName: string): ImportEntry | undefined {
    return this.importEntries.find((entry: ImportEntry): boolean => entry.localName == localName);
  }

  public getExportedNames(exportStarSet: SourceTextModuleRecord[] = []): string[] {
    // https://tc39.es/ecma262/#sec-getexportednames

    // Step 4.
    if (exportStarSet.includes(this)) {
      return [];
    }

    // Steps 5-6.
    exportStarSet.push(this);
    let exportedNames: string[] = [];

    // Step 7
    for (let exp of this.localExportEntries) {
      exportedNames.push(exp.exportName);
    }

    // Step 8
    for (let exp of this.indirectExportEntries) {
      exportedNames.push(exp.exportName);
    }

    // Step 9
    for (let exp of this.starExportEntries) {
      let requestedModule = this.host.resolveImportedModule(this, exp.node, exp.moduleRequest);
      let starNames = requestedModule.getExportedNames(exportStarSet);
      for (let name of starNames) {
        if (name != "default" && !exportedNames.includes(name)) {
          exportedNames.push(name);
        }
      }
    }

    // Step 10
    return exportedNames;
  }

  public resolveExport(exportName: string, resolveSet: ExportBinding[] = []): ResolvedBinding | "ambiguous" | null {
    // https://tc39.es/ecma262/#sec-resolveexport

    // Step 4.
    for (let binding of resolveSet) {
      if (binding.module == this && binding.exportName == exportName) {
        return null;
      }
    }

    // Step 5.
    resolveSet.push({
      module: this,
      exportName,
    });

    // Step 6.
    for (let exportEntry of this.localExportEntries) {
      if (exportEntry.exportName == exportName) {
        return {
          module: this,
          bindingName: exportEntry.localName,
        };
      }
    }

    // Step 7.
    for (let exportEntry of this.indirectExportEntries) {
      if (exportEntry.exportName == exportName) {
        let importedModule = this.host.resolveImportedModule(this, exportEntry.node, exportEntry.moduleRequest);
        if (exportEntry.importName == "*") {
          return {
            module: importedModule,
            bindingName: "*namespace*",
          };
        }
        return importedModule.resolveExport(exportEntry.importName, resolveSet);
      }
    }

    // Step 8.
    if (exportName == "default") {
      return null;
    }

    // Steps 9-10.
    let starResolution: ResolvedBinding | null = null;
    for (let exportEntry of this.starExportEntries) {
      let importedModule = this.host.resolveImportedModule(this, exportEntry.node, exportEntry.moduleRequest);
      let resolution = importedModule.resolveExport(exportName, resolveSet);
      if (resolution == "ambiguous") {
        return resolution;
      }
      if (resolution) {
        if (!starResolution) {
          starResolution = resolution;
        } else if (resolution.module != starResolution.module ||
                   resolution.bindingName != starResolution.bindingName) {
          return "ambiguous";
        }
      }
    }

    return starResolution;
  }

  protected initializeEnvironment(): void {
    // https://tc39.es/ecma262/#sec-source-text-module-record-initialize-environment

    // Step 2.
    for (let exportEntry of this.indirectExportEntries) {
      let resolution = this.resolveExport(exportEntry.exportName);
      if (!resolution) {
        throw new IssueError({
          severity: Severity.Error,
          filePath: this.script,
          type: IssueType.ExportError,
          lintMessage: buildLintMessage(
            IssueType.ExportError,
            `Export of ${exportEntry.exportName} could not be resolved.`,
            exportEntry.node,
            Severity.Error,
          )
        });
      }

      if (resolution == "ambiguous") {
        throw new IssueError({
          severity: Severity.Error,
          filePath: this.script,
          type: IssueType.ExportError,
          lintMessage: buildLintMessage(
            IssueType.ExportError,
            `Export of ${exportEntry.exportName} resolves ambiguously.`,
            exportEntry.node,
            Severity.Error,
          )
        });
      }
    }

    // Steps 4-8.
    this.environmentRecord = new EnvironmentRecord();

    // Step 9.
    for (let importEntry of this.importEntries) {
      let importedModule = this.host.resolveImportedModule(this, importEntry.node, importEntry.moduleRequest);
      if (importEntry.importName == "*") {
        this.environmentRecord.createImmutableBinding(importEntry.localName, importedModule.getModuleNamespace());
      } else {
        let resolution = importedModule.resolveExport(importEntry.importName);

        if (!resolution) {
          throw new IssueError({
            severity: Severity.Error,
            filePath: this.script,
            type: IssueType.ImportError,
            lintMessage: buildLintMessage(
              IssueType.ImportError,
              `Import of ${importEntry.importName} could not be resolved by ${importedModule.relativePath}.`,
              importEntry.node,
              Severity.Error,
            )
          });
        }
  
        if (resolution == "ambiguous") {
          throw new IssueError({
            severity: Severity.Error,
            filePath: this.script,
            type: IssueType.ImportError,
            lintMessage: buildLintMessage(
              IssueType.ImportError,
              `Import of ${importEntry.importName} resolves ambiguously.`,
              importEntry.node,
              Severity.Error,
            )
          });
        }

        if (resolution.bindingName == "*namespace*") {
          this.environmentRecord.createImmutableBinding(importEntry.localName, resolution.module.getModuleNamespace());
        } else {
          this.environmentRecord.createImportBinding(importEntry.localName, resolution.module, resolution.bindingName);
        }
      }
    }
  }

  protected executeModule(): void {
    // Nothing
  }
}
