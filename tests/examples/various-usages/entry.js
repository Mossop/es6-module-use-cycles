import { foo } from "./indirect";
import { makeCycle } from "./module";

export { bar } from "./indirect";
export { foo };
export const unavailable = 5;
