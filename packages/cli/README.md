# es6-module-use-cycles

![Test status](https://github.com/Mossop/es6-module-use-cycles/workflows/Build%20and%20test/badge.svg)
[![Code coverage](https://codecov.io/gh/Mossop/es6-module-use-cycles/branch/master/graph/badge.svg?token=cuyYJZZq9i)](https://codecov.io/gh/Mossop/es6-module-use-cycles)
![npm](https://img.shields.io/npm/v/module-cycles)

A tool to detect problematic ES6 module cyclic dependencies.

See [the top-level README](../../README.md) for the nitty gritty about the types of module cycles that this tool finds and why other tools aren't sufficient.

## Usage

```
npx module-cycles <options> [entrypoints...]
```

The tool needs at least one entrypoint into the application (think the module you include into the html file). If none are given on the command line it will attempt to find a `package.json` file in or above the current directory and use the `main` property from it. Make sure this is correct, whether a dependency cycle is safe or not can change depending on the entrypoint into the module graph.
