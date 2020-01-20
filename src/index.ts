import path from "path";

import yargs from "yargs";

import ModuleGraph from "./graph";

interface Options {
  _: string[];
  ext: string[];
}

function detectCycles({ _: entrypoints, ext: extensions }: Options): void {
  entrypoints = entrypoints.map((filename: string) => path.resolve(filename));
  let extensionSet = extensions.reduce((set: Set<string>, current: string): Set<string> => {
    for (let extension of current.split(",")) {
      set.add(extension);
    }
    return set;
  }, new Set<string>());

  for (let entrypoint of entrypoints) {
    new ModuleGraph(entrypoint, Array.from(extensionSet));
  }
}

yargs.command("*", "Detect module cycles.", (yargs: yargs.Argv<{}>) => {
  yargs
    .positional("entrypoints", {
      type: "string",
      description: "The scripts that are the entry points to your application.",
      defaultDescription: "main from package.json"
    })
    .option("ext", {
      type: "string",
      description: "JavaScript file extensions.",
      default: ".js",
      array: true,
      nargs: 1,
    });
}, detectCycles).argv;
