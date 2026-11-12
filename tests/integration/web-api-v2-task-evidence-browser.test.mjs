//! MAYNE-38 integration: the web-api/2 exit-evidence faces on the REAL
//! production stack — one headless-Chrome run over the compiled TaskQueue.vue,
//! the real stores/client/pairing transport, driven through controlled
//! HTTP/SSE fixtures generated from the frozen 0c9febc samples (see
//! tests/fixtures/web-api-v2-client/README.md for the provenance split).
//!
//! This is CLIENT-LAYER evidence by construction: the wire side is a scripted
//! transport seam, so nothing here validates the real backend composition.
//! The single case budget is 20 s INCLUDING the driver's Chrome/vite/profile
//! cleanup; the driver exits 0 only when every face holds and its cleanup
//! steps report closed.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, '..', 'fixtures', 'web-api-v2-client', 'evidence-browser.mjs');
const OUT_DIR = process.env.V2_EVIDENCE_OUT ?? join(HERE, '..', '..', 'build', 'mayne38-api2-browser', 'browser-run');

test('web-api/2 exit-evidence browser faces: honest presentation, version rejection, SSE/snapshot discipline, a11y (single 20s budget incl. cleanup)', { timeout: 20000 }, async () => {
  assert.equal(existsSync(DRIVER), true, 'the evidence-browser driver fixture exists');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DRIVER], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the browser driver exceeded the 20s case budget; tail: ${(stdout + stderr).slice(-400)}`));
    }, 19500);
    timer.unref();
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  assert.equal(output.code, 0, `the browser driver must exit 0; stderr tail: ${output.stderr.slice(-300)}`);

  // Every face passed and the cleanup actually reclaimed its resources.
  const summaryPath = join(OUT_DIR, 'v2-evidence-browser-summary.json');
  assert.equal(existsSync(summaryPath), true, 'the driver wrote its TAP summary');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.fail, 0, `no failed faces; ${JSON.stringify(summary.results.filter((row) => !row.ok))}`);
  assert.ok(summary.pass >= 20, `the full face battery ran (pass=${summary.pass})`);
  assert.deepEqual(summary.cleanup, { chromeClosed: true, viteClosed: true, httpClosed: true, profileRemoved: true }, 'the driver reclaimed Chrome/vite/http/profile');

  // The DOM evidence exists for the record: both screenshots captured.
  assert.equal(existsSync(join(OUT_DIR, 'v2-evidence-narrow-640.png')), true, 'the 640px disclosure screenshot exists');
  assert.equal(existsSync(join(OUT_DIR, 'v2-evidence-malformed-rejection.png')), true, 'the malformed-evidence rejection screenshot exists');

  // The forbidden-wording faces are in the TAP explicitly.
  const names = summary.results.map((row) => row.name);
  assert.ok(names.some((name) => name.includes('no tree-extinct claim')), 'the tree-extinct forbidden-wording face ran');
  assert.ok(names.some((name) => name.includes('never renders as 无残余')), 'the found=0 forbidden-wording face ran');
  assert.ok(names.filter((name) => name.includes('exited_unknown shows the slot-held fact')).length === 7, 'all seven frozen unresolved samples were faced');
});
