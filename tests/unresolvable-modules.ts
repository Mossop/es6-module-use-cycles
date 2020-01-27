import path from "path";

import { ModuleHost } from "../src/host";
import { IssueType, ImportError } from "../src/issue";
import { getExample } from "./helpers/utils";

const example = getExample();

test("No errors.", () => {
  let host = new ModuleHost([".js"], example);
  host.parseEntrypoint(path.join(example, "entry.js"));

  let issues = host.getIssues();
  expect(issues).toHaveLength(3);

  expect(issues[0].type).toBe(IssueType.ImportError);
  expect((issues[0] as ImportError).specifier).toBe("./bar");

  expect(issues[1].type).toBe(IssueType.ImportError);
  expect((issues[1] as ImportError).specifier).toBe("./baz");

  expect(issues[2].type).toBe(IssueType.ImportError);
  expect((issues[2] as ImportError).specifier).toBe("./biz");
});
