import { Rule } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { IssueError, IssueType, internalError, buildLintMessage, Severity, assert } from "./issue";
import { SourceTextModuleRecord, ImportEntry, LocalExportEntry, IndirectExportEntry,
  ExportEntry, StarExportEntry } from "./modulerecord";

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
            specifier: String(node.source.value),
          });
        }
        let moduleSpecifier = node.source.value;

        for (let specifier of node.specifiers) {
          switch (specifier.type) {
            case "ImportSpecifier":
              yield new ImportEntry(
                specifier,
                node,
                moduleSpecifier,
                specifier.imported.name,
                specifier.local.name,
              );
              break;
            case "ImportDefaultSpecifier":
              yield new ImportEntry(
                specifier,
                node,
                moduleSpecifier,
                "default",
                specifier.local.name,
              );
              break;
            case "ImportNamespaceSpecifier":
              yield new ImportEntry(
                specifier,
                node,
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

/**
 *  These are the supported types of export declarations:
 *
 *     export `ExportFromClause` `FromClause`;
 *         `ExportFromClause` =
 *              *
 *              * as `IdentifierName`
 *              `NamesExports`
 *     export `VariableStatement`;
 *     export `NamedExports`;
 *     export `Declaration`;
 *     export default `HoistableDeclaration`;
 *     export default `ClassDeclaration`;
 *     export default `AssignmentExpression`
 */
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
              type: IssueType.ExportError,
            });
          }
          moduleRequest = node.source.value;
        } else {
          moduleRequest = null;
        }

        if (node.declaration) {
          // This is the `export var foo = ...;` form.
          assert(
            node.specifiers.length == 0 && !moduleRequest,
            "https://tc39.es/ecma262/#sec-exports-static-semantics-exportentries", "0",
            filePath,
            node
          );

          if (node.declaration.type == "VariableDeclaration") {
            for (let varDeclarator of node.declaration.declarations) {
              if (varDeclarator.id.type == "Identifier") {
                // Easy case, `var foo = bar;`
                yield {
                  node: varDeclarator,
                  declaration: node,
                  exportName: varDeclarator.id.name,
                  moduleRequest,
                  importName: null,
                  localName: varDeclarator.id.name,
                };
              } else if (varDeclarator.id.type == "ObjectPattern") {
                // Object destructuring, `var { a, b: c } = foo;
                for (let prop of varDeclarator.id.properties) {
                  if (prop.key.type != "Identifier" || prop.value.type != "Identifier") {
                    internalError("Unsupported object pattern property type",
                      filePath, prop);
                  }
                  yield {
                    node: prop,
                    declaration: node,
                    exportName: prop.value.name,
                    moduleRequest,
                    importName: null,
                    localName: prop.key.name,
                  };
                }
              } else {
                internalError(`Unsupported variable declarator type ${varDeclarator.id.type}`,
                  filePath, varDeclarator);
              }
            }
          } else if (node.declaration.id) {
            // function or class declaration.
            yield {
              node: node.declaration,
              declaration: node,
              exportName: node.declaration.id.name,
              moduleRequest,
              importName: null,
              localName: node.declaration.id.name,
            };
          }

        } else {
          // { foo, bar as baz }
          for (let specifier of node.specifiers) {
            if (moduleRequest) {
              yield {
                node: specifier,
                declaration: node,
                exportName: specifier.exported.name,
                moduleRequest,
                importName: specifier.local.name,
                localName: null,
              };
            } else {
              yield {
                node: specifier,
                declaration: node,
                exportName: specifier.exported.name,
                moduleRequest,
                importName: null,
                localName: specifier.local.name,
              };
            }
          }
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        // export default = ...;
        yield {
          node,
          declaration: node,
          exportName: "default",
          moduleRequest: null,
          importName: null,
          localName: "*default*",
        };
        break;
      }
      case "ExportAllDeclaration": {
        // export * from ...;
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
            type: IssueType.ExportError,
          });
        }

        yield {
          node,
          declaration: node,
          exportName: null,
          moduleRequest: node.source.value,
          importName: "*",
          localName: null,
        };
        break;
      }
    }
  }
}

export function createParser(module: SourceTextModuleRecord, context: Rule.RuleContext): Rule.RuleListener {
  return {
    "Program": (program: ESTree.Program): void => {
      try {
        // https://tc39.es/ecma262/#sec-parsemodule

        // Steps 4-6.
        for (let importEntry of importEntries(context.getFilename(), program)) {
          // Filter out any unknown modules.
          if (importEntry.moduleRequest.startsWith(".")) {
            try {
              module.host.resolveModule(context.getFilename(), importEntry.declaration, importEntry.moduleRequest);
            } catch (e) {
              if (e instanceof IssueError) {
                module.host.addIssue(e.issue);
                continue;
              }

              throw e;
            }
          }

          module.importEntries.push(importEntry);
        }

        // Steps 10-11.
        for (let exportEntry of exportEntries(context.getFilename(), program)) {
          if (exportEntry.moduleRequest == null) {
            if (!exportEntry.localName) {
              internalError("An export with no module specifier must have a local name.",
                context.getFilename(), exportEntry.node);
            }

            let importEntry = module.getImportEntry(exportEntry.localName);
            if (!importEntry) {
              module.localExportEntries.push(new LocalExportEntry(context.getFilename(), exportEntry));
            } else {
              if (importEntry.importName == "*") {
                module.localExportEntries.push(new LocalExportEntry(context.getFilename(), exportEntry));
              } else {
                module.indirectExportEntries.push(new IndirectExportEntry(context.getFilename(), {
                  node: exportEntry.node,
                  declaration: exportEntry.declaration,
                  moduleRequest: importEntry.moduleRequest,
                  importName: importEntry.importName,
                  localName: null,
                  exportName: exportEntry.exportName,
                }));
              }
            }
          } else {
            // Filter out any unknown modules.
            if (exportEntry.moduleRequest.startsWith(".")) {
              try {
                module.host.resolveModule(context.getFilename(), exportEntry.declaration, exportEntry.moduleRequest);
              } catch (e) {
                if (e instanceof IssueError) {
                  module.host.addIssue(e.issue);
                  continue;
                }

                throw e;
              }
            }

            if (exportEntry.importName == "*" && exportEntry.exportName == null) {
              module.starExportEntries.push(new StarExportEntry(context.getFilename(), exportEntry));
            } else {
              module.indirectExportEntries.push(new IndirectExportEntry(context.getFilename(), exportEntry));
            }
          }
        }
      } catch (exc) {
        if (exc instanceof IssueError) {
          console.error(exc.message);
          module.host.addIssue(exc.issue);
        } else {
          throw exc;
        }
      }
    }
  };
}
