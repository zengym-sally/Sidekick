// Narrow read-only preview server for the HTML design artifacts.
// It exposes only /design/, /src/assets/ and /src/styles/; every other path is a 404.
// Usage: node design/serve.mjs   (PORT overrides the default 4173; binds 127.0.0.1 only)
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const host = '127.0.0.1';
const port = Number(process.env.PORT) || 4173;
const prefixes = ['/design/', '/src/assets/', '/src/styles/'];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function send(response, status, body = '', headers = {}) {
  response.writeHead(status, { 'cache-control': 'no-store', ...headers });
  response.end(body);
}

function notFound(response) {
  send(response, 404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' });
}

function redirect(response, location) {
  send(response, 302, '', { location });
}

async function serve(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    return;
  }
  let pathname;
  try {
    pathname = normalize(decodeURIComponent(new URL(request.url, `http://${host}`).pathname));
  } catch {
    notFound(response);
    return;
  }
  if (pathname === '/') {
    redirect(response, '/design/');
    return;
  }
  if (pathname.includes('\0') || !prefixes.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix))) {
    notFound(response);
    return;
  }
  if (!pathname.endsWith('/') && !extname(pathname)) {
    redirect(response, `${pathname}/`);
    return;
  }
  const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    notFound(response);
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      notFound(response);
      return;
    }
    throw error;
  }
  if (info.isDirectory()) {
    redirect(response, `${pathname}/`);
    return;
  }
  response.writeHead(200, {
    'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

createServer((request, response) => {
  serve(request, response).catch(() => {
    if (!response.headersSent) send(response, 500, 'Internal Server Error', { 'content-type': 'text/plain; charset=utf-8' });
    else response.destroy();
  });
}).listen(port, host, () => {
  console.log(`Design preview: http://${host}:${port}/design/ (serving /design/, /src/assets/, /src/styles/)`);
});
