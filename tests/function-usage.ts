import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType, ImportCycle, UseBeforeExecutionIssue } from "../src/issue";
import { CyclicModuleRecord } from "../src/modulerecord";
import { getExample } from "./helpers/utils";

const example = getExample();

test("Cycles detected in basic-cycle.", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "entry.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(2);
  expect(issues[0].type).toBe(IssueType.ImportCycle);

  let cycle = issues[0] as ImportCycle;
  expect(cycle.stack).toHaveLength(3);
  expect(cycle.stack.map((m: CyclicModuleRecord) => m.relativePath)).toEqual([
    "entry.js",
    "module.js",
    "entry.js",
  ]);

  expect(issues[1].type).toBe(IssueType.UseBeforeExecution);
  let use = issues[1] as UseBeforeExecutionIssue;
  expect(use.importEntry.localName).toBe("buildStore");
  let loc = use.importEntry.executionUse ? use.importEntry.executionUse.loc : {};
  expect(loc).toStrictEqual(expect.objectContaining({
    start: {
      line: 4,
      column: 9,
    },
    end: {
      line: 4,
      column: 19,
    },
  }));
});
