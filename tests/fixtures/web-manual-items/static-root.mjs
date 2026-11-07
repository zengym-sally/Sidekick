// Synthetic static root builder for the same-origin static supply suite. It is used when no
// real frontend dist is available (packaged build/web-backend/static absent and
// WEB_MANUAL_ITEMS_STATIC_ROOT unset): the mechanics (MIME, cache policy, SPA fallback,
// /api non-fallback) and the browser same-origin cold-start chain are exercised against a
// real static root served by the real backend. It is not the product UI and never signs
// business behavior; when a real dist is present the same tests run against it and the
// evidence records which root was used.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HASH = '9f8e7d6c5b4a';

export function buildSyntheticStaticRoot(dir) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sidekick synthetic same-origin root</title>
<link rel="stylesheet" href="/assets/app-${HASH}.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<div id="app">booting</div>
<pre id="probe" hidden></pre>
<script src="/assets/app-${HASH}.js" defer></script>
</body>
</html>
`);
  writeFileSync(join(dir, 'assets', `app-${HASH}.js`), `// synthetic same-origin probe app (not the product UI; only exercises the supply chain)
const app = document.getElementById('app');
app.textContent = 'synthetic-root-ready';
const sameOrigin = (value) => {
  try { return new URL(value, location.href).origin === location.origin; } catch { return false; }
};
const refs = [...document.querySelectorAll('script[src],link[href],img[src]')]
  .map((element) => element.getAttribute('src') || element.getAttribute('href'));
const report = {
  mounted: app.textContent === 'synthetic-root-ready',
  origin: location.origin,
  refs,
  crossOriginRefs: refs.filter((value) => !sameOrigin(value)),
  overflow: document.documentElement.scrollWidth <= window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
};
const settle = async (path) => {
  try {
    const response = await fetch(path, { credentials: 'same-origin' });
    const body = await response.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* not JSON */ }
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', json, body };
  } catch (error) { return { fetchError: String(error) }; }
};
void (async () => {
  report.session = await settle('/api/session');
  report.events = await settle('/api/events');
  document.getElementById('probe').textContent = JSON.stringify(report);
  app.setAttribute('data-probe', 'ready');
})();
`);
  writeFileSync(join(dir, 'assets', `app-${HASH}.css`), 'body{margin:0;font-family:sans-serif}#app{padding:16px}\n');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>\n');
  writeFileSync(join(dir, 'data.json'), '{"contractVersion":"web-api/1","synthetic":true}\n');
  writeFileSync(join(dir, 'assets', 'font.woff2'), Buffer.from('dG9vLXNtYWxs', 'base64'));
  return dir;
}
