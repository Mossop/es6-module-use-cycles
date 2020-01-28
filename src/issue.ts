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

export function buildLintMessage(issueType: IssueType, message: string, node: ESTree.Node | null, severity: Severity): Linter.LintMessage {
  return {
    ruleId: issueType,
    message,
    severity,
    nodeType: node ? node.type : "",
    ...getPosition(node),
  };
}

export enum IssueType {
  ImportCycle = "import-cycle",
  Assertion = "assertion",
  InternalError = "internal-error",
  EslintIssue = "eslint",
  ImportError = "import-error",
  ExportError = "export-error",
  UseBeforeExecution = "use-before-execution",
}

interface BaseIssue {
  severity: Severity;
  filePath: string;
  lintMessage: Linter.LintMessage;
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

export interface EslintIssue extends BaseIssue {
  type: IssueType.EslintIssue;
}

export interface UseBeforeExecutionIssue extends BaseIssue {
  type: IssueType.UseBeforeExecution;
  importEntry: ImportEntry;
}

export type Issue = EslintIssue | Assertion | InternalError | ImportError | ExportError | ImportCycle | UseBeforeExecutionIssue;

export function intoLintResult(issues: Issue[]): CLIEngine.LintResult[] {
  let results: CLIEngine.LintResult[] = [];
  issues = [...issues];

  let issue = issues.shift();
  if (!issue) {
    return results;
  }

  const buildInitialLintResult = (issue: Issue): CLIEngine.LintResult => {
    return {
      filePath: issue.filePath,
      messages: [issue.lintMessage],
      errorCount: issue.lintMessage.severity == 2 ? 1 : 0,
      warningCount: issue.lintMessage.severity == 2 ? 0 : 1,
      fixableErrorCount: 0,
      fixableWarningCount: 0,
    };
  };

  let currentResult = buildInitialLintResult(issue);
  for (issue of issues) {
    if (issue.filePath != currentResult.filePath) {
      results.push(currentResult);
      currentResult = buildInitialLintResult(issue);
    } else {
      currentResult.messages.push(issue.lintMessage);
      if (issue.lintMessage.severity == 2) {
        currentResult.errorCount++;
      } else {
        currentResult.warningCount++;
      }
    }
  }

  results.push(currentResult);
  return results;
}

export class IssueError extends Error {
  public constructor(public readonly issue: Issue) {
    super(issue.lintMessage.message);
  }
}

export function assert(check: boolean, algorithm: string, part: string, filePath: string, node: ESTree.Node | null): void {
  /* istanbul ignore else: We should be unable to trigger assertions in tests. */
  if (check) {
    return;
  } else {
    let lintMessage = buildLintMessage(IssueType.Assertion, `Assertion in ${algorithm} part ${part}`, node, Severity.Error);
    let error: Assertion = {
      severity: Severity.Error,
      filePath,
      lintMessage,
      type: IssueType.Assertion,
      algorithm,
      part,
    };
    throw new IssueError(error);
  }
}

/* istanbul ignore next: We should be unable to trigger internal errors in tests. */
export function internalError(message: string, filePath: string, node: ESTree.Node | null): never {
  let lintMessage = buildLintMessage(IssueType.InternalError, message, node, Severity.Error);
  let error: InternalError = {
    severity: Severity.Error,
    filePath,
    lintMessage,
    type: IssueType.InternalError,
    message,
  };

  throw new IssueError(error);
}
