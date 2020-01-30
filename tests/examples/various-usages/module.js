import { unavailable, foo, bar } from "./entry";
import { indirect } from "./indirectCycle";

let test = function() {
  return unavailable;
}
test();

function check() {
  return foo() + bar() + indirect;
}

const dotest = () => check();
dotest();

export const makeCycle = 42;
