import path from "path";

import { ModuleHost } from "../src/host";
import { ImportCycle, IssueType, intoLintResults, Severity, buildLintMessage } from "../src/issue";
import { CyclicModuleRecord } from "../src/modulerecord";
import { getExample } from "./helpers/utils";

const example = getExample();

test("Cycles detected in more complex import/export scenarios.", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "entry.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(4);

  const expectedCycles = [
    ["entry.js", "module.js", "namedExport.js", "entry.js"],
    ["entry.js", "module.js", "starImported.js", "entry.js"],
    ["entry.js", "module.js", "direct.js", "entry.js"],
    ["entry.js", "module.js", "starExport.js", "entry.js"],
  ];

  for (let expected of expectedCycles) {
    let issue = issues.shift() as ImportCycle;

    expect(issue.type).toBe(IssueType.ImportCycle);
    expect(issue.stack).toHaveLength(expected.length);
    expect(issue.stack.map((m: CyclicModuleRecord) => m.relativePath)).toEqual(expected);
  }
});

test("Lint results", () => {
  let host = new ModuleHost([".js"], example);
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
