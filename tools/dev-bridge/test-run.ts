#!/usr/bin/env npx tsx
/**
 * CLI test runner for dev bridge E2E testing.
 *
 * Usage:
 *   npx tsx tools/dev-bridge/test-run.ts "Design a login card"
 *   npx tsx tools/dev-bridge/test-run.ts "Design a dashboard" --reset --wait 120
 *
 * Options:
 *   --reset     Reset session before running (new design)
 *   --wait N    Wait timeout in seconds (default: 120)
 *   --build     Run `node build.js` before triggering
 *
 * What it does:
 *   1. Ensures dev bridge server is running (starts if not)
 *   2. Optionally builds the plugin
 *   3. Sends the prompt via POST /trigger
 *   4. Long-polls GET /result/:id?wait=N
 *   5. Prints a structured report (digest, tool calls, screenshot path)
 */

const BRIDGE_URL = 'http://localhost:3456';

async function main() {
  const args = process.argv.slice(2);
  const prompt = args.find(a => !a.startsWith('--'));
  const reset = args.includes('--reset');
  const doBuild = args.includes('--build');
  const waitIdx = args.indexOf('--wait');
  const waitSec = waitIdx >= 0 && args[waitIdx + 1] ? Number(args[waitIdx + 1]) : 120;

  if (!prompt) {
    console.error('Usage: npx tsx tools/dev-bridge/test-run.ts "your prompt" [--reset] [--build] [--wait N]');
    process.exit(1);
  }

  // Step 1: Ensure server is running
  const healthy = await checkHealth();
  if (!healthy) {
    console.log('[test-run] Dev bridge not running. Starting...');
    await startServer();
    // Wait for it to be healthy
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      if (await checkHealth()) break;
    }
    if (!await checkHealth()) {
      console.error('[test-run] Failed to start dev bridge server');
      process.exit(1);
    }
  }
  console.log('[test-run] Dev bridge: ok');

  // Step 2: Build if requested
  if (doBuild) {
    console.log('[test-run] Building plugin...');
    const { execSync } = await import('node:child_process');
    execSync('node build.js', { stdio: 'inherit', cwd: process.cwd() });
    console.log('[test-run] Build: ok');
  }

  // Step 3: Send trigger
  console.log(`[test-run] Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);
  const triggerRes = await fetch(`${BRIDGE_URL}/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, reset }),
  });
  const trigger = await triggerRes.json() as any;
  if (!trigger.ok) {
    console.error('[test-run] Failed to trigger:', trigger);
    process.exit(1);
  }
  const triggerId = trigger.id;
  console.log(`[test-run] Triggered: ${triggerId} (waiting up to ${waitSec}s...)`);

  // Step 4: Long-poll for result
  const resultRes = await fetch(`${BRIDGE_URL}/result/${triggerId}?wait=${waitSec}`);
  const result = await resultRes.json() as any;

  if (result.status === 'pending') {
    console.error(`[test-run] Timed out after ${waitSec}s. No result received.`);
    process.exit(1);
  }

  // Step 5: Print report
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULT');
  console.log('='.repeat(60));
  console.log(`Status: ${result.status}`);
  console.log(`Model: ${result.modelName}`);
  console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Tools: ${result.toolCallSummary?.total ?? '?'} calls, ${result.toolCallSummary?.errors ?? '?'} errors`);

  // Tool call timeline
  if (result.toolCallDetails?.length > 0) {
    console.log('\n--- Tool Calls ---');
    for (const tc of result.toolCallDetails) {
      const dur = tc.durationMs ? `${tc.durationMs}ms` : '?';
      const status = tc.status === 'success' ? 'OK' : `ERR: ${tc.error}`;
      const paramPreview = tc.params
        ? tc.params.slice(0, 120) + (tc.params.length > 120 ? '...' : '')
        : '';
      console.log(`  [${tc.name}] ${dur} ${status}  ${paramPreview}`);
    }
  }

  // Final text
  if (result.finalText) {
    console.log('\n--- Agent Response ---');
    console.log(result.finalText.slice(0, 500));
    if (result.finalText.length > 500) console.log('...(truncated)');
  }

  // Screenshot path
  const screenshotPath = `/tmp/figma-bridge/results/${triggerId}/screenshot.png`;
  console.log(`\n--- Files ---`);
  console.log(`Screenshot: ${screenshotPath}`);
  console.log(`Full result: /tmp/figma-bridge/results/${triggerId}/meta.json`);
  console.log(`Tool calls: /tmp/figma-bridge/results/${triggerId}/tool-calls.json`);
  console.log('='.repeat(60));
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  const { spawn } = await import('node:child_process');
  const child = spawn('npx', ['tsx', 'tools/dev-bridge/server.ts'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('[test-run] Fatal:', err);
  process.exit(1);
});
