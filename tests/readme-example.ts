import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType } from "../src/issue";
import { getExample, testableIssues } from "./helpers/utils";

const example = getExample();
const host = new ModuleHost([".js"], example);
host.parseEntrypoint(path.join(example, "a.js"));

test("Safe cycle detected.", () => {
  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "b.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 24,
        },
      },
      message: "Import cycle: a.js -> b.js -> a.js",
      stack: [
        expect.objectContaining({
          relativePath: "a.js",
        }),
        expect.objectContaining({
          relativePath: "b.js",
        }),
        expect.objectContaining({
          relativePath: "a.js",
        }),
      ]
    }),
  ]);
});

test("Correct filename list.", () => {
  let filenames = host.getFilenames().map((filename: string): string => path.relative(example, filename));
  filenames.sort();
  expect(filenames).toStrictEqual([
    "a.js",
    "b.js",
  ]);
});

test("Unsafe cycle detected.", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "b.js"));

  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "a.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 26,
        },
      },
      message: "Import cycle: b.js -> a.js -> b.js",
      stack: [
        expect.objectContaining({
          relativePath: "b.js",
        }),
        expect.objectContaining({
          relativePath: "a.js",
        }),
        expect.objectContaining({
          relativePath: "b.js",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.UseBeforeExecution,
      modulePath: "a.js",
      nodeType: "Identifier",
      location: {
        start: {
          line: 5,
          column: 12,
        },
        end: {
          line: 5,
          column: 15,
        },
      },
      message: "Imported 'add' is used before 'b.js' has been evaluated.",
    }),
  ]);
});
