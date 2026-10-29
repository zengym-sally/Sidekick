import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelResult } from '../runtime/organizer-contract.mjs';
const request={kind:'extract',anchorAtMs:Date.parse('2026-10-29T02:00:00Z'),source:{rawText:'我整理清单，周五17点前提交。林川负责方案，我今天15点跟进。补充：下周五复核。',timeZone:'Asia/Shanghai'}};
const candidate={title:'跟进方案',kind:'followup',owner:'林川',priority:'medium',tags:[],evidence:'林川负责方案，我今天15点跟进。',dueExpression:'周五17点前',followupExpression:'今天15点'};
test('model strings become typed candidates with exact evidence and independent dates',()=>{
  const result=parseModelResult(JSON.stringify({candidates:[candidate]}),request);
  assert.equal(result.candidates[0].fields.due.atMs,Date.parse('2026-10-30T09:00:00Z'));
  assert.equal(result.candidates[0].fields.followup.atMs,Date.parse('2026-10-29T07:00:00Z'));
  assert.throws(()=>parseModelResult(JSON.stringify({candidates:[{...candidate,evidence:'不是原文'}]}),request));
  assert.throws(()=>parseModelResult(JSON.stringify({candidates:[{...candidate,todoId:'injected'}]}),request));
  assert.throws(()=>parseModelResult(JSON.stringify({candidates:[{...candidate,dueExpression:'明年三月'}]}),request));
});
test('a title-only revision preserves original temporal coordinates, zone and precision',()=>{
  const base=parseModelResult(JSON.stringify({candidates:[{...candidate,dueExpression:'下周五'}]}),request).candidates[0];
  const revised=parseModelResult(JSON.stringify({changes:{title:'新的标题'}}),{...request,kind:'revise',anchorAtMs:Date.parse('2026-11-05T00:00:00Z'),candidate:{draft:base}}).preview;
  assert.deepEqual(revised.fields.due,base.fields.due);assert.deepEqual(revised.fields.followup,base.fields.followup);
  const moved=parseModelResult(JSON.stringify({changes:{followupExpression:'明天上午10点'}}),{...request,kind:'revise',anchorAtMs:Date.parse('2026-11-05T00:00:00Z'),candidate:{draft:base}}).preview;
  assert.equal(moved.fields.followup.atMs,Date.parse('2026-11-06T02:00:00Z'));assert.deepEqual(moved.fields.due,base.fields.due);
});
test('empty results are valid; malformed, oversized or date-fabricating results fail',()=>{
  assert.deepEqual(parseModelResult('{"candidates":[]}',request),{candidates:[]});
  assert.throws(()=>parseModelResult('{"candidates":[{"atMs":0}]}',request));
  assert.throws(()=>parseModelResult('not-json',request));
  assert.throws(()=>parseModelResult(JSON.stringify({candidates:Array(51).fill(candidate)}),request));
});
