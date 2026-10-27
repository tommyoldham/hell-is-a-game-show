// node tools/artlab.js [port] — a local workbench for cutting up the source art.
// Serves the project folder, and saves PNGs the browser POSTs to /save?path=art/out/x.png
// (only under art/out/). Open http://localhost:8790/tools/artlab.html.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'art', 'out');
const port = +process.argv[2] || 8790;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/save') {
    const dest = path.resolve(ROOT, url.searchParams.get('path') || '');
    if (!dest.startsWith(OUT + path.sep)) { res.writeHead(403); res.end('art/out only'); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.concat(chunks));
      res.writeHead(200); res.end('saved ' + path.relative(ROOT, dest));
    });
    return;
  }
  const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('artlab on http://localhost:' + port));
