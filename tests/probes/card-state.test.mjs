import assert from 'node:assert/strict';
import test from 'node:test';
import { applyProbeEvent } from './card-state.mjs';

const expected = { operator: 'fixture-user', message: 'fixture-message', now: 1000 };
function state() { return { events: [], items: { 's0-fixture-a': { status: 'pending', dueAt: 5000, reminderAt: 2000, version: 1 } } }; }
function event(action = 'complete') { return { event_id: 'event-1', operator_id: expected.operator, message_id: expected.message, action_value: JSON.stringify({ probe: 'sidekick-s0', todoId: 's0-fixture-a', version: 1, action }) }; }

test('complete is explicit and duplicate delivery takes effect once', () => {
  const data = state();
  assert.equal(applyProbeEvent(data, event(), expected), 'complete');
  assert.equal(data.items['s0-fixture-a'].status, 'completed');
  assert.equal(applyProbeEvent(data, event(), expected), 'duplicate');
  assert.equal(data.items['s0-fixture-a'].version, 2);
});
test('snooze changes reminder and preserves deadline and pending state', () => {
  const data = state();
  assert.equal(applyProbeEvent(data, event('snooze'), expected), 'snooze');
  assert.equal(data.items['s0-fixture-a'].dueAt, 5000);
  assert.equal(data.items['s0-fixture-a'].status, 'pending');
  assert.equal(data.items['s0-fixture-a'].reminderAt, 3601000);
});
test('wrong user, wrong card and stale version cannot change the fixture', () => {
  for (const change of [{ operator_id: 'other' }, { message_id: 'old-card' }]) {
    const data = state();
    assert.equal(applyProbeEvent(data, { ...event(), ...change }, expected), 'unrelated');
    assert.equal(data.items['s0-fixture-a'].version, 1);
  }
  const data = state(); data.items['s0-fixture-a'].version = 2;
  assert.equal(applyProbeEvent(data, event(), expected), 'stale');
});
test('malformed action and missing event ID leave the fixture untouched', () => {
  for (const change of [{ action_value: 'null' }, { action_value: '{' }, { event_id: '' }]) {
    const data = state();
    assert.equal(applyProbeEvent(data, { ...event(), ...change }, expected), 'invalid');
    assert.equal(data.items['s0-fixture-a'].version, 1);
  }
});
