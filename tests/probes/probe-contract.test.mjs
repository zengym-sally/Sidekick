import assert from 'node:assert/strict';
import test from 'node:test';
import { isSyntheticFollowupBatch } from '../../runtime/lib/probe-contract.mjs';

const candidate = { title: 'Follow up on delivery', kind: 'followup', dueExpression: 'Friday', followupExpression: 'today', evidence: 'S0 controlled fixture: delivery is on Friday; follow-up is today.' };

test('the controlled source yields one complete follow-up candidate', () => {
  assert.equal(isSyntheticFollowupBatch({ candidates: [candidate] }), true);
});
test('missing fields and dates inconsistent with the source fail validation', () => {
  for (const change of [{ title: undefined }, { title: ' ' }, { followupExpression: undefined }, { dueExpression: 'Monday' }, { followupExpression: 'tomorrow' }, { evidence: 'invented' }, { kind: 'action' }]) {
    assert.equal(isSyntheticFollowupBatch({ candidates: [{ ...candidate, ...change }] }), false);
  }
});
test('the review counterexample and invalid batch structures cannot report success', () => {
  for (const value of [null, {}, { candidates: [] }, { candidates: [null] }, { candidates: [candidate, candidate] }, { candidates: [{ kind: 'followup', dueExpression: 'wrong-day' }] }]) {
    assert.equal(isSyntheticFollowupBatch(value), false);
  }
});
