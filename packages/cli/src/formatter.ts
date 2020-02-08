import { CLIEngine, Linter } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";
import { Issue, IssueType } from "module-cycles-parser";

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
