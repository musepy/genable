#!/usr/bin/env node
/**
 * Custom Build Script with Version Injection
 *
 * Injects BUILD_VERSION into the compiled code by replacing the placeholder string.
 *
 * Usage:
 *   node build.js          # Production build
 *   node build.js --watch  # Watch mode
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Generate build timestamp
const buildTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

// Get CLI args
const args = process.argv.slice(2);
const isWatch = args.includes('--watch');

console.log(`🔨 Building with version: ${buildTime}`);
console.log(`   Mode: ${isWatch ? 'watch' : 'production'}`);
console.log('');

// Build command args
const skipTypecheck = args.includes('--no-typecheck');
const buildArgs = ['build-figma-plugin'];
if (!skipTypecheck) buildArgs.push('--typecheck');
if (!isWatch) buildArgs.push('--minify');
if (isWatch) buildArgs.push('--watch');

/**
 * Inject build version into output file.
 *
 * NOTE: Figma sandbox sanitization (import/eval/Function pattern breaking) is now
 * handled by esbuild onEnd plugins in build-figma-plugin.main.js and
 * build-figma-plugin.ui.js. This eliminates the race condition where Figma's file
 * watcher would reload unsanitized code before the post-build sanitizer ran.
 */
function injectMetaData() {
  const buildDir = path.join(__dirname, 'build');
  const outputPath = path.join(buildDir, 'main.js');

  if (!fs.existsSync(outputPath)) return;

  let content = fs.readFileSync(outputPath, 'utf8');

  if (content.includes('__BUILD_VERSION__')) {
    content = content.replace(/__BUILD_VERSION__/g, buildTime);
    fs.writeFileSync(outputPath, content);
  }

  console.log(`✅ Version injected: ${buildTime}`);
}

if (isWatch) {
  // Start Log Server in background
  const logServer = spawn('node', ['scripts/log-server.js'], { stdio: 'inherit', shell: true });
  logServer.on('error', (err) => console.error('Failed to start log server:', err));

  // Watch mode: inject version after each rebuild
  const child = spawn('npx', buildArgs, { stdio: 'inherit', shell: true });

  // Watch the output files for changes and inject metadata
  let debounce = null;
  fs.watch(path.join(__dirname, 'build'), (event, filename) => {
    if (filename === 'main.js' || filename === 'ui.js') {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log(`🔄 [${filename}] Changed, re-injecting metadata...`);
        injectMetaData();
      }, 100);
    }
  });

  child.on('exit', (code) => process.exit(code));
} else {
  // One-shot build
  try {
    // UI capture disabled (test worktree)

    console.log(`🔨 Generating Agent Registries...`);
    execSync(`node scripts/generate-knowledge-index.js`, { stdio: 'inherit' });
    execSync(`node scripts/generate-prompt-catalog.js`, { stdio: 'inherit' });

    console.log(`🔨 Verifying Figma property registry sync...`);
    execSync(`npx tsx tools/extract-figma-props.ts --check`, { stdio: 'inherit' });

    console.log(`🔨 Running Figma Plugin Build...`);
    execSync(`npx ${buildArgs.join(' ')}`, { stdio: 'inherit' });
    injectMetaData();
    console.log(`\n✅ Build complete!`);
  } catch (e) {
    process.exit(1);
  }
}
