import path from "path";

export function getExample(): string {
  if (!module.parent) {
    throw new Error("utils.ts must not be invoked directly.");
  }
  let parent = module.parent.filename;

  let name = path.basename(parent, path.extname(parent));
  return path.join(path.dirname(parent), "examples", name);
}
