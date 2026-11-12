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
import { ApplicationSettingsService } from '../../server/lib/application-settings-service.mjs';
import { createPairing } from '../../src/stores/pairing.ts';
import { useOrganizer } from '../../src/stores/organizer.ts';
import { getWebApiClient } from '../../src/lib/web-api-client.ts';
import { createPinia, setActivePinia } from 'pinia';

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
  // The frozen 001 table the application-settings service reuses.
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL);');
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
  // The pairing transport is a same-origin fetch stream (frozen web-api/1 §6:
  // the resubscribe token rides the Last-Event-ID REQUEST HEADER, which native
  // EventSource cannot carry). The seam below drives that real transport: a
  // controllable text/event-stream body for /api/events plus a real-shaped §6
  // snapshot response for the reset resync. The assertion intent is
  // unchanged — the three hints (stream.ready / item.changed / stream.reset)
  // each notify the hint handler exactly once — with the contract timing made
  // explicit: stream.reset notifies only AFTER the snapshot has been consumed
  // into the organizer baseline, and the resubscribe carries the snapshot's
  // lastEventId as the request header. Session-loss/dispose semantics stay in
  // their own case below; dispose here is unconditional so a failed assertion
  // cannot leave a reconnect loop behind.
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  const connections = [];
  const calls = [];
  const encoder = new TextEncoder();
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path: String(path), headers: { ...(options.headers ?? {}) } });
    const stream = new ReadableStream({ start(c) { connections.push(c); } });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const emit = (controller, text) => controller.enqueue(encoder.encode(text));
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const waitFor = async (predicate, what) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 3000) throw new Error(`timeout waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  setActivePinia(createPinia());
  const organizer = useOrganizer();
  const pairing = createPairing({
    readSession: async () => null,
    pair: async () => ({}),
    onSessionLost() {},
    readSnapshot: async () => ({
      // The real §6.1 response shape, tasks mapped the way the client maps
      // them (the same StoreRun rows the regular read path produces).
      contractVersion: 'web-api/2',
      highWatermark: 7,
      lastEventId: 'inst_probe:7',
      epoch: 'inst_probe',
      settings: { agentConcurrency: 3, version: 5 },
      workspace: { mode: 'local', currentRoot: { id: 'root_probe', label: '探针' }, capabilities: [], recovery: null },
      agentConcurrency: 3,
      generatedAt: '2026-11-11T00:00:00.000Z',
      tasks: [{
        id: 'tsk_snap_1', sourceId: null, kind: 'extract', status: 'running',
        snapshot: {}, input: {}, candidateId: null, candidateVersion: null,
        preview: null, errorCode: null, createdAtMs: 1, finishedAtMs: null,
        wireVersion: 2, wireAttemptCount: 1, wireState: 'running',
        wireAttemptId: null, wireExitState: '', wireExitEvidence: null, wireExitEvidenceError: null,
      }],
    }),
  });
  let refreshes = 0;
  let disposed = false;
  try {
    pairing.setOnItemChanged(() => { refreshes += 1; });
    await pairing.start();
    await pairing.pair();
    await waitFor(() => connections.length >= 1, 'the first subscription');
    emit(connections[0], frame('stream.ready', { contractVersion: 'web-api/2', epoch: 'inst_probe', cursor: 0 }));
    emit(connections[0], frame('item.changed', { contractVersion: 'web-api/2', objectType: 'item', itemId: 'mi_1', itemVersion: 2 }));
    await waitFor(() => refreshes >= 2, 'ready and item notifications');
    assert.ok(connections.length >= 1);
    emit(connections[0], frame('stream.reset', { contractVersion: 'web-api/2', epoch: 'inst_probe', reason: 'cursor_out_of_window' }));
    // reset: close -> GET /api/snapshot -> CONSUME into the organizer
    // baseline -> notify. The third notification can only land after the
    // snapshot task is installed.
    await waitFor(() => refreshes >= 3, 'the reset notification after snapshot install');
    assert.equal(refreshes, 3);
    // The store unwraps refs: `organizer.run` IS the displayed run here.
    assert.equal(organizer.run?.id, 'tsk_snap_1');
    await waitFor(() => connections.length >= 2, 'the header-carried resubscribe');
    assert.equal(calls[calls.length - 1].headers['Last-Event-ID'], 'inst_probe:7');
    pairing.dispose();
    disposed = true;
  } finally {
    if (!disposed) pairing.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    delete globalThis.fetch;
    delete globalThis.window;
  }
});

test('rejects UTC instants that roll over the calendar (MINOR-1)', async () => {
  const { service, storage } = makeService();
  for (const at of ['2026-02-30T00:00:00.000Z', '2026-11-13T24:00:00.000Z', '2026-13-01T00:00:00.000Z', '2026-11-13T10:60:00.000Z']) {
    await assert.rejects(() => service.createItem(`op_roll_${at}`, {
      ...SAMPLE,
      due: { at, timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'minute' },
    }), (error) => {
      assert.equal(error.code, 'validation_failed');
      return true;
    });
  }
  const rows = await storage.command('query', { sql: 'SELECT count(*) FROM manual_items', params: [] });
  assert.equal(rows.rows[0][0], 0);
  // A real leap day and an ordinary date still work, and free-form text is untouched.
  const leap = await service.createItem('op_leap', {
    ...SAMPLE,
    due: { at: '2024-02-29T00:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2024-02-29 08:00', precision: 'minute' },
  });
  assert.equal(leap.item.due.at, '2024-02-29T00:00:00.000Z');
  const day = await service.createItem('op_day', {
    ...SAMPLE,
    due: { at: '2026-11-13T10:00:00.000Z', timeZone: 'Asia/Shanghai', localText: '2026-11-13 18:00', precision: 'day' },
  });
  assert.equal(day.item.due.precision, 'day');
});

test('application settings reads the OS default at version 0 without writing', async () => {
  const { storage } = makeService();
  const service = new ApplicationSettingsService(storage, { osTimeZone: () => 'Asia/Shanghai' });
  const snapshot = await service.read();
  assert.equal(snapshot.contractVersion, 'web-api/1');
  assert.equal(snapshot.settings.timeZone, 'Asia/Shanghai');
  assert.equal(snapshot.version, 0);
  const rows = await storage.command('query', { sql: 'SELECT count(*) FROM settings', params: [] });
  assert.equal(rows.rows[0][0], 0);
});

test('application settings write is an atomic compare-and-set', async () => {
  const { storage } = makeService();
  const service = new ApplicationSettingsService(storage, { osTimeZone: () => 'Asia/Shanghai' });
  const first = await service.write('America/New_York', 0);
  assert.equal(first.version, 1);
  await assert.rejects(() => service.write('UTC', 0), (error) => {
    assert.equal(error.code, 'version_conflict');
    return true;
  });
  const second = await service.write('UTC', 1);
  assert.equal(second.version, 2);
  const read = await service.read();
  assert.equal(read.settings.timeZone, 'UTC');
  assert.equal(read.version, 2);
});

test('application settings rejects invalid timezone and version', async () => {
  const { storage } = makeService();
  const service = new ApplicationSettingsService(storage);
  await assert.rejects(() => service.write('Nowhere/Nope', 0), (error) => {
    assert.equal(error.code, 'validation_failed');
    return true;
  });
  await assert.rejects(() => service.write('UTC', 1.5), (error) => {
    assert.equal(error.code, 'validation_failed');
    return true;
  });
});

test('the shared web api client is a singleton and carries CSRF into settings writes', async () => {
  const seen = [];
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  globalThis.fetch = async (url, options) => {
    seen.push({ url, headers: options.headers });
    const body = url.includes('/api/pair')
      ? { contractVersion: 'web-api/2', session: { capabilities: [] }, csrfToken: 'csrf-1' }
      : { contractVersion: 'web-api/2', settings: { timeZone: 'UTC' }, version: 1 };
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  try {
    const first = getWebApiClient();
    const second = getWebApiClient();
    assert.equal(first, second);
    await first.pair('code');
    await first.writeApplicationSettings('UTC', 0);
    const write = seen.find((call) => call.url.includes('/api/settings/application'));
    assert.equal(write.headers['X-CSRF-Token'], 'csrf-1');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('an in-session 401 clears the shared CSRF token', async () => {
  const seen = [];
  globalThis.window = { location: { host: 'h', origin: 'http://h' } };
  globalThis.fetch = async (url, options) => {
    seen.push({ url, headers: options.headers });
    if (url.includes('/api/pair')) {
      return { ok: true, text: async () => JSON.stringify({ contractVersion: 'web-api/2', session: { capabilities: [] }, csrfToken: 'csrf-1' }) };
    }
    return {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ contractVersion: 'web-api/2', error: { code: 'unauthenticated', message: '会话已过期' } }),
    };
  };
  try {
    const client = getWebApiClient();
    await client.pair('code');
    assert.equal(client.getCsrfToken(), 'csrf-1');
    await assert.rejects(() => client.listItems(), (error) => error.status === 401);
    assert.equal(client.getCsrfToken(), '');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('pairing store returns to the gate when the session is lost', async () => {
  let lostHandler;
  const fakeClient = {
    onSessionLost(handler) { lostHandler = handler; },
    readSession: async () => ({ capabilities: [], csrfToken: 'csrf' }),
    pair: async () => ({}),
  };
  const pairing = createPairing(fakeClient);
  await pairing.start();
  assert.equal(pairing.paired.value, true);
  lostHandler();
  assert.equal(pairing.paired.value, false);
  pairing.dispose();
});

test('canonicalize is key-order independent', () => {
  assert.equal(canonicalize({ a: 1, b: [2, 3] }), canonicalize({ b: [2, 3], a: 1 }));
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
});
