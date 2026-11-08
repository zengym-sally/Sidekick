// MAYNE-23 slice II (revision r2): same-root SIGKILL restart recovery (P2 matrix A-8,
// contract §3 path 7, §11 "重启恢复"). A test-owned child process imports the pinned
// startWebBackend interface and forwards the one-time pairing code over its dedicated IPC
// channel; the child is killed with SIGKILL and a fresh instance opens the same synthetic
// root. Committed items, versions, states and history must reappear byte-for-byte; the root
// lock must be released; the SSE stream must reset on epoch change and clients must
// compensate by read-back. Wire literals follow the 2026-11-08 interface arbitration
// (pairingCode body field, top-level csrfToken, X-CSRF-Token header) pinned in the fixture.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startBackendChild, writeEvidence, effectiveConfig } from '../fixtures/web-manual-items/backend-process.mjs';
import { tableCounts, itemRow, itemEvents } from '../fixtures/web-manual-items/db-observer.mjs';
import { openEventStream } from '../fixtures/web-manual-items/sse-listener.mjs';

const operationId = () => `op_${randomUUID().replaceAll('-', '')}`;

const timePoint = (overrides = {}) => ({
  at: '2026-11-13T10:00:00.000Z',
  timeZone: 'Asia/Shanghai',
  localText: '2026-11-13 18:00',
  precision: 'minute',
  ...overrides,
});

const actionInput = (overrides = {}) => ({
  title: '重启恢复事项',
  kind: 'action',
  owner: '李四',
  priority: 'high',
  due: timePoint(),
  followup: null,
  tags: ['重启'],
  ...overrides,
});

const followupInput = (overrides = {}) => ({
  title: '重启恢复跟进',
  kind: 'followup',
  owner: '王五',
  priority: 'medium',
  due: timePoint(),
  followup: timePoint({ at: '2026-11-20T02:00:00.000Z', localText: '2026-11-20 10:00' }),
  tags: [],
  ...overrides,
});

async function createItem(handle, input) {
  const response = await handle.request('POST', '/api/manual-items', {
    body: { operationId: operationId(), input },
    cookie: handle.cookie,
    csrf: handle.csrf,
  });
  assert.equal(response.status, 200, `create must succeed: ${response.text}`);
  return response.json.item;
}

let root;
let first;
let second;
let firstEpoch;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'web-manual-items-restart-'));
  first = await startBackendChild({ root, initialize: true });
  writeEvidence('restart-effective-config.json', effectiveConfig({ suite: 'web-manual-items-restart' }));
}, { timeout: 60000 });

after(async () => {
  for (const handle of [second, first]) {
    if (handle) await handle.close().catch(() => {});
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

test('A-8: after SIGKILL of the backend, a fresh instance on the same root reopens it and every committed item, version, state and history reappears', async () => {
  assert.ok(!first.stdout().includes(first.pairingCode), 'the pairing code must never reach the child stdout');
  assert.ok(!first.stderr().includes(first.pairingCode), 'the pairing code must never reach the child stderr');

  const action = await createItem(first, actionInput());
  const followup = await createItem(first, followupInput());
  const completed = await first.request('POST', `/api/manual-items/${action.itemId}/complete`, {
    body: { operationId: operationId(), expectedVersion: 1 }, cookie: first.cookie, csrf: first.csrf,
  });
  assert.equal(completed.status, 200, completed.text);
  const updated = await first.request('PUT', `/api/manual-items/${followup.itemId}`, {
    body: { operationId: operationId(), expectedVersion: 1, input: followupInput({ title: '重启恢复跟进 改' }) },
    cookie: first.cookie, csrf: first.csrf,
  });
  assert.equal(updated.status, 200, updated.text);
  const beforeKill = tableCounts(root);
  assert.equal(beforeKill.manualItems, 2);
  assert.equal(beforeKill.manualItemEvents, 4);
  const preKillAction = itemRow(root, action.itemId);
  assert.equal(preKillAction.version, 2);
  assert.equal(preKillAction.status, 'completed');

  const stream = await openEventStream(first.origin, { cookie: first.cookie });
  const ready = await stream.waitFor((frame) => frame.event === 'stream.ready');
  firstEpoch = ready.data.epoch;
  assert.ok(firstEpoch, 'stream.ready must expose the instance epoch');
  stream.close();

  first.killHard();
  await first.waitExit();

  // A fresh instance must be able to open the same root: the root lock has to be released
  // even though the backend died without a graceful close. A bounded retry distinguishes a
  // slow lock release from a leaked lock (a leak never clears).
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      second = await startBackendChild({ root, initialize: false });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (lastError) throw new Error(`the restarted instance could not open the same root (root lock or state): ${lastError.message}`);

  const oldCookieRead = await second.request('GET', '/api/manual-items', { headers: { cookie: first.cookie } });
  assert.equal(oldCookieRead.status, 401, 'the pre-restart session must not survive the restart');

  const list = await second.request('GET', '/api/manual-items', { cookie: second.cookie });
  assert.equal(list.status, 200, list.text);
  const byId = new Map(list.json.items.map((entry) => [entry.itemId, entry]));
  assert.equal(list.json.items.length, 2, 'exactly the committed items must reappear — no loss and no duplication');
  const restoredAction = byId.get(action.itemId);
  const restoredFollowup = byId.get(followup.itemId);
  assert.ok(restoredAction && restoredFollowup, 'both committed items must reappear after the restart');
  assert.equal(restoredAction.status, 'completed', 'the completed state must survive the restart');
  assert.equal(restoredAction.version, 2);
  assert.equal(restoredAction.title, action.title);
  assert.equal(restoredAction.completedAt, action.completedAt, 'the completion timestamp must be preserved');
  assert.equal(restoredFollowup.version, 2);
  assert.equal(restoredFollowup.title, '重启恢复跟进 改');
  assert.equal(restoredFollowup.kind, 'followup');
  assert.equal(restoredFollowup.followup.at, '2026-11-20T02:00:00.000Z');
  assert.equal(restoredFollowup.due.at, '2026-11-13T10:00:00.000Z');

  const detail = await second.request('GET', `/api/manual-items/${action.itemId}`, { cookie: second.cookie });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.item.version, 2);

  const actionHistory = await second.request('GET', `/api/manual-items/${action.itemId}/history`, { cookie: second.cookie });
  assert.deepEqual(actionHistory.json.events.map((event) => event.action), ['complete', 'create'],
    'history must reappear ordered sequence DESC');
  const followupHistory = await second.request('GET', `/api/manual-items/${followup.itemId}/history`, { cookie: second.cookie });
  assert.deepEqual(followupHistory.json.events.map((event) => event.action), ['update', 'create']);

  const afterRestart = tableCounts(root);
  assert.equal(afterRestart.manualItems, 2, 'no duplicated rows after the restart');
  assert.equal(afterRestart.manualItemEvents, 4, 'no duplicated events after the restart');
  assert.equal(itemRow(root, action.itemId).version, 2, 'versions must be continuous across the restart');
  assert.equal(itemRow(root, followup.itemId).version, 2);

  const events = itemEvents(root, action.itemId);
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.after_json), 'event snapshots must survive the restart');

  const reopened = await second.request('POST', `/api/manual-items/${action.itemId}/reopen`, {
    body: { operationId: operationId(), expectedVersion: 2 }, cookie: second.cookie, csrf: second.csrf,
  });
  assert.equal(reopened.status, 200, `the restarted instance must accept new changes: ${reopened.text}`);
  assert.equal(reopened.json.item.version, 3, 'the version counter must continue from the pre-restart value');
  const reopenHistory = await second.request('GET', `/api/manual-items/${action.itemId}/history`, { cookie: second.cookie });
  assert.deepEqual(reopenHistory.json.events.map((event) => event.action), ['reopen', 'complete', 'create']);
  assert.equal(itemRow(root, action.itemId).version, 3);
});

test('A-8/M2: a reconnecting client with the pre-restart epoch receives stream.reset and compensates by read-back', async () => {
  assert.ok(firstEpoch, 'the pre-restart epoch must have been captured');
  const stream = await openEventStream(second.origin, {
    cookie: second.cookie,
    lastEventId: `${firstEpoch}:1`,
  });
  try {
    assert.equal(stream.status, 200, 'SSE must accept the reconnect with a stale token');
    const reset = await stream.waitFor((frame) => frame.event === 'stream.reset');
    assert.equal(reset.id, null, 'stream.reset must not carry an id line');
    assert.ok(reset.data?.epoch, 'stream.reset must carry the current epoch');
    assert.notEqual(reset.data.epoch, firstEpoch, 'the epoch must have changed across the restart');
  } finally {
    stream.close();
  }
  const list = await second.request('GET', '/api/manual-items', { cookie: second.cookie });
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.items.length, 2, 'read-back after reset must return the authoritative list');
  const hintStream = await openEventStream(second.origin, { cookie: second.cookie });
  try {
    await hintStream.waitFor((frame) => frame.event === 'stream.ready');
    const changed = await second.request('POST', `/api/manual-items/${list.json.items[0].itemId}/complete`, {
      body: { operationId: operationId(), expectedVersion: list.json.items[0].version },
      cookie: second.cookie, csrf: second.csrf,
    });
    assert.equal(changed.status, 200, changed.text);
    await hintStream.waitFor((frame) => frame.event === 'item.changed'
      && frame.data?.itemId === list.json.items[0].itemId
      && frame.data?.itemVersion === changed.json.item.version);
  } finally {
    hintStream.close();
  }
  const counts = tableCounts(root);
  assert.equal(counts.agentTasks, 0, 'restart handling must not enqueue agent tasks');
});
