This demonstrates a simple module cycle that will throw an error.

Using `entry.js` as the entrypoint it imports store from `module.js` which will
cause `module.js` to be executed first where it tries to call `buildStore`
before `entry.js` has executed and created the function.

Actually running this should throw an error trying to call the undefined
`buildStore` function.
