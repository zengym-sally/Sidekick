import assert from 'node:assert/strict';
import test from 'node:test';
import { createTodoModel } from '../../src/stores/todos.ts';

test('a late old response cannot replace a newer authoritative snapshot',async()=>{
  const resolvers=[];const model=createTodoModel(()=>new Promise(resolve=>resolvers.push(resolve)));
  const old=model.refresh(),recent=model.refresh();
  resolvers[1]([{id:'new'}]);await recent;resolvers[0]([{id:'old'}]);await old;
  assert.equal(model.rows.value[0].id,'new');assert.equal(model.loading.value,false);
});
test('read failure retains the previous snapshot and exposes an error',async()=>{
  let failed=false;const model=createTodoModel(async()=>{if(failed)throw {code:'DATABASE_BUSY',message:'稍后重试'};return [{id:'saved'}]});
  await model.refresh();failed=true;await assert.rejects(model.refresh());
  assert.equal(model.rows.value[0].id,'saved');assert.equal(model.error.value,'稍后重试');
});
test('a committed write is not reported as unsaved when the follow-up read fails',async()=>{
  const saved={id:'saved',version:1};
  const model=createTodoModel(async command=>{if(command==='create_todo')return saved;throw {message:'暂时无法读取'};});
  assert.equal((await model.create({},'operation')).id,'saved');
  assert.equal(model.rows.value[0].id,'saved');assert.ok(model.error.value.includes('已保存'));
});
test('a failed mutation invalidates an old read without leaving refresh disabled',async()=>{
  let resolveRead;
  const model=createTodoModel(command=>command==='list_todos'?new Promise(resolve=>resolveRead=resolve):Promise.reject({message:'版本已变化'}));
  const oldRead=model.refresh();
  await assert.rejects(model.create({},'operation'));
  resolveRead([{id:'stale'}]);await oldRead;
  assert.equal(model.loading.value,false);assert.equal(model.saving.value,false);
  assert.equal(model.rows.value.length,0);
});
