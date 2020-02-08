# es6-module-use-cycles

![Test status](https://github.com/Mossop/es6-module-use-cycles/workflows/Build%20and%20test/badge.svg)
[![Code coverage](https://codecov.io/gh/Mossop/es6-module-use-cycles/branch/master/graph/badge.svg?token=cuyYJZZq9i)](https://codecov.io/gh/Mossop/es6-module-use-cycles)

A tool to detect problematic ES6 module cyclic dependencies.

While working on a separate project I ran into a problem where I had created some
cyclic dependencies amongst my modules. There are a couple of tools out there
that can to a certain extent detect and warn you about this but none of them
actually showed me the issue that needed resolving. So I set about writing my own.

## Project status

This project should currently be considered as unstable and under active (or as active as I can manage in my spare time) development. It currently does some things, mostly without throwing exceptions. Some of those things are known to be correct and useful. Some of those things are known to be wrong. I think it's pretty close but right now I wouldn't use it except as a way to hint at what you might want to investigate further.

## Safe and unsafe dependency cycles

The challenge with detecting bugs caused by dependency cycles is that JavaScript
is designed to be able to load and run code with dependency cycles with no
problems in many cases. Take this contrived example:

```javascript
// a.js
import { add } from "./b";

export const a = 5;

console.log(add(7));
```

```javascript
// b.js
import { a } from "./a";

export const add = (value) => value + a;
```

There is clearly a dependency cycle here. `a.js` imports something from `b.js` which imports something from `a.js`. And yet this cycle is safe. Executing `a.js` will correctly output the number 12. How?

The key is that importing something from another module does not give you a copy of the value from that module. Instead before execution a space in memory is created for the exported value (here `const a`) and the import is set up to point to the same space in memory. Now when `a.js` is actually executed it knows it is importing from `b.js` and so executes that first. In there the imported `a` is not yet defined since `a.js` hasn't evaluated its value yet but that doesn't matter since all `b.js` does is export a function. `a` doesn't need to be defined until that function is called. So as long as `a.js` sets the value for the exorted `a` before it calls the imported `add` function things will work as expected.

Every existing tool I could find would flag these modules as an error when it is actually ok. This tool is intended to differentiate between these safe and unsafe dependency cycles because in some cases it is very hard to do away with cycles entirely.

It can also warn you about these safe cycles existing though because it is very easy to accidentally go from a safe cycle to an unsafe cycle. In the example simply changing the module that executes first causes this cycle to become unsafe. Running `b.js` first causes `a.js` to attempt to call `add` before `b.js` has executed to define it. Alternatively changing what `b.js` exports to be `export const 7 + a` makes this an unsafe cycle as `b.js` is trying to use `a` before `a.js` has executed.
