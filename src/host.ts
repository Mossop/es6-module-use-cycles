import fs from "fs";
import path from "path";

import { Linter, Rule, CLIEngine } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";
import resolve from "resolve";

import { Issue, IssueType, IssueError, internalError, Severity, buildLintMessage } from "./issue";
import { SourceTextModuleRecord, CyclicModuleRecord, ExternalModuleRecord } from "./modulerecord";
import { createParser } from "./parser";

export class ModuleHost {
  private readonly engine: CLIEngine;
  private moduleRecords: Map<string, SourceTextModuleRecord> = new Map();
  private externalModules: Map<string, ExternalModuleRecord> = new Map();
  private issues: Issue[] = [];

  public constructor(
    private readonly moduleExtensions: string[],
    public readonly workingDirectory: string
  ) {
    this.engine = new CLIEngine({
      extensions: moduleExtensions,
      cwd: workingDirectory,
    });
  }

  public getIssues(): Issue[] {
    return [...this.issues];
  }

  public addIssue(issue: Issue): void {
    this.issues.push(issue);
  }

  public resolveModule(sourceScript: string, node: ESTree.Node, specifier: string): string {
    try {
      return resolve.sync(specifier, {
        basedir: path.dirname(sourceScript),
        extensions: this.moduleExtensions,
      });
    } catch (e) {
      let lintMessage = buildLintMessage(IssueType.ImportError, `Unable to locate module for specifier '${specifier}' from ${sourceScript}.`, node, Severity.Error);
      throw new IssueError({
        severity: Severity.Error,
        filePath: sourceScript,
        lintMessage,
        type: IssueType.ImportError,
        specifier,
      });
    }
  }

  public resolveImportedModule(referencingScriptOrModule: CyclicModuleRecord | string, node: ESTree.Node, specifier: string): CyclicModuleRecord {
    if (referencingScriptOrModule instanceof CyclicModuleRecord) {
      referencingScriptOrModule = referencingScriptOrModule.script;
    }

    if (!specifier.startsWith(".")) {
      let module = this.externalModules.get(specifier);
      if (!module) {
        module = new ExternalModuleRecord(this.workingDirectory, this, specifier);
        this.externalModules.set(specifier, module);
      }
      return module;
    }

    // Resolve a module to its target file.
    let targetPath = this.resolveModule(referencingScriptOrModule, node, specifier);

    let record = this.moduleRecords.get(targetPath);
    if (record) {
      return record;
    }

    let sourceText = fs.readFileSync(targetPath, { encoding: "utf8" });
    return this.parseModule(sourceText, targetPath);
  }

  public parseEntrypoint(entrypoint: string): SourceTextModuleRecord | null {
    let sourceText = fs.readFileSync(entrypoint, { encoding: "utf8" });
    return this.topLevelModuleEvaluation(sourceText, entrypoint);
  }

  public topLevelModuleEvaluation(sourceText: string, targetPath: string): SourceTextModuleRecord | null {
    try {
      let module = this.parseModule(sourceText, targetPath);
      module.link();
      module.evaluate();
      return module;
    } catch (e) {
      if (e instanceof IssueError) {
        this.addIssue(e.issue);
        return null;
      }

      throw e;
    }
  }

  public parseModule(sourceText: string, targetPath: string): SourceTextModuleRecord {
    let config = this.engine.getConfigForFile(targetPath);
    config.plugins = [];
    config.rules = {
      "module-parse": "error",
    };

    let module: SourceTextModuleRecord | null = null;

    // The types for Linter don't seem to be correct.
    // @ts-ignore
    let linter = new Linter({ cwd: this.workingDirectory });
    linter.defineRule("module-parse", {
      create: (context: Rule.RuleContext): Rule.RuleListener => {
        return {
          Program: (node: ESTree.Program): void => {
            module = new SourceTextModuleRecord(this, targetPath, node);
            this.moduleRecords.set(targetPath, module);

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
      filename: path.relative(this.workingDirectory, targetPath),
      allowInlineConfig: false,
    });
    process.chdir(cwd);

    for (let lintMessage of lintMessages) {
      this.addIssue({
        severity: lintMessage.severity,
        filePath: targetPath,
        type: IssueType.EslintIssue,
        lintMessage,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!module) {
      internalError(`ModuleRecord was not created while parsing ${path.relative(this.workingDirectory, targetPath)}.`, targetPath, null);
    }

    return module;
  }
}
