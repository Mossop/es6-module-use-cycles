import { Rule } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { IssueError, IssueType, internalError, buildLintMessage, Severity } from "./issue";
import { SourceTextModuleRecord, ImportEntry, LocalExportEntry, IndirectExportEntry, ExportEntry } from "./modulerecord";

function* importEntries(filePath: string, program: ESTree.Program): Iterable<ImportEntry> {
  for (let node of program.body) {
    switch (node.type) {
      case "ImportDeclaration": {
        if (typeof node.source.value != "string") {
          let lintMessage = buildLintMessage(
            IssueType.ImportError,
            `Found an import declaration with a non-string module specifier: ${node.source.value}`,
            node,
            Severity.Error,
          );

          throw new IssueError({
            severity: Severity.Error,
            filePath,
            lintMessage,
            type: IssueType.ImportError,
          });
        }
        let moduleSpecifier = node.source.value;

        for (let specifier of node.specifiers) {
          switch (specifier.type) {
            case "ImportSpecifier":
              yield new ImportEntry(
                specifier,
                moduleSpecifier,
                specifier.imported.name,
                specifier.local.name,
              );
              break;
            case "ImportDefaultSpecifier":
              yield new ImportEntry(
                specifier,
                moduleSpecifier,
                "default",
                specifier.local.name,
              );
              break;
            case "ImportNamespaceSpecifier":
              yield new ImportEntry(
                specifier,
                moduleSpecifier,
                "*",
                specifier.local.name,
              );
              break;
          }

        }
        break;
      }
    }
  }
}

function* exportEntries(filePath: string, program: ESTree.Program): Iterable<ExportEntry> {
  for (let node of program.body) {
    switch (node.type) {
      case "ExportNamedDeclaration": {
        let moduleRequest: string | null;
        if (node.source) {
          if (typeof node.source.value != "string") {
            let lintMessage = buildLintMessage(
              IssueType.ExportError,
              `Found an export declaration with a non-string module specifier: ${node.source.value}`,
              node,
              Severity.Error,
            );

            throw new IssueError({
              severity: Severity.Error,
              filePath,
              lintMessage,
              type: IssueType.ImportError,
            });
          }
          moduleRequest = node.source.value;
        } else {
          moduleRequest = null;
        }
        for (let specifier of node.specifiers) {
          if (moduleRequest) {
            yield new IndirectExportEntry(
              specifier,
              specifier.exported.name,
              moduleRequest,
              specifier.local.name,
            );
          } else {
            yield new LocalExportEntry(
              specifier,
              specifier.exported.name,
              specifier.local.name,
            );
          }
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        yield new LocalExportEntry(
          node,
          "default",
          "*default*",
        );
        break;
      }
      case "ExportAllDeclaration": {
        if (typeof node.source.value != "string") {
          let lintMessage = buildLintMessage(
            IssueType.ExportError,
            `Found an export declaration with a non-string module specifier: ${node.source.value}`,
            node,
            Severity.Error,
          );

          throw new IssueError({
            severity: Severity.Error,
            filePath,
            lintMessage,
            type: IssueType.ImportError,
          });
        }

        yield new IndirectExportEntry(
          node,
          null,
          node.source.value,
          "*",
        );
        break;
      }
    }
  }
}

export function createParser(record: SourceTextModuleRecord, context: Rule.RuleContext): Rule.RuleListener {
  return {
    "Program": (program: ESTree.Program): void => {
      try {
        // https://tc39.es/ecma262/#sec-parsemodule

        // Steps 4-6.
        for (let importEntry of importEntries(context.getFilename(), program)) {
          record.importEntries.push(importEntry);
        }

        // Steps 10-11.
        for (let exportEntry of exportEntries(context.getFilename(), program)) {
          if (exportEntry instanceof LocalExportEntry) {
            let importEntry = record.getImportEntry(exportEntry.localName);

            if (!importEntry) {
              record.localExportEntries.push(exportEntry);
            } else {
              if (importEntry.importName == "*") {
                record.localExportEntries.push(exportEntry);
              } else {
                record.indirectExportEntries.push(new IndirectExportEntry(
                  exportEntry.node,
                  exportEntry.exportName,
                  importEntry.moduleRequest,
                  importEntry.importName,
                ));
              }
            }
          } else if (exportEntry.importName == "*" && exportEntry.exportName == null) {
            record.starExportEntries.push(exportEntry);
          } else {
            record.indirectExportEntries.push(exportEntry);
          }
        }
      } catch (exc) {
        if (exc instanceof IssueError) {
          record.host.addIssue(exc.issue);
        } else {
          record.host.addIssue(internalError(
            `Parser threw an unexpected exception: ${exc}`,
            context.getFilename(),
            null,
          ));
        }
      }
    }
  };
}
