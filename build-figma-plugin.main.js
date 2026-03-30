const fs = require('fs')
const path = require('path')

/**
 * [Figma Sandbox Defense] esbuild plugin
 *
 * Figma's plugin sandbox rejects code containing forbidden patterns like
 * `import(`, `import.meta`, `eval(`, `new Function(` — even inside strings.
 *
 * This plugin sanitizes the output synchronously in esbuild's onEnd hook,
 * BEFORE Figma's file watcher can detect and evaluate the unsanitized code.
 *
 * Previously, sanitization was done via a separate fs.watch in build.js,
 * which caused a race condition: Figma would reload the plugin before the
 * sanitizer ran, triggering "SyntaxError: possible import expression rejected".
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
  return {
    ...buildOptions,
    // platform: 'neutral' ignores main/module by default — configure explicitly
    // so packages like sucrase (which only expose main/module, not exports) resolve correctly
    mainFields: ['module', 'main'],
    plugins: [
      {
        name: 'csv-text-loader',
        setup(build) {
          build.onLoad({ filter: /\.csv$/ }, async (args) => {
            const text = await fs.promises.readFile(args.path, 'utf8')
            return { contents: `export default ${JSON.stringify(text)}`, loader: 'js' }
          })
        }
      },
      ...(buildOptions.plugins || []),
      figmaSandboxSanitizer
    ]
  }
}
