import path from "path";

import { ModuleHost } from "../src/host";
import { ImportCycle, IssueType } from "../src/issue";
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
