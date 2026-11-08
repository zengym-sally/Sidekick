// MAYNE-23 slice II (revision r2): real HTTP acceptance for the web manual-items vertical.
// Assertions come from the frozen contract docs/engineering/web-manual-items-contract.md
// (§4–§7, §11) and the frozen web-api/1 contract (docs/engineering/web-api-contract.md,
// §2/§6/§10); test ids reference the P2 acceptance matrix (A-1..A-9) from
// docs/reviews/web-manual-items-readiness-20261108.md. Business setup goes through real
// HTTP only; database observations are read-only on the same synthetic root.
// Wire literals follow the 2026-11-08 interface arbitration registered in the MAYNE-23 task
// description: pair body field pairingCode, session response top-level csrfToken, write
// header X-CSRF-Token, unknown status or invalid limit rejected 400 validation_failed, list
// limit default 50 with explicit integers 1–200 only. The fixture pins them as constants.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { startBackend, createRawRequester, readSession, pairRequestBody, writeEvidence, effectiveConfig } from '../fixtures/web-manual-items/backend-process.mjs';
import { tableCounts, itemRow, itemEvents, schemaVersion } from '../fixtures/web-manual-items/db-observer.mjs';
import { openEventStream } from '../fixtures/web-manual-items/sse-listener.mjs';

const operationId = () => `op_${randomUUID().replaceAll('-', '')}`;
const ITEM_ID = /^mi_[0-9a-f]{32}$/;

const timePoint = (overrides = {}) => ({
  at: '2026-11-13T10:00:00.000Z',
  timeZone: 'Asia/Shanghai',
  localText: '2026-11-13 18:00',
  precision: 'minute',
  ...overrides,
});

const actionInput = (overrides = {}) => ({
  title: '周五前提交方案并请张三评审',
  kind: 'action',
  owner: '李四',
  priority: 'high',
  due: timePoint(),
  followup: null,
  tags: ['方案', '评审'],
  ...overrides,
});

const followupInput = (overrides = {}) => ({
  title: '跟进供应商报价',
  kind: 'followup',
  owner: '李四',
  priority: 'medium',
  due: timePoint(),
  followup: timePoint({ at: '2026-11-20T02:00:00.000Z', localText: '2026-11-20 10:00' }),
  tags: [],
  ...overrides,
});

function assertEnvelope(response, status, code) {
  assert.equal(response.status, status, `expected HTTP ${status}, got ${response.status}: ${response.text}`);
  assert.ok(response.json, `expected a JSON body, got: ${response.text}`);
  assert.equal(response.json.contractVersion, 'web-api/1', 'error envelope must carry contractVersion web-api/1');
  assert.equal(response.json.status, status, 'envelope status must mirror the HTTP status');
  assert.equal(response.json.error?.code, code, `expected error code ${code}, got ${JSON.stringify(response.json.error)}`);
  assert.equal(typeof response.json.error?.message, 'string', 'error message must be a string');
  assert.ok(response.json.error.message.length > 0, 'error message must not be empty');
}

async function createItem(backend, input, op = operationId()) {
  const response = await backend.request('POST', '/api/manual-items', {
    body: { operationId: op, input },
    cookie: backend.cookie,
    csrf: backend.csrf,
  });
  return { response, operationId: op };
}

let backend;

before(async () => {
  backend = await startBackend();
  writeEvidence('http-effective-config.json', effectiveConfig({ suite: 'web-manual-items-http' }));
}, { timeout: 60000 });

after(async () => {
  await backend?.close();
});

test('A-9/schema: synthetic root initialized to web-backend schema version 2 with the manual-item tables', async () => {
  assert.equal(schemaVersion(backend.root), 2, 'migration 002 must advance schema_meta to 2 inside the same transaction');
  const counts = tableCounts(backend.root);
  assert.equal(counts.manualItems, 0);
  assert.equal(counts.manualItemEvents, 0);
  assert.equal(counts.agentTasks, 0, 'a fresh web-backend root starts with an empty agent task queue');
});

test('A-9: unauthenticated reads and writes are rejected 401 before pairing and persist nothing', async () => {
  const isolated = await startBackend({ pair: false });
  try {
    const read = await isolated.request('GET', '/api/manual-items');
    assertEnvelope(read, 401, 'unauthenticated');
    const write = await isolated.request('POST', '/api/manual-items', {
      body: { operationId: operationId(), input: actionInput() },
    });
    assertEnvelope(write, 401, 'unauthenticated');
    const counts = tableCounts(isolated.root);
    assert.equal(counts.manualItems, 0, 'a rejected write must not reach the database');
    assert.equal(counts.manualItemEvents, 0);
  } finally {
    await isolated.close();
  }
});

test('A-9: wrong pairing code is rejected, the correct code sets a strict single-use session cookie, and logout revokes it', async () => {
  const isolated = await startBackend({ pair: false });
  try {
    const request = createRawRequester(isolated.origin);
    const wrong = await request('POST', '/api/pair', { headers: { 'content-type': 'application/json' }, body: pairRequestBody('WRONG-CODE-0001') });
    assertEnvelope(wrong, 401, 'pair_code_invalid');
    const code = await isolated.receivePairingCode();
    const pairing = await request('POST', '/api/pair', { headers: { 'content-type': 'application/json' }, body: pairRequestBody(code) });
    assert.equal(pairing.status, 200, `pair with the delivered one-time code must succeed: ${pairing.text}`);
    const cookie = pairing.setCookie[0] ?? '';
    assert.match(cookie, /HttpOnly/i, 'session cookie must be HttpOnly');
    assert.match(cookie, /SameSite=Strict/i, 'session cookie must be SameSite=Strict');
    assert.match(cookie, /Path=/i, 'session cookie must be path-scoped');
    assert.doesNotMatch(cookie, /Domain=/i, 'session cookie must not set Domain');
    const sessionCookie = cookie.split(';', 1)[0];
    const replay = await request('POST', '/api/pair', { headers: { 'content-type': 'application/json' }, body: pairRequestBody(code) });
    assertEnvelope(replay, 401, 'pair_code_invalid');
    const session = await readSession(isolated.origin, sessionCookie);
    assert.ok(Array.isArray(session.capabilities), 'GET /api/session must return capabilities');
    for (const capability of ['workspace.manage', 'workspace.backup']) {
      assert.ok(session.capabilities.includes(capability), `local mode must issue ${capability}`);
    }
    const logout = await request('DELETE', '/api/session', { headers: { cookie: sessionCookie } });
    assert.equal(logout.status, 200, `logout must succeed: ${logout.text}`);
    const afterLogout = await request('GET', '/api/manual-items', { headers: { cookie: sessionCookie } });
    assertEnvelope(afterLogout, 401, 'unauthenticated');
  } finally {
    await isolated.close();
  }
});

test('A-9: repeated wrong pairing codes are rejected (401/429) and never create a session', async () => {
  const isolated = await startBackend({ pair: false });
  try {
    const request = createRawRequester(isolated.origin);
    const statuses = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request('POST', '/api/pair', {
        headers: { 'content-type': 'application/json' },
        body: pairRequestBody(`WRONG-CODE-${String(attempt).padStart(4, '0')}`),
      });
      statuses.push(response.status);
      assert.ok(response.status === 401 || response.status === 429,
        `a wrong pairing code must be rejected with 401 pair_code_invalid or 429 pair_rate_limited, got ${response.status}: ${response.text}`);
      if (response.status === 429) assert.equal(response.json?.error?.code, 'pair_rate_limited');
      else assert.equal(response.json?.error?.code, 'pair_code_invalid');
    }
    const read = await request('GET', '/api/manual-items');
    assertEnvelope(read, 401, 'unauthenticated');
    const counts = tableCounts(isolated.root);
    assert.equal(counts.manualItems, 0, 'failed pairing attempts must not create business rows');
  } finally {
    await isolated.close();
  }
});

test('A-9: writes without CSRF, with wrong CSRF, from a foreign Origin or a foreign Host are rejected 403 and leave the database unchanged', async () => {
  const request = createRawRequester(backend.origin);
  const body = { operationId: operationId(), input: actionInput({ title: 'CSRF 控制项' }) };
  const before = tableCounts(backend.root).manualItems;
  const missingCsrf = await backend.request('POST', '/api/manual-items', { body, cookie: backend.cookie });
  assertEnvelope(missingCsrf, 403, 'csrf_invalid');
  const wrongCsrf = await backend.request('POST', '/api/manual-items', { body, cookie: backend.cookie, csrf: 'not-the-issued-token' });
  assertEnvelope(wrongCsrf, 403, 'csrf_invalid');
  const foreignOrigin = await backend.request('POST', '/api/manual-items', {
    body, cookie: backend.cookie, csrf: backend.csrf, headers: { origin: 'https://evil.example' },
  });
  assertEnvelope(foreignOrigin, 403, 'origin_rejected');
  const foreignHost = await request('POST', '/api/manual-items', {
    body, cookie: backend.cookie, csrf: backend.csrf, headers: { host: 'evil.example' },
  });
  assertEnvelope(foreignHost, 403, 'origin_rejected');
  const control = await backend.request('POST', '/api/manual-items', { body, cookie: backend.cookie, csrf: backend.csrf });
  assert.equal(control.status, 200, `the same write with session, CSRF and matching Origin must succeed: ${control.text}`);
  const after = tableCounts(backend.root).manualItems;
  assert.equal(after, before + 1, 'only the fully authorized write may persist');
});

test('A-1: the two item kinds are created with the contract wire format and database rows', async () => {
  const action = await createItem(backend, actionInput());
  assert.equal(action.response.status, 200, action.response.text);
  const item = action.response.json.item;
  assert.ok(item, 'create response must carry {item}');
  assert.equal(item.contractVersion, 'web-api/1');
  assert.match(item.itemId, ITEM_ID);
  assert.equal(item.kind, 'action');
  assert.equal(item.owner, '李四');
  assert.equal(item.priority, 'high');
  assert.equal(item.status, 'open');
  assert.equal(item.source, 'manual');
  assert.equal(item.version, 1);
  assert.equal(item.completedAt, null);
  assert.equal(item.deletedAt, null);
  assert.deepEqual(item.tags, ['方案', '评审']);
  assert.deepEqual(item.due, timePoint());
  assert.equal(item.followup, null);
  assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(item.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const followup = await createItem(backend, followupInput());
  assert.equal(followup.response.status, 200, followup.response.text);
  assert.equal(followup.response.json.item.kind, 'followup');
  assert.equal(followup.response.json.item.due.at, '2026-11-13T10:00:00.000Z');
  assert.equal(followup.response.json.item.followup.at, '2026-11-20T02:00:00.000Z');
  const list = await backend.request('GET', '/api/manual-items', { cookie: backend.cookie });
  assert.equal(list.status, 200, list.text);
  const ids = list.json.items.map((entry) => entry.itemId);
  assert.ok(ids.includes(item.itemId) && ids.includes(followup.response.json.item.itemId), 'both kinds must appear in the default list');
  const row = itemRow(backend.root, item.itemId);
  assert.ok(row, 'the created item must exist as a database row');
  assert.equal(row.kind, 'action');
  assert.equal(row.owner, '李四');
  assert.equal(row.priority, 'high');
  assert.equal(row.status, 'open');
  assert.equal(row.version, 1);
  assert.equal(row.source, 'manual');
  assert.equal(row.due_at_ms, Date.parse('2026-11-13T10:00:00.000Z'));
  assert.equal(row.due_timezone, 'Asia/Shanghai');
  assert.equal(row.due_local, '2026-11-13 18:00');
  assert.equal(row.due_precision, 'minute');
  assert.equal(row.followup_at_ms, null);
  assert.deepEqual(JSON.parse(row.tags_json), ['方案', '评审']);
  const events = itemEvents(backend.root, item.itemId);
  assert.equal(events.length, 1, 'creation must write exactly one event row');
  assert.equal(events[0].action, 'create');
  assert.ok(events[0].before_json === null || events[0].before_json === '', 'create has no before snapshot');
  assert.ok(events[0].after_json, 'create must record an after snapshot');
});

test('A-1/A-2: malformed field input is rejected 400 validation_failed without persisting, tags are normalized on success', async () => {
  const before = tableCounts(backend.root).manualItems;
  const invalid = [
    ['empty title', actionInput({ title: '' })],
    ['whitespace title', actionInput({ title: '   ' })],
    ['501-character title', actionInput({ title: '标'.repeat(501) })],
    ['empty owner', actionInput({ owner: '' })],
    ['201-character owner', actionInput({ owner: '李'.repeat(201) })],
    ['unknown kind', actionInput({ kind: 'someday' })],
    ['unknown priority', actionInput({ priority: 'urgent' })],
    ['21 tags', actionInput({ tags: Array.from({ length: 21 }, (_, index) => `标签${index}`) })],
    ['51-character tag', actionInput({ tags: ['标'.repeat(51)] })],
    ['due without timezone', actionInput({ due: { at: '2026-11-13T10:00:00.000Z', timeZone: '', localText: 'x', precision: 'minute' } })],
    ['due without localText', actionInput({ due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '', precision: 'minute' } })],
    ['due without instant', actionInput({ due: { at: '', timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'minute' } })],
    ['unknown precision', actionInput({ due: timePoint({ precision: 'second' }) })],
    ['non-ISO instant', actionInput({ due: timePoint({ at: '2026-11-13 18:00' }) })],
  ];
  for (const [label, input] of invalid) {
    const response = await createItem(backend, input);
    assertEnvelope(response.response, 400, 'validation_failed');
  }
  assert.equal(tableCounts(backend.root).manualItems, before, 'rejected input must not persist any row');
  const normalized = await createItem(backend, actionInput({ tags: ['方案', '方案', ' 评审 '] }));
  assert.equal(normalized.response.status, 200, normalized.response.text);
  assert.deepEqual(normalized.response.json.item.tags, ['方案', '评审'], 'tags must be deduplicated and trimmed');
  assert.deepEqual(JSON.parse(itemRow(backend.root, normalized.response.json.item.itemId).tags_json), ['方案', '评审']);
});

test('A-2: day precision keeps the original expression, ambiguous local times resolve through the explicit instant, nonexistent local times are rejected', async () => {
  const day = await createItem(backend, actionInput({
    due: { at: '2026-11-13T16:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-14', precision: 'day' },
  }));
  assert.equal(day.response.status, 200, day.response.text);
  const dayItem = day.response.json.item;
  assert.equal(dayItem.due.precision, 'day');
  assert.equal(dayItem.due.localText, '2026-11-14', 'the original expression must be preserved verbatim');
  assert.equal(dayItem.due.at, '2026-11-13T16:00:00.000Z');
  const row = itemRow(backend.root, dayItem.itemId);
  assert.equal(row.due_precision, 'day');
  assert.equal(row.due_local, '2026-11-14');
  const ambiguous = await createItem(backend, actionInput({
    due: { at: '2026-11-01T05:30:00.000Z', timeZone: 'America/New_York', localText: '2026-11-01 01:30', precision: 'minute' },
  }));
  assert.equal(ambiguous.response.status, 200, `an ambiguous local time with an explicit instant must be accepted: ${ambiguous.response.text}`);
  assert.equal(ambiguous.response.json.item.due.at, '2026-11-01T05:30:00.000Z');
  assert.equal(ambiguous.response.json.item.due.timeZone, 'America/New_York', 'the stored timezone must not drift to the browser locale');
  const nonexistent = await createItem(backend, actionInput({
    due: { at: '2026-03-08T07:30:00.000Z', timeZone: 'America/New_York', localText: '2026-03-08 02:30', precision: 'minute' },
  }));
  assertEnvelope(nonexistent.response, 400, 'validation_failed');
  const followupOnAction = await createItem(backend, actionInput({
    followup: timePoint({ at: '2026-11-20T02:00:00.000Z', localText: '2026-11-20 10:00' }),
  }));
  assert.equal(followupOnAction.response.status, 200, `a followup point on an action item is accepted per contract m2: ${followupOnAction.response.text}`);
  assert.equal(followupOnAction.response.json.item.kind, 'action');
  assert.equal(followupOnAction.response.json.item.due.at, '2026-11-13T10:00:00.000Z');
});

test('A-3/M1: list order, detail readback and cursor pagination are stable; new items appear only on a re-read first page', async () => {
  const isolated = await startBackend();
  try {
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      const item = await createItem(isolated, actionInput({ title: `分页事项 ${index}` }));
      assert.equal(item.response.status, 200, item.response.text);
      created.push(item.response.json.item);
    }
    const list = await isolated.request('GET', '/api/manual-items', { cookie: isolated.cookie });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.items.length, 5);
    const expectedOrder = [...created].sort((left, right) =>
      (right.createdAt < left.createdAt ? -1 : right.createdAt > left.createdAt ? 1 : 0)
      || (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
    assert.deepEqual(list.json.items.map((entry) => entry.itemId), expectedOrder.map((entry) => entry.itemId),
      'list order must be created_at DESC, item_id ASC');
    assert.equal(list.json.nextCursor, null, 'nextCursor must be empty when there is no more');
    for (const item of created) {
      const detail = await isolated.request('GET', `/api/manual-items/${item.itemId}`, { cookie: isolated.cookie });
      assert.equal(detail.status, 200, detail.text);
      assert.equal(detail.json.item.version, item.version, 'detail must return the same version as the list row');
      assert.equal(detail.json.item.title, item.title);
      assert.equal(detail.json.item.status, item.status);
    }
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const query = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const response = await isolated.request('GET', `/api/manual-items${query}`, { cookie: isolated.cookie });
      assert.equal(response.status, 200, response.text);
      assert.ok(response.json.items.length <= 2, 'limit must be honored');
      seen.push(...response.json.items.map((entry) => entry.itemId));
      cursor = response.json.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual([...seen].sort(), expectedOrder.map((entry) => entry.itemId).sort(),
      'pagination must return every item exactly once');
    const fresh = await createItem(isolated, actionInput({ title: '分页事项 新' }));
    const firstPage = await isolated.request('GET', '/api/manual-items?limit=2', { cookie: isolated.cookie });
    assert.ok(firstPage.json.items.some((entry) => entry.itemId === fresh.response.json.item.itemId),
      'a new item must appear on the re-read first page (MINOR-1)');
    const secondPage = await isolated.request('GET', `/api/manual-items?limit=2&cursor=${encodeURIComponent(firstPage.json.nextCursor)}`, { cookie: isolated.cookie });
    assert.ok(!secondPage.json.items.some((entry) => entry.itemId === fresh.response.json.item.itemId),
      'an in-progress pagination page must not be disrupted by the new item');
    const tooLarge = await isolated.request('GET', '/api/manual-items?limit=201', { cookie: isolated.cookie });
    assertEnvelope(tooLarge, 400, 'validation_failed');
    const unknownFilter = await isolated.request('GET', '/api/manual-items?status=weird', { cookie: isolated.cookie });
    assertEnvelope(unknownFilter, 400, 'validation_failed');
  } finally {
    await isolated.close();
  }
});

test('A-3: the list limit defaults to 50, accepts only integers 1–200, and rejects everything else 400 validation_failed', async () => {
  const isolated = await startBackend();
  try {
    const created = [];
    for (let index = 0; index < 51; index += 1) {
      const item = await createItem(isolated, actionInput({ title: `分页边界 ${index}` }));
      assert.equal(item.response.status, 200, item.response.text);
      created.push(item.response.json.item);
    }
    const defaultList = await isolated.request('GET', '/api/manual-items', { cookie: isolated.cookie });
    assert.equal(defaultList.status, 200, defaultList.text);
    assert.equal(defaultList.json.items.length, 50, 'the default page size must be 50');
    assert.ok(defaultList.json.nextCursor, 'a full default first page must expose nextCursor');
    const rest = await isolated.request('GET', `/api/manual-items?cursor=${encodeURIComponent(defaultList.json.nextCursor)}`, { cookie: isolated.cookie });
    assert.equal(rest.status, 200, rest.text);
    assert.equal(rest.json.items.length, 1, 'the remaining item must arrive on the cursor page');
    assert.equal(rest.json.nextCursor, null, 'the last page must not expose a cursor');
    for (const limit of [1, 50, 200]) {
      const response = await isolated.request('GET', `/api/manual-items?limit=${limit}`, { cookie: isolated.cookie });
      assert.equal(response.status, 200, `limit=${limit} must be accepted: ${response.text}`);
      assert.ok(response.json.items.length <= limit, `limit=${limit} must be honored`);
    }
    for (const limit of [201, 0, -1, 1.5, 'abc']) {
      const response = await isolated.request('GET', `/api/manual-items?limit=${encodeURIComponent(limit)}`, { cookie: isolated.cookie });
      assertEnvelope(response, 400, 'validation_failed');
    }
    const historyOk = await isolated.request('GET', `/api/manual-items/${created[0].itemId}/history?limit=1`, { cookie: isolated.cookie });
    assert.equal(historyOk.status, 200, `history limit=1 must be accepted: ${historyOk.text}`);
    const historyBad = await isolated.request('GET', `/api/manual-items/${created[0].itemId}/history?limit=0`, { cookie: isolated.cookie });
    assertEnvelope(historyBad, 400, 'validation_failed');
    const unknownStatus = await isolated.request('GET', '/api/manual-items?status=someday', { cookie: isolated.cookie });
    assertEnvelope(unknownStatus, 400, 'validation_failed');
  } finally {
    await isolated.close();
  }
});

test('A-4: a stale expectedVersion is rejected 409 version_conflict without a lost update; re-read then re-decide succeeds', async () => {
  const created = await createItem(backend, actionInput({ title: '版本冲突事项' }));
  assert.equal(created.response.status, 200, created.response.text);
  const itemId = created.response.json.item.itemId;
  const winner = await backend.request('PUT', `/api/manual-items/${itemId}`, {
    body: { operationId: operationId(), expectedVersion: 1, input: actionInput({ title: '客户端 A 的标题' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(winner.status, 200, winner.text);
  assert.equal(winner.json.item.version, 2);
  const loser = await backend.request('PUT', `/api/manual-items/${itemId}`, {
    body: { operationId: operationId(), expectedVersion: 1, input: actionInput({ title: '客户端 B 的过期标题' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(loser, 409, 'version_conflict');
  const row = itemRow(backend.root, itemId);
  assert.equal(row.version, 2, 'a rejected stale write must not consume the version');
  assert.equal(row.title, '客户端 A 的标题', 'the winner value must survive');
  const reread = await backend.request('GET', `/api/manual-items/${itemId}`, { cookie: backend.cookie });
  assert.equal(reread.json.item.version, 2);
  const retry = await backend.request('PUT', `/api/manual-items/${itemId}`, {
    body: { operationId: operationId(), expectedVersion: 2, input: actionInput({ title: '客户端 B 重读后提交' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(retry.status, 200, retry.text);
  assert.equal(retry.json.item.version, 3);
  const staleComplete = await backend.request('POST', `/api/manual-items/${itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: 2 },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(staleComplete, 409, 'version_conflict');
  const unknownItem = await backend.request('PUT', '/api/manual-items/mi_00000000000000000000000000000000', {
    body: { operationId: operationId(), expectedVersion: 1, input: actionInput() },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(unknownItem, 404, 'item_not_found');
});

test('A-6: the same operationId replays the current authoritative state, a different input conflicts, and replay precedes state guards', async () => {
  // The shared file-level backend root already carries events from earlier tests, so the
  // global count is captured before this test's writes and the delta is asserted. Comparing
  // the global count with this item's own count could never hold (F-1 revision).
  const eventsBefore = tableCounts(backend.root).manualItemEvents;
  const op = operationId();
  const created = await createItem(backend, actionInput({ title: '幂等事项' }), op);
  assert.equal(created.response.status, 200, created.response.text);
  const itemId = created.response.json.item.itemId;
  const replay = await backend.request('POST', '/api/manual-items', {
    body: { operationId: op, input: actionInput({ title: '幂等事项' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.replayed, true, 'a replayed submit must report replayed:true');
  assert.equal(replay.json.item.itemId, itemId, 'a replay must not create a second item');
  const updated = await backend.request('PUT', `/api/manual-items/${itemId}`, {
    body: { operationId: operationId(), expectedVersion: 1, input: actionInput({ title: '幂等事项 改' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(updated.status, 200, updated.text);
  const replayAfterUpdate = await backend.request('POST', '/api/manual-items', {
    body: { operationId: op, input: actionInput({ title: '幂等事项' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replayAfterUpdate.status, 200, replayAfterUpdate.text);
  assert.equal(replayAfterUpdate.json.replayed, true);
  assert.equal(replayAfterUpdate.json.item.version, 2, 'a replay must return the current authoritative state');
  const conflict = await backend.request('POST', '/api/manual-items', {
    body: { operationId: op, input: actionInput({ title: '同一个 operationId 不同输入' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(conflict, 409, 'idempotency_conflict');
  const deleted = await backend.request('DELETE', `/api/manual-items/${itemId}`, {
    body: { operationId: operationId(), expectedVersion: 2 },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(deleted.status, 200, deleted.text);
  const replayAfterDelete = await backend.request('POST', '/api/manual-items', {
    body: { operationId: op, input: actionInput({ title: '幂等事项' }) },
    cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(replayAfterDelete.status, 200, replayAfterDelete.text);
  assert.equal(replayAfterDelete.json.replayed, true, 'replay must precede the state guard (contract M1)');
  assert.equal(replayAfterDelete.json.item.status, 'deleted', 'the replay must report the current deleted state');
  const counts = tableCounts(backend.root);
  const rows = itemRow(backend.root, itemId);
  assert.ok(rows, 'exactly one database row may exist for the item');
  assert.equal(counts.manualItemEvents, eventsBefore + 3,
    'the create/update/delete writes must be the only new event rows; replays and conflicts must not write events');
  const events = itemEvents(backend.root, itemId).map((event) => event.action);
  assert.deepEqual(events, ['create', 'update', 'delete'], 'replays must not write extra event rows');
});

test('A-5: complete, reopen and soft delete follow the state table, keep history readable, and refuse further changes', async () => {
  const created = await createItem(backend, actionInput({ title: '生命周期事项' }));
  const itemId = created.response.json.item.itemId;
  const complete = await backend.request('POST', `/api/manual-items/${itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: 1 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(complete.status, 200, complete.text);
  assert.equal(complete.json.item.status, 'completed');
  assert.equal(complete.json.item.version, 2);
  assert.ok(complete.json.item.completedAt, 'completion must record completedAt');
  const completeAgain = await backend.request('POST', `/api/manual-items/${itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: 2 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(completeAgain, 409, 'state_conflict');
  const reopen = await backend.request('POST', `/api/manual-items/${itemId}/reopen`, {
    body: { operationId: operationId(), expectedVersion: 2 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(reopen.status, 200, reopen.text);
  assert.equal(reopen.json.item.status, 'open');
  assert.equal(reopen.json.item.version, 3);
  assert.equal(reopen.json.item.completedAt, null, 'reopen must clear completedAt');
  const reopenAgain = await backend.request('POST', `/api/manual-items/${itemId}/reopen`, {
    body: { operationId: operationId(), expectedVersion: 3 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assertEnvelope(reopenAgain, 409, 'state_conflict');
  const remove = await backend.request('DELETE', `/api/manual-items/${itemId}`, {
    body: { operationId: operationId(), expectedVersion: 3 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(remove.status, 200, remove.text);
  assert.equal(remove.json.item.status, 'deleted');
  assert.equal(remove.json.item.version, 4);
  assert.ok(remove.json.item.deletedAt, 'soft delete must record deletedAt');
  const detail = await backend.request('GET', `/api/manual-items/${itemId}`, { cookie: backend.cookie });
  assert.equal(detail.status, 200, 'a deleted item stays readable by id');
  assert.equal(detail.json.item.status, 'deleted');
  for (const [method, path, body] of [
    ['PUT', `/api/manual-items/${itemId}`, { operationId: operationId(), expectedVersion: 4, input: actionInput() }],
    ['POST', `/api/manual-items/${itemId}/complete`, { operationId: operationId(), expectedVersion: 4 }],
    ['POST', `/api/manual-items/${itemId}/reopen`, { operationId: operationId(), expectedVersion: 4 }],
    ['DELETE', `/api/manual-items/${itemId}`, { operationId: operationId(), expectedVersion: 4 }],
  ]) {
    const response = await backend.request(method, path, { body, cookie: backend.cookie, csrf: backend.csrf });
    assertEnvelope(response, 409, 'state_conflict');
  }
  const defaultList = await backend.request('GET', '/api/manual-items', { cookie: backend.cookie });
  assert.ok(!defaultList.json.items.some((entry) => entry.itemId === itemId), 'the default list must exclude deleted items');
  const deletedList = await backend.request('GET', '/api/manual-items?status=deleted', { cookie: backend.cookie });
  assert.ok(deletedList.json.items.some((entry) => entry.itemId === itemId), 'status=deleted must expose deleted items');
  const allList = await backend.request('GET', '/api/manual-items?status=all', { cookie: backend.cookie });
  assert.ok(allList.json.items.some((entry) => entry.itemId === itemId), 'status=all must include deleted items');
  const openList = await backend.request('GET', '/api/manual-items?status=open', { cookie: backend.cookie });
  assert.ok(!openList.json.items.some((entry) => entry.itemId === itemId), 'status=open must exclude the deleted item');
  const history = await backend.request('GET', `/api/manual-items/${itemId}/history`, { cookie: backend.cookie });
  assert.equal(history.status, 200, history.text);
  assert.deepEqual(history.json.events.map((event) => event.action), ['delete', 'reopen', 'complete', 'create'],
    'history must be ordered sequence DESC');
  for (const event of history.json.events) assert.ok(event.after, 'each event must carry an after snapshot');
  const row = itemRow(backend.root, itemId);
  assert.equal(row.version, 4);
  assert.equal(row.status, 'deleted');
  assert.ok(row.deleted_at_ms, 'deleted_at_ms must be set');
  assert.equal(row.completed_at_ms, null, 'reopen must have cleared completed_at_ms in the database');
  const dbEvents = itemEvents(backend.root, itemId).map((event) => event.action);
  assert.deepEqual(dbEvents, ['create', 'complete', 'reopen', 'delete'], 'database events must match the actions');
  const deleteFromCompleted = await createItem(backend, actionInput({ title: '完成后删除事项' }));
  const completed = await backend.request('POST', `/api/manual-items/${deleteFromCompleted.response.json.item.itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: 1 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(completed.status, 200, completed.text);
  const removed = await backend.request('DELETE', `/api/manual-items/${deleteFromCompleted.response.json.item.itemId}`, {
    body: { operationId: operationId(), expectedVersion: 2 }, cookie: backend.cookie, csrf: backend.csrf,
  });
  assert.equal(removed.status, 200, 'delete from completed must be allowed by the state table');
});

test('A-5/n1: history paginates by sequence DESC with a stable cursor', async () => {
  const created = await createItem(backend, actionInput({ title: '历史分页事项' }));
  const itemId = created.response.json.item.itemId;
  for (const step of [
    ['PUT', `/api/manual-items/${itemId}`, { operationId: operationId(), expectedVersion: 1, input: actionInput({ title: '历史分页事项 改' }) }],
    ['POST', `/api/manual-items/${itemId}/complete`, { operationId: operationId(), expectedVersion: 2 }],
    ['POST', `/api/manual-items/${itemId}/reopen`, { operationId: operationId(), expectedVersion: 3 }],
    ['DELETE', `/api/manual-items/${itemId}`, { operationId: operationId(), expectedVersion: 4 }],
  ]) {
    const response = await backend.request(step[0], step[1], { body: step[2], cookie: backend.cookie, csrf: backend.csrf });
    assert.equal(response.status, 200, `${step[0]} ${step[1]}: ${response.text}`);
  }
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const query = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
    const response = await backend.request('GET', `/api/manual-items/${itemId}/history${query}`, { cookie: backend.cookie });
    assert.equal(response.status, 200, response.text);
    seen.push(...response.json.events.map((event) => event.action));
    cursor = response.json.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, ['delete', 'reopen', 'complete', 'update', 'create'], 'history pages must cover every action in sequence DESC order');
  const tooLarge = await backend.request('GET', `/api/manual-items/${itemId}/history?limit=201`, { cookie: backend.cookie });
  assertEnvelope(tooLarge, 400, 'validation_failed');
  const unknown = await backend.request('GET', '/api/manual-items/mi_00000000000000000000000000000000/history', { cookie: backend.cookie });
  assertEnvelope(unknown, 404, 'item_not_found');
});

test('A-6: a lost response is recovered by item id readback', async () => {
  const created = await createItem(backend, actionInput({ title: '响应丢失读回' }));
  const itemId = created.response.json.item.itemId;
  const readback = await backend.request('GET', `/api/manual-items/${itemId}`, { cookie: backend.cookie });
  assert.equal(readback.status, 200, readback.text);
  assert.equal(readback.json.item.itemId, itemId);
  assert.equal(readback.json.item.title, '响应丢失读回');
  assert.equal(readback.json.item.version, 1);
});

test('M2: item.changed hints arrive on the session stream without task cursor ids; read-back remains the source of truth', async () => {
  const stream = await openEventStream(backend.origin, { cookie: backend.cookie });
  let itemId = null;
  try {
    assert.equal(stream.status, 200, 'SSE subscription must succeed for a paired session');
    assert.match(stream.contentType, /text\/event-stream/);
    const ready = await stream.waitFor((frame) => frame.event === 'stream.ready');
    assert.equal(ready.id, null, 'stream.ready must not carry an id line');
    assert.equal(ready.data.contractVersion, 'web-api/1');
    const created = await createItem(backend, actionInput({ title: 'SSE 提示事项' }));
    itemId = created.response.json.item.itemId;
    const hint = await stream.waitFor((frame) => frame.event === 'item.changed' && frame.data?.itemId === itemId);
    assert.equal(hint.id, null, 'item.changed hints must not carry an id line and must not advance the task cursor');
    assert.equal(hint.data.objectType, 'item');
    assert.equal(hint.data.itemVersion, 1);
    assert.equal(hint.data.contractVersion, 'web-api/1');
    assert.ok(hint.data.at, 'the hint must carry a timestamp');
    const updated = await backend.request('PUT', `/api/manual-items/${itemId}`, {
      body: { operationId: operationId(), expectedVersion: 1, input: actionInput({ title: 'SSE 提示事项 改' }) },
      cookie: backend.cookie, csrf: backend.csrf,
    });
    assert.equal(updated.status, 200, updated.text);
    await stream.waitFor((frame) => frame.event === 'item.changed' && frame.data?.itemVersion === 2 && frame.data?.itemId === itemId);
  } finally {
    stream.close();
  }
  const reconnect = await openEventStream(backend.origin, { cookie: backend.cookie });
  try {
    const ready = await reconnect.waitFor((frame) => frame.event === 'stream.ready');
    assert.equal(ready.id, null, 'every subscription, including a reconnect, must start with stream.ready');
  } finally {
    reconnect.close();
  }
  const readback = await backend.request('GET', `/api/manual-items/${itemId}`, { cookie: backend.cookie });
  assert.equal(readback.json.item.version, 2, 'read-back is the source of truth after hint delivery');
  const counts = tableCounts(backend.root);
  assert.equal(counts.taskEvents, 0, 'item hints must not write task_events rows');
  assert.equal(counts.agentTasks, 0, 'item hints must not enter the agent task queue');
});

test('A-7: manual items never enter the agent task queue', async () => {
  const counts = tableCounts(backend.root);
  assert.equal(counts.agentTasks, 0, 'manual items must not be enqueued as agent tasks');
  assert.equal(counts.taskEvents, 0, 'manual item changes must not write task events');
  assert.ok(counts.manualItems > 0, 'the suite exercised real manual item writes');
});

test('envelope hygiene: error bodies carry only the frozen envelope', async () => {
  const created = await createItem(backend, actionInput({ title: '信封卫生事项' }));
  const itemId = created.response.json.item.itemId;
  const cases = [
    [await backend.request('GET', '/api/manual-items/mi_00000000000000000000000000000000', { cookie: backend.cookie }), 404, 'item_not_found'],
    [await backend.request('POST', '/api/manual-items', { body: { operationId: operationId(), input: actionInput({ title: '' }) }, cookie: backend.cookie, csrf: backend.csrf }), 400, 'validation_failed'],
    [await backend.request('POST', `/api/manual-items/${itemId}/complete`, { body: { operationId: operationId(), expectedVersion: 99 }, cookie: backend.cookie, csrf: backend.csrf }), 409, 'version_conflict'],
    [await backend.request('POST', `/api/manual-items/${itemId}/complete`, { body: { operationId: operationId(), expectedVersion: 1 }, cookie: backend.cookie }), 403, 'csrf_invalid'],
  ];
  for (const [response, status, code] of cases) {
    assertEnvelope(response, status, code);
    const serialized = JSON.stringify(response.json);
    for (const leak of ['stack', 'sqlite', 'SELECT ', '/Users/', '.rs', 'node_modules']) {
      assert.ok(!serialized.includes(leak), `error envelope must not leak ${leak}: ${serialized}`);
    }
  }
});
