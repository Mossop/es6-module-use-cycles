import path from "path";

import { Linter } from "eslint";
import { Variable, ScopeManager } from "eslint-scope";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { algorithmAssert, internalError, checkParented} from "./assert";
import { EnvironmentRecord } from "./environment";
import { ModuleHost } from "./host";
import { IssueType, Issue } from "./issue";
import { parseCode, importEntries, exportEntries, getBaseScope, getFunctionVariable } from "./parser";

// This is all mostly based on the ES spec: https://tc39.es/ecma262/#sec-modules
// Plus some additions for better reporting.

enum Status {
  unlinked = "unlinked",
  linking = "linking",
  linked = "linked",
  evaluating = "evaluating",
  evaluated = "evaluated",
}

type ImportEntryJSON = Omit<ImportEntry, "node" | "declaration" | "variable" | "toJSON"> & {
  node: string;
  declaration: string;
};

export class ImportEntry {
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
    public readonly localName: string,
    // The variable declared.
    public readonly variable: Variable,
  ) {}

  public toJSON(): ImportEntryJSON {
    return {
      node: this.node.type,
      declaration: this.declaration.type,
      moduleRequest: this.moduleRequest,
      importName: this.importName,
      localName: this.localName,
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
  readonly variable: Variable | null;
}

type ExportEntryJSON = Omit<ExportEntry, "node" | "declaration" | "variable"> & {
  node: string;
  declaration: string;
  variable: string | null;
};

export function exportEntryToJSON(entry: ExportEntry): ExportEntryJSON {
  return {
    node: entry.node.type,
    declaration: entry.declaration.type,
    moduleRequest: entry.moduleRequest,
    importName: entry.importName,
    exportName: entry.exportName,
    localName: entry.localName,
    variable: entry.variable ? entry.variable.name : null,
  };
}

interface CycleIssue {
  reasons: string[];
  exportBinding: ResolvedBinding;
}

export class LocalExportEntry implements ExportEntry {
  public readonly node: ESTree.Node;
  public readonly declaration: ESTree.Node;
  public readonly exportName: string;
  public readonly moduleRequest: null = null;
  public readonly importName: null = null;
  public readonly localName: string;
  public readonly variable: Variable | null;
  public cycleIssues: CycleIssue[] = [];

  public constructor(public readonly module: CyclicModuleRecord, entry: ExportEntry) {
    /* istanbul ignore if: We should be unable to trigger assertions in tests. */
    if (entry.moduleRequest || entry.importName || !entry.exportName || !entry.localName) {
      internalError(`Invalid attempt to use an ExportEntry as a LocalExportEntry: ${JSON.stringify(exportEntryToJSON(entry))}`);
    }

    /* istanbul ignore if: We should be unable to trigger assertions in tests. */
    if (!entry.variable && entry.localName != "*default*") {
      internalError(`Invalid attempt to use an ExportEntry as a LocalExportEntry: ${JSON.stringify(exportEntryToJSON(entry))}`);
    }

    this.module = module;
    this.node = entry.node;
    this.declaration = entry.declaration;
    this.exportName = entry.exportName;
    this.localName = entry.localName;
    this.variable = entry.variable;
  }

  public toJSON(): ExportEntryJSON {
    return exportEntryToJSON(this);
  }
}

export class IndirectExportEntry implements ExportEntry {
  public readonly node: ESTree.Node;
  public readonly declaration: ESTree.Node;
  public readonly exportName: string;
  public readonly moduleRequest: string;
  public readonly importName: string;
  public readonly localName: null = null;
  public readonly variable: null = null;

  public constructor(public readonly module: CyclicModuleRecord, entry: ExportEntry) {
    if (!entry.moduleRequest || !entry.importName || !entry.exportName || entry.localName || entry.variable) {
      internalError(`Invalid attempt to use an ExportEntry as a IndirectExportEntry: ${JSON.stringify(exportEntryToJSON(entry))}`);
    }

    this.node = entry.node;
    this.declaration = entry.declaration;
    this.moduleRequest = entry.moduleRequest;
    this.exportName = entry.exportName;
    this.importName = entry.importName;
  }

  public toJSON(): ExportEntryJSON {
    return exportEntryToJSON(this);
  }
}

export class StarExportEntry implements ExportEntry {
  public readonly node: ESTree.Node;
  public readonly declaration: ESTree.Node;
  public readonly exportName: null = null;
  public readonly moduleRequest: string;
  public readonly importName: "*" = "*";
  public readonly localName: null = null;
  public readonly variable: null = null;

  public constructor(public readonly module: CyclicModuleRecord, entry: ExportEntry) {
    /* istanbul ignore if: We should be unable to trigger assertions in tests. */
    if (!entry.moduleRequest || entry.importName != "*" || entry.exportName || entry.localName || entry.variable) {
      internalError(`Invalid attempt to use an ExportEntry as a StarExportEntry: ${JSON.stringify(exportEntryToJSON(entry))}`);
    }

    this.node = entry.node;
    this.declaration = entry.declaration;
    this.moduleRequest = entry.moduleRequest;
  }

  public toJSON(): ExportEntryJSON {
    return exportEntryToJSON(this);
  }
}

export interface ModuleNamespace {
  module: CyclicModuleRecord;
  exports: string[];
}

interface ResolvedBinding {
  module: CyclicModuleRecord;
  bindingName: string;
  exportEntry: LocalExportEntry | null;
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

  protected namespaceCreate(names: string[]): ModuleNamespace {
    let algorithm = "https://tc39.es/ecma262/#sec-modulenamespacecreate";

    // Step 2.
    algorithmAssert(
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
    algorithmAssert(
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

  public abstract innerModuleLinking(stack: CyclicModuleRecord[], index: number): number;

  public abstract getExportedNames(exportStarSet?: SourceTextModuleRecord[]): string[];

  public addIssue(issue: Issue): void {
    /* istanbul ignore if: We should be unable to trigger assertions in tests. */
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
    algorithmAssert(
      ![Status.linking, Status.evaluating].includes(this.status),
      algorithm,
      "2",
      this,
    );

    // Steps 3-4.
    this.innerModuleLinking([], 0);

    // Steps 6-7.
    algorithmAssert(
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
    algorithmAssert(
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
    algorithmAssert(
      this.status == Status.evaluated,
      algorithm,
      "6",
      this,
    );
    algorithmAssert(
      stack.length == 0,
      algorithm,
      "7",
      this,
    );
    algorithmAssert(
      executeStack.length == 0,
      algorithm,
      "7.x.1",
      this,
    );
  }
}

export class SourceTextModuleRecord extends CyclicModuleRecord {
  public readonly importEntries: ImportEntry[] = [];
  public readonly localExportEntries: Map<string, LocalExportEntry> = new Map();
  public readonly indirectExportEntries: Map<string, IndirectExportEntry> = new Map();
  public readonly starExportEntries: StarExportEntry[] = [];
  private importCycles: Set<ESTree.Node> = new Set();
  private scopeManager: ScopeManager | null = null;

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

  public get defaultExport(): LocalExportEntry | null {
    return this.localExportEntries.get("default") || null;
  }

  public parseCode(code: string, parserId: string, options: Linter.ParserOptions | undefined): void {
    let { program, scopeManager } = parseCode(code, parserId, options);
    this.scopeManager = scopeManager;

    // https://tc39.es/ecma262/#sec-parsemodule

    // Steps 4-6.
    for (let importEntry of importEntries(this, program, scopeManager)) {
      this.importEntries.push(importEntry);
    }

    // Steps 10-11.
    for (let exportEntry of exportEntries(this, program, scopeManager)) {
      if (exportEntry.moduleRequest == null) {
        /* istanbul ignore if: We should be unable to trigger assertions in tests. */
        if (!exportEntry.localName) {
          internalError("An export with no module specifier must have a local name.");
        }

        let importEntry = this.getImportEntry(exportEntry.localName);
        if (!importEntry) {
          let entry = new LocalExportEntry(this, exportEntry);
          this.localExportEntries.set(entry.exportName, entry);
        } else {
          if (importEntry.importName == "*") {
            let entry = new LocalExportEntry(this, exportEntry);
            this.localExportEntries.set(entry.exportName, entry);
          } else {
            let entry = new IndirectExportEntry(this, {
              node: exportEntry.node,
              declaration: exportEntry.declaration,
              moduleRequest: importEntry.moduleRequest,
              importName: importEntry.importName,
              localName: null,
              exportName: exportEntry.exportName,
              variable: null,
            });
            this.indirectExportEntries.set(entry.exportName, entry);
          }
        }
      } else {
        if (exportEntry.importName == "*" && exportEntry.exportName == null) {
          this.starExportEntries.push(new StarExportEntry(this, exportEntry));
        } else {
          let entry = new IndirectExportEntry(this, exportEntry);
          this.indirectExportEntries.set(entry.exportName, entry);
        }
      }
    }
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
    algorithmAssert(
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

      algorithmAssert(
        [Status.linking, Status.linked, Status.evaluated].includes(requiredModule.status),
        algorithm,
        "9.c.i",
        this
      );

      if (requiredModule.status == Status.linking) {
        algorithmAssert(
          stack.includes(requiredModule),
          algorithm,
          "9.c.ii",
          this
        );

        /* istanbul ignore if: This should always have been set by now. */
        if (typeof requiredModule.ancestorIndex != "number") {
          internalError("Expected ancestorIndex to have been set by now.");
        }

        this.ancestorIndex = Math.min(this.ancestorIndex, requiredModule.ancestorIndex);
      }
    }

    // Step 10.
    this.initializeEnvironment();

    // Steps 11-12.
    algorithmAssert(
      stack.filter((mod: CyclicModuleRecord) => mod === this).length == 1,
      algorithm,
      "11",
      this
    );
    algorithmAssert(
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
    algorithmAssert(
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

      algorithmAssert(
        [Status.evaluating, Status.evaluated].includes(requiredModule.status),
        algorithm,
        "10.d.i",
        this
      );

      if (requiredModule.status == Status.evaluating) {
        algorithmAssert(
          stack.includes(requiredModule),
          algorithm,
          "10.d.ii",
          this
        );

        this.maybeReportImportCycle(executeStack, requiredModule, required);

        /* istanbul ignore if: This should always have been set by now. */
        if (typeof requiredModule.ancestorIndex != "number") {
          internalError("Expected ancestorIndex to have been set by now.");
        }

        this.ancestorIndex = Math.min(this.ancestorIndex, requiredModule.ancestorIndex);
      }
    }

    // Step 11.
    this.executeModule();
    algorithmAssert(
      executeStack.length > 0 && executeStack[executeStack.length - 1] == this,
      algorithm,
      "11.x.1",
      this
    );
    executeStack.pop();
    this.hasExecuted = true;

    // Steps 12-13.
    algorithmAssert(
      stack.filter((mod: CyclicModuleRecord) => mod === this).length == 1,
      algorithm,
      "12",
      this
    );
    algorithmAssert(
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

    for (let exportEntry of this.indirectExportEntries.values()) {
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
    exportedNames.push(...this.localExportEntries.keys());

    // Step 8
    exportedNames.push(...this.indirectExportEntries.keys());

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
    let localEntry = this.localExportEntries.get(exportName);
    if (localEntry) {
      return {
        module: this,
        bindingName: localEntry.localName,
        exportEntry: localEntry,
      };
    }

    // Step 7.
    let indirectEntry = this.indirectExportEntries.get(exportName);
    if (indirectEntry) {
      let importedModule = this.host.resolveImportedModule(this, indirectEntry.moduleRequest);

      if (indirectEntry.importName == "*") {
        return {
          module: importedModule,
          bindingName: "*namespace",
          exportEntry: null,
        };
      }
      return importedModule.resolveExport(indirectEntry.importName, resolveSet);
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
    for (let exportEntry of this.indirectExportEntries.values()) {
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

        if (!resolution.exportEntry) {
          this.environmentRecord.createImmutableBinding(importEntry.localName, resolution.module.getModuleNamespace());
        } else {
          this.environmentRecord.createImportBinding(importEntry.localName, resolution.module, resolution.bindingName);
        }
      }
    }
  }

  private markFunctionVariableUnusable(importEntry: ImportEntry, functionVariable: Variable | LocalExportEntry,
    currentReason: string, issue: CycleIssue): void {
    /* istanbul ignore if: This should always have been set by now. */
    if (!this.scopeManager) {
      internalError(`Executing module ${this.relativePath} before it has been parsed.`);
    }

    let reasons = [...issue.reasons];
    if (functionVariable instanceof LocalExportEntry) {
      reasons.unshift(`  calling '${functionVariable.localName}' from '${this.relativePath}' ${currentReason}`);
      functionVariable.cycleIssues.push({
        reasons,
        exportBinding: issue.exportBinding,
      });
    } else {
      reasons.unshift(`  calling '${functionVariable.name}' from '${this.relativePath}' ${currentReason}`);

      let exportEntry = this.localExportEntries.get(functionVariable.name);
      if (exportEntry && exportEntry.variable == functionVariable) {
        exportEntry.cycleIssues.push({
          reasons,
          exportBinding: issue.exportBinding,
        });
      }

      for (let reference of functionVariable.references) {
        checkParented(reference.identifier);

        // We only care about calls of this function.
        if (reference.identifier.parent.type != "CallExpression") {
          continue;
        }

        if (issue.exportBinding.module == this && issue.exportBinding.exportEntry) {
          let eloc = issue.exportBinding.exportEntry.declaration.loc;
          let iloc = reference.identifier.loc;
          if (eloc && iloc) {
            if (eloc.start.line < iloc.start.line) {
              continue;
            }

            if (eloc.start.line == iloc.start.line && eloc.start.column < iloc.start.column) {
              continue;
            }
          }
        }

        let scope = getBaseScope(reference.from);
        if (scope.type == "global") {
          // Almost always a problem.
          this.addIssue({
            module: this,
            type: IssueType.UseBeforeExecution,
            importEntry,
            message: `Calling '${functionVariable.name}' will fail due to an import cycle:\n${reasons.join("\n")}`,
            node: reference.identifier,
          });
          continue;
        }

        if (scope.type == "function") {
          let outer = getFunctionVariable(this, this.scopeManager, scope);
          if (outer) {
            this.markFunctionVariableUnusable(importEntry, outer, `calls '${functionVariable.name}'.`, {
              reasons,
              exportBinding: issue.exportBinding,
            });
          }
        }
      }
    }
  }

  protected executeModule(): void {
    /* istanbul ignore if: This should always have been set by now. */
    if (!this.scopeManager) {
      internalError(`Executing module ${this.relativePath} before it has been parsed.`);
    }

    for (let importEntry of this.importEntries) {
      let importedModule = this.host.resolveImportedModule(this, importEntry.moduleRequest);
      let exported = importedModule.resolveExport(importEntry.importName);
      if (!exported || exported == "ambiguous") {
        continue;
      }

      if (!exported.module.hasExecuted) {
        // This import is entirely unusable. See if it is used anywhere.
        for (let reference of importEntry.variable.references) {
          checkParented(reference.identifier);

          if (reference.identifier.parent.type == "ExportSpecifier") {
            // Simply exporting the import does not count as usage since it will get
            // resolved directly to the imported module.
            continue;
          }

          let scope = getBaseScope(reference.from);
          if (scope.type == "global") {
            // Almost always a problem.
            this.addIssue({
              module: this,
              type: IssueType.UseBeforeExecution,
              importEntry,
              message: `Imported '${importEntry.localName}' is used before '${exported.module.relativePath}' has been evaluated.`,
              node: reference.identifier,
            });
            continue;
          }

          if (scope.type == "function") {
            let functionVariable = getFunctionVariable(this, this.scopeManager, scope);
            if (functionVariable) {
              this.markFunctionVariableUnusable(importEntry, functionVariable,
                `uses imported '${importEntry.localName}' before '${exported.module.relativePath}' has been evaluated.`, {
                  reasons: [],
                  exportBinding: exported,
                });
            }
          }
        }
      } else if (exported.exportEntry) {
        for (let issue of exported.exportEntry.cycleIssues) {
          // If the cause of this issue has executed then it is no longer an issue.
          if (issue.exportBinding.module.hasExecuted) {
            continue;
          }

          this.markFunctionVariableUnusable(importEntry, importEntry.variable,
            `is calling '${exported.exportEntry.localName}' exported from '${exported.module.relativePath}'.`, issue);
        }
      }
    }
  }
}

export class ExternalModuleRecord extends CyclicModuleRecord {
  public getExportedNames(_exportStarSet?: SourceTextModuleRecord[] | undefined): string[] {
    return [];
  }

  public innerModuleLinking(_stack: SourceTextModuleRecord[], index: number): number {
    // A vastly simplified version for this special case.
    let algorithm = "https://tc39.es/ecma262/#sec-InnerModuleLinking";

    /* istanbul ignore if: External modules can never be anything but a leaf in the stack. */
    if ([Status.linking, Status.linked, Status.evaluated].includes(this.status)) {
      return index;
    }

    algorithmAssert(
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
    /* istanbul ignore if: External modules can never be anything but a leaf in the stack. */
    if ([Status.evaluated, Status.evaluating].includes(this.status)) {
      return index;
    }

    algorithmAssert(
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
      exportEntry: null,
    };
  }
}

export type ConcreteModule = SourceTextModuleRecord | ExternalModuleRecord;
