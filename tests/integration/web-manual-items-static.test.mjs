// MAYNE-23 slice II: same-origin static supply and browser cold-start acceptance (contract
// §9.4, §11 "同源静态供给", NIT-3). The backend must serve the UI, the business API and SSE
// from one origin: correct MIME, long cache for hashed assets, no cache for index.html, SPA
// fallback to index.html, and no SPA fallback under /api. A headless Chrome cold start then
// loads the backend-served UI at 1440x1000 and 640x900 and reaches /api and /api/events
// same-origin. When no real frontend dist exists yet (slice I/III not landed) the suite runs
// against a synthetic static root and says so; it never signs the product UI from a
// prototype and never uses synthetic IPC in place of HTTP.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startBackend, repositoryRoot } from '../fixtures/web-manual-items/backend-process.mjs';
import { buildSyntheticStaticRoot } from '../fixtures/web-manual-items/static-root.mjs';

const exec = promisify(execFile);
const chrome = process.env.SIDEKICK_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeAvailable = existsSync(chrome);
const evidence = join(repositoryRoot, 'build/web-manual-items-tests/static-browser');

let backend;
let staticRoot;
let staticRootMode;
let syntheticRoot = null;

before(async () => {
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  if (process.env.WEB_MANUAL_ITEMS_STATIC_ROOT) {
    staticRoot = resolve(process.env.WEB_MANUAL_ITEMS_STATIC_ROOT);
    staticRootMode = 'explicit';
  } else if (existsSync(join(repositoryRoot, 'build/web-backend/static/index.html'))) {
    staticRoot = join(repositoryRoot, 'build/web-backend/static');
    staticRootMode = 'packaged';
  } else {
    syntheticRoot = mkdtempSync(join(tmpdir(), 'web-manual-items-static-'));
    staticRoot = buildSyntheticStaticRoot(syntheticRoot);
    staticRootMode = 'synthetic';
  }
  assert.ok(existsSync(join(staticRoot, 'index.html')), `static root must contain index.html: ${staticRoot}`);
  backend = await startBackend({ staticRoot });
  writeFileSync(join(evidence, 'static-root.json'), JSON.stringify({
    mode: staticRootMode,
    root: staticRootMode === 'synthetic' ? 'synthetic fixture root (real files, not the product UI)' : staticRoot,
    backendOrigin: backend.origin,
  }, null, 2) + '\n', { mode: 0o600 });
}, { timeout: 60000 });

after(async () => {
  await backend?.close();
  if (syntheticRoot) rmSync(syntheticRoot, { recursive: true, force: true });
});

const LONG_CACHE = /(?:max-age\s*=\s*(\d+)|immutable)/i;

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

test('hashed assets are served with correct MIME and long caching', async () => {
  const hashed = staticRootMode === 'synthetic' ? '/assets/app-9f8e7d6c5b4a.js' : findHashedAsset(staticRoot);
  assert.ok(hashed, 'a hashed asset must exist in the static root');
  const response = await backend.request('GET', hashed);
  assert.equal(response.status, 200, response.text.slice(0, 200));
  assert.match(response.headers.get('content-type') ?? '', /javascript/);
  const cacheControl = response.headers.get('cache-control') ?? '';
  const match = cacheControl.match(LONG_CACHE);
  assert.ok(match, `hashed assets must be cacheable: ${cacheControl}`);
  if (match[1]) assert.ok(Number(match[1]) >= 31536000, `hashed assets need a long max-age: ${cacheControl}`);
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
    assert.equal(response.json.contractVersion, 'web-api/1', `${path} error envelope must carry the contract version`);
  }
  const posted = await backend.request('POST', '/api/unknown-route', { body: { hello: 'world' } });
  assert.ok(posted.status >= 400 && posted.status < 500, 'unknown API writes must not fall back either');
  assert.doesNotMatch(posted.headers.get('content-type') ?? '', /text\/html/);
});

for (const width of [1440, 640]) {
  test(`browser cold start at ${width}px loads the same-origin UI, reaches /api and /api/events, and does not overflow`, {
    skip: chromeAvailable ? false : 'Chrome unavailable; browser same-origin acceptance not verified',
    timeout: 60000,
  }, async () => {
    const profile = join(evidence, `chrome-profile-${width}`);
    const url = `${backend.origin}/`;
    const result = await exec(chrome, [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--use-mock-keychain', `--user-data-dir=${profile}`,
      '--dump-dom', '--virtual-time-budget=15000', `--window-size=${width},1000`,
      `--screenshot=${join(evidence, `same-origin-${width}.png`)}`, url,
    ], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(join(evidence, `same-origin-${width}.dom.html`), result.stdout, { mode: 0o600 });
    const dom = result.stdout;
    assert.match(dom, /<div id="app"/, 'the application mount point must be rendered by the backend-served page');
    if (staticRootMode === 'synthetic') {
      const probe = dom.match(/<pre id="probe"[^>]*>(.*?)<\/pre>/s);
      assert.ok(probe, 'the synthetic probe must render into the page');
      const report = JSON.parse(probe[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
      writeFileSync(join(evidence, `same-origin-${width}.json`), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      assert.equal(report.mounted, true, 'the page application must mount');
      assert.equal(report.origin, backend.origin, 'the page must be served from the backend origin');
      assert.deepEqual(report.crossOriginRefs, [], `all static references must be same-origin: ${JSON.stringify(report.crossOriginRefs)}`);
      assert.equal(report.overflow, true, `the page must not overflow horizontally: ${JSON.stringify(report)}`);
      assert.equal(report.session?.status, 401, 'the unpaired page must reach /api/session same-origin and be told to pair');
      assert.equal(report.session?.json?.error?.code, 'unauthenticated', '/api/session must answer with the frozen envelope');
      assert.equal(report.events?.status, 401, 'the page must reach /api/events same-origin');
      assert.equal(report.events?.json?.error?.code, 'unauthenticated', '/api/events must answer with the frozen envelope');
    } else {
      const references = [...dom.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
      const crossOrigin = references.filter((value) => /^https?:\/\//i.test(value) && !value.startsWith(backend.origin));
      assert.deepEqual(crossOrigin, [], `all static references must be same-origin: ${JSON.stringify(crossOrigin)}`);
      writeFileSync(join(evidence, `same-origin-${width}.json`), JSON.stringify({
        mode: staticRootMode, origin: backend.origin, references: references.length, crossOrigin,
      }, null, 2) + '\n', { mode: 0o600 });
    }
  });
}

function findHashedAsset(root) {
  const assets = join(root, 'assets');
  if (!existsSync(assets)) return null;
  for (const name of readdirSync(assets)) {
    if (statSync(join(assets, name)).isFile() && /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(name)) return `/assets/${name}`;
  }
  return null;
}
