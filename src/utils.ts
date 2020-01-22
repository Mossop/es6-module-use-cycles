import fs from "fs";
import path from "path";

import { CLIEngine } from "eslint";

import { Issue } from "./graph";

export type NonEmptyArray<T> = [T, ...T[]];

export function makeNonEmpty<T>(arr: T[]): NonEmptyArray<T> {
  if (arr.length > 0) {
    return arr as NonEmptyArray<T>;
  }
  throw new Error("Expected a non-empty array but got a zero length array.");
}

export function findWorkingDirectory(filename: string): string {
  let directory = path.dirname(filename);
  if (directory == filename) {
    return process.cwd();
  }

  if (fs.existsSync(path.join(directory, "package.json"))) {
    return directory;
  }

  return findWorkingDirectory(directory);
}

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
