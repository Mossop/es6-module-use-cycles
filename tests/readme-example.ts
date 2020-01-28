import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType } from "../src/issue";
import { getExample } from "./helpers/utils";

const example = getExample();

test("Safe cycle detected.", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "a.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(1);
  expect(issues[0].type).toBe(IssueType.ImportCycle);
});

test("Unsafe cycle detected.", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "b.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(2);
  expect(issues[0].type).toBe(IssueType.ImportCycle);
  expect(issues[1].type).toBe(IssueType.UseBeforeExecution);
});
