This demonstrates a simple module cycle that will not throw an error.

Using `entry.js` as the entrypoint it imports something from `module.js` which
in turn imports something from `entry.js`. None of these things are using during
execution though and so there is no issue with this cycle.
