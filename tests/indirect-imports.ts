import path from "path";

import { ModuleHost } from "../src/host";
import { ImportCycle, IssueType, intoLintResult, Severity } from "../src/issue";
import { SourceTextModuleRecord } from "../src/modulerecord";
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
    expect(issue.stack.map((m: SourceTextModuleRecord) => m.relativePath)).toEqual(expected);
  }
});

test("Lint results", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "entry.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(4);

  expect(issues[0].lintMessage).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 35,
  }));

  expect(issues[1].lintMessage).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 35,
  }));

  expect(issues[2].lintMessage).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 44,
  }));

  expect(issues[3].lintMessage).toEqual(expect.objectContaining({
    ruleId: IssueType.ImportCycle,
    severity: Severity.Warning,
    nodeType: "ImportDeclaration",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 35,
  }));

  let results = intoLintResult(issues);
  expect(results).toHaveLength(4);

  expect(results[0]).toEqual({
    filePath: path.resolve(example, "namedExport.js"),
    messages: [issues[0].lintMessage],
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  });

  expect(results[1]).toEqual({
    filePath: path.resolve(example, "starImported.js"),
    messages: [issues[1].lintMessage],
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  });

  expect(results[2]).toEqual({
    filePath: path.resolve(example, "direct.js"),
    messages: [issues[2].lintMessage],
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  });

  expect(results[3]).toEqual({
    filePath: path.resolve(example, "starExport.js"),
    messages: [issues[3].lintMessage],
    errorCount: 0,
    warningCount: 1,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  });
});
