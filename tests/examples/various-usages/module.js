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

class Cls {
  constructor() {
    check();
  }

  a() {
    check();
  }

  b() {
    check();
  }

  static sa() {
    check();
  }

  static sb() {
    check();
  }
}

Cls.sa();
let cls = new Cls();
cls.a();

export const makeCycle = 42;
