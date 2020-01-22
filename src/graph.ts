import fs from "fs";
import path from "path";

import { CLIEngine, Linter, Rule } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { ModuleInfo } from "./moduleinfo";
import createRule from "./parser";

export enum IssueType {
  ImportCycle = "import-cycle",
  ImportExportDependency = "import-export-dependency",
  UseOfUndefined = "use-of-undefined",
  EslintIssue = "eslint-issue",
}

interface GraphOptions {
  extensions?: string[];
  workingDirectory: string;
}

export interface Position {
  column: number;
  line: number;
  endColumn?: number;
  endLine?: number;
  source: string | null;
}

export interface IssueInfo {
  moduleInfo: ModuleInfo;
  node: ESTree.Node;
}

interface BaseIssue {
  filePath: string;
  lintMessage: Linter.LintMessage;
}

interface EslintIssue extends BaseIssue {
  type: IssueType.EslintIssue;
}

export interface ImportCycle extends BaseIssue {
  type: IssueType.ImportCycle;
  moduleStack: ModuleInfo[];
  filePath: string;
}

export type Issue = ImportCycle | EslintIssue;

export default class ModuleGraph {
  private engine: CLIEngine;
  private parseStack: ModuleInfo[] = [];
  private seenModules: Map<string, ModuleInfo> = new Map();
  private extensions: string[];

  private issues: Issue[] = [];

  public constructor(private options: GraphOptions) {
    this.extensions = options.extensions || [".js"];
    this.engine = new CLIEngine({
      extensions: this.extensions,
      cwd: options.workingDirectory,
    });
  }

  public getIssues(types: IssueType[]): Issue[] {
    return this.issues.filter((i: Issue) => {
      if (types.length == 0) {
        return true;
      }

      return types.includes(i.type);
    });
  }

  private getStack(moduleInfo: ModuleInfo): ModuleInfo[] {
    let stack: ModuleInfo[] = [...this.parseStack];
    while (stack.length && stack[stack.length - 1] != moduleInfo) {
      stack.pop();
    }

    if (!stack.length) {
      throw new Error("Issue reported from a module not in the current parse stack.");
    }

    return stack;
  }

  private getPosition(node: ESTree.Node): Position {
    if (!node.loc) {
      return {
        line: 0,
        column: 1,
        source: null,
      };
    }

    return {
      line: node.loc.start.line,
      column: node.loc.start.column,
      endLine: node.loc.end.line,
      endColumn: node.loc.end.column,
      source: node.loc.source || null,
    };
  }

  private buildLintMessage(ruleId: IssueType, message: string, node: ESTree.Node, severity: Linter.Severity): Linter.LintMessage {
    return {
      ruleId,
      message,
      severity,
      nodeType: node.type,
      ...this.getPosition(node),
    };
  }

  public logImportCycle(filePath: string, info: IssueInfo): void {
    let stack = this.getStack(info.moduleInfo);

    let onlyCycleStack = [...stack];
    while (onlyCycleStack.length > 0 && onlyCycleStack[0].filename != filePath) {
      onlyCycleStack.shift();
    }

    let fileStack = onlyCycleStack.map((moduleInfo: ModuleInfo) => path.relative(this.options.workingDirectory, moduleInfo.filename));
    let filename = path.relative(this.options.workingDirectory, filePath);

    this.issues.push({
      type: IssueType.ImportCycle,
      moduleStack: stack,
      filePath,
      lintMessage: this.buildLintMessage(IssueType.ImportCycle, `Detected an import cycle: ${fileStack.join(" -> ")} -> ${filename}`, info.node, 1),
    });
  }

  public resolveModule(filePath: string): string | null {
    // Resolve a module to its target file.
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

  public parseEntrypoint(entrypoint: string): void {
    let moduleFile = this.resolveModule(entrypoint);
    if (!moduleFile) {
      throw new Error(`Could not find entrypoint ${entrypoint})`);
    }

    this.parseFile(moduleFile);

    if (this.parseStack.length) {
      throw new Error(`Parsing left a non-empty parse stack: ${JSON.stringify(this.parseStack)}`);
    }
  }

  public parseModule(filePath: string): ModuleInfo | null {
    return this.seenModules.get(filePath) || this.parseFile(filePath);
  }

  private parseFile(fileToParse: string): ModuleInfo | null {
    // If this file is already higher up in the parse tree then don't parse it again.
    // This indicates a module cycle.
    if (this.parseStack.find((mod: ModuleInfo) => mod.filename == fileToParse)) {
      return null;
    }

    let config = this.engine.getConfigForFile(fileToParse);
    config.plugins = [];
    config.rules = {
      "graph-parse": "error",
    };

    let relativePath = path.relative(this.options.workingDirectory, fileToParse);
    let moduleInfo: ModuleInfo | undefined;

    // The types for Linter don't seem to be correct.
    // @ts-ignore
    let linter = new Linter({ cwd: this.workingDirectory });
    linter.defineRule("graph-parse", {
      create: (context: Rule.RuleContext): Rule.RuleListener => {
        moduleInfo = new ModuleInfo(fileToParse, this);
        this.parseStack.push(moduleInfo);

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
    process.chdir(this.options.workingDirectory);
    let issues = (linter.verify(code, config, {
      filename: relativePath,
      allowInlineConfig: false,
    }));
    process.chdir(cwd);

    for (let issue of issues) {
      this.issues.push(issue);
    }

    if (!moduleInfo) {
      throw new Error("Linter didn't use the parser as expected.");
    }

    this.seenModules.set(fileToParse, moduleInfo);
    this.parseStack.pop();
    return moduleInfo;
  }
}
