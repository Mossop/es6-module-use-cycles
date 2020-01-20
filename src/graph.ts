import fs from "fs";
import path from "path";

import { CLIEngine, Linter, Rule } from "eslint";

import { ModuleInfo } from "./moduleinfo";
import createRule from "./parser";
import { findWorkingDirectory } from "./utils";

export default class ModuleGraph {
  private engine: CLIEngine;
  private formatter: CLIEngine.Formatter;
  private workingDirectory: string;
  private parseStack: string[] = [];
  private seenModules: Map<string, ModuleInfo> = new Map();

  public constructor(private entrypoint: string, private extensions: string[]) {
    this.workingDirectory = findWorkingDirectory(entrypoint);

    this.engine = new CLIEngine({
      extensions: this.extensions,
      cwd: this.workingDirectory,
    });
    this.formatter = this.engine.getFormatter();

    // Start parsing at the first file.
    this.parseFile(this.entrypoint);

    if (this.parseStack.length) {
      throw new Error(`Parsing left a non-empty parse stack: ${JSON.stringify(this.parseStack)}`);
    }
  }

  public displayLintErrors(file: string, messages: Linter.LintMessage[]): void {
    let errorCount = 0;
    let fixableErrorCount = 0;
    let warningCount = 0;
    let fixableWarningCount = 0;

    for (let message of messages) {
      if (message.severity == 2) {
        errorCount++;
        if (message.fix) {
          fixableErrorCount++;
        }
      } else {
        warningCount++;
        if (message.fix) {
          fixableWarningCount++;
        }
      }
    }

    let result: CLIEngine.LintResult = {
      filePath: file,
      messages,
      errorCount,
      warningCount,
      fixableErrorCount,
      fixableWarningCount,
    };

    console.log(this.formatter([result]));
  }

  public resolveModule(sourceFile: string, target: string): string | null {
    // Resolve a module to its target file.
    let filePath = path.resolve(path.dirname(sourceFile), target);
    try {
      let stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        filePath = path.join(filePath, "index");
      } else {
        return filePath;
      }
    } catch {
      // Ignore the error.
    }

    for (let extension of this.extensions) {
      if (fs.existsSync(filePath + extension)) {
        return filePath + extension;
      }
    }

    return null;
  }

  public parseModule(source: string, target: string): ModuleInfo | null {
    let resolved = this.resolveModule(source, target);
    if (!resolved) {
      throw new Error(`Unable to resolve module reference ${target} from ${source}`);
    }

    return this.seenModules.get(resolved) || this.parseFile(resolved);
  }

  public parseFile(fileToParse: string): ModuleInfo | null {
    // If this file is already higher up in the parse tree then don't parse it again.
    // This indicates a module cycle.
    if (this.parseStack.includes(fileToParse)) {
      console.warn("Found module cycle", ...this.parseStack, fileToParse);
      return null;
    }

    this.parseStack.push(fileToParse);

    let config = this.engine.getConfigForFile(fileToParse);
    config.plugins = [];
    config.rules = {
      "graph-parse": "error",
    };

    let relativePath = path.relative(this.workingDirectory, fileToParse);
    let moduleInfo = new ModuleInfo(fileToParse, this);

    // The types for Linter don't seem to be correct.
    // @ts-ignore
    let linter = new Linter({ cwd: this.workingDirectory });
    linter.defineRule("graph-parse", {
      create: (context: Rule.RuleContext): Rule.RuleListener => {
        return createRule(context, moduleInfo);
      }
    });

    if (config.parser) {
      // For some reason Linter can't resolve the parser correctly, resolve it ourselves.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      let parser = require(config.parser);
      config.parser = "resolved-parser";
      linter.defineParser("resolved-parser", parser);
    }

    let code = fs.readFileSync(fileToParse, { encoding: "utf8" });

    // Run from the right directory so eslint can find its modules.
    let cwd = process.cwd();
    process.chdir(this.workingDirectory);
    let errors = (linter.verify(code, config, {
      filename: relativePath,
      allowInlineConfig: false,
    }));
    process.chdir(cwd);

    // Should only happen when there is a bad eslint config.
    if (errors.length) {
      this.displayLintErrors(fileToParse, errors);
    }

    this.seenModules.set(fileToParse, moduleInfo);
    this.parseStack.pop();
    return moduleInfo;
  }
}
