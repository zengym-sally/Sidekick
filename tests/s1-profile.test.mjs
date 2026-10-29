import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileModel } from '../src/stores/profile.ts';
const profile=(address='BOSS',name='小明同学')=>({version:1,name,address});

test('profile read failure leaves a safe default and cannot overwrite the unread file',async()=>{
  const model=createProfileModel(async()=>{throw {message:'个人配置无法读取'};});
  await model.load();assert.equal(model.saved.value.address,'BOSS');assert.equal(model.ready.value,false);
  assert.equal(model.saved.value.name,'小明同学');
  await assert.rejects(model.save());assert.ok(model.loadError.value);
});
test('save failure preserves the draft and the previous saved value',async()=>{
  const model=createProfileModel(async command=>{if(command==='read_profile')return profile();throw {message:'暂时无法保存'};});
  await model.load();model.draft.address='新称呼';await assert.rejects(model.save());
  assert.equal(model.draft.address,'新称呼');assert.equal(model.saved.value.address,'BOSS');assert.equal(model.saving.value,false);
});
test('late read success or failure cannot replace a successful save',async()=>{
  for(const rejectOld of [false,true]){
    let resolveOld,reject;let reads=0;
    const model=createProfileModel(command=>command==='read_profile'?(++reads===1?Promise.resolve(profile()):new Promise((a,b)=>{resolveOld=a;reject=b;})):Promise.resolve({profile:profile('新称呼'),warning:null}));
    await model.load();const late=model.load();model.draft.address='新称呼';await model.save();
    if(rejectOld)reject({message:'旧错误'});else resolveOld(profile('旧称呼'));
    await late;assert.equal(model.saved.value.address,'新称呼');assert.equal(model.draft.address,'新称呼');assert.equal(model.loadError.value,'');
  }
});
test('a late load or save keeps a newer session draft intact',async()=>{
  let finishRead,finishSave;const model=createProfileModel(command=>new Promise(resolve=>{if(command==='read_profile')finishRead=resolve;else finishSave=resolve;}));
  const read=model.load();model.draft.name='更新草稿';finishRead(profile());await read;
  assert.equal(model.draft.name,'更新草稿');
  model.draft.address='提交A';const save=model.save();model.draft.address='编辑B';finishSave({profile:profile('提交A','更新草稿'),warning:null});await save;
  assert.equal(model.saved.value.address,'提交A');assert.equal(model.draft.address,'编辑B');
});
test('post-replace warning publishes the current value; unknown result requires a fresh read',async()=>{
  let uncertain=false;
  const model=createProfileModel(async command=>{if(command==='read_profile')return profile();if(uncertain)throw {code:'PROFILE_SAVE_UNCERTAIN',message:'请重新读取'};return {profile:profile('已生效'),warning:'同步未确认'};});
  await model.load();model.draft.address='已生效';await model.save();assert.equal(model.saved.value.address,'已生效');assert.equal(model.warning.value,'同步未确认');
  uncertain=true;await assert.rejects(model.save());assert.equal(model.ready.value,false);assert.equal(model.draft.address,'已生效');
});
test('nickname copy is explicit, accepts long legal names and never binds or saves',async()=>{
  let writes=0;const model=createProfileModel(async command=>{if(command==='read_profile')return profile();writes++;});
  await model.load();model.draft.name='明'.repeat(40);model.useNickname();assert.equal(model.draft.address,'明'.repeat(40));
  model.draft.name='后来修改的昵称';assert.equal(model.draft.address,'明'.repeat(40));assert.equal(writes,0);
  model.draft.name='  ';model.useNickname();assert.equal(model.draft.address,'小明同学');
  model.saving.value=true;model.draft.name='保存期间';model.useNickname();assert.equal(model.draft.address,'小明同学');
});
