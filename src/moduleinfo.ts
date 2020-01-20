import ModuleGraph from "./graph";

export class ModuleInfo {
  public constructor(private filename: string, private parser: ModuleGraph) {}

  public parseModule(target: string): ModuleInfo | null {
    return this.parser.parseModule(this.filename, target);
  }
}
