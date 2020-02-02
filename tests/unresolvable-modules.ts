import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType } from "../src/issue";
import { getExample, testableIssues } from "./helpers/utils";

const example = getExample();
const host = new ModuleHost([".js"], example);
host.parseEntrypoint(path.join(example, "entry.js"));
test("No errors.", () => {
  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
    expect.objectContaining({
      type: IssueType.ImportError,
      modulePath: "entry.js",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 3,
          column: 0,
        },
        end: {
          line: 3,
          column: 28,
        },
      },
      message: "Unable to locate module for specifier './bar'.",
      specifier: "./bar",
    }),
    expect.objectContaining({
      type: IssueType.ImportError,
      modulePath: "entry.js",
      nodeType: "ExportNamedDeclaration",
      location: {
        start: {
          line: 5,
          column: 0,
        },
        end: {
          line: 5,
          column: 28,
        },
      },
      message: "Unable to locate module for specifier './baz'.",
      specifier: "./baz",
    }),
    expect.objectContaining({
      type: IssueType.ImportError,
      modulePath: "entry.js",
      nodeType: "ExportAllDeclaration",
      location: {
        start: {
          line: 6,
          column: 0,
        },
        end: {
          line: 6,
          column: 22,
        },
      },
      message: "Unable to locate module for specifier './biz'.",
      specifier: "./biz",
    }),
  ]);
});

test("Correct filename list.", () => {
  let filenames = host.getFilenames().map((filename: string): string => path.relative(example, filename));
  filenames.sort();
  expect(filenames).toStrictEqual([
    "entry.js",
  ]);
});
