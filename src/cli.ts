import path from "path";

import resolve from "resolve";
import yargs from "yargs";

export type NonEmptyArray<T> = [T, ...T[]];

export function makeNonEmpty<T>(arr: T[]): NonEmptyArray<T> {
  if (arr.length > 0) {
    return arr as NonEmptyArray<T>;
  }
  throw new Error("Expected a non-empty array but got a zero length array.");
}

export interface DefaultOptions {
  command: "*";
  entrypoints: NonEmptyArray<string>;
  extensions: string[];
  includeWarnings: boolean;
}

export type Options = DefaultOptions;

type Resolver<T> = (arg: T) => void;
type Rejecter<T> = (arg: T) => void;

interface DefaultArguments {
  _: string[];
  ext: string[];
  warnings: boolean;
}

function parseDefaultArguments({ _: entrypoints, ext: extensions, warnings }: DefaultArguments): DefaultOptions {
  if (!entrypoints.length) {
    throw new Error("At least one entrypoint must be provided.");
  }

  extensions = Array.from(extensions.reduce((set: Set<string>, current: string): Set<string> => {
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
  }, new Set<string>()));

  entrypoints = entrypoints.map((entry: string): string => {
    return resolve.sync(path.resolve(process.cwd(), entry), {
      basedir: process.cwd(),
      extensions: extensions,
    });
  });

  return {
    command: "*",
    entrypoints: makeNonEmpty(entrypoints.map((filename: string) => path.resolve(filename))),
    extensions,
    includeWarnings: warnings,
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

  const parser = yargs
    .command("*", "Detect module cycles.", (yargs: yargs.Argv<{}>) => {
      yargs
        .positional("entrypoints", {
          type: "string",
          description: "The scripts that are the entry points to your application.",
          defaultDescription: "main from package.json"
        })
        .option("warnings", {
          boolean: true,
          default: false,
          description: "Displays warnings as well as errors.",
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

      // This is a no-op if a command was already run.
      if (resolver) {
        resolver(null);
      }
      return promise;
    },
  };
}
