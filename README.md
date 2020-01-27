# es6-module-use-cycles

![Test status](https://github.com/Mossop/es6-module-use-cycles/workflows/Build%20and%20test/badge.svg)
[![Code coverage](https://codecov.io/gh/Mossop/es6-module-use-cycles/branch/master/graph/badge.svg?token=cuyYJZZq9i)](https://codecov.io/gh/Mossop/es6-module-use-cycles)

A tool to detect problematic ES6 module cyclic dependencies.

While working on a separate project I ran into a problem where I had created some
cyclic dependencies amongst my modules. There are a couple of tools out there
that can to a certain extent detect and warn you about this but none of them
actually showed me the issue that needed resolving. So I set about writing my own.
