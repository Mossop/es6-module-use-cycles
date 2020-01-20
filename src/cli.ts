import path from "path";

import yargs from "yargs";

export interface DefaultOptions {
  command: "*";
  entrypoints: string[];
  extensions: string[];
}

export type Options = DefaultOptions;

type Resolver<T> = (arg: T) => void;
type Rejecter<T> = (arg: T) => void;

interface DefaultArguments {
  _: string[];
  ext: string[];
}

function parseDefaultArguments({ _: entrypoints, ext: extensions }: DefaultArguments): DefaultOptions {
  if (entrypoints.length == 0) {
    throw new Error("At least one entrypoint must be provided.");
  }

  let extensionSet = extensions.reduce((set: Set<string>, current: string): Set<string> => {
    for (let extension of current.split(",")) {
      if (extension.length == 0) {
        continue;
      }

      if (!extension.startsWith(".")) {
        extension = "." + extension;
      }
      set.add(extension);
    }
    return set;
  }, new Set<string>());

  return {
    command: "*",
    entrypoints: entrypoints.map((filename: string) => path.resolve(filename)),
    extensions: Array.from(extensionSet),
  };
}

function commandFunction<O, R>(fn: (options: O) => R, resolve: Resolver<R> | undefined, reject: Rejecter<string> | undefined): (options: O) => void {
  if (!resolve || !reject) {
    throw new Error("Unexpected state.");
  }

  return (options: O): void => {
    try {
      resolve(fn(options));
    } catch(e) {
      reject(e.message);
    }
  };
}

interface ArgumentParser {
  readonly help: () => void;
  readonly parse: (args?: string[]) => Promise<Options | null>;
}

export function buildArgumentParser(): ArgumentParser {
  let resolver: Resolver<Options | null> | undefined = undefined;
  let rejecter: Rejecter<string> | undefined = undefined;
  let promise = new Promise((resolve: Resolver<Options | null>, reject: Rejecter<string>) => {
    resolver = resolve;
    rejecter = reject;
  });

  const parser = yargs.command("*", "Detect module cycles.", (yargs: yargs.Argv<{}>) => {
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
  }, commandFunction(parseDefaultArguments, resolver, rejecter))
    .help()
    .exitProcess(false);

  return {
    help: (): void => {
      parser.showHelp();
    },
    parse: async (args?: string[]): Promise<Options | null> => {
      if (args) {
        parser.parse(args);
      } else {
        parser.parse();
      }

      // This is a no-op if a command was run.
      if (resolver) {
        resolver(null);
      }
      return promise;
    },
  };
}
