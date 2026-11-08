//! Service-layer logic for the W1 manual-item vertical: validation, version
//! conflicts, idempotency replay, time semantics, soft delete and history.
//!
//! The storage seam is an in-memory SQLite database loaded with the frozen 002
//! DDL, so the service's real SQL runs unmodified.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ManualItemsService, ServiceError, canonicalize } from '../../server/lib/manual-items-service.mjs';
import { parseArgs } from '../../server/entries/web-backend-entry.mjs';
import { fromWireItem, toDomainPoint, toWireInput, toWirePoint } from '../../src/lib/web-api-client.ts';
import { SseHub } from '../../server/lib/sse-hub.mjs';
import { createPairing } from '../../src/stores/pairing.ts';

class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function memoryStorage() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL);');
  db.exec("INSERT INTO schema_meta (id, schema_version) VALUES (1, 1);");
  const ddl = readFileSync(new URL('../../src-tauri/migrations/web-backend/002_manual_items.sql', import.meta.url), 'utf8');
  db.exec(ddl);
  return {
    db,
    async command(command, params) {
      if (command === 'query') {
        const rows = db.prepare(params.sql).all(...params.params);
        return { rows: rows.map((row) => Object.values(row)) };
      }
      if (command === 'transact') {
        const results = [];
        db.exec('BEGIN');
        try {
          for (const op of params.ops) {
            const info = db.prepare(op.sql).run(...op.params);
            results.push({ rows: [], changes: Number(info.changes) });
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw new StorageError('WEB_BACKEND_SQL_ERROR', error.message);
        }
        return { results };
      }
      throw new StorageError('UNSUPPORTED', `unsupported command ${command}`);
    },
  };
}

function makeService() {
  const storage = memoryStorage();
  let clock = 1000;
  const service = new ManualItemsService(storage, { now: () => clock });
  const tick = () => {
    clock += 1;
    return clock;
  };
  return { storage, service, tick };
}

const SAMPLE = {
  title: '周五前提交方案',
  kind: 'action',
  owner: '李四',
  priority: 'high',
  due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'minute' },
  followup: null,
  tags: ['方案', '评审'],
};

async function createSample(service, overrides = {}) {
  return service.createItem(`op_${Math.random().toString(36).slice(2)}`, { ...SAMPLE, ...overrides });
}

test('create returns the wire shape and records history', async () => {
  const { service } = makeService();
  const { item, replayed } = await service.createItem('op_1', SAMPLE);
  assert.equal(replayed, false);
  assert.equal(item.contractVersion, 'web-api/1');
  assert.match(item.itemId, /^mi_[0-9a-f]{32}$/);
  assert.equal(item.status, 'open');
  assert.equal(item.version, 1);
  assert.equal(item.due.at, SAMPLE.due.at);
  assert.equal(item.due.precision, 'minute');
  assert.deepEqual(item.tags, ['方案', '评审']);
  const history = await service.history(item.itemId);
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].action, 'create');
  assert.equal(history.events[0].before, null);
  assert.equal(history.events[0].after.itemId, item.itemId);
});

test('validation rejects malformed input', async () => {
  const { service } = makeService();
  const cases = [
    [{ ...SAMPLE, title: '   ' }, '标题不能为空'],
    [{ ...SAMPLE, title: 'x'.repeat(501) }, '标题最多 500 字'],
    [{ ...SAMPLE, kind: 'other' }, '事项类型无效'],
    [{ ...SAMPLE, owner: '' }, '负责人不能为空'],
    [{ ...SAMPLE, priority: 'urgent' }, '优先级无效'],
    [{ ...SAMPLE, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, '标签最多 20 个'],
    [{ ...SAMPLE, tags: ['x'.repeat(51)] }, '标签最多 50 字'],
    [{ ...SAMPLE, due: { at: 'nope', timeZone: 'Asia/Shanghai', localText: 'x', precision: 'minute' } }, 'ISO 8601'],
    [{ ...SAMPLE, due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Nowhere/Nope', localText: 'x', precision: 'minute' } }, '时区无效'],
    [{ ...SAMPLE, due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: 'x', precision: 'hour' } }, '精度无效'],
  ];
  for (const [input, message] of cases) {
    await assert.rejects(() => service.createItem(`op_${Math.random()}`, input), (error) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'validation_failed');
      assert.match(error.message, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    });
  }
});

test('idempotency replays the same request and conflicts on a different one', async () => {
  const { service } = makeService();
  const first = await service.createItem('op_same', SAMPLE);
  const replay = await service.createItem('op_same', SAMPLE);
  assert.equal(replay.replayed, true);
  assert.equal(replay.item.itemId, first.item.itemId);
  assert.equal(replay.item.version, 1);

  // Key order does not change the canonical request.
  const reordered = { followup: null, tags: ['方案', '评审'], due: SAMPLE.due, priority: 'high', owner: '李四', kind: 'action', title: '周五前提交方案' };
  const replay2 = await service.createItem('op_same', reordered);
  assert.equal(replay2.item.itemId, first.item.itemId);

  await assert.rejects(() => service.createItem('op_same', { ...SAMPLE, title: '另一件事' }), (error) => {
    assert.equal(error.code, 'idempotency_conflict');
    return true;
  });
  const list = await service.listItems({ status: 'all' });
  assert.equal(list.items.length, 1);
});

test('version conflict rejects a stale expectedVersion', async () => {
  const { service } = makeService();
  const { item } = await createSample(service);
  const updated = await service.updateItem(item.itemId, 'op_update', 1, { ...SAMPLE, title: '改后' });
  assert.equal(updated.item.version, 2);
  await assert.rejects(() => service.updateItem(item.itemId, 'op_stale', 1, { ...SAMPLE, title: '旧版本' }), (error) => {
    assert.equal(error.code, 'version_conflict');
    return true;
  });
  const current = await service.getItem(item.itemId);
  assert.equal(current.title, '改后');
});

test('complete and reopen move state, time and history together', async () => {
  const { service, tick } = makeService();
  const { item } = await createSample(service);
  const completed = await service.completeItem(item.itemId, 'op_complete', 1);
  assert.equal(completed.item.status, 'completed');
  assert.equal(completed.item.version, 2);
  assert.ok(completed.item.completedAt);
  await assert.rejects(() => service.completeItem(item.itemId, 'op_again', 2), (error) => {
    assert.equal(error.code, 'state_conflict');
    return true;
  });
  tick();
  const reopened = await service.reopenItem(item.itemId, 'op_reopen', 2);
  assert.equal(reopened.item.status, 'open');
  assert.equal(reopened.item.completedAt, null);
  assert.equal(reopened.item.version, 3);
  const history = await service.history(item.itemId);
  assert.deepEqual(history.events.map((event) => event.action), ['reopen', 'complete', 'create']);
  assert.equal(history.events[1].before.status, 'open');
  assert.equal(history.events[1].after.status, 'completed');
});

test('delete is a soft delete: hidden by default, readable in detail and history', async () => {
  const { service } = makeService();
  const { item } = await createSample(service);
  const deleted = await service.deleteItem(item.itemId, 'op_delete', 1);
  assert.equal(deleted.item.status, 'deleted');
  assert.ok(deleted.item.deletedAt);
  const list = await service.listItems();
  assert.equal(list.items.length, 0);
  const audit = await service.listItems({ status: 'deleted' });
  assert.equal(audit.items.length, 1);
  const detail = await service.getItem(item.itemId);
  assert.equal(detail.status, 'deleted');
  const history = await service.history(item.itemId);
  assert.equal(history.events.length, 2);
  await assert.rejects(() => service.updateItem(item.itemId, 'op_after', 2, SAMPLE), (error) => {
    assert.equal(error.code, 'state_conflict');
    return true;
  });
  await assert.rejects(() => service.deleteItem(item.itemId, 'op_again', 2), (error) => {
    assert.equal(error.code, 'state_conflict');
    return true;
  });
});

test('due and followup stay independent and precision is preserved', async () => {
  const { service } = makeService();
  const { item } = await service.createItem('op_time', {
    title: '跟进',
    kind: 'followup',
    owner: '王五',
    priority: 'low',
    due: { at: '2026-11-20T02:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-20 10:00', precision: 'minute' },
    followup: { at: '2026-11-10T02:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-10 10:00', precision: 'day' },
    tags: [],
  });
  assert.equal(item.due.precision, 'minute');
  assert.equal(item.followup.precision, 'day');
  assert.equal(item.followup.at, '2026-11-10T02:00:00.000Z');
  assert.notEqual(item.due.at, item.followup.at);
});

test('list paginates by created_at_ms DESC, item_id ASC', async () => {
  const { service, tick } = makeService();
  for (let index = 0; index < 5; index += 1) {
    tick();
    await service.createItem(`op_page_${index}`, { ...SAMPLE, title: `事项 ${index}` });
  }
  const first = await service.listItems({ limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await service.listItems({ limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 2);
  const third = await service.listItems({ limit: 2, cursor: second.nextCursor });
  assert.equal(third.items.length, 1);
  assert.equal(third.nextCursor, null);
  const all = await service.listItems({ status: 'all' });
  assert.equal(all.items.length, 5);
  const titles = all.items.map((item) => item.title);
  assert.deepEqual(titles, ['事项 4', '事项 3', '事项 2', '事项 1', '事项 0']);
});

test('history paginates by sequence DESC', async () => {
  const { service } = makeService();
  const { item } = await createSample(service);
  await service.updateItem(item.itemId, 'op_h1', 1, { ...SAMPLE, title: '一' });
  await service.updateItem(item.itemId, 'op_h2', 2, { ...SAMPLE, title: '二' });
  const first = await service.history(item.itemId, { limit: 2 });
  assert.equal(first.events.length, 2);
  assert.ok(first.nextCursor);
  const second = await service.history(item.itemId, { limit: 2, cursor: first.nextCursor });
  assert.equal(second.events.length, 1);
  assert.equal(second.nextCursor, null);
});

test('list rejects unknown status and invalid limit (2026-11-08 ruling)', async () => {
  const { service, tick } = makeService();
  for (let index = 0; index < 3; index += 1) {
    tick();
    await service.createItem(`op_rej_${index}`, { ...SAMPLE, title: `事项 ${index}` });
  }
  const item = (await service.listItems()).items[0];

  for (const status of ['bogus', '', 'OPEN', 'all ']) {
    await assert.rejects(() => service.listItems({ status }), (error) => {
      assert.equal(error.code, 'validation_failed');
      return true;
    });
  }
  for (const limit of [0, -1, 201, 1.5, 'abc', '', Number.NaN]) {
    await assert.rejects(() => service.listItems({ limit }), (error) => {
      assert.equal(error.code, 'validation_failed');
      return true;
    });
    await assert.rejects(() => service.history(item.itemId, { limit }), (error) => {
      assert.equal(error.code, 'validation_failed');
      return true;
    });
  }

  // Explicit bounds and every allowed status are accepted.
  const limited = await service.listItems({ limit: 1 });
  assert.equal(limited.items.length, 1);
  assert.ok(limited.nextCursor);
  const max = await service.listItems({ limit: 200 });
  assert.equal(max.items.length, 3);
  assert.equal(max.nextCursor, null);
  const defaults = await service.listItems();
  assert.equal(defaults.items.length, 3);
  for (const status of ['open', 'completed', 'deleted', 'all']) {
    const result = await service.listItems({ status });
    assert.ok(Array.isArray(result.items));
  }
  const history = await service.history(item.itemId, { limit: 200 });
  assert.ok(Array.isArray(history.events));
});

test('failed concurrent writes leave no event and keep the operationId free (MAJOR-1)', async () => {
  for (const action of ['update', 'complete', 'reopen', 'delete']) {
    const { service, storage } = makeService();
    const { item } = await createSample(service);
    const itemId = item.itemId;
    let staleVersion = 1;
    if (action === 'reopen') {
      await service.completeItem(itemId, `op_setup_${action}`, 1);
      staleVersion = 2;
    }
    // Deterministic version race: the winner's commit lands between the
    // loser's read-before and its transaction.
    let winnerHook = null;
    const racingStorage = {
      async command(command, params) {
        if (command === 'transact' && winnerHook) {
          const hook = winnerHook;
          winnerHook = null;
          await hook();
        }
        return storage.command(command, params);
      },
    };
    const racing = new ManualItemsService(racingStorage, { now: () => 9000 });
    winnerHook = () => storage.command('transact', {
      ops: [{
        sql: `UPDATE manual_items SET title='胜者', updated_at_ms=8000, version=version+1 WHERE item_id=? AND version=?`,
        params: [itemId, staleVersion],
      }],
    });

    const loser = action === 'update'
      ? () => racing.updateItem(itemId, `op_loser_${action}`, staleVersion, { ...SAMPLE, title: '败者' })
      : action === 'complete'
        ? () => racing.completeItem(itemId, `op_loser_${action}`, staleVersion)
        : action === 'reopen'
          ? () => racing.reopenItem(itemId, `op_loser_${action}`, staleVersion)
          : () => racing.deleteItem(itemId, `op_loser_${action}`, staleVersion);
    await assert.rejects(loser, (error) => {
      assert.equal(error.code, 'version_conflict');
      return true;
    });

    const afterLoss = await racing.history(itemId);
    assert.equal(afterLoss.events.find((event) => event.operationId === `op_loser_${action}`), undefined);

    const retried = action === 'update'
      ? await racing.updateItem(itemId, `op_loser_${action}`, staleVersion + 1, { ...SAMPLE, title: '败者重决' })
      : action === 'complete'
        ? await racing.completeItem(itemId, `op_loser_${action}`, staleVersion + 1)
        : action === 'reopen'
          ? await racing.reopenItem(itemId, `op_loser_${action}`, staleVersion + 1)
          : await racing.deleteItem(itemId, `op_loser_${action}`, staleVersion + 1);
    assert.equal(retried.replayed, false);
    const afterRetry = await racing.history(itemId);
    assert.ok(afterRetry.events.find((event) => event.operationId === `op_loser_${action}`));
  }
});

test('idempotency key binds action and item across reuse (OBS-2)', async () => {
  const { service } = makeService();
  const first = await createSample(service);
  const second = await createSample(service);
  const shared = 'op_shared';

  await service.completeItem(first.item.itemId, shared, 1);
  await assert.rejects(() => service.completeItem(second.item.itemId, shared, 1), (error) => {
    assert.equal(error.code, 'idempotency_conflict');
    return true;
  });
  await assert.rejects(() => service.deleteItem(first.item.itemId, shared, 2), (error) => {
    assert.equal(error.code, 'idempotency_conflict');
    return true;
  });
  const replay = await service.completeItem(first.item.itemId, shared, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.item.itemId, first.item.itemId);
});

test('CLI parseArgs keeps the boolean --init flag and value flags', () => {
  assert.deepEqual(parseArgs(['--root', '/tmp/x', '--init']), { root: '/tmp/x', init: true });
  assert.deepEqual(parseArgs(['--init', '--root', '/tmp/x']), { init: true, root: '/tmp/x' });
  assert.deepEqual(
    parseArgs(['--root', '/tmp/x', '--storage-bin', '/b', '--port', '9000']),
    { root: '/tmp/x', 'storage-bin': '/b', port: '9000' },
  );
  assert.throws(() => parseArgs(['--root']), /缺少值/);
  assert.throws(() => parseArgs(['--root', '/tmp/x', '--init', '--port']), /缺少值/);
  assert.throws(() => parseArgs(['root']), /无法识别/);
});

test('wire↔domain time mapping keeps minute default and day precision', () => {
  const minuteWire = toWirePoint({ atMs: 1794564000000, timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00' });
  assert.equal(minuteWire.precision, 'minute');
  assert.equal(minuteWire.at, '2026-11-13T10:00:00.000Z');
  assert.equal(toDomainPoint(minuteWire).precision, undefined);
  assert.equal(toDomainPoint(minuteWire).atMs, 1794564000000);

  const dayWire = toWirePoint({ atMs: 1794620800000, timeZone: 'Asia/Shanghai', localText: '2026-11-14', precision: 'day' });
  assert.equal(dayWire.precision, 'day');
  assert.equal(toDomainPoint(dayWire).precision, 'day');
  assert.equal(toDomainPoint(dayWire).atMs, 1794620800000);

  assert.equal(toWirePoint(null), null);
});

test('fromWireItem maps due/followup and source per the manual wire format', () => {
  const wire = {
    contractVersion: 'web-api/1',
    itemId: 'mi_x',
    title: 't',
    kind: 'action',
    owner: 'o',
    priority: 'high',
    status: 'open',
    due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'minute' },
    followup: { at: '2026-11-14T02:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-14', precision: 'day' },
    tags: [],
    createdAt: '2026-11-08T02:00:00.000Z',
    updatedAt: '2026-11-08T02:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    version: 1,
    source: 'manual',
  };
  const item = fromWireItem(wire);
  assert.equal(item.data.due.precision, undefined);
  assert.equal(item.data.due.atMs, 1794564000000);
  assert.equal(item.data.followup.precision, 'day');
  assert.equal(item.data.followup.atMs, 1794621600000);
  assert.equal(item.source, 'manual');

  // Round trip: minute default and day precision both survive.
  const back = toWireInput(item.data);
  assert.equal(back.due.precision, 'minute');
  assert.equal(back.followup.precision, 'day');

  const empty = fromWireItem({ ...wire, due: null, followup: null });
  assert.equal(empty.data.due, null);
  assert.equal(empty.data.followup, null);
});

test('rejects non-ISO instants and validates structured local times (F-1/F-2)', async () => {
  const { service } = makeService();
  await assert.rejects(() => service.createItem('op_iso', {
    ...SAMPLE,
    due: { at: '2026-11-13 18:00', timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'minute' },
  }), (error) => {
    assert.equal(error.code, 'validation_failed');
    return true;
  });
  await assert.rejects(() => service.createItem('op_gap', {
    ...SAMPLE,
    due: { at: '2026-03-08T06:30:00.000Z', timeZone: 'America/New_York', localText: '2026-03-08 02:30', precision: 'minute' },
  }), (error) => {
    assert.equal(error.code, 'validation_failed');
    return true;
  });
  await assert.rejects(() => service.createItem('op_mismatch', {
    ...SAMPLE,
    due: { at: '2026-11-01T07:30:00.000Z', timeZone: 'America/New_York', localText: '2026-11-01 01:30', precision: 'minute' },
  }), (error) => {
    assert.equal(error.code, 'validation_failed');
    return true;
  });
  const accepted = await service.createItem('op_ambiguous', {
    ...SAMPLE,
    due: { at: '2026-11-01T05:30:00.000Z', timeZone: 'America/New_York', localText: '2026-11-01 01:30', precision: 'minute' },
  });
  assert.equal(Date.parse(accepted.item.due.at), Date.parse('2026-11-01T05:30:00.000Z'));
  const free = await service.createItem('op_free', {
    ...SAMPLE,
    due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '周五下午', precision: 'minute' },
  });
  assert.equal(free.item.due.localText, '周五下午');
});

function mockSseRes() {
  const frames = [];
  return { frames, writeHead() {}, write(frame) { frames.push(frame); }, end() {} };
}

const sseEventNames = (res) => res.frames
  .filter((frame) => frame.startsWith('event: '))
  .map((frame) => frame.slice('event: '.length).split('\n')[0]);
const sseData = (res, event) => {
  const frame = res.frames.find((candidate) => candidate.startsWith(`event: ${event}\n`));
  const line = frame.split('\n').find((candidate) => candidate.startsWith('data: '));
  return JSON.parse(line.slice('data: '.length));
};
const sseFrame = (res, event) => res.frames.find((candidate) => candidate.startsWith(`event: ${event}\n`));

test('SSE answers an old epoch with stream.reset then stream.ready (F-4)', () => {
  const hub = new SseHub();
  const old = mockSseRes();
  hub.addClient({ headers: { 'last-event-id': 'inst_old:0' }, on() {} }, old);
  assert.deepEqual(sseEventNames(old), ['stream.reset', 'stream.ready']);
  assert.equal(sseData(old, 'stream.reset').epoch, hub.epoch);
  assert.equal(sseData(old, 'stream.reset').reason, 'epoch_changed');
  assert.ok(!/^id: /m.test(sseFrame(old, 'stream.reset')));

  const same = mockSseRes();
  hub.addClient({ headers: { 'last-event-id': `${hub.epoch}:0` }, on() {} }, same);
  assert.deepEqual(sseEventNames(same), ['stream.ready']);

  const none = mockSseRes();
  hub.addClient({ headers: {}, on() {} }, none);
  assert.deepEqual(sseEventNames(none), ['stream.ready']);

  const outOfWindow = mockSseRes();
  hub.addClient({ headers: { 'last-event-id': `${hub.epoch}:9` }, on() {} }, outOfWindow);
  assert.deepEqual(sseEventNames(outOfWindow), ['stream.reset', 'stream.ready']);
  assert.equal(sseData(outOfWindow, 'stream.reset').reason, 'cursor_out_of_window');

  const malformed = mockSseRes();
  hub.addClient({ headers: { 'last-event-id': 'garbage' }, on() {} }, malformed);
  assert.deepEqual(sseEventNames(malformed), ['stream.reset', 'stream.ready']);
  assert.equal(sseData(malformed, 'stream.reset').reason, 'malformed_last_event_id');
});

test('item.changed frames carry no id and do not advance the task cursor', () => {
  const hub = new SseHub();
  const res = mockSseRes();
  hub.addClient({ headers: {}, on() {} }, res);
  res.frames.length = 0;
  hub.broadcastItemChanged({ itemId: 'mi_1', version: 2 });
  const frame = res.frames.find((candidate) => candidate.startsWith('event: item.changed'));
  assert.ok(frame);
  assert.ok(!/^id: /m.test(frame));
  assert.match(frame, /"objectType":"item"/);
  assert.match(frame, /"itemId":"mi_1"/);
});

test('pairing re-reads on stream.ready/stream.reset/item.changed', async () => {
  let lastSource;
  globalThis.EventSource = class {
    constructor() {
      this.listeners = {};
      lastSource = this;
    }
    addEventListener(event, handler) {
      (this.listeners[event] ??= []).push(handler);
    }
    close() {}
    emit(event) {
      for (const handler of this.listeners[event] ?? []) handler();
    }
  };
  try {
    const pairing = createPairing({ readSession: async () => null, pair: async () => {} });
    let refreshes = 0;
    pairing.setOnItemChanged(() => { refreshes += 1; });
    await pairing.start();
    await pairing.pair();
    assert.ok(lastSource);
    lastSource.emit('stream.ready');
    lastSource.emit('item.changed');
    lastSource.emit('stream.reset');
    assert.equal(refreshes, 3);
    pairing.dispose();
  } finally {
    delete globalThis.EventSource;
  }
});

test('canonicalize is key-order independent', () => {
  assert.equal(canonicalize({ a: 1, b: [2, 3] }), canonicalize({ b: [2, 3], a: 1 }));
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
});
