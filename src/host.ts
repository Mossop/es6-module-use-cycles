import fs from "fs";
import path from "path";

import { Linter, Rule, CLIEngine } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { Issue, IssueType, IssueError, internalError, Severity, buildLintMessage } from "./issue";
import { SourceTextModuleRecord, CyclicModuleRecord } from "./modulerecord";
import { createParser } from "./parser";

export class ModuleHost {
  private readonly engine: CLIEngine;
  private moduleRecords: Map<string, SourceTextModuleRecord> = new Map();
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

  private resolveModule(sourceScript: string, node: ESTree.Node, specifier: string): string {
    let basePath = path.resolve(path.dirname(sourceScript), specifier);

    try {
      let stats = fs.statSync(basePath);
      if (stats.isDirectory()) {
        basePath = path.join(basePath, "index");
      } else {
        return basePath;
      }
    } catch {
      // Ignore the error.
    }

    for (let extension of this.moduleExtensions) {
      if (fs.existsSync(basePath + extension)) {
        return basePath + extension;
      }
    }

    let lintMessage = buildLintMessage(IssueType.ImportError, `Unable to locate module for specifier ${specifier}.`, node, Severity.Error);
    throw new IssueError({
      severity: Severity.Error,
      filePath: sourceScript,
      lintMessage,
      type: IssueType.ImportError,
    });
  }

  public resolveImportedModule(referencingScriptOrModule: CyclicModuleRecord | string, node: ESTree.Node, specifier: string): SourceTextModuleRecord {
    if (referencingScriptOrModule instanceof CyclicModuleRecord) {
      referencingScriptOrModule = referencingScriptOrModule.script;
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
