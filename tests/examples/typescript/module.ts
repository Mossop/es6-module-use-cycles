import { foo } from "./entry";

export default foo + 5;
export type Foo = string | number;
export interface Bar {
  foo: string;
}

type Baz = string | null;
export { Baz };
