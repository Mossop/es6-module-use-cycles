import { TSESTree } from "@typescript-eslint/typescript-estree";
import { Linter } from "eslint";
import { analyze, ScopeManager, Variable, Scope, AnalysisOptions } from "eslint-scope";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { algorithmAssert, internalWarning, internalError, checkParented} from "./assert";
import { IssueType } from "./issue";
import { SourceTextModuleRecord, ImportEntry, ExportEntry, CyclicModuleRecord, LocalExportEntry } from "./modulerecord";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNode(item: any): item is ESTree.Node {
  return item && (typeof item == "object") && (typeof item.type == "string");
}

function isTSImportDeclaration(node: object): node is TSESTree.ImportDeclaration {
  return node["type"] == "ImportDeclaration" && "importKind" in node;
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

export function parseCode(filePath: string, code: string, parserId: string, options: Linter.ParserOptions = {}): ParseResults {
  function buildScopeManager(program: ESTree.Program): ScopeManager {
    let analysisOptions: AnalysisOptions = {
      ecmaVersion: options.ecmaVersion || 6,
      sourceType: options.sourceType || "module",
    };

    return analyze(program, analysisOptions);
  }

  let parserOptions = Object.assign({}, options, {
    loc: true,
    range: true,
    raw: true,
    tokens: true,
    comment: true,
    eslintVisitorKeys: true,
    eslintScopeManager: true,
    filePath,
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let parser = require(parserId) as ParserModule;
  if ("parseForESLint" in parser) {
    let { ast: program, scopeManager } = parser.parseForESLint(code, parserOptions);
    addParents(program);
    return {
      program,
      scopeManager: scopeManager || buildScopeManager(program),
    };
  }

  let program = parser.parse(code, parserOptions);
  addParents(program);
  return {
    program,
    scopeManager: buildScopeManager(program),
  };
}

export function* importEntries(module: CyclicModuleRecord, program: ESTree.Program, scopeManager: ScopeManager): Iterable<ImportEntry> {
  for (let node of program.body) {
    switch (node.type) {
      case "ImportDeclaration": {
        if (isTSImportDeclaration(node) && node.importKind == "type") {
          // Type imports are removed at compile time and so do not cause module cycles.
          continue;
        }

        /* istanbul ignore if */
        if (typeof node.source.value != "string") {
          internalError("Parser generated an ImportDeclaration with a non-string specifier");
        }

        let moduleSpecifier = node.source.value;

        if (moduleSpecifier.startsWith(".")) {
          try {
            module.resolveModule(moduleSpecifier);
          } catch (e) {
            module.addIssue({
              module,
              type: IssueType.ImportError,
              message: `Unable to locate module for specifier '${moduleSpecifier}'.`,
              specifier: moduleSpecifier,
              node,
            });

            continue;
          }
        }

        for (let specifier of node.specifiers) {
          let variables = scopeManager.getDeclaredVariables(specifier);

          /* istanbul ignore if */
          if (variables.length != 1) {
            internalError(`Found no variable for a ${specifier.type} for ${moduleSpecifier}`);
          }

          switch (specifier.type) {
            case "ImportSpecifier": {
              yield new ImportEntry(
                specifier,
                node,
                moduleSpecifier,
                specifier.imported.name,
                specifier.local.name,
                variables[0],
              );
              break;
            }
            case "ImportDefaultSpecifier": {
              yield new ImportEntry(
                specifier,
                node,
                moduleSpecifier,
                "default",
                specifier.local.name,
                variables[0],
              );
              break;
            }
            case "ImportNamespaceSpecifier": {
              yield new ImportEntry(
                specifier,
                node,
                moduleSpecifier,
                "*",
                specifier.local.name,
                variables[0],
              );
              break;
            }
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
export function* exportEntries(module: SourceTextModuleRecord, program: ESTree.Program, scopeManager: ScopeManager): Iterable<ExportEntry> {
  for (let node of program.body) {
    switch (node.type) {
      case "ExportNamedDeclaration": {
        let moduleSpecifier: string | null;
        if (node.source) {
          /* istanbul ignore if */
          if (typeof node.source.value != "string") {
            internalError("Parser generated an ExportNamedDeclaration with a non-string specifier.");
          }

          moduleSpecifier = node.source.value;

          if (moduleSpecifier.startsWith(".")) {
            try {
              module.resolveModule(moduleSpecifier);
            } catch (e) {
              module.addIssue({
                module,
                type: IssueType.ImportError,
                message: `Unable to locate module for specifier '${moduleSpecifier}'.`,
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
          algorithmAssert(
            node.specifiers.length == 0 && !moduleSpecifier,
            "https://tc39.es/ecma262/#sec-exports-static-semantics-exportentries", "0",
            module
          );

          if (node.declaration.type == "VariableDeclaration") {
            for (let varDeclarator of node.declaration.declarations) {
              if (varDeclarator.id.type == "Identifier") {
                let variables = scopeManager.getDeclaredVariables(varDeclarator);
                /* istanbul ignore if */
                if (variables.length != 1) {
                  internalError("A VariableDeclarator should always define a variable.");
                }

                // Easy case, `var foo = bar;`
                yield {
                  node: varDeclarator,
                  declaration: node,
                  exportName: varDeclarator.id.name,
                  specifier: moduleSpecifier,
                  importName: null,
                  localName: varDeclarator.id.name,
                  variable: variables[0],
                };
              } else if (varDeclarator.id.type == "ObjectPattern") {
                // Object destructuring, `var { a, b: c } = foo;
                for (let prop of varDeclarator.id.properties) {
                  if (prop.key.type != "Identifier" || prop.value.type != "Identifier") {
                    internalWarning("Unsupported object pattern property type");
                    continue;
                  }

                  let variables = scopeManager.getDeclaredVariables(varDeclarator);
                  if (variables.length != 1) {
                    console.warn(`Saw ${variables.length} variables from property Identifier`);
                  }

                  yield {
                    node: prop,
                    declaration: node,
                    exportName: prop.value.name,
                    specifier: moduleSpecifier,
                    importName: null,
                    localName: prop.key.name,
                    variable: variables.length > 0 ? variables[0] : null,
                  };
                }
              } else {
                internalWarning(`Unsupported variable declarator type ${varDeclarator.id.type}`);
                continue;
              }
            }
          } else if (node.declaration.id) {
            if (["FunctionDeclaration", "ClassDeclaration"].includes(node.declaration.type)) {
              // function or class declaration.
              let variables = scopeManager.getDeclaredVariables(node.declaration);
              /* istanbul ignore if */
              if (variables.length == 0) {
                internalError(`A ${node.declaration.type} should always declare a variable.`);
              }

              yield {
                node: node.declaration,
                declaration: node,
                exportName: node.declaration.id.name,
                specifier: moduleSpecifier,
                importName: null,
                localName: node.declaration.id.name,
                variable: variables[0],
              };
            } else {
              // This is an export of something we don't recognise, a TypeScript type or interface for example.
              yield {
                node: node.declaration,
                declaration: node,
                exportName: node.declaration.id.name,
                specifier: moduleSpecifier,
                importName: null,
                localName: node.declaration.id.name,
                variable: null,
              };
            }
          } else {
            internalError("Unparseable ExportNamedDeclaration.");
          }

        } else {
          // { foo, bar as baz }
          for (let specifier of node.specifiers) {
            if (moduleSpecifier) {
              yield {
                node: specifier,
                declaration: node,
                exportName: specifier.exported.name,
                specifier: moduleSpecifier,
                importName: specifier.local.name,
                localName: null,
                variable: null,
              };
            } else {
              let scope = scopeManager.acquire(program, true);
              let variable = scope && scope.set.get(specifier.local.name) || null;

              yield {
                node: specifier,
                declaration: node,
                exportName: specifier.exported.name,
                specifier: moduleSpecifier,
                importName: null,
                localName: specifier.local.name,
                variable,
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
          specifier: null,
          importName: null,
          localName: "*default*",
          variable: null,
        };
        break;
      }
      case "ExportAllDeclaration": {
        // export * from ...;
        /* istanbul ignore if */
        if (typeof node.source.value != "string") {
          internalError("The parser generated an ExportAllDeclaration with a non-string specifier.");
        }

        let moduleSpecifier = node.source.value;

        if (moduleSpecifier.startsWith(".")) {
          try {
            module.resolveModule(moduleSpecifier);
          } catch (e) {
            module.addIssue({
              module,
              type: IssueType.ImportError,
              message: `Unable to locate module for specifier '${moduleSpecifier}'.`,
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
          specifier: moduleSpecifier,
          importName: "*",
          localName: null,
          variable: null,
        };
        break;
      }
    }
  }
}

const BASE_SCOPES = ["class", "function", "global"];

export function getBaseScope(scope: Scope): Scope {
  while (!BASE_SCOPES.includes(scope.type)) {
    /* istanbul ignore if */
    if (!scope.upper) {
      internalError(`Found a ${scope.type} with no upper scope.`);
    }
    scope = scope.upper;
  }

  return scope;
}

// Gets the variable for the function that creates this scope.
export function getFunctionVariable(module: SourceTextModuleRecord, scopeManager: ScopeManager, scope: Scope): Variable | LocalExportEntry | null {
  /* istanbul ignore if */
  if (scope.type != "function") {
    internalError(`Attempt to use ${scope.type} as a function scope.`);
  }

  checkParented(scope.block);

  switch (scope.block.type) {
    case "FunctionDeclaration": {
      let id = scope.block.id;
      if (!id) {
        // Part of an `export default function...`, no variable.
        let exportEntry = module.defaultExport;
        if (!exportEntry || scope.block.parent != exportEntry.declaration) {
          internalError("Found a function declaration with no name but not as part of a default export.");
        }

        return exportEntry;
      }

      let variables = scopeManager.getDeclaredVariables(scope.block);
      /* istanbul ignore if */
      if (variables.length == 0) {
        internalError("A function declaration should always declare variables.");
      }
      return variables[0];
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      if (scope.block.parent.type != "VariableDeclarator") {
        return null;
      }

      let variables = scopeManager.getDeclaredVariables(scope.block.parent);
      /* istanbul ignore if */
      if (variables.length == 0) {
        internalError("A variable declarator should always declare a variable.");
      }
      return variables[0];
    }
    default:
      internalWarning(`Attempting to get function for unknown type ${scope.block.type}`);
      return null;
  }
}
