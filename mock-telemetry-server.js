const http = require('http');

const PORT = 3005;

const server = http.createServer((req, res) => {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      console.log('=== TELEMETRY DATA RECEIVED ===');
      console.log('Headers:', req.headers);
      console.log('Body:', body);
      try {
        const parsed = JSON.parse(body);
        console.log('Parsed JSON:', JSON.stringify(parsed, null, 2));
      } catch (e) {
        console.log('Could not parse body as JSON');
      }
      console.log('===============================');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      
      // We got the data, exit successfully so our script knows
      setTimeout(() => process.exit(0), 500);
    });
  } else {
    res.writeHead(405);
    res.end('Method Not Allowed');
  }
});

server.listen(PORT, () => {
  console.log(`Mock telemetry server listening on http://localhost:${PORT}`);
});
