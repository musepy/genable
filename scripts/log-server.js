const http = require('http');

const PORT = 3456;
const LOGS_LIMIT = 100;
let logs = [];

/**
 * A ultra-lightweight log server for Figma Plugin Development.
 * 
 * APIs:
 * - POST /logs: Send a log entry { type: 'info'|'warn'|'error', message: string, data: any }
 * - GET /logs/summary: Retrieve the last 20 logs.
 * - GET /logs/clear: Clear the log buffer.
 */
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/logs') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        entry.timestamp = new Date().toISOString();
        logs.push(entry);
        
        // Circular buffer
        if (logs.length > LOGS_LIMIT) {
          logs.shift();
        }

        // Mirror to terminal for visibility
        const color = entry.type === 'error' ? '\x1b[31m' : (entry.type === 'warn' ? '\x1b[33m' : '\x1b[32m');
        console.log(`${color}[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}\x1b[0m`);
        if (entry.data) console.dir(entry.data, { depth: 2 });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.method === 'GET' && url.pathname === '/logs/summary') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs.slice(-20), null, 2));
  } else if (req.method === 'GET' && url.pathname === '/logs/clear') {
    logs = [];
    console.log('\x1b[36m[LogServer] Logs cleared.\x1b[0m');
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\x1b[35m[LogServer] 🚀 Ready on http://localhost:${PORT}\x1b[0m`);
  console.log(`\x1b[35m[LogServer] Capture logs via POST /logs and view via GET /logs/summary\x1b[0m`);
});
