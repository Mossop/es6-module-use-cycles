import { unavailable } from "./entry.js";

export function callme() {
  callme();
  return unavailable;
}
