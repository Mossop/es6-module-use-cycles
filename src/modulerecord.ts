import path from "path";

// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { ModuleHost } from "./host";
import { assert, internalError, IssueType, Severity, buildLintMessage } from "./issue";

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

export class LocalExportEntry {
  public readonly moduleRequest: null = null;
  public readonly importName: null = null;

  public constructor(
    public readonly node: ESTree.Node,
    public readonly exportName: string,
    public readonly localName: string
  ) {}
}

export class IndirectExportEntry {
  public readonly localName: null = null;

  public constructor(
    public readonly node: ESTree.Node,
    public readonly exportName: string | null,
    public readonly moduleRequest: string,
    public readonly importName: string
  ) {
  }
}

export type ExportEntry = LocalExportEntry | IndirectExportEntry;

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
  public environment: undefined = undefined;
  public namespace: undefined = undefined;

  public constructor(public readonly host: ModuleHost) {
  }

  public abstract link(): void;

  public abstract evaluate(): void;

  public abstract resolveExport(exportName: string, resolveSet?: ExportBinding[]): ResolvedBinding | "ambiguous" | null;
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

  protected abstract innerModuleLinking(stack: SourceTextModuleRecord[], index: number): number;

  public link(): void {
    let algorithm = "https://tc39.es/ecma262/#sec-moduledeclarationlinking";

    // Step 2.
    assert(
      this.status != Status.linking && this.status != Status.evaluating,
      algorithm,
      "2",
      this.script,
      null
    );

    // Steps 3-4.
    this.innerModuleLinking([], 0);

    // Steps 6-7.
    assert(
      this.status == Status.linked || this.status == Status.evaluated,
      algorithm,
      "6",
      this.script,
      null
    );
  }

  public evaluate(): void {
    // Nothing.
  }

  public abstract getRequestedModules(): RequestedModule[];

  public abstract initializeEnvironment(): void;

  // public abstract executeModule(): string;
}

export class SourceTextModuleRecord extends CyclicModuleRecord {
  public readonly importEntries: ImportEntry[] = [];
  public readonly localExportEntries: LocalExportEntry[] = [];
  public readonly indirectExportEntries: IndirectExportEntry[] = [];
  public readonly starExportEntries: IndirectExportEntry[] = [];

  public constructor(
    host: ModuleHost,
    script: string,
    public readonly node: ESTree.Program
  ) {
    super(host.workingDirectory, host, script);
  }

  private maybeReportImportCycle(stack: SourceTextModuleRecord[], requiredModule: SourceTextModuleRecord, node: ESTree.Node): void {
    if (requiredModule.status != Status.linking) {
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

      this.maybeReportImportCycle(stack, requiredModule, required.node);

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

  public getRequestedModules(): RequestedModule[] {
    let list: Map<string, RequestedModule> = new Map();
    for (let importEntry of this.importEntries) {
      list.set(importEntry.moduleRequest, {
        specifier: importEntry.moduleRequest,
        node: importEntry.node,
      });
    }
    return Array.from(list.values());
  }

  public getImportEntry(localName: string): ImportEntry | undefined {
    return this.importEntries.find((entry: ImportEntry): boolean => entry.localName == localName);
  }

  public getImportedLocalNames(): string[] {
    return this.importEntries.map((entry: ImportEntry): string => entry.localName);
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
      if (exp.exportName) {
        exportedNames.push(exp.exportName);
      }
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
        }

        if (resolution.module != starResolution.module ||
            resolution.bindingName != starResolution.bindingName) {
          return "ambiguous";
        }
      }
    }

    return starResolution;
  }

  public initializeEnvironment(): void {
    // Nothing.
  }
}
