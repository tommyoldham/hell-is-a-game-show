// node tools/serve.js [port] — tiny static server for dist/ (local testing only).
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'dist');
const port = +process.argv[2] || 8765;
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/HellIsAGameShow.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving dist on http://localhost:${port}`));
