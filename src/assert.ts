// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { CyclicModuleRecord } from "./modulerecord";

type Parented<T> = T & { parent: ESTree.Node };

export function checkParented<T extends ESTree.Node>(node: T): asserts node is Parented<T> {
  /* istanbul ignore if: We should be unable to trigger assertions in tests. */
  if (!("parent" in node)) {
    internalError(`${node.type} has no parent property.`);
  }
}

export function algorithmAssert(check: boolean, algorithm: string, part: string, module: CyclicModuleRecord): asserts check is true {
  /* istanbul ignore if: We should be unable to trigger assertions in tests. */
  if (!check) {
    throw new Error(`Assertion in ${algorithm} part ${part} for module ${module.modulePath}`);
  }
}

/* istanbul ignore next: We should be unable to trigger internal errors in tests. */
export function internalError(message: string): never {
  throw new Error(message);
}

/* istanbul ignore next: We should be unable to trigger internal errors in tests. */
export function internalWarning(message: string): void {
  console.warn(message);
}
