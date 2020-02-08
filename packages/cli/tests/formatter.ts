import path from "path";

import { ModuleHost, IssueType } from "module-cycles-parser";

import { Severity, buildLintMessage, intoLintResults } from "../src/formatter";

let examples = path.resolve(__dirname, path.join("examples"));

test("Lint results", () => {
  let example = path.join(examples, "indirect-imports");
  const host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "entry.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(4);

  expect(buildLintMessage(issues[0])).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 35,
  }));

  expect(buildLintMessage(issues[1])).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 35,
  }));

  expect(buildLintMessage(issues[2])).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 43,
  }));

  expect(buildLintMessage(issues[3])).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 35,
  }));

  let results = intoLintResults(issues);
  expect(results).toHaveLength(4);

  expect(results[0]).toEqual(expect.objectContaining({
    filePath: path.resolve(example, "namedExport.js"),
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  }));

  expect(results[1]).toEqual(expect.objectContaining({
    filePath: path.resolve(example, "starImported.js"),
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  }));

  expect(results[2]).toEqual(expect.objectContaining({
    filePath: path.resolve(example, "direct.js"),
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  }));

  expect(results[3]).toEqual(expect.objectContaining({
    filePath: path.resolve(example, "starExport.js"),
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  }));
});
