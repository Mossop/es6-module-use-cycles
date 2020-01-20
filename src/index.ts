import { buildArgumentParser, Options, DefaultOptions } from "./cli";
import ModuleGraph from "./graph";

function detectCycles(options: DefaultOptions): void {
  for (let entrypoint of options.entrypoints) {
    new ModuleGraph(entrypoint, options.extensions);
  }
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

  detectCycles(options);
}

cli();
