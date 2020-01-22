import { Rule } from "eslint";
// eslint-disable-next-line import/no-unresolved
import * as ESTree from "estree";

import { ModuleInfo } from "./moduleinfo";

export default function createRule(_context: Rule.RuleContext, moduleInfo: ModuleInfo): Rule.RuleListener {
  return {
    "Program": function(_node: ESTree.Program): void {
      // TODO
    },
    "ImportDeclaration": function(node: ESTree.ImportDeclaration): void {
      if (typeof node.source.value == "string" && node.source.value.startsWith(".")) {
        moduleInfo.parseModule(node.source.value, node);
      //   for (let specifier of node.specifiers) {
      //     switch (specifier.type) {
      //       case "ImportSpecifier":
      //         moduleInfo.imports.push({
      //           module: target,
      //           type: ImportType.Symbol,
      //           symbol: specifier.local.name,
      //           source: specifier.imported.name,
      //         });
      //         console.log(`import ${context.getFilename()}:${specifier.local.name} -> ${target}:${specifier.imported.name}`);
      //         break;
      //       case "ImportDefaultSpecifier":
      //         moduleInfo.imports.push({
      //           module: target,
      //           type: ImportType.Default,
      //           symbol: specifier.local.name,
      //         });
      //         console.log(`import ${context.getFilename()}:${specifier.local.name} -> ${target}:default`);
      //         break;
      //       case "ImportNamespaceSpecifier":
      //         moduleInfo.imports.push({
      //           module: target,
      //           type: ImportType.Namespace,
      //           symbol: specifier.local.name,
      //         });
      //         console.log(`import ${context.getFilename()}:${specifier.local.name} -> ${target}:*`);
      //         break;
      //     }
      //   }
      }
    },
  };
}
