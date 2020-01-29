import fs from "fs";
import path from "path";

import { Linter, Rule, CLIEngine } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";
import resolve from "resolve";

import { Issue, IssueType } from "./issue";
import { SourceTextModuleRecord, CyclicModuleRecord, ExternalModuleRecord } from "./modulerecord";
import { createParser } from "./parser";

export class ModuleHost {
  private readonly engine: CLIEngine;
  private moduleRecords: Map<string, SourceTextModuleRecord> = new Map();
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
      issues.push(...module.getIssues());
    }

    return issues;
  }

  public resolveModule(sourceModule: CyclicModuleRecord, specifier: string): string {
    return resolve.sync(specifier, {
      basedir: path.dirname(sourceModule.modulePath),
      extensions: this.moduleExtensions,
    });
  }

  public resolveImportedModule(referencingModule: CyclicModuleRecord, specifier: string): CyclicModuleRecord {
    if (!specifier.startsWith(".")) {
      let module = this.externalModules.get(specifier);
      if (!module) {
        module = new ExternalModuleRecord(this.workingDirectory, this, specifier);
        this.externalModules.set(specifier, module);
      }
      return module;
    }

    // Resolve a module to its target file.
    let modulePath = this.resolveModule(referencingModule, specifier);

    let module = this.moduleRecords.get(modulePath);
    if (module) {
      return module;
    }

    let sourceText = fs.readFileSync(modulePath, { encoding: "utf8" });
    return this.parseModule(sourceText, modulePath);
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

  public parseModule(sourceText: string, modulePath: string): SourceTextModuleRecord {
    let module: SourceTextModuleRecord = new SourceTextModuleRecord(this, modulePath);

    let config = this.engine.getConfigForFile(modulePath);
    config.plugins = [];
    config.rules = {
      "module-parse": "error",
    };

    // The types for Linter don't seem to be correct.
    // @ts-ignore
    let linter = new Linter({ cwd: this.workingDirectory });
    linter.defineRule("module-parse", {
      create: (context: Rule.RuleContext): Rule.RuleListener => {
        return {
          Program: (node: ESTree.Program): void => {
            this.moduleRecords.set(modulePath, module);

            let parser = createParser(module, context);
            for (let [selector, callback] of Object.entries(parser)) {
              if (callback && selector != "Program") {
                this[selector] = callback.bind(parser);
              }
            }

            if (parser.Program) {
              parser.Program(node);
            }
          }
        };
      }
    });

    if (config.parser) {
      // For some reason Linter can't resolve the parser correctly, resolve it ourselves.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      let parser = require(config.parser);
      config.parser = "resolved-parser";
      linter.defineParser("resolved-parser", parser);
    }

    // Run from the right directory so eslint can find its modules.
    let cwd = process.cwd();
    process.chdir(this.workingDirectory);
    let lintMessages = linter.verify(sourceText, config, {
      filename: path.relative(this.workingDirectory, modulePath),
      allowInlineConfig: false,
    });
    process.chdir(cwd);

    for (let lintMessage of lintMessages) {
      module.addIssue({
        severity: lintMessage.severity,
        module,
        message: lintMessage.message,
        type: IssueType.EslintIssue,
        lintMessage,
        node: null,
      });
    }

    return module;
  }
}
