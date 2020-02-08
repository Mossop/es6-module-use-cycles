// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { CyclicModuleRecord, ImportEntry } from "./modulerecord";

export enum IssueType {
  ImportCycle = "import-cycle",
  Assertion = "assertion",
  InternalError = "internal-error",
  ImportError = "import-error",
  ExportError = "export-error",
  UseBeforeExecution = "use-before-execution",
}

interface BaseIssue {
  module: CyclicModuleRecord;
  node: ESTree.Node | null;
  message: string;
}

export interface ImportCycle extends BaseIssue {
  type: IssueType.ImportCycle;
  stack: CyclicModuleRecord[];
}

export interface ImportError extends BaseIssue {
  type: IssueType.ImportError;
  specifier: string;
}

export interface ExportError extends BaseIssue {
  type: IssueType.ExportError;
}

export interface Assertion extends BaseIssue {
  type: IssueType.Assertion;
  algorithm: string;
  part: string;
}

export interface InternalError extends BaseIssue {
  type: IssueType.InternalError;
  message: string;
}

export interface UseBeforeExecutionIssue extends BaseIssue {
  type: IssueType.UseBeforeExecution;
  importEntry: ImportEntry;
}

export type Issue = Assertion | InternalError | ImportError | ExportError | ImportCycle | UseBeforeExecutionIssue;
