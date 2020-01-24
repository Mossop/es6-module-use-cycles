import fs from "fs";
import path from "path";

export type NonEmptyArray<T> = [T, ...T[]];

export function makeNonEmpty<T>(arr: T[]): NonEmptyArray<T> {
  if (arr.length > 0) {
    return arr as NonEmptyArray<T>;
  }
  throw new Error("Expected a non-empty array but got a zero length array.");
}

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
