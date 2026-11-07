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
    [{ ...SAMPLE, due: { at: 'nope', timeZone: 'Asia/Shanghai', localText: 'x', precision: 'minute' } }, '时间无效'],
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

test('canonicalize is key-order independent', () => {
  assert.equal(canonicalize({ a: 1, b: [2, 3] }), canonicalize({ b: [2, 3], a: 1 }));
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
});
