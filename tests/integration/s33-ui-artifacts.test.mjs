import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const bundles = resolve('src-tauri/target/release/bundle/macos');
const verification = join(bundles, 'Sidekick MCP Verify.app');
const ordinary = join(bundles, 'Sidekick.app');
async function entries(root, prefix = '') {
 const result = [];
 for (const e of await readdir(join(root, prefix), { withFileTypes: true })) {
  const name = join(prefix, e.name); result.push(name);
  if (e.isDirectory()) result.push(...await entries(root, name));
 }
 return result;
}
test('special-then-ordinary bundles keep the controlled service out of ordinary resources', async () => {
 const resources = bundle => join(bundle, 'Contents/Resources');
 assert.deepEqual(await readFile(join(resources(verification), 's33-ui/service.mjs')), await readFile('tests/fixtures/s33-discovery/service.mjs'));
 const names = await entries(resources(ordinary));
 assert.ok(!names.some(n => /s33-ui|s33-discovery|service\.mjs/.test(n)), JSON.stringify(names));
 assert.ok(!(await entries('build/s0-runtime')).some(n => /s33-ui|s33-discovery|service\.mjs/.test(n)));
 for (const bundle of [verification, ordinary]) execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
 console.log(JSON.stringify({ layer: 'actual macOS bundles; no GUI or MCP launch', ordinaryResourceEntries: names.length, controlledServiceExcluded: true, signatures: 'both deep strict verified' }));
});
test('ordinary executable refuses the verification flag before opening any work root', () => {
 const result = spawnSync(join(ordinary, 'Contents/MacOS/sidekick'), ['--s33-mcp-ui'], { env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp' }, encoding: 'utf8', timeout: 10000 });
 assert.equal(result.error, undefined); assert.equal(result.status, 2);
 assert.match(result.stderr, /MCP UI verification is not enabled in this package/);
 console.log(JSON.stringify({ layer: 'ordinary executable negative entry; no ordinary-root startup', exitCode: result.status, stderr: result.stderr.trim() }));
});
