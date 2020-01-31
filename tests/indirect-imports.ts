import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType, intoLintResults, Severity, buildLintMessage } from "../src/issue";
import { getExample, testableIssues } from "./helpers/utils";

const example = getExample();
const host = new ModuleHost([".js"], example);
host.parseEntrypoint(path.join(example, "entry.js"));

test("Cycles detected in more complex import/export scenarios.", () => {
  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "direct.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 43,
        },
      },
      message: "Import cycle: entry.js -> module.js -> direct.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "module.js",
        }),
        expect.objectContaining({
          relativePath: "direct.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "namedExport.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 35,
        },
      },
      message: "Import cycle: entry.js -> module.js -> namedExport.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "module.js",
        }),
        expect.objectContaining({
          relativePath: "namedExport.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "starExport.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 35,
        },
      },
      message: "Import cycle: entry.js -> module.js -> starExport.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "module.js",
        }),
        expect.objectContaining({
          relativePath: "starExport.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "starImported.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 35,
        },
      },
      message: "Import cycle: entry.js -> module.js -> starImported.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "module.js",
        }),
        expect.objectContaining({
          relativePath: "starImported.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
  ]);
});

test("Correct filename list.", () => {
  let filenames = host.getFilenames().map((filename: string): string => path.relative(example, filename));
  filenames.sort();
  expect(filenames).toStrictEqual([
    "direct.js",
    "entry.js",
    "module.js",
    "namedExport.js",
    "starExport.js",
    "starImported.js",
  ]);
});

test("Lint results", () => {
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
