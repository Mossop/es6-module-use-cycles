import path from "path";

export function getExample(name: string): string {
  return path.resolve(__dirname, path.join("..", "..", "..", "..", "examples", name));
}
