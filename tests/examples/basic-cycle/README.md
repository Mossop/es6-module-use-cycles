This demonstrates a simple module cycle that will throw an error.

Using `entry.js` as the entrypoint it imports store from `module.js` which will
cause `module.js` to be executed first where it tries to call `buildStore`
before `entry.js` has executed and created the function.

Using `module.js` will not show any issues currently but an attempt to use
`store` in `app.js` during the initial execution would be a problem since
`module.js` hasn't executed and so hasn't given `store` a value yet.
