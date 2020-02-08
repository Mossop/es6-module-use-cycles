import fs from "fs";
import path from "path";

import { CLIEngine } from "eslint";
import resolve from "resolve";

import { Issue, IssueType } from "./issue";
import { SourceTextModuleRecord, CyclicModuleRecord, ExternalModuleRecord, RequestedModule } from "./modulerecord";

export class ModuleHost {
  private readonly engine: CLIEngine;
  private moduleRecords: Map<string, SourceTextModuleRecord | null> = new Map();
  private externalModules: Map<string, ExternalModuleRecord> = new Map();

  public constructor(
    private readonly moduleExtensions: string[],
    public readonly workingDirectory: string
  ) {
    this.engine = new CLIEngine({
      extensions: moduleExtensions,
      cwd: workingDirectory,
    });
  }

  public reset(): void {
    this.moduleRecords.clear();
    this.externalModules.clear();
  }

  public getFilenames(): string[] {
    return Array.from(this.moduleRecords.values()).map((module: SourceTextModuleRecord): string => module.modulePath);
  }

  public getModule(modulePath: string): SourceTextModuleRecord | null {
    return this.moduleRecords.get(modulePath) || null;
  }

  public getIssues(): Issue[] {
    let issues: Issue[] = [];
    for (let module of this.moduleRecords.values()) {
      if (module) {
        issues.push(...module.getIssues());
      }
    }

    return issues;
  }

  public resolveModule(sourceModule: CyclicModuleRecord, specifier: string): string {
    return resolve.sync(specifier, {
      basedir: path.dirname(sourceModule.modulePath),
      extensions: this.moduleExtensions,
    });
  }

  public resolveImportedModule(referencingModule: CyclicModuleRecord, requestedModule: RequestedModule): CyclicModuleRecord | null {
    if (!requestedModule.specifier.startsWith(".")) {
      let module = this.externalModules.get(requestedModule.specifier);
      if (!module) {
        module = new ExternalModuleRecord(this.workingDirectory, this, requestedModule.specifier);
        this.externalModules.set(requestedModule.specifier, module);
      }
      return module;
    }

    // Resolve a module to its target file.
    let modulePath = this.resolveModule(referencingModule, requestedModule.specifier);

    let module = this.moduleRecords.get(modulePath);
    if (module !== undefined) {
      return module;
    }

    try {
      let sourceText = fs.readFileSync(modulePath, { encoding: "utf8" });
      return this.parseModule(sourceText, modulePath);
    } catch (e) {
      referencingModule.addIssue({
        type: IssueType.ImportError,
        specifier: requestedModule.specifier,
        module: referencingModule,
        node: requestedModule.node,
        message: `Failed to parse ${modulePath}: ${e}`,
      });
      return null;
    }
  }

  public parseEntrypoint(modulePath: string): SourceTextModuleRecord | null {
    let sourceText = fs.readFileSync(modulePath, { encoding: "utf8" });
    return this.topLevelModuleEvaluation(sourceText, modulePath);
  }

  public topLevelModuleEvaluation(sourceText: string, modulePath: string): SourceTextModuleRecord | null {
    let module = this.parseModule(sourceText, modulePath);
    module.link();
    module.evaluate();
    return module;
  }

  private parseModule(sourceText: string, modulePath: string): SourceTextModuleRecord {
    let module: SourceTextModuleRecord = new SourceTextModuleRecord(this, modulePath);
    this.moduleRecords.set(modulePath, module);

    try {
      let config = this.engine.getConfigForFile(modulePath);
      let wd = process.cwd();
      process.chdir(this.workingDirectory);
      module.parseCode(sourceText, config.parser || "espree", config.parserOptions);
      process.chdir(wd);
      return module;
    } catch (e) {
      this.moduleRecords.set(modulePath, null);
      throw e;
    }
  }
}
