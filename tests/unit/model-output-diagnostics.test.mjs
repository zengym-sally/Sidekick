import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, writeFile, chmod, symlink, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseModelResult } from '../../runtime/lib/organizer-contract.mjs';

const load = () => import('../../runtime/lib/model-output-diagnostics.mjs');
const request = { kind: 'revise', anchorAtMs: 1793480000000, source: { rawText: '合成原文', timeZone: 'UTC' }, candidate: { draft: { fields: { title: '旧标题', kind: 'action', owner: '我', priority: 'medium', tags: [], due: null, followup: null }, evidence: '合成原文', dueExpression: null, followupExpression: null, warnings: [], unresolved: false } } };
const meta = { runId: 'synthetic-run-1', kind: 'revise', outcome: 'rejected', reason: 'changes-empty' };
const hash = value => createHash('sha256').update(value).digest('hex');

for (const [name, raw, reason] of [
  ['empty changes', '{"changes":{}}', 'changes-empty'],
  ['wrong top level', '{"preview":{}}', 'object-keys'],
  ['non JSON', 'not-json', 'json'],
  ['wrong text type', '{"changes":{"title":17}}', 'text'],
  ['invalid kind', '{"changes":{"kind":"unknown"}}', 'kind']
]) test(`contract rejection keeps its public code and identifies ${name}`, () => {
  assert.throws(() => parseModelResult(raw, request), error => error.message === 'MODEL_INVALID_OUTPUT' && error.reason === reason);
});

test('valid title revision and legal empty extraction preserve their existing results', () => {
  const result = parseModelResult('{"changes":{"title":"新标题"}}', request);
  assert.equal(result.preview.fields.title, '新标题');
  assert.equal(result.preview.evidence, request.candidate.draft.evidence);
  assert.deepEqual(parseModelResult('{"candidates":[]}', { ...request, kind: 'extract' }), { candidates: [] });
});

test('diagnostic projects shape without any string values or unknown key names', async () => {
  const { buildOutputDiagnostic } = await load();
  const secret = 'synthetic-private-canary-96419';
  const raw = JSON.stringify({ changes: { title: secret }, [secret]: { content: secret } });
  const diagnostic = buildOutputDiagnostic(raw, meta);
  const serialized = JSON.stringify(diagnostic);
  assert.ok(!serialized.includes(secret));
  assert.ok(serialized.includes('<redacted>'));
  assert.equal(diagnostic.raw.sha256, hash(raw));
  assert.equal(diagnostic.raw.bytes, Buffer.byteLength(raw));
  assert.equal(diagnostic.raw.shape.type, 'object');
  assert.equal(diagnostic.raw.shape.entryCount, 2);
});

test('canonical projection also removes values and keeps types', async () => {
  const { buildOutputDiagnostic } = await load();
  const secret = 'synthetic-private-canonical-817';
  const diagnostic = buildOutputDiagnostic('{"changes":{"title":"safe"}}', { ...meta, outcome: 'validated', reason: null }, { preview: { fields: { title: secret }, evidence: secret } });
  assert.ok(!JSON.stringify(diagnostic).includes(secret));
  assert.equal(diagnostic.canonicalShape.type, 'object');
});

test('non JSON and oversized raw output get hashes without retaining their text', async () => {
  const { buildOutputDiagnostic } = await load();
  for (const raw of ['private-not-json', 'x'.repeat(262145)]) {
    const diagnostic = buildOutputDiagnostic(raw, { ...meta, reason: raw.length > 262144 ? 'raw-size' : 'json' });
    assert.equal(diagnostic.raw.sha256, hash(raw));
    assert.ok(!JSON.stringify(diagnostic).includes(raw));
    assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 16384);
  }
});

test('shape depth and node budgets remain bounded for large and nested values', async () => {
  const { buildOutputDiagnostic } = await load();
  const nested = { changes: { tags: Array.from({ length: 10000 }, () => ({ unknown: ['secret', { next: 'secret' }] })) } };
  const diagnostic = buildOutputDiagnostic(JSON.stringify(nested), meta);
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 16384);
  assert.ok(JSON.stringify(diagnostic).includes('truncated'));
});

test('unavailable output uses fixed metadata and no raw body', async () => {
  const { buildOutputDiagnostic } = await load();
  const result = buildOutputDiagnostic(null, { ...meta, outcome: 'unavailable', reason: 'model-error' });
  assert.equal(result.raw, null);
  assert.equal(result.canonicalShape, null);
  assert.throws(() => buildOutputDiagnostic('null', { ...meta, reason: 'untrusted-secret' }));
});

async function directory() { return realpath(await mkdtemp(join(await realpath('/tmp'), 'sidekick-output-diagnostic-'))); }

test('diagnostic file is exclusive, private and exactly bounded JSON', async () => {
  const { buildOutputDiagnostic, writeOutputDiagnostic } = await load();
  const base = await directory();
  const value = buildOutputDiagnostic('{"changes":{}}', meta);
  await writeOutputDiagnostic(base, value);
  const path = join(base, 'output-diagnostic.json');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), value);
  const info = await stat(path);
  assert.equal(info.mode & 0o7777, 0o600);
  assert.equal(info.nlink, 1);
  assert.ok(info.size <= 16384);
  await assert.rejects(writeOutputDiagnostic(base, value));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), value);
});

test('public or noncanonical cwd is rejected before creating evidence', async () => {
  const { buildOutputDiagnostic, writeOutputDiagnostic } = await load();
  const base = await directory();
  const value = buildOutputDiagnostic('{}', meta);
  await chmod(base, 0o755);
  await assert.rejects(writeOutputDiagnostic(base, value));
  assert.deepEqual(await readdir(base), []);
  await chmod(base, 0o700);
  await assert.rejects(writeOutputDiagnostic(base + '/.', value));
  assert.deepEqual(await readdir(base), []);
});

test('symlink evidence cannot overwrite another owned synthetic file', async () => {
  const { buildOutputDiagnostic, writeOutputDiagnostic } = await load();
  const base = await directory();
  const target = join(base, 'existing-synthetic.txt');
  await writeFile(target, 'preserved', { mode: 0o600 });
  await symlink(target, join(base, 'output-diagnostic.json'));
  await assert.rejects(writeOutputDiagnostic(base, buildOutputDiagnostic('{}', meta)));
  assert.equal(await readFile(target, 'utf8'), 'preserved');
});

test('caller-supplied extra values and malformed shape cannot become private evidence', async () => {
  const { buildOutputDiagnostic, writeOutputDiagnostic } = await load();
  const base = await directory();
  for (const change of [
    value => { value.extra = 'synthetic-private-canary-441'; },
    value => { value.raw.shape.type = 'synthetic-private-canary-441'; },
    value => { value.raw.sha256 = 'synthetic-private-canary-441'; },
    value => { value.canonicalShape = { type: 'string', bytes: 'synthetic-private-canary-441' }; }
  ]) {
    const value = buildOutputDiagnostic('{}', meta); change(value);
    await assert.rejects(writeOutputDiagnostic(base, value));
    assert.deepEqual(await readdir(base), []);
  }
});

test('building a diagnostic has no filesystem side effect', async () => {
  const { buildOutputDiagnostic } = await load();
  const base = await directory();
  buildOutputDiagnostic('{"changes":{"title":"private synthetic text"}}', { ...meta, outcome: 'validated', reason: null });
  assert.deepEqual(await readdir(base), []);
});
