import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType } from "../src/issue";
import { getExample, testableIssues } from "./helpers/utils";

const example = getExample();
const host = new ModuleHost([".js"], example);
host.parseEntrypoint(path.join(example, "entry.js"));

test("Cycles when used inside a function.", () => {
  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
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
          column: 37,
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
          line: 4,
          column: 9,
        },
        end: {
          line: 4,
          column: 19,
        },
      },
      message: "Import 'buildStore' is used before 'entry.js' has been evaluated.",
    }),
  ]);
});

test("Correct filename list.", () => {
  let filenames = host.getFilenames().map((filename: string): string => path.relative(example, filename));
  filenames.sort();
  expect(filenames).toStrictEqual([
    "entry.js",
    "module.js",
  ]);
});
