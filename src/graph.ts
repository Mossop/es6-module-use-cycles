import fs from "fs";
import path from "path";

import { CLIEngine, Linter, Rule } from "eslint";

import { ModuleInfo } from "./moduleinfo";
import createRule from "./parser";

export default class ModuleGraph {
  private engine: CLIEngine;
  private isParsing: boolean = false;
  private parseQueue: string[] = [];
  private moduleOrder: string[] = [];
  private formatter: CLIEngine.Formatter;
  private workingDirectory: string;

  public constructor(private entrypoint: string, private extensions: string[]) {
    let wd = path.dirname(entrypoint);
    this.workingDirectory = this.findWorkingDirectory(wd) || wd;

    this.engine = new CLIEngine({
      extensions: this.extensions,
      cwd: this.workingDirectory,
    });
    this.formatter = this.engine.getFormatter();

    this.parseFile(this.entrypoint);
  }

  public findWorkingDirectory(directory: string): string | null {
    if (fs.existsSync(path.join(directory, "package.json"))) {
      return directory;
    }

    let parent = path.dirname(directory);
    if (parent == directory) {
      return null;
    }

    return this.findWorkingDirectory(parent);
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

  public parseModule(source: string, target: string): void {
    let resolved = this.resolveModule(source, target);
    if (!resolved) {
      console.error(`Unable to resolve module reference ${target} from ${source}`);
      return;
    }

    this.parseFile(resolved);
  }

  public parseFile(file: string): void {
    if (this.moduleOrder.includes(file)) {
      return;
    }

    this.parseQueue.push(file);
    this.moduleOrder.unshift(file);

    if (this.isParsing) {
      return;
    }

    this.isParsing = true;
    try {
      while (this.parseQueue.length > 0) {
        let fileToParse = this.parseQueue.shift();
        if (!fileToParse) {
          return;
        }

        let config = this.engine.getConfigForFile(fileToParse);
        config.plugins = [];
        config.rules = {
          "graph-parse": "error",
        };

        let relativePath = path.relative(this.workingDirectory, fileToParse);
        let moduleInfo = new ModuleInfo(fileToParse, this);

        // @ts-ignore
        let linter = new Linter({ cwd: this.workingDirectory });
        linter.defineRule("graph-parse", {
          create: (context: Rule.RuleContext): Rule.RuleListener => {
            return createRule(context, this, moduleInfo);
          }
        });

        if (config.parser) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          let parser = require(config.parser);
          config.parser = "resolved-parser";
          linter.defineParser("resolved-parser", parser);
        }

        let code = fs.readFileSync(fileToParse, { encoding: "utf8" });

        process.chdir(this.workingDirectory);
        let errors = (linter.verify(code, config, {
          filename: relativePath,
          allowInlineConfig: false,
        }));

        if (errors.length) {
          this.displayLintErrors(fileToParse, errors);
        }
      }
    } finally {
      this.isParsing = false;
    }
  }
}
