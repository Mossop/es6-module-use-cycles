import fs from "fs";
import path from "path";

import formatter from "eslint/lib/cli-engine/formatters/stylish";
import { ModuleHost, Issue, IssueType } from "module-cycles-parser";

import { buildArgumentParser, Options, DefaultOptions } from "./cli";
import { intoLintResults } from "./formatter";

export function findWorkingDirectory(filename: string): string {
  let directory = path.dirname(filename);
  if (directory == filename) {
    return process.cwd();
  }

  if (fs.existsSync(path.join(directory, "package.json"))) {
    return directory;
  }

  return findWorkingDirectory(directory);
}

function detectCycles(options: DefaultOptions): void {
  let workingDirectory = findWorkingDirectory(options.entrypoints[0]);

  let host = new ModuleHost(options.extensions, workingDirectory);
  let sourceText = fs.readFileSync(options.entrypoints[0], { encoding: "utf8" });
  host.topLevelModuleEvaluation(sourceText, options.entrypoints[0]);

  let issues = [...host.getIssues()];
  if (!options.allCycles) {
    issues = issues.filter((issue: Issue): boolean => issue.type != IssueType.ImportCycle);
  }
  console.log(formatter(intoLintResults(issues)));
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
