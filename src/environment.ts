import { ModuleNamespace, ConcreteModule } from "./modulerecord";

interface ModuleBinding {
  module: ConcreteModule;
  bindingName: string;
}

export class EnvironmentRecord {
  public names: Map<string, ModuleNamespace | ModuleBinding> = new Map();

  public createImmutableBinding(name: string, namespace: ModuleNamespace): void {
    this.names.set(name, namespace);
  }

  public createImportBinding(name: string, module: ConcreteModule, bindingName: string): void {
    this.names.set(name, {
      module,
      bindingName,
    });
  }
}
