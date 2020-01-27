import { foo } from "./namedExport";
import * as starImported from "./starImported";

export { foo };
export { starImported };
export { direct } from "./direct.js";
export * from "./starExport";
