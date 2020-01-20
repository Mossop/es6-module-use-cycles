import { Rule } from "eslint";
import * as ESTree from "estree";
import ModuleGraph from "./graph";

export default function createRule(context: Rule.RuleContext, graph: ModuleGraph): Rule.RuleListener {
  return {
    "Program": function(_node: ESTree.Program): void {
      console.log(`Parsing ${context.getFilename()}`);
    },
    "ImportDeclaration": function(node: ESTree.ImportDeclaration): void {
      if (typeof node.source.value == "string" && node.source.value.startsWith(".")) {
        graph.parseModule(context.getFilename(), node.source.value);
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
