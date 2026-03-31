const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8080;
const ROOT_DIR = __dirname;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
};

const server = http.createServer((req, res) => {
    // 1. Check for API: Save Metrics
    if (req.method === 'POST' && req.url === '/api/metrics') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // Save metrics locally so the LLM Agent can view_file them directly
                const outPath = path.join(ROOT_DIR, 'metrics_latest.json');
                fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', msg: 'Metrics saved to ' + outPath }));
                console.log(`[API] Saved user metrics to ${outPath}`);
            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // 2. Check for API: Open File in IDE
    if (req.method === 'POST' && req.url === '/api/open-file') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { filePath } = JSON.parse(body);
                if (!filePath) throw new Error("No file path provided");
                
                // Extremely safe escape for mac CLI `open "path"`
                const safePath = filePath.replace(/"/g, '\\"');
                console.log(`[API] Opening file in system default IDE: ${safePath}`);
                
                exec(`open "${safePath}"`, (error) => {
                    if (error) {
                        console.error('Failed to open file:', error);
                        res.writeHead(500);
                        res.end(JSON.stringify({ status: 'error', error: error.message }));
                    } else {
                        res.writeHead(200);
                        res.end(JSON.stringify({ status: 'ok' }));
                    }
                });
            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 3. Static File Server
    let filePath = path.join(ROOT_DIR, req.url === '/' ? 'index.html' : req.url);
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('404 Not Found', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, Object.assign({
    hostname: '127.0.0.1' // Restrict to localhost for safety
}), () => {
    console.log(`Interactive Quiz Server running at http://127.0.0.1:${PORT}/`);
    console.log(`- LLM Retrieval Endpoint active (metrics_latest.json)`);
    console.log(`- IDE-Agnostic File Opener active`);
});
