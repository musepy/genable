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
const buildArgs = ['build-figma-plugin', '--typecheck'];
if (!isWatch) buildArgs.push('--minify');
if (isWatch) buildArgs.push('--watch');

/**
 * Inject version into output file by replacing placeholder
 */
function injectVersion() {
  const outputPath = path.join(__dirname, 'build', 'main.js');
  if (fs.existsSync(outputPath)) {
    let content = fs.readFileSync(outputPath, 'utf8');
    const newContent = content.replace(/__BUILD_VERSION__/g, buildTime);
    if (content !== newContent) {
      fs.writeFileSync(outputPath, newContent);
      console.log(`✅ Version injected: ${buildTime}`);
    }
  }
}

if (isWatch) {
  // Watch mode: inject version after each rebuild
  const child = spawn('npx', buildArgs, { stdio: 'inherit', shell: true });
  
  // Watch the output file for changes and inject version
  const outputPath = path.join(__dirname, 'build', 'main.js');
  let debounce = null;
  fs.watch(path.dirname(outputPath), (event, filename) => {
    if (filename === 'main.js') {
      clearTimeout(debounce);
      debounce = setTimeout(injectVersion, 100);
    }
  });
  
  child.on('exit', (code) => process.exit(code));
} else {
  // One-shot build
  try {
    execSync(`npx ${buildArgs.join(' ')}`, { stdio: 'inherit' });
    injectVersion();
    console.log(`\n✅ Build complete!`);
  } catch (e) {
    process.exit(1);
  }
}
