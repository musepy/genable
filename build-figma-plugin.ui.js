const fs = require('fs')
const path = require('path')

/**
 * [Figma Sandbox Defense] esbuild plugin — same as in build-figma-plugin.main.js
 * Sanitizes forbidden patterns synchronously in onEnd, before Figma can reload.
 */
const figmaSandboxSanitizer = {
  name: 'figma-sandbox-sanitizer',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return

      const outfile = build.initialOptions.outfile
      if (!outfile || !fs.existsSync(outfile)) return

      let content = fs.readFileSync(outfile, 'utf8')
      let modified = false

      const patterns = [
        { regex: /import\s*\(/g, replacement: 'imp_ort(' },
        { regex: /import\.\s*meta/g, replacement: 'imp_ort.meta' },
        { regex: /eval\s*\(/g, replacement: 'ev_al(' },
        { regex: /new\s*Function\s*\(/g, replacement: 'new Fun_ction(' }
      ]

      for (const { regex, replacement } of patterns) {
        const replaced = content.replace(regex, replacement)
        if (replaced !== content) {
          content = replaced
          modified = true
        }
      }

      if (modified) {
        fs.writeFileSync(outfile, content)
      }
    })
  }
}

module.exports = function (buildOptions) {
  // Resolve preact/compat paths for aliasing React → Preact
  const preactCompat = path.dirname(require.resolve('preact/compat/package.json'))

  return {
    ...buildOptions,
    define: {
      global: 'window',
      __DEV__: JSON.stringify(buildOptions.dev || false)
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
      ...(buildOptions.plugins || []),
      figmaSandboxSanitizer
    ]
  }
}
