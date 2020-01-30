import path from "path";

import { Linter } from "eslint";
import { ScopeManager } from "eslint-scope";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { EnvironmentRecord } from "./environment";
import { ModuleHost } from "./host";
import { assert, internalError, IssueType, Issue } from "./issue";
import { parseCode, importEntries, exportEntries, findImportUsage } from "./parser";

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
  public executionUse: ESTree.Node[] = [];

  public constructor(
    // The import specifier.
    public readonly node: ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier | ESTree.ImportSpecifier,
    // The import declaration node.
    public readonly declaration: ESTree.ImportDeclaration,
    // The module specifier.
    public readonly moduleRequest: string,
    // The name of the export, may be "*" or "default".
    public readonly importName: string,
    // The name that is used locally.
    public readonly localName: string
  ) {}

  public toJSON(): object {
    return {
      node: this.node.type,
      declaration: this.declaration.type,
      moduleRequest: this.moduleRequest,
      importName: this.importName,
      localName: this.localName,
      usedInExecution: !!this.executionUse,
    };
  }
}

export interface ExportEntry {
  readonly node: ESTree.Node;
  readonly declaration: ESTree.Node;
  readonly exportName: string | null;
  readonly moduleRequest: string | null;
  readonly importName: string | null;
  readonly localName: string | null;
}

export class LocalExportEntry implements ExportEntry {
  public readonly node: ESTree.Node;
  public readonly declaration: ESTree.Node;
  public readonly exportName: string;
  public readonly moduleRequest: null = null;
  public readonly importName: null = null;
  public readonly localName: string;

  public constructor(public readonly module: CyclicModuleRecord, entry: ExportEntry) {
    if (entry.moduleRequest || entry.importName || !entry.exportName || !entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry (${JSON.stringify(entry)}) as a LocalExportEntry.`);
    }

    this.module = module;
    this.node = entry.node;
    this.declaration = entry.declaration;
    this.exportName = entry.exportName;
    this.localName = entry.localName;
  }

  public toJSON(): object {
    return {
      node: this.node.type,
      declaration: this.declaration.type,
      moduleRequest: this.moduleRequest,
      importName: this.importName,
      exportName: this.exportName,
      localName: this.localName,
    };
  }
}

export class IndirectExportEntry implements ExportEntry {
  public readonly node: ESTree.Node;
  public readonly declaration: ESTree.Node;
  public readonly exportName: string;
  public readonly moduleRequest: string;
  public readonly importName: string;
  public readonly localName: null = null;

  public constructor(public readonly module: CyclicModuleRecord, entry: ExportEntry) {
    if (!entry.moduleRequest || !entry.importName || !entry.exportName || entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry (${JSON.stringify(entry)}) as a IndirectExportEntry.`);
    }

    this.node = entry.node;
    this.declaration = entry.declaration;
    this.moduleRequest = entry.moduleRequest;
    this.exportName = entry.exportName;
    this.importName = entry.importName;
  }

  public toJSON(): object {
    return {
      node: this.node.type,
      declaration: this.declaration.type,
      moduleRequest: this.moduleRequest,
      importName: this.importName,
      exportName: this.exportName,
      localName: this.localName,
    };
  }
}

export class StarExportEntry implements ExportEntry {
  public readonly node: ESTree.Node;
  public readonly declaration: ESTree.Node;
  public readonly exportName: null = null;
  public readonly moduleRequest: string;
  public readonly importName: "*" = "*";
  public readonly localName: null = null;

  public constructor(public readonly module: CyclicModuleRecord, entry: ExportEntry) {
    if (!entry.moduleRequest || entry.importName != "*" || entry.exportName || entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry (${JSON.stringify(entry)}) as a StarExportEntry.`);
    }

    this.node = entry.node;
    this.declaration = entry.declaration;
    this.moduleRequest = entry.moduleRequest;
  }

  public toJSON(): object {
    return {
      node: this.node.type,
      declaration: this.declaration.type,
      moduleRequest: this.moduleRequest,
      importName: this.importName,
      exportName: this.exportName,
      localName: this.localName,
    };
  }
}

export interface ModuleNamespace {
  module: SourceTextModuleRecord;
  exports: string[];
}

interface ResolvedBinding {
  module: CyclicModuleRecord;
  bindingName: string;
}

interface ExportBinding {
  module: SourceTextModuleRecord;
  exportName: string;
}

interface RequestedModule {
  specifier: string;
  node: ESTree.Node;
  declaration: ESTree.Node;
}

abstract class ModuleRecord {
  public environmentRecord: EnvironmentRecord | undefined = undefined;
  public namespace: ModuleNamespace | undefined = undefined;

  public constructor(public readonly host: ModuleHost) {
  }

  public abstract link(): void;

  public abstract evaluate(): void;

  public abstract resolveExport(exportName: string, resolveSet?: ExportBinding[]): ResolvedBinding | "ambiguous" | null;

  public abstract getModuleNamespace(): ModuleNamespace;
}

export abstract class CyclicModuleRecord extends ModuleRecord {
  public status: Status = Status.unlinked;
  public index: number | undefined = undefined;
  public ancestorIndex: number | undefined = undefined;
  public readonly relativePath: string;
  public hasExecuted: boolean = false;
  private issues: Issue[] = [];

  public constructor(workingDirectory: string, host: ModuleHost, public readonly modulePath: string) {
    super(host);
    if (modulePath.startsWith("/")) {
      this.relativePath = path.relative(workingDirectory, modulePath);
    } else {
      this.relativePath = modulePath;
    }
  }

  public resolveModule(specifier: string): string {
    return this.host.resolveModule(this, specifier);
  }

  public abstract getModuleNamespace(): ModuleNamespace;

  public abstract innerModuleLinking(stack: CyclicModuleRecord[], index: number): number;

  public abstract getExportedNames(exportStarSet?: SourceTextModuleRecord[]): string[];

  public addIssue(issue: Issue): void {
    if (issue.module != this) {
      internalError("Attempt to add an issue to the wrong module.");
    }

    this.issues.push(issue);
  }

  public getIssues(): Issue[] {
    return [...this.issues];
  }

  public link(): void {
    let algorithm = "https://tc39.es/ecma262/#sec-moduledeclarationlinking";

    // Step 2.
    assert(
      ![Status.linking, Status.evaluating].includes(this.status),
      algorithm,
      "2",
      this,
    );

    // Steps 3-4.
    this.innerModuleLinking([], 0);

    // Steps 6-7.
    assert(
      [Status.linked, Status.evaluated].includes(this.status),
      algorithm,
      "6",
      this,
    );
  }

  public abstract innerModuleEvaluation(stack: CyclicModuleRecord[], executeStack: SourceTextModuleRecord[], index: number): number;

  public evaluate(): void {
    let algorithm = "https://tc39.es/ecma262/#sec-moduleevaluation";

    // Step 2.
    assert(
      [Status.linked, Status.evaluated].includes(this.status),
      algorithm,
      "2",
      this,
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
      this,
    );
    assert(
      stack.length == 0,
      algorithm,
      "7",
      this,
    );
    assert(
      executeStack.length == 0,
      algorithm,
      "7.x.1",
      this,
    );
  }
}

export class SourceTextModuleRecord extends CyclicModuleRecord {
  public readonly importEntries: ImportEntry[] = [];
  public readonly localExportEntries: LocalExportEntry[] = [];
  public readonly indirectExportEntries: IndirectExportEntry[] = [];
  public readonly starExportEntries: StarExportEntry[] = [];
  private importCycles: Set<ESTree.Node> = new Set();

  public constructor(
    host: ModuleHost,
    modulePath: string
  ) {
    super(host.workingDirectory, host, modulePath);
  }

  public toJSON(): object {
    return {
      modulePath: this.modulePath,
      relativePath: this.relativePath,
      status: this.status,
      hasExecuted: this.hasExecuted,
    };
  }

  private analyseImports(scopeManager: ScopeManager): void {
    for (let importEntry of this.importEntries) {
      findImportUsage(scopeManager, importEntry);
    }
  }

  public parseCode(code: string, parserId: string, options: Linter.ParserOptions | undefined): void {
    let { program, scopeManager } = parseCode(code, parserId, options);

    // https://tc39.es/ecma262/#sec-parsemodule

    // Steps 4-6.
    for (let importEntry of importEntries(this, program)) {
      this.importEntries.push(importEntry);
    }

    // Steps 10-11.
    for (let exportEntry of exportEntries(this, program)) {
      if (exportEntry.moduleRequest == null) {
        if (!exportEntry.localName) {
          internalError("An export with no module specifier must have a local name.");
        }

        let importEntry = this.getImportEntry(exportEntry.localName);
        if (!importEntry) {
          this.localExportEntries.push(new LocalExportEntry(this, exportEntry));
        } else {
          if (importEntry.importName == "*") {
            this.localExportEntries.push(new LocalExportEntry(this, exportEntry));
          } else {
            this.indirectExportEntries.push(new IndirectExportEntry(this, {
              node: exportEntry.node,
              declaration: exportEntry.declaration,
              moduleRequest: importEntry.moduleRequest,
              importName: importEntry.importName,
              localName: null,
              exportName: exportEntry.exportName,
            }));
          }
        }
      } else {
        if (exportEntry.importName == "*" && exportEntry.exportName == null) {
          this.starExportEntries.push(new StarExportEntry(this, exportEntry));
        } else {
          this.indirectExportEntries.push(new IndirectExportEntry(this, exportEntry));
        }
      }
    }

    this.analyseImports(scopeManager);
  }

  protected namespaceCreate(names: string[]): ModuleNamespace {
    let algorithm = "https://tc39.es/ecma262/#sec-modulenamespacecreate";

    // Step 2.
    assert(
      !this.namespace,
      algorithm,
      "2",
      this,
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

  public getModuleNamespace(): ModuleNamespace {
    let algorithm = "https://tc39.es/ecma262/#sec-getmodulenamespace";

    // Step 2.
    assert(
      this.status != Status.unlinked,
      algorithm,
      "2",
      this,
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

  private maybeReportImportCycle(stack: CyclicModuleRecord[], requiredModule: CyclicModuleRecord, requestedModule: RequestedModule): void {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    if (requiredModule instanceof ExternalModuleRecord) {
      return;
    }

    if (!stack.includes(requiredModule) || requiredModule.hasExecuted || this.importCycles.has(requestedModule.declaration)) {
      return;
    }

    // This indicates a module cycle.
    let cycleStack = [...stack];
    cycleStack.push(requiredModule);
    while (cycleStack[0] != requiredModule) {
      cycleStack.shift();
    }

    this.addIssue({
      module: this,
      message: `Import cycle: ${cycleStack.map((mod: SourceTextModuleRecord): string => mod.relativePath).join(" -> ")}`,
      type: IssueType.ImportCycle,
      stack: cycleStack,
      node: requestedModule.declaration,
    });

    this.importCycles.add(requestedModule.declaration);
  }

  public innerModuleLinking(stack: CyclicModuleRecord[], index: number): number {
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
      this
    );

    // Steps 4-8.
    this.status = Status.linking;
    this.index = index;
    this.ancestorIndex = index;
    index++;
    stack.push(this);

    // Step 9.
    for (let required of this.getRequestedModules()) {
      let requiredModule = this.host.resolveImportedModule(this, required.specifier);

      index = requiredModule.innerModuleLinking(stack, index);

      assert(
        [Status.linking, Status.linked, Status.evaluated].includes(requiredModule.status),
        algorithm,
        "9.c.i",
        this
      );

      if (requiredModule.status == Status.linking) {
        assert(
          stack.includes(requiredModule),
          algorithm,
          "9.c.ii",
          this
        );

        if (typeof requiredModule.ancestorIndex != "number") {
          internalError("Expected ancestorIndex to have been set by now.");
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
      this
    );
    assert(
      this.ancestorIndex <= this.index,
      algorithm,
      "12",
      this
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

  public innerModuleEvaluation(stack: CyclicModuleRecord[], executeStack: SourceTextModuleRecord[], index: number): number {
    let algorithm = "https://tc39.es/ecma262/#sec-innermoduleevaluation";

    // Steps 2-4.
    if ([Status.evaluated, Status.evaluating].includes(this.status)) {
      return index;
    }
    assert(
      this.status == Status.linked,
      algorithm,
      "4",
      this
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
      let requiredModule = this.host.resolveImportedModule(this, required.specifier);

      index = requiredModule.innerModuleEvaluation(stack, executeStack, index);

      assert(
        [Status.evaluating, Status.evaluated].includes(requiredModule.status),
        algorithm,
        "10.d.i",
        this
      );

      if (requiredModule.status == Status.evaluating) {
        assert(
          stack.includes(requiredModule),
          algorithm,
          "10.d.ii",
          this
        );

        this.maybeReportImportCycle(executeStack, requiredModule, required);

        if (typeof requiredModule.ancestorIndex != "number") {
          internalError("Expected ancestorIndex to have been set by now.");
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
      this
    );
    executeStack.pop();
    this.hasExecuted = true;

    // Steps 12-13.
    assert(
      stack.filter((mod: CyclicModuleRecord) => mod === this).length == 1,
      algorithm,
      "12",
      this
    );
    assert(
      this.ancestorIndex <= this.index,
      algorithm,
      "13",
      this
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
        declaration: importEntry.declaration,
      });
    }

    for (let exportEntry of this.indirectExportEntries) {
      list.set(exportEntry.moduleRequest, {
        specifier: exportEntry.moduleRequest,
        node: exportEntry.node,
        declaration: exportEntry.declaration,
      });
    }

    for (let exportEntry of this.starExportEntries) {
      list.set(exportEntry.moduleRequest, {
        specifier: exportEntry.moduleRequest,
        node: exportEntry.node,
        declaration: exportEntry.declaration,
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
      let requestedModule = this.host.resolveImportedModule(this, exp.moduleRequest);

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
        let importedModule = this.host.resolveImportedModule(this, exportEntry.moduleRequest);

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
      let importedModule = this.host.resolveImportedModule(this, exportEntry.moduleRequest);

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
        this.addIssue({
          module: this,
          type: IssueType.ExportError,
          message: `Export of ${exportEntry.exportName} could not be resolved.`,
          node: exportEntry.node,
        });

        continue;
      }

      if (resolution == "ambiguous") {
        this.addIssue({
          module: this,
          type: IssueType.ExportError,
          message: `Export of ${exportEntry.exportName} resolved ambiguously.`,
          node: exportEntry.node,
        });

        continue;
      }
    }

    // Steps 4-8.
    this.environmentRecord = new EnvironmentRecord();

    // Step 9.
    for (let importEntry of this.importEntries) {
      let importedModule = this.host.resolveImportedModule(this, importEntry.moduleRequest);

      if (importEntry.importName == "*") {
        this.environmentRecord.createImmutableBinding(importEntry.localName, importedModule.getModuleNamespace());
      } else {
        let resolution = importedModule.resolveExport(importEntry.importName);

        if (!resolution) {
          this.addIssue({
            module: this,
            node: importEntry.node,
            type: IssueType.ImportError,
            message: `Import of ${importEntry.importName} could not be resolved by ${importedModule.relativePath}.`,
            specifier: importEntry.moduleRequest,
          });

          continue;
        }
  
        if (resolution == "ambiguous") {
          this.addIssue({
            module: this,
            node: importEntry.node,
            type: IssueType.ImportError,
            message: `Import of ${importEntry.importName} resolves ambiguously.`,
            specifier: importEntry.moduleRequest,
          });

          continue;
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
    for (let importEntry of this.importEntries) {
      if (!importEntry.executionUse.length) {
        // This import is not needed for execution so nothing more to do.
        continue;
      }

      let importedModule = this.host.resolveImportedModule(this, importEntry.moduleRequest);
      let exported = importedModule.resolveExport(importEntry.importName);
      if (!exported || exported == "ambiguous") {
        continue;
      }

      if (!exported.module.hasExecuted) {
        // The imported module has not been evaluated so use of this import will
        // fail.
        for (let use of importEntry.executionUse) {
          this.addIssue({
            module: this,
            type: IssueType.UseBeforeExecution,
            importEntry,
            message: `Import '${importEntry.localName}' is used before '${exported.module.relativePath}' has been evaluated.`,
            node: use,
          });
        }
      }
    }
  }
}

export class ExternalModuleRecord extends CyclicModuleRecord {
  public getExportedNames(_exportStarSet?: SourceTextModuleRecord[] | undefined): string[] {
    return [];
  }

  public getModuleNamespace(): ModuleNamespace {
    throw new Error("Method not implemented.");
  }

  public innerModuleLinking(_stack: SourceTextModuleRecord[], index: number): number {
    // A vastly simplified version for this special case.
    let algorithm = "https://tc39.es/ecma262/#sec-InnerModuleLinking";

    if ([Status.linking, Status.linked, Status.evaluated].includes(this.status)) {
      return index;
    }

    assert(
      this.status == Status.unlinked,
      algorithm,
      "3",
      this
    );

    this.status = Status.linked;
    this.index = index;
    this.ancestorIndex = index;
    index++;

    return index;
  }

  public innerModuleEvaluation(_stack: SourceTextModuleRecord[], _executeStack: SourceTextModuleRecord[], index: number): number {
    // A vastly simplified version for this special case.
    let algorithm = "https://tc39.es/ecma262/#sec-innermoduleevaluation";

    // Steps 2-4.
    if ([Status.evaluated, Status.evaluating].includes(this.status)) {
      return index;
    }
    assert(
      this.status == Status.linked,
      algorithm,
      "4",
      this
    );

    // Steps 5-9.
    this.status = Status.evaluated;
    this.hasExecuted = true;
    this.index = index;
    this.ancestorIndex = index;
    index++;

    return index;
  }

  public resolveExport(exportName: string): ResolvedBinding | "ambiguous" | null {
    return {
      module: this,
      bindingName: exportName,
    };
  }
}

export type ConcreteModule = SourceTextModuleRecord | ExternalModuleRecord;
