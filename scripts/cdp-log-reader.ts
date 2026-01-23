/**
 * CDP Log Reader - Captures console.log from Figma DevTools via Chrome DevTools Protocol
 *
 * Usage:
 *   npx ts-node scripts/cdp-log-reader.ts [--output <file>] [--filter <pattern>]
 *
 * Prerequisites:
 *   - Run ./scripts/start-figma-debug.sh first
 *   - Figma must be running with remote debugging on port 9222
 */

import * as fs from 'fs';
import * as path from 'path';

const DEBUG_PORT = 9222;
const DEFAULT_LOG_FILE = path.join(__dirname, '..', 'figma-plugin.log');

interface CDPTarget {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CDPMessage {
  id?: number;
  method?: string;
  params?: {
    type?: string;
    args?: Array<{
      type: string;
      value?: unknown;
      description?: string;
    }>;
    timestamp?: number;
    stackTrace?: {
      callFrames: Array<{
        functionName: string;
        url: string;
        lineNumber: number;
      }>;
    };
  };
  result?: unknown;
  error?: { message: string };
}

async function getDebugTargets(): Promise<CDPTarget[]> {
  const response = await fetch(`http://localhost:${DEBUG_PORT}/json`);
  if (!response.ok) {
    throw new Error(`Failed to get debug targets: ${response.statusText}`);
  }
  return response.json() as Promise<CDPTarget[]>;
}

function formatLogEntry(params: CDPMessage['params']): string {
  if (!params) return '';

  const timestamp = new Date(params.timestamp ? params.timestamp * 1000 : Date.now()).toISOString();
  const type = params.type || 'log';
  const args = params.args || [];

  const message = args
    .map((arg) => {
      if (arg.type === 'string' || arg.type === 'number' || arg.type === 'boolean') {
        return String(arg.value);
      }
      return arg.description || JSON.stringify(arg.value);
    })
    .join(' ');

  return `[${timestamp}] [${type.toUpperCase()}] ${message}`;
}

async function connectAndCapture(target: CDPTarget, options: { output: string; filter?: string }) {
  const { WebSocket } = await import('ws');

  if (!target.webSocketDebuggerUrl) {
    throw new Error('Target does not have a WebSocket debugger URL');
  }

  console.log(`📡 Connecting to: ${target.title}`);
  console.log(`   URL: ${target.webSocketDebuggerUrl}`);
  console.log(`   Logging to: ${options.output}`);
  if (options.filter) {
    console.log(`   Filter: ${options.filter}`);
  }
  console.log('');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let messageId = 1;

  ws.on('open', () => {
    console.log('✅ Connected! Listening for console output...');
    console.log('   Press Ctrl+C to stop\n');

    // Enable Runtime domain to receive console events
    ws.send(JSON.stringify({ id: messageId++, method: 'Runtime.enable' }));

    // Enable Log domain for additional logs
    ws.send(JSON.stringify({ id: messageId++, method: 'Log.enable' }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const msg: CDPMessage = JSON.parse(data.toString());

      if (msg.method === 'Runtime.consoleAPICalled') {
        const logEntry = formatLogEntry(msg.params);

        // Apply filter if specified
        if (options.filter && !logEntry.includes(options.filter)) {
          return;
        }

        // Write to console and file
        console.log(logEntry);
        fs.appendFileSync(options.output, logEntry + '\n');
      } else if (msg.method === 'Log.entryAdded') {
        const entry = msg.params as unknown as { entry: { level: string; text: string; timestamp: number } };
        if (entry?.entry) {
          const logEntry = `[${new Date(entry.entry.timestamp).toISOString()}] [${entry.entry.level.toUpperCase()}] ${entry.entry.text}`;

          if (options.filter && !logEntry.includes(options.filter)) {
            return;
          }

          console.log(logEntry);
          fs.appendFileSync(options.output, logEntry + '\n');
        }
      }
    } catch {
      // Ignore parse errors
    }
  });

  ws.on('error', (error: Error) => {
    console.error('❌ WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('\n📴 Connection closed');
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping log capture...');
    ws.close();
    process.exit(0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const filterIndex = args.indexOf('--filter');
  const targetIndex = args.indexOf('--target');

  const options = {
    output: outputIndex !== -1 ? args[outputIndex + 1] : DEFAULT_LOG_FILE,
    filter: filterIndex !== -1 ? args[filterIndex + 1] : undefined,
    targetName: targetIndex !== -1 ? args[targetIndex + 1] : undefined,
  };

  console.log('🔍 CDP Log Reader - Figma DevTools Console Capture');
  console.log('═'.repeat(50));
  console.log('');

  try {
    // Get available debug targets
    console.log('📋 Fetching debug targets...');
    const targets = await getDebugTargets();

    // Find plugin-related targets
    const pluginTargets = targets.filter(
      (t) =>
        t.url.includes('figma') ||
        t.title.toLowerCase().includes('figma') ||
        t.type === 'page'
    );

    if (pluginTargets.length === 0) {
      console.log('❌ No Figma targets found. Available targets:');
      targets.forEach((t) => console.log(`   - ${t.title} (${t.type})`));
      process.exit(1);
    }

    console.log(`✅ Found ${pluginTargets.length} target(s):`);
    pluginTargets.forEach((t, i) => console.log(`   ${i + 1}. ${t.title} (${t.type})`));
    console.log('');

    // Select target: prefer --target match, otherwise first with WebSocket
    let target: CDPTarget | undefined;
    if (options.targetName) {
      target = pluginTargets.find(
        (t) => t.webSocketDebuggerUrl && t.title.toLowerCase().includes(options.targetName!.toLowerCase())
      );
      if (!target) {
        console.log(`⚠️  Target containing "${options.targetName}" not found, using first available`);
      }
    }
    if (!target) {
      target = pluginTargets.find((t) => t.webSocketDebuggerUrl);
    }
    if (!target) {
      console.log('❌ No target with WebSocket debugger URL found');
      process.exit(1);
    }

    // Clear previous log file
    fs.writeFileSync(options.output, `# Figma Plugin Console Log - Started ${new Date().toISOString()}\n\n`);

    await connectAndCapture(target, options);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED')) {
        console.log('❌ Cannot connect to Figma debug port.');
        console.log('   Make sure Figma is running with --remote-debugging-port=9222');
        console.log('   Run: ./scripts/start-figma-debug.sh');
      } else {
        console.error('❌ Error:', error.message);
      }
    }
    process.exit(1);
  }
}

main();
