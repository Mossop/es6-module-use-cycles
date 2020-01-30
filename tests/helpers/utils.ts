import path from "path";

// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { Issue } from "../../src/issue";

type TestableIssue = Omit<Issue, "module" | "node"> & {
  modulePath: string;
  nodeType: string | null;
  location: ESTree.SourceLocation | null;
};

export function getExample(): string {
  if (!module.parent) {
    throw new Error("utils.ts must not be invoked directly.");
  }
  let parent = module.parent.filename;

  let name = path.basename(parent, path.extname(parent));
  return path.join(path.dirname(parent), "examples", name);
}

export function testableIssues(issues: Issue[]): TestableIssue[] {
  issues.sort((a: Issue, b: Issue): number => {
    if (a.module != b.module) {
      return a.module.modulePath.localeCompare(b.module.modulePath);
    }

    if (a.type != b.type) {
      return a.type.localeCompare(b.type);
    }

    if (a.node != b.node) {
      if (!a.node) {
        return -1;
      }

      if (!b.node) {
        return 1;
      }

      let aloc = a.node.loc;
      let bloc = b.node.loc;

      if (aloc != bloc) {
        if (!aloc) {
          return -1;
        }

        if (!bloc) {
          return -1;
        }

        if (aloc.start.line != bloc.start.line) {
          return aloc.start.line - bloc.start.line;
        }

        if (aloc.start.column != bloc.start.column) {
          return aloc.start.column - bloc.start.column;
        }

        if (aloc.end.line != bloc.end.line) {
          return aloc.end.line - bloc.end.line;
        }

        if (aloc.end.column != bloc.end.column) {
          return aloc.end.column - bloc.end.column;
        }
      }
    }

    return a.message.localeCompare(b.message);
  });

  return issues.map((issue: Issue): TestableIssue => {
    return Object.assign(issue, {
      modulePath: issue.module.relativePath,
      nodeType: issue.node ? issue.node.type : null,
      location: issue.node ? issue.node.loc || null : null,
      node: null,
      module: null,
    }, issue);
  });
}
