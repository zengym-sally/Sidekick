import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExpression, zonedCandidates, dayCoordinate } from '../runtime/dates.mjs';
const anchor=Date.parse('2026-10-29T02:00:00Z');
test('relative dates use the supplied source anchor and keep delivery and follow-up separate',()=>{
  const due=resolveExpression('周五17点前',anchor,'Asia/Shanghai');const follow=resolveExpression('今天15点',anchor,'Asia/Shanghai');
  assert.equal(due.point.atMs,Date.parse('2026-10-30T09:00:00Z'));assert.equal(follow.point.atMs,Date.parse('2026-10-29T07:00:00Z'));
  const next=resolveExpression('下周五',anchor,'Asia/Shanghai');assert.equal(next.point.precision,'day');assert.equal(next.point.atMs,Date.parse('2026-11-05T16:00:00Z'));
  assert.equal(resolveExpression('明天上午10点',Date.parse('2026-10-30T00:00:00Z'),'Asia/Shanghai').point.atMs,Date.parse('2026-10-31T02:00:00Z'));
});
test('calendar dates cross years without inventing a clock',()=>{
  const value=resolveExpression('下周五',Date.parse('2026-12-31T01:00:00Z'),'Asia/Shanghai');
  assert.equal(value.point.precision,'day');assert.equal(value.point.atMs,Date.parse('2027-01-07T16:00:00Z'));
  assert.equal(resolveExpression(null,anchor,'Asia/Shanghai').point,null);
});
test('DST gaps and repeated instants remain unresolved instead of choosing a guess',()=>{
  assert.equal(zonedCandidates('2026-03-08T02:30','America/New_York').length,0);
  assert.equal(zonedCandidates('2026-11-01T01:30','America/New_York').length,2);
  assert.equal(resolveExpression('2026-11-01 01:30',anchor,'America/New_York').unresolved,true);
  assert.equal(resolveExpression('2026-02-31 10:00',anchor,'Asia/Shanghai').unresolved,true);
  assert.equal(resolveExpression('会后',anchor,'Asia/Shanghai').unresolved,true);
  assert.equal(dayCoordinate('2011-12-30','Pacific/Apia'),null);
});
test('alternatives, unsupported relative dates and ambiguous midnight never get combined into a guess',()=>{
  for(const text of ['明天或后天','下周五或周六','明天17:00之前或后天10:00','三天后17:00','明天晚上12点','每周五17点','下下周五','明天3点一刻','明天17:00 UTC']){
    const value=resolveExpression(text,anchor,'Asia/Shanghai');assert.equal(value.unresolved,true,text);assert.equal(value.point,null,text);
  }
});
