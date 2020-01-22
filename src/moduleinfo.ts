// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import ModuleGraph from "./graph";

import path = require("path");

export class ModuleInfo {
  public constructor(public readonly filename: string, private parser: ModuleGraph) {}

  public parseModule(target: string, node: ESTree.Node): ModuleInfo | null {
    let filePath = path.resolve(path.dirname(this.filename), target);
    let resolved = this.parser.resolveModule(filePath);

    if (!resolved) {
      throw new Error(`Unable to resolve module for ${filePath}`);
    }

    let module = this.parser.parseModule(resolved);
    if (!module) {
      this.parser.logImportCycle(resolved, {
        moduleInfo: this,
        node,
      });
    }
    return module;
  }
}
