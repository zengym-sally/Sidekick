// Synthetic static root builder for the same-origin static supply suite. It is used when no
// real frontend dist is available (packaged build/web-backend/static absent and
// WEB_MANUAL_ITEMS_STATIC_ROOT unset): the mechanics (MIME, cache policy, SPA fallback,
// /api non-fallback) and the browser same-origin cold-start chain are exercised against a
// real static root served by the real backend. It is not the product UI and never signs
// business behavior; when a real dist is present the same tests run against it and the
// evidence records which root was used. The page carries the same reference classes the
// real product dist shows (same-origin http(s) assets plus one inline data: image), so the
// F-5/F-6 classification is exercised in this mode too.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HASH = '9f8e7d6c5b4a';
// A minimal inline SVG data URI — the same reference class as the product's vite-inlined
// sidekick-mark.svg. Inline data: resources never touch the network.
const INLINE_MARK = 'data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2716%27%3E%3C/svg%3E';

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
<img id="mark" src="${INLINE_MARK}" alt="synthetic inline mark">
<pre id="probe" hidden></pre>
<script src="/assets/app-${HASH}.js" defer></script>
</body>
</html>
`);
  writeFileSync(join(dir, 'assets', `app-${HASH}.js`), `// synthetic same-origin probe app (not the product UI; only exercises the supply chain)
const app = document.getElementById('app');
app.textContent = 'synthetic-root-ready';
// Reference classification mirrors tests/fixtures/web-manual-items/browser-probe.mjs (F-5/F-6):
// inline data: resources and real http(s) network references are verified separately and no
// scheme passes through an opaque (null) origin unexamined.
const classify = (value) => {
  let url;
  try { url = new URL(value, location.href); } catch { return { value, kind: 'unparseable' }; }
  if (url.protocol === 'data:') {
    const comma = value.indexOf(',');
    return { value, kind: 'inline-data', payloadLength: comma < 0 ? 0 : value.length - comma - 1 };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return { value, kind: 'network', origin: url.origin };
  return { value, kind: 'unexpected-scheme', protocol: url.protocol };
};
const refs = [...document.querySelectorAll('script[src],link[href],img[src]')]
  .map((element) => element.getAttribute('src') || element.getAttribute('href'))
  .filter((value) => value && value.length > 0);
const classified = refs.map((value) => classify(value));
const report = {
  mounted: app.textContent === 'synthetic-root-ready',
  origin: location.origin,
  refs,
  classified,
  crossOriginRefs: classified.filter((entry) => entry.kind === 'network' && entry.origin !== location.origin).map((entry) => entry.value),
  inlineDataRefs: classified.filter((entry) => entry.kind === 'inline-data'),
  unexpectedRefs: classified.filter((entry) => entry.kind !== 'network' && entry.kind !== 'inline-data').map((entry) => entry.value),
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
