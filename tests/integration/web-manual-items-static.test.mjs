// MAYNE-23 slice II (revision r2): same-origin static supply and browser cold-start
// acceptance (contract §9.4, §11 "同源静态供给", NIT-3). The backend must serve the UI, the
// business API and SSE from one origin: correct MIME, long cache for hashed assets, no cache
// for index.html, SPA fallback to index.html, and no SPA fallback under /api. A headless
// Chrome cold start then loads the backend-served UI at 1440x1000 and 640x900.
//
// The browser check drives Chrome through the DevTools Protocol and evaluates a probe inside
// the served page itself, so it observes what the browser actually rendered and reached: the
// application must have mounted into #app in the live DOM (an unmounted Vite page leaves #app
// empty, which a static index.html check cannot detect), every static reference must stay
// same-origin, the page must reach /api/session and /api/events same-origin and be answered
// with the frozen 401 envelope (JSON, not HTML), and the page must not overflow horizontally.
// The same assertions run in both static-root modes; the synthetic fixture root only signs
// fixture mechanics and is recorded as such. An explicit static root pointing at the
// repository design/ prototype directory is rejected by the fixture (contract §9.4 forbids
// design previews as acceptance). No synthetic page can pass these assertions as the product.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBackend, repositoryRoot, resolveSuiteStaticRoot, writeEvidence, effectiveConfig } from '../fixtures/web-manual-items/backend-process.mjs';
import { chromeAvailable, probeWithChrome, assertColdStartReport } from '../fixtures/web-manual-items/browser-probe.mjs';
import { buildSyntheticStaticRoot } from '../fixtures/web-manual-items/static-root.mjs';

const evidence = join(repositoryRoot, 'build/web-manual-items-tests/static-browser');

let backend;
let staticRoot;
let staticRootMode;
let syntheticRoot = null;

before(async () => {
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const resolved = resolveSuiteStaticRoot();
  if (resolved.mode === 'synthetic') {
    syntheticRoot = mkdtempSync(join(tmpdir(), 'web-manual-items-static-'));
    staticRoot = buildSyntheticStaticRoot(syntheticRoot);
    staticRootMode = 'synthetic';
  } else {
    staticRoot = resolved.root;
    staticRootMode = resolved.mode;
  }
  assert.ok(existsSync(join(staticRoot, 'index.html')), `static root must contain index.html: ${staticRoot}`);
  backend = await startBackend({ staticRoot });
  writeFileSync(join(evidence, 'static-root.json'), JSON.stringify({
    mode: staticRootMode,
    root: staticRootMode === 'synthetic' ? 'synthetic fixture root (real files, not the product UI)' : staticRoot,
    backendOrigin: backend.origin,
  }, null, 2) + '\n', { mode: 0o600 });
  writeEvidence('static-effective-config.json', effectiveConfig({ suite: 'web-manual-items-static', staticRootMode }));
}, { timeout: 60000 });

after(async () => {
  await backend?.close();
  if (syntheticRoot) rmSync(syntheticRoot, { recursive: true, force: true });
});

const LONG_CACHE = /(?:max-age\s*=\s*(\d+)|immutable)/i;

// MIME expectation per hashed-asset extension. The extension — never the readdir order —
// decides the expected type: a Vite dist emits index-<hash>.css next to index-<hash>.js, and
// the retired check asserted /javascript/ for whichever file it happened to pick first.
const HASHED_MIME = {
  '.js': /javascript/,
  '.mjs': /javascript/,
  '.css': /^text\/css/,
  '.map': /json/,
  '.woff2': /font\/woff2/,
  '.woff': /font\/woff/,
  '.ttf': /font\/ttf/,
  '.otf': /font\/otf/,
  '.svg': /image\/svg\+xml/,
  '.png': /image\/png/,
  '.jpg': /image\/jpeg/,
  '.jpeg': /image\/jpeg/,
  '.gif': /image\/gif/,
  '.ico': /image\/(x-icon|vnd\.microsoft\.icon)/,
  '.webp': /image\/webp/,
  '.avif': /image\/avif/,
};

test('index.html is served same-origin with correct MIME and without long caching', async () => {
  const response = await backend.request('GET', '/');
  assert.equal(response.status, 200, response.text.slice(0, 200));
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  const cacheControl = response.headers.get('cache-control') ?? '';
  assert.doesNotMatch(cacheControl, /immutable/i, 'index.html must not be immutably cached');
  const maxAge = cacheControl.match(/max-age\s*=\s*(\d+)/i);
  assert.ok(!maxAge || Number(maxAge[1]) < 3600, `index.html must not be cached long: ${cacheControl}`);
  assert.match(cacheControl, /no-cache|no-store|must-revalidate|max-age=0/i, `index.html must carry a no-cache directive: ${cacheControl}`);
  assert.match(response.text, /id="app"/, 'the served page must contain the application mount point');
});

test('hashed assets are served with the MIME their extension requires and with long caching', async () => {
  const hashed = staticRootMode === 'synthetic' ? ['/assets/app-9f8e7d6c5b4a.js'] : findHashedAssets(staticRoot);
  assert.ok(hashed.length > 0, 'a hashed asset must exist in the static root');
  for (const path of hashed) {
    const response = await backend.request('GET', path);
    assert.equal(response.status, 200, `${path}: ${response.text.slice(0, 120)}`);
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    const expected = HASHED_MIME[extension];
    assert.ok(expected, `${path}: unclassified hashed asset extension ${extension}; extend the MIME map deliberately`);
    assert.match(response.headers.get('content-type') ?? '', expected, `${path} MIME must match ${expected}`);
    const cacheControl = response.headers.get('cache-control') ?? '';
    const match = cacheControl.match(LONG_CACHE);
    assert.ok(match, `${path} must be cacheable: ${cacheControl}`);
    if (match[1]) assert.ok(Number(match[1]) >= 31536000, `${path} needs a long max-age: ${cacheControl}`);
  }
});

test('static MIME types are correct for every known extension present in the root', async () => {
  const expectations = [
    ['/assets/app-9f8e7d6c5b4a.css', /^text\/css/],
    ['/assets/app-9f8e7d6c5b4a.js', /javascript/],
    ['/favicon.svg', /image\/svg\+xml/],
    ['/data.json', /application\/json/],
    ['/assets/font.woff2', /font\/woff2/],
  ];
  for (const [path, pattern] of expectations) {
    if (!existsSync(join(staticRoot, path))) continue;
    const response = await backend.request('GET', path);
    assert.equal(response.status, 200, `${path}: ${response.text.slice(0, 120)}`);
    assert.match(response.headers.get('content-type') ?? '', pattern, `${path} MIME must match ${pattern}`);
  }
});

test('SPA routes fall back to index.html while /api paths never do', async () => {
  const index = await backend.request('GET', '/');
  const deepRoute = await backend.request('GET', '/workbench/today');
  assert.equal(deepRoute.status, 200, 'a client-side route must fall back to index.html');
  assert.match(deepRoute.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(deepRoute.text, index.text, 'the SPA fallback must serve the same index.html');
  for (const path of ['/api/unknown-route', '/api', '/api/events', '/api/manual-items']) {
    const response = await backend.request('GET', path);
    assert.ok(response.status >= 400 && response.status < 500, `${path} must not fall back to index.html (got ${response.status})`);
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/, `${path} must not return HTML`);
    assert.ok(response.json, `${path} must return a JSON error envelope: ${response.text.slice(0, 200)}`);
    assert.equal(response.json.contractVersion, 'web-api/2', `${path} error envelope must carry the contract version`);
  }
  const posted = await backend.request('POST', '/api/unknown-route', { body: { hello: 'world' } });
  assert.ok(posted.status >= 400 && posted.status < 500, 'unknown API writes must not fall back either');
  assert.doesNotMatch(posted.headers.get('content-type') ?? '', /text\/html/);
});

for (const width of [1440, 640]) {
  test(`browser cold start at ${width}px: the served UI mounts, reaches /api and /api/events same-origin with the frozen 401 envelope, and does not overflow`, {
    skip: chromeAvailable ? false : 'Chrome unavailable; browser same-origin acceptance not verified',
    timeout: 60000,
  }, async () => {
    const { report, dom, screenshot } = await probeWithChrome(`${backend.origin}/`, width, {
      profileDir: join(evidence, `chrome-profile-${width}`),
    });
    writeFileSync(join(evidence, `same-origin-${width}.dom.html`), dom, { mode: 0o600 });
    if (screenshot) writeFileSync(join(evidence, `same-origin-${width}.png`), Buffer.from(screenshot, 'base64'));
    writeFileSync(join(evidence, `same-origin-${width}.json`), JSON.stringify({ mode: staticRootMode, report }, null, 2) + '\n', { mode: 0o600 });

    assert.match(dom, /<div id="app"/, 'the live DOM must contain the application mount point');
    assertColdStartReport(report, { origin: backend.origin, mode: staticRootMode, width });
  });
}

function findHashedAssets(root) {
  const assets = join(root, 'assets');
  if (!existsSync(assets)) return [];
  return readdirSync(assets)
    .filter((name) => statSync(join(assets, name)).isFile() && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name))
    .sort()
    .map((name) => `/assets/${name}`);
}
