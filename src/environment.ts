import { SourceTextModuleRecord, ModuleNamespace } from "./modulerecord";

interface ModuleBinding {
  module: SourceTextModuleRecord;
  bindingName: string;
}

export class EnvironmentRecord {
  public names: Map<string, ModuleNamespace | ModuleBinding> = new Map();

  public createImmutableBinding(name: string, namespace: ModuleNamespace): void {
    this.names.set(name, namespace);
  }

  public createImportBinding(name: string, module: SourceTextModuleRecord, bindingName: string): void {
    this.names.set(name, {
      module,
      bindingName,
    });
  }
}
