import path from "path";

import ModuleGraph, { IssueType, ImportCycle } from "../src/graph";
import { ModuleInfo } from "../src/moduleinfo";
import { getExample } from "./helpers/utils";

const example = getExample();

test("Cycles detected in basic-cycle.", () => {
  let graph = new ModuleGraph({
    workingDirectory: example,
  });

  graph.parseEntrypoint(path.join(example, "entry.js"));

  let issues = graph.getIssues([]);
  expect(issues).toHaveLength(1);
  expect(issues[0].type).toBe(IssueType.ImportCycle);

  let cycle = issues[0] as ImportCycle;
  expect(cycle.moduleStack).toHaveLength(2);
  expect(cycle.moduleStack.map((m: ModuleInfo) => path.relative(example, m.filename))).toEqual([
    "entry.js",
    "module.js",
  ]);
  expect(path.relative(example, cycle.filePath)).toBe("entry.js");
});
