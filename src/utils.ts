import fs from "fs";
import path from "path";

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
