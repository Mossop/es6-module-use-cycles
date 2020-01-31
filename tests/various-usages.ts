import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType } from "../src/issue";
import { getExample, testableIssues } from "./helpers/utils";

const example = getExample();
const host = new ModuleHost([".js"], example);
host.parseEntrypoint(path.join(example, "entry.js"));

test("Cycles detected from various usages.", () => {
  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "functioncycle.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 41,
        },
      },
      message: "Import cycle: entry.js -> functioncycle.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "functioncycle.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "indirectCycle.js",
      nodeType: "ExportNamedDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 50,
        },
      },
      message: "Import cycle: entry.js -> module.js -> indirectCycle.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "module.js",
        }),
        expect.objectContaining({
          relativePath: "indirectCycle.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "module.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 48,
        },
      },
      message: "Import cycle: entry.js -> module.js -> entry.js",
      stack: [
        expect.objectContaining({
          relativePath: "entry.js",
        }),
        expect.objectContaining({
          relativePath: "module.js",
        }),
        expect.objectContaining({
          relativePath: "entry.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.UseBeforeExecution,
      modulePath: "module.js",
      nodeType: "Identifier",
      location: {
        start: {
          line: 5,
          column: 9,
        },
        end: {
          line: 5,
          column: 20,
        },
      },
      message: "Import 'unavailable' is used before 'entry.js' has been evaluated.",
    }),
    expect.objectContaining({
      type: IssueType.UseBeforeExecution,
      modulePath: "module.js",
      nodeType: "Identifier",
      location: {
        start: {
          line: 10,
          column: 25,
        },
        end: {
          line: 10,
          column: 33,
        },
      },
      message: "Import 'indirect' is used before 'entry.js' has been evaluated.",
    }),
  ]);
});

test("Correct filename list.", () => {
  let filenames = host.getFilenames().map((filename: string): string => path.relative(example, filename));
  filenames.sort();
  expect(filenames).toStrictEqual([
    "entry.js",
    "functioncycle.js",
    "indirect.js",
    "indirectCycle.js",
    "module.js",
  ]);
});
