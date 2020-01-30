import { Linter } from "eslint";
import { analyze, ScopeManager, Variable, Scope, AnalysisOptions } from "eslint-scope";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { IssueType, assert, internalWarning } from "./issue";
import { SourceTextModuleRecord, ImportEntry, ExportEntry, CyclicModuleRecord } from "./modulerecord";

type Parented<T> = T & { parent: ESTree.Node };

function isParented<T>(node: T): node is Parented<T> {
  return "parent" in node;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNode(item: any): item is ESTree.Node {
  return item && (typeof item == "object") && (typeof item.type == "string");
}

function addParents(node: ESTree.Node): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMaybeNode(item: any): void {
    if (isNode(item)) {
      Object.defineProperty(item, "parent", {
        enumerable: false,
        writable: false,
        value: node,
      });

      addParents(item);
    }
  }

  for (let property of Object.values(node)) {
    if (Array.isArray(property)) {
      property.forEach(handleMaybeNode);
    } else {
      handleMaybeNode(property);
    }
  }
}

interface ParseResults {
  program: ESTree.Program;
  scopeManager: ScopeManager;
}

type ParserModule =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { parse(text: string, options?: any): ESTree.Program } |
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { parseForESLint(text: string, options?: any): ESLintParseResult };

interface ESLintParseResult {
  ast: ESTree.Program;
  scopeManager?: ScopeManager;
}

export function parseCode(code: string, parserId: string, options: Linter.ParserOptions = {}): ParseResults {
  function buildScopeManager(program: ESTree.Program): ScopeManager {
    let analysisOptions: AnalysisOptions = {
      ecmaVersion: options.ecmaVersion || 6,
      sourceType: options.sourceType || "module",
    };

    return analyze(program, analysisOptions);
  }

  let parserOptions = Object.assign({
    range: true,
    loc: true,
  }, options);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let parser = require(parserId) as ParserModule;
  if ("parse" in parser) {
    let program = parser.parse(code, parserOptions);
    addParents(program);
    return {
      program,
      scopeManager: buildScopeManager(program),
    };
  }

  let { ast: program, scopeManager } = parser.parseForESLint(code, parserOptions);
  addParents(program);
  return {
    program,
    scopeManager: scopeManager || buildScopeManager(program),
  };
}

export function* importEntries(module: CyclicModuleRecord, program: ESTree.Program): Iterable<ImportEntry> {
  for (let node of program.body) {
    switch (node.type) {
      case "ImportDeclaration": {
        if (typeof node.source.value != "string") {
          module.addIssue({
            module,
            type: IssueType.ImportError,
            message: "Import includes a non-string module specifier.",
            specifier: String(node.source.value),
            node,
          });

          continue;
        }
        let moduleSpecifier = node.source.value;

        if (moduleSpecifier.startsWith(".")) {
          try {
            module.resolveModule(moduleSpecifier);
          } catch (e) {
            module.addIssue({
              module,
              type: IssueType.ImportError,
              message: `Unable to locate module for specifier '${moduleSpecifier}' from ${module.modulePath}.`,
              specifier: moduleSpecifier,
              node,
            });

            continue;
          }
        }

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
export function* exportEntries(module: SourceTextModuleRecord, program: ESTree.Program): Iterable<ExportEntry> {
  for (let node of program.body) {
    switch (node.type) {
      case "ExportNamedDeclaration": {
        let moduleSpecifier: string | null;
        if (node.source) {
          if (typeof node.source.value != "string") {
            module.addIssue({
              module,
              type: IssueType.ImportError,
              message: "Export includes a non-string module specifier.",
              specifier: String(node.source.value),
              node,
            });

            continue;
          }

          moduleSpecifier = node.source.value;

          if (moduleSpecifier.startsWith(".")) {
            try {
              module.resolveModule(moduleSpecifier);
            } catch (e) {
              module.addIssue({
                module,
                type: IssueType.ImportError,
                message: `Unable to locate module for specifier '${moduleSpecifier}' from ${module.modulePath}.`,
                specifier: moduleSpecifier,
                node,
              });
  
              continue;
            }
          }
        } else {
          moduleSpecifier = null;
        }

        if (node.declaration) {
          // This is the `export var foo = ...;` form.
          assert(
            node.specifiers.length == 0 && !moduleSpecifier,
            "https://tc39.es/ecma262/#sec-exports-static-semantics-exportentries", "0",
            module
          );

          if (node.declaration.type == "VariableDeclaration") {
            for (let varDeclarator of node.declaration.declarations) {
              if (varDeclarator.id.type == "Identifier") {
                // Easy case, `var foo = bar;`
                yield {
                  node: varDeclarator,
                  declaration: node,
                  exportName: varDeclarator.id.name,
                  moduleRequest: moduleSpecifier,
                  importName: null,
                  localName: varDeclarator.id.name,
                };
              } else if (varDeclarator.id.type == "ObjectPattern") {
                // Object destructuring, `var { a, b: c } = foo;
                for (let prop of varDeclarator.id.properties) {
                  if (prop.key.type != "Identifier" || prop.value.type != "Identifier") {
                    internalWarning("Unsupported object pattern property type");
                    continue;
                  }

                  yield {
                    node: prop,
                    declaration: node,
                    exportName: prop.value.name,
                    moduleRequest: moduleSpecifier,
                    importName: null,
                    localName: prop.key.name,
                  };
                }
              } else {
                internalWarning(`Unsupported variable declarator type ${varDeclarator.id.type}`);
                continue;
              }
            }
          } else if (node.declaration.id) {
            // function or class declaration.
            yield {
              node: node.declaration,
              declaration: node,
              exportName: node.declaration.id.name,
              moduleRequest: moduleSpecifier,
              importName: null,
              localName: node.declaration.id.name,
            };
          }

        } else {
          // { foo, bar as baz }
          for (let specifier of node.specifiers) {
            if (moduleSpecifier) {
              yield {
                node: specifier,
                declaration: node,
                exportName: specifier.exported.name,
                moduleRequest: moduleSpecifier,
                importName: specifier.local.name,
                localName: null,
              };
            } else {
              yield {
                node: specifier,
                declaration: node,
                exportName: specifier.exported.name,
                moduleRequest: moduleSpecifier,
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
          module.addIssue({
            module,
            type: IssueType.ImportError,
            message: "Export includes a non-string module specifier.",
            specifier: String(node.source.value),
            node,
          });

          continue;
        }

        let moduleSpecifier = node.source.value;

        if (moduleSpecifier.startsWith(".")) {
          try {
            module.resolveModule(moduleSpecifier);
          } catch (e) {
            module.addIssue({
              module,
              type: IssueType.ImportError,
              message: `Unable to locate module for specifier '${moduleSpecifier}' from ${module.modulePath}.`,
              node,
              specifier: moduleSpecifier,
            });

            continue;
          }
        }

        yield {
          node,
          declaration: node,
          exportName: null,
          moduleRequest: moduleSpecifier,
          importName: "*",
          localName: null,
        };
        break;
      }
    }
  }
}

function isFunctionVariableUsedInGlobalPath(scopeManager: ScopeManager, variable: Variable): boolean {
  for (let reference of variable.references) {
    if (isParented(reference.identifier) && reference.identifier.parent.type == "CallExpression") {
      if (isInGlobalPath(scopeManager, reference.from)) {
        return true;
      }
    }
  }

  return false;
}

export function isInGlobalPath(scopeManager: ScopeManager, scope: Scope | null): boolean {
  while (scope) {
    if (scope.type == "class") {
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
        let variable = scopeManager.getDeclaredVariables(scope.block)[0];
        return isFunctionVariableUsedInGlobalPath(scopeManager, variable);
      }

      if (scope.block.type == "ArrowFunctionExpression") {
        if (!isParented(scope.block)) {
          return false;
        }

        let variables = scopeManager.getDeclaredVariables(scope.block.parent);
        if (variables.length > 0) {
          return isFunctionVariableUsedInGlobalPath(scopeManager, variables[0]);
        }

        return false;
      }

      internalWarning(`Used in unknown function block ${scope.block.type}.`);
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
export function findImportUsage(scopeManager: ScopeManager, importEntry: ImportEntry): void {
  let variables = scopeManager.getDeclaredVariables(importEntry.declaration);
  for (let variable of variables) {
    for (let reference of variable.references) {
      if (isParented(reference.identifier) && reference.identifier.parent.type == "ExportSpecifier") {
        // Simply exporting the import does not count as usage.
        continue;
      }

      if (isInGlobalPath(scopeManager, reference.from)) {
        importEntry.executionUse = reference.identifier;
      }
    }
  }
}
