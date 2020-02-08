import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType } from "../src/issue";
import { getExample, testableIssues } from "./helpers/utils";

const example = getExample();
const host = new ModuleHost([".ts"], example);
host.parseEntrypoint(path.join(example, "entry.ts"));

test("Cycles detected in typescript.", () => {
  let issues = testableIssues(host.getIssues());
  expect(issues).toStrictEqual([
    expect.objectContaining({
      type: IssueType.ImportCycle,
      modulePath: "module.ts",
      nodeType: "ImportDeclaration",
      location: {
        start: {
          line: 1,
          column: 0,
        },
        end: {
          line: 1,
          column: 30,
        },
      },
      message: "Import cycle: entry.ts -> module.ts -> entry.ts",
      stack: [
        expect.objectContaining({
          relativePath: "entry.ts",
        }),
        expect.objectContaining({
          relativePath: "module.ts",
        }),
        expect.objectContaining({
          relativePath: "entry.ts",
        }),
      ]
    }),
    expect.objectContaining({
      type: IssueType.UseBeforeExecution,
      modulePath: "module.ts",
      nodeType: "Identifier",
      location: {
        start: {
          line: 3,
          column: 15,
        },
        end: {
          line: 3,
          column: 18,
        },
      },
      message: "Imported 'foo' is used before 'entry.ts' has been evaluated.",
    }),
  ]);
});

test("Correct filename list.", () => {
  let filenames = host.getFilenames().map((filename: string): string => path.relative(example, filename));
  filenames.sort();
  expect(filenames).toStrictEqual([
    "entry.ts",
    "module.ts",
    "types.ts",
  ]);
});
