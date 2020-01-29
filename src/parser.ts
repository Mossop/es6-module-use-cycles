import { Rule, Scope } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { IssueError, IssueType, internalError, buildLintMessage, Severity, assert } from "./issue";
import { SourceTextModuleRecord, ImportEntry, LocalExportEntry, IndirectExportEntry,
  ExportEntry, StarExportEntry } from "./modulerecord";

type Parented<T> = T & { parent: ESTree.Node };

function isParented<T>(node: T): node is Parented<T> {
  return "parent" in node;
}

function* importEntries(modulePath: string, program: ESTree.Program): Iterable<ImportEntry> {
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
            modulePath: modulePath,
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
function* exportEntries(modulePath: string, program: ESTree.Program): Iterable<ExportEntry> {
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
              modulePath: modulePath,
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
            modulePath,
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
                      modulePath, prop);
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
                  modulePath, varDeclarator);
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
            modulePath: modulePath,
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

function isFunctionVariableUsedInGlobalPath(context: Rule.RuleContext, variable: Scope.Variable): boolean {
  for (let reference of variable.references) {
    if (isParented(reference.identifier) && reference.identifier.parent.type == "CallExpression") {
      if (isInGlobalPath(context, reference.from)) {
        return true;
      }
    }
  }

  return false;
}

function isInGlobalPath(context: Rule.RuleContext, scope: Scope.Scope | null): boolean {
  while (scope) {
    if (scope.type == "class") {
      console.log("Used in class");
      return false;
    }

    if (scope.type == "function") {
      if (scope.block.type == "FunctionDeclaration") {
        let id = scope.block.id;
        if (!id) {
          // Part of an `export default function...`, can't be in use.
          return false;
        }

        // Get the variable for the function and see if it is ever called.
        let variable = context.getDeclaredVariables(scope.block)[0];
        return isFunctionVariableUsedInGlobalPath(context, variable);
      }

      if (scope.block.type == "ArrowFunctionExpression") {
        if (!isParented(scope.block)) {
          return false;
        }

        let variables = context.getDeclaredVariables(scope.block.parent);
        if (variables.length > 0) {
          return isFunctionVariableUsedInGlobalPath(context, variables[0]);
        }

        return false;
      }

      console.warn(`Used in unknown function block ${scope.block.type}.`);
      return false;
    }

    if (scope.type == "module") {
      return true;
    }

    scope = scope.upper;
  }

  return false;
}

/**
 * Attempts to find a case where this import entry is used during a module's
 * initial execution.
 */
function findImportUsage(context: Rule.RuleContext, importEntry: ImportEntry): void {
  let variables = context.getDeclaredVariables(importEntry.declaration);
  for (let variable of variables) {
    for (let reference of variable.references) {
      if (isParented(reference.identifier) && reference.identifier.parent.type == "ExportSpecifier") {
        // Simply exporting the import does not count as usage.
        continue;
      }

      if (isInGlobalPath(context, reference.from)) {
        importEntry.executionUse = reference.identifier;
      }
    }
  }

}

export function createParser(module: SourceTextModuleRecord, context: Rule.RuleContext): Rule.RuleListener {
  return {
    "Program": (program: Parented<ESTree.Program>): void => {
      let modulePath = context.getFilename();

      try {
        // https://tc39.es/ecma262/#sec-parsemodule

        // Steps 4-6.
        for (let importEntry of importEntries(modulePath, program)) {
          // Filter out any unknown modules.
          if (importEntry.moduleRequest.startsWith(".")) {
            try {
              module.host.resolveModule(modulePath, importEntry.declaration, importEntry.moduleRequest);
            } catch (e) {
              if (e instanceof IssueError) {
                module.host.addIssue(e.issue);
                continue;
              }

              throw e;
            }
          }

          module.importEntries.push(importEntry);

          findImportUsage(context, importEntry);
        }

        // Steps 10-11.
        for (let exportEntry of exportEntries(modulePath, program)) {
          if (exportEntry.moduleRequest == null) {
            if (!exportEntry.localName) {
              internalError("An export with no module specifier must have a local name.",
                modulePath, exportEntry.node);
            }

            let importEntry = module.getImportEntry(exportEntry.localName);
            if (!importEntry) {
              module.localExportEntries.push(new LocalExportEntry(modulePath, exportEntry));
            } else {
              if (importEntry.importName == "*") {
                module.localExportEntries.push(new LocalExportEntry(modulePath, exportEntry));
              } else {
                module.indirectExportEntries.push(new IndirectExportEntry(modulePath, {
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
                module.host.resolveModule(modulePath, exportEntry.declaration, exportEntry.moduleRequest);
              } catch (e) {
                if (e instanceof IssueError) {
                  module.host.addIssue(e.issue);
                  continue;
                }

                throw e;
              }
            }

            if (exportEntry.importName == "*" && exportEntry.exportName == null) {
              module.starExportEntries.push(new StarExportEntry(modulePath, exportEntry));
            } else {
              module.indirectExportEntries.push(new IndirectExportEntry(modulePath, exportEntry));
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
    },
  };
}
