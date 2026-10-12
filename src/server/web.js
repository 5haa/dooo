'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../apps/web/public');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'],
  '/sw.js': ['sw.js', 'text/javascript'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'], '/font.woff2': ['font.woff2', 'font/woff2'] };
function serveWeb(req, res, url) {
  const item = files[url.pathname]; if (!item || !['GET', 'HEAD'].includes(req.method)) return false;
  if (!fs.existsSync(path.join(root, item[0]))) return false;
  res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(path.join(root, item[0])).pipe(res); return true;
}
module.exports = { serveWeb };
