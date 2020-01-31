import { Linter, CLIEngine } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { CyclicModuleRecord, ImportEntry } from "./modulerecord";

export enum Severity {
  Warning = 1,
  Error = 2,
}

interface Position {
  column: number;
  line: number;
  endColumn?: number;
  endLine?: number;
  source: string | null;
}

function getPosition(node: ESTree.Node | null): Position {
  if (!node || !node.loc) {
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

function getSeverity(issue: Issue): Severity {
  return issue.type == IssueType.ImportCycle ? Severity.Warning : Severity.Error;
}

export function buildLintMessage(issue: Issue): Linter.LintMessage {
  return {
    ruleId: issue.type,
    message: issue.message,
    severity: getSeverity(issue),
    nodeType: issue.node ? issue.node.type : "",
    ...getPosition(issue.node),
  };
}

export enum IssueType {
  ImportCycle = "import-cycle",
  Assertion = "assertion",
  InternalError = "internal-error",
  ImportError = "import-error",
  ExportError = "export-error",
  UseBeforeExecution = "use-before-execution",
}

interface BaseIssue {
  module: CyclicModuleRecord;
  node: ESTree.Node | null;
  message: string;
}

export interface ImportCycle extends BaseIssue {
  type: IssueType.ImportCycle;
  stack: CyclicModuleRecord[];
}

export interface ImportError extends BaseIssue {
  type: IssueType.ImportError;
  specifier: string;
}

export interface ExportError extends BaseIssue {
  type: IssueType.ExportError;
}

export interface Assertion extends BaseIssue {
  type: IssueType.Assertion;
  algorithm: string;
  part: string;
}

export interface InternalError extends BaseIssue {
  type: IssueType.InternalError;
  message: string;
}

export interface UseBeforeExecutionIssue extends BaseIssue {
  type: IssueType.UseBeforeExecution;
  importEntry: ImportEntry;
}

export type Issue = Assertion | InternalError | ImportError | ExportError | ImportCycle | UseBeforeExecutionIssue;

export function intoLintResults(issues: Issue[]): CLIEngine.LintResult[] {
  let results: CLIEngine.LintResult[] = [];
  issues = [...issues];

  let issue = issues.shift();
  if (!issue) {
    return results;
  }

  const buildInitialLintResult = (issue: Issue): CLIEngine.LintResult => {
    return {
      filePath: issue.module.modulePath,
      messages: [buildLintMessage(issue)],
      errorCount: getSeverity(issue) == Severity.Error ? 1 : 0,
      warningCount: getSeverity(issue) == Severity.Error ? 0 : 1,
      fixableErrorCount: 0,
      fixableWarningCount: 0,
    };
  };

  let currentResult = buildInitialLintResult(issue);
  for (issue of issues) {
    if (issue.module.modulePath != currentResult.filePath) {
      results.push(currentResult);
      currentResult = buildInitialLintResult(issue);
    } else {
      currentResult.messages.push(buildLintMessage(issue));
      if (getSeverity(issue) == Severity.Error) {
        currentResult.errorCount++;
      } else {
        currentResult.warningCount++;
      }
    }
  }

  results.push(currentResult);
  return results;
}

export function assert(check: boolean, algorithm: string, part: string, module: CyclicModuleRecord): void {
  /* istanbul ignore else: We should be unable to trigger assertions in tests. */
  if (check) {
    return;
  } else {
    throw new Error(`Assertion in ${algorithm} part ${part} for module ${module.modulePath}`);
  }
}

/* istanbul ignore next: We should be unable to trigger internal errors in tests. */
export function internalError(message: string): never {
  throw new Error(message);
}

/* istanbul ignore next: We should be unable to trigger internal errors in tests. */
export function internalWarning(message: string): void {
  console.warn(message);
}
