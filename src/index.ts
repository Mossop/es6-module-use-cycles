import formatter from "eslint/lib/cli-engine/formatters/stylish";

import { buildArgumentParser, Options, DefaultOptions } from "./cli";
import ModuleGraph from "./graph";
import { findWorkingDirectory } from "./utils";

function detectCycles(options: DefaultOptions): void {
  let workingDirectory = findWorkingDirectory(options.entrypoints[0]);
  let graph = new ModuleGraph({
    extensions: options.extensions,
    workingDirectory,
  });

  for (let entrypoint of options.entrypoints) {
    graph.parseEntrypoint(entrypoint);
  }

  let issues = graph.getIssues(options.issueTypes);
  console.log(formatter(issues));
}

async function cli(): Promise<void> {
  let parser = buildArgumentParser();
  let options: Options | null;
  try {
    options = await parser.parse();
    if (!options) {
      return;
    }

    detectCycles(options);
  } catch (e) {
    console.error(e);
    parser.help();
    return;
  }
}

cli();
