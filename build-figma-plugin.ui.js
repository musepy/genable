const path = require('path')

module.exports = function (buildOptions) {
  // Resolve preact/compat paths for aliasing React → Preact
  const preactCompat = path.dirname(require.resolve('preact/compat/package.json'))

  return {
    ...buildOptions,
    define: {
      global: 'window'
    },
    // Ensure ALL react imports (including jsx-runtime) are aliased to preact/compat
    // The built-in preact-compat plugin only handles "react" and "react-dom",
    // but react-markdown@10 imports from "react/jsx-runtime" which was falling
    // through to real React, causing insertBefore errors due to vnode mismatch.
    plugins: [
      {
        name: 'preact-compat-jsx-runtime',
        setup(build) {
          // Alias react/jsx-runtime → preact/compat/jsx-runtime
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
            path: path.join(preactCompat, 'jsx-runtime.mjs')
          }))
          // Alias react/jsx-dev-runtime → preact/compat/jsx-dev-runtime
          build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
            path: path.join(preactCompat, 'jsx-dev-runtime.js')
          }))
        }
      },
      ...(buildOptions.plugins || [])
    ]
  }
}
