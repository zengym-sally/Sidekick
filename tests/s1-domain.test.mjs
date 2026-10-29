import assert from 'node:assert/strict';
import test from 'node:test';
import { localCandidates, pointFromInput, localInput, filterTodos, todayLists } from '../src/domain/todos.ts';

function inZone(zone, action) { const old=process.env.TZ; process.env.TZ=zone; try { action(); } finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old;} }
const row=(id,data,status='open')=>({id,data:{title:'合成事项',kind:'action',owner:'我',priority:'medium',due:null,followup:null,tags:[],...data},status,version:1,source:'manual',createdAtMs:0,updatedAtMs:0,completedAtMs:null,deletedAtMs:null});

test('manual dates preserve UTC, timezone, expression and unchanged values',()=>inZone('Asia/Shanghai',()=>{
  const point=pointFromInput('2026-10-30T17:00',null,null);
  assert.equal(point.atMs,Date.parse('2026-10-30T09:00:00Z')); assert.equal(point.timeZone,'Asia/Shanghai');
  assert.equal(localInput(point),'2026-10-30T17:00');
  assert.equal(pointFromInput('2026-10-30T17:00',null,point),point);
  assert.equal(pointFromInput('',null,point),null);
}));
test('DST gaps and invalid dates fail; repeated times require explicit choice',()=>inZone('America/New_York',()=>{
  assert.equal(localCandidates('2026-03-08T02:30').length,0);
  assert.equal(localCandidates('2026-02-31T10:00').length,0);
  const repeated=localCandidates('2026-11-01T01:30'); assert.equal(repeated.length,2);
  assert.throws(()=>pointFromInput('2026-11-01T01:30',null,null));
  assert.equal(pointFromInput('2026-11-01T01:30',repeated[1],null).atMs,repeated[1]);
}));
test('editing only the offset of a repeated time preserves the chosen occurrence',()=>inZone('America/New_York',()=>{
  const raw='2026-11-01T01:30',choices=localCandidates(raw);
  const previous=pointFromInput(raw,choices[0],null);
  assert.equal(pointFromInput(raw,choices[1],previous).atMs,choices[1]);
  assert.equal(pointFromInput(raw,choices[0],previous),previous);
}));
test('today follow-ups use next follow-up independently of delivery; deleted stays excluded',()=>inZone('Asia/Shanghai',()=>{
  const due=pointFromInput('2026-10-30T17:00',null,null),followup=pointFromInput('2026-10-29T15:00',null,null);
  const rows=[row('follow',{kind:'followup',owner:'合成人',due,followup}),row('undated',{}),row('done',{due},'completed'),row('gone',{due},'deleted')];
  const today=todayLists(rows,Date.parse('2026-10-29T04:00:00Z'));
  assert.deepEqual(today.followup.map(t=>t.id),['follow']);assert.equal(today.action.length,0);
  assert.deepEqual(filterTodos(rows,{date:'undated'}).map(t=>t.id),['undated']);
  assert.equal(filterTodos(rows,{}).length,3);assert.equal(filterTodos(rows,{status:'deleted'}).length,1);
}));
test('type, owner, tag, status and text filters combine without mutating records',()=>{
  const rows=[row('a',{kind:'followup',owner:'合成人',tags:['清单'],title:'准备验收'}),row('b',{title:'另一个事项'})];
  assert.deepEqual(filterTodos(rows,{kind:'followup',owner:'合成人',tag:'清单',query:'验收',status:'open'}).map(t=>t.id),['a']);
  assert.equal(rows.length,2);
});
