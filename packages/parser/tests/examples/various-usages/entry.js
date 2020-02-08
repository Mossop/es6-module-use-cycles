import { foo } from "./indirect";
import { makeCycle } from "./module";
import { callme } from "./functioncycle";

callme();

export { bar } from "./indirect";
export { foo };
export const unavailable = 5;
