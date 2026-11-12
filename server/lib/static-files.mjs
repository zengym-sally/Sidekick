//! Same-origin static file serving for the backend host.
//!
//! Serves the frontend `dist/` with correct MIME types, long-lived caching for
//! hashed assets and no caching for `index.html`. `/api` paths never fall back
//! to the SPA shell (W1 contract §9.4, M3).

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function fileMime(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function looksLikeFile(pathname) {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  return last.includes('.');
}

export function serveStatic(req, res, { staticRoot }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'method_not_allowed' } }));
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ contractVersion: 'web-api/2', status: 404, error: { code: 'not_found' } }));
    return;
  }
  const root = resolve(staticRoot);
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'forbidden' } }));
    return;
  }
  let file = candidate;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (looksLikeFile(pathname)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'not_found' } }));
      return;
    }
    file = join(root, 'index.html');
  }
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'not_found' } }));
    return;
  }
  const stats = statSync(file);
  const headers = {
    'Content-Type': fileMime(file),
    'Content-Length': stats.size,
  };
  if (file.endsWith('index.html')) headers['Cache-Control'] = 'no-cache';
  else headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
