<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { Button as TButton } from 'tdesign-vue-next';
import { useTodos, errorMessage } from '../stores/todos';
import { currentZone, displayTime, displayPoint, isOverdue, filterTodos, todayLists, type Todo, type TodoInput, type TodoEvent } from '../domain/todos';
import Icon from './Icon.vue';
import TodoRow from './TodoRow.vue';
import TimeField from './TimeField.vue';
import InboxView from './InboxView.vue';
import TextIntake from './TextIntake.vue';
import { useOrganizer } from '../stores/organizer';
import { timeDraft,draftPoint } from '../domain/time';
import SettingsPanel from './SettingsPanel.vue';
import { useProfile, DEFAULT_NICKNAME } from '../stores/profile';
import mark from '../../design/brand/sidekick-mark.svg';
import pet from '../../design/brand/banban-idle.svg';

const store=useTodos(),profile=useProfile(),organizer=useOrganizer();
const captureMode=ref<'manual'|'text'>('manual');
const settingsTab=ref<'profile'|'general'|'models'|'about'>('profile');
const address=computed(()=>profile.ready?profile.saved.address:'BOSS');
const profileName=computed(()=>profile.ready?(profile.saved.name||DEFAULT_NICKNAME):DEFAULT_NICKNAME);
function openSettings(){page.value='settings';settingsTab.value='profile';}
function openModels(){if(organizer.starting)return;formDialog.value?.close();page.value='settings';settingsTab.value='models';}
function captureText(){captureMode.value='text';editing.value=null;show(formDialog.value);}
async function sourceSubmitted(id:string){formDialog.value?.close();page.value='inbox';try{await organizer.select(id);}catch{}}
function signed(){page.value='today';notify('事项已签收，班班开始盯着了。');}
const page=ref<'today'|'inbox'|'all'|'settings'>('today'),booting=ref(true),startupError=ref(''),initializing=ref(false),setupError=ref('');
const now=ref(Date.now()),toast=ref(''),formDialog=ref<HTMLDialogElement>(),detailDialog=ref<HTMLDialogElement>(),deleteDialog=ref<HTMLDialogElement>();
const filters=reactive({kind:'all',status:'all',date:'all',owner:'',tag:'',query:''});
const today=computed(()=>todayLists(store.rows,now.value));
const active=computed(()=>store.rows.filter(t=>t.status==='open'));
const undated=computed(()=>active.value.filter(t=>!t.data.due&&!t.data.followup).length);
const overdue=computed(()=>active.value.filter(t=>isOverdue(t,now.value)).length);
const results=computed(()=>filterTodos(store.rows,filters,now.value));
const owners=computed(()=>[...new Set(store.rows.map(t=>t.data.owner))]);
const tags=computed(()=>[...new Set(store.rows.flatMap(t=>t.data.tags))]);
const editing=ref<Todo|null>(null),selectedId=ref<string|null>(null),deleteTarget=ref<Todo|null>(null);
const selected=computed(()=>store.rows.find(t=>t.id===selectedId.value));
const sourceLinks=ref<{sourceId:string;evidence:string;association:string;createdAtMs:number}[]>([]);
const events=ref<TodoEvent[]>([]),historyBusy=ref(false),historyError=ref('');
const form=reactive({title:'',kind:'action' as TodoInput['kind'],owner:'我',priority:'medium' as TodoInput['priority'],due:timeDraft(null),followup:timeDraft(null),tags:''});
const formError=ref('');
let organizerUnlisten:UnlistenFn|undefined,poller:ReturnType<typeof setInterval>|undefined;
let operationId='',signature='',deleteOperation='',historyRequest=0,lastFocus:HTMLElement|null=null,unlisten:UnlistenFn|undefined,clock:ReturnType<typeof setInterval>|undefined,toastTimer:ReturnType<typeof setTimeout>|undefined;
const actionNames:Record<string,string>={create:'手工录入',update:'修改事项',complete:'标记完成',reopen:'重新打开',delete:'删除事项',link:'关联来源'};

async function boot(){booting.value=true;startupError.value='';try{await store.boot();if(!store.workspace?.needsSetup){void profile.load();void organizer.refresh().catch(()=>{});}}catch(e){startupError.value=errorMessage(e);}finally{booting.value=false;}}
async function initialize(path:string|null){initializing.value=true;setupError.value='';try{await store.initialize(path);void profile.load();void organizer.refresh().catch(()=>{});}catch(e){setupError.value=errorMessage(e);}finally{initializing.value=false;}}
async function chooseDirectory(){
  setupError.value='';initializing.value=true;
  try{const path=await open({directory:true,multiple:false,title:'选择跟班工作目录'});if(typeof path==='string')await initialize(path);}
  catch(e){setupError.value=errorMessage(e);}finally{initializing.value=false;}
}
function notify(text:string){toast.value=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',4500);}
function show(dialog:HTMLDialogElement|undefined){lastFocus=document.activeElement as HTMLElement;dialog?.showModal();}
function close(dialog:HTMLDialogElement|undefined){if(store.saving||organizer.starting)return;dialog?.close();if(lastFocus?.isConnected&&lastFocus.getClientRects().length&&!lastFocus.closest('dialog:not([open])'))lastFocus.focus();else document.querySelector<HTMLButtonElement>('#quick-entry')?.focus();}
function capture(todo:Todo|null=null){
  captureMode.value='manual';editing.value=todo;formError.value='';signature='';operationId=crypto.randomUUID();
  Object.assign(form,{title:todo?.data.title||'',kind:todo?.data.kind||'action',owner:todo?.data.owner||'我',priority:todo?.data.priority||'medium',due:timeDraft(todo?.data.due||null),followup:timeDraft(todo?.data.followup||null),tags:todo?.data.tags.join('，')||''});
  if(detailDialog.value?.open)detailDialog.value.close();show(formDialog.value);
}
function kindChanged(){if(form.kind==='followup'&&form.owner==='我')form.owner='';}
async function save(){
  if(store.saving)return;formError.value='';
  try{
    const input:TodoInput={title:form.title,kind:form.kind,owner:form.owner,priority:form.priority,due:draftPoint(form.due),followup:form.kind==='followup'?draftPoint(form.followup):null,tags:form.tags.split(/[,，]/)};
    const next=JSON.stringify(input);if(signature&&signature!==next)operationId=crypto.randomUUID();signature=next;
    if(editing.value)await store.update(editing.value,input,operationId);else await store.create(input,operationId);
    formDialog.value?.close();page.value='all';Object.assign(filters,{status:'all',date:'all',kind:'all',owner:'',tag:'',query:''});notify(editing.value?'修改已保存。':'事项已保存，班班记着了。');
    await nextTick();document.querySelector<HTMLButtonElement>('#quick-entry')?.focus();
  }catch(e){formError.value=e instanceof Error?e.message:errorMessage(e);}
}
async function loadHistory(id:string){const request=++historyRequest;historyBusy.value=true;historyError.value='';try{const [result,sources]=await Promise.all([store.history(id),store.sources(id)]);if(request===historyRequest&&selectedId.value===id){events.value=result;sourceLinks.value=sources;}}catch(e){if(request===historyRequest)historyError.value=errorMessage(e);}finally{if(request===historyRequest)historyBusy.value=false;}}
async function detail(id:string){selectedId.value=id;events.value=[];sourceLinks.value=[];await nextTick();show(detailDialog.value);await loadHistory(id);}
async function viewSource(id:string){detailDialog.value?.close();page.value='inbox';try{await organizer.select(id);}catch{}}
async function toggle(todo:Todo){try{await store.setCompleted(todo,todo.status!=='completed',crypto.randomUUID());notify(todo.status==='completed'?'事项已重新打开。':'事项已完成。');if(detailDialog.value?.open)await loadHistory(todo.id);}catch(e){notify(errorMessage(e));}}
function askDelete(todo:Todo){deleteTarget.value=todo;deleteOperation=crypto.randomUUID();if(detailDialog.value?.open)detailDialog.value.close();show(deleteDialog.value);}
async function remove(){if(!deleteTarget.value||store.saving)return;try{await store.deleteTodo(deleteTarget.value,deleteOperation);deleteDialog.value?.close();notify('事项已删除，本地历史仍保留。');}catch(e){notify(errorMessage(e));}}
async function refresh(){try{if(page.value==='inbox')await Promise.all([organizer.refresh(),store.refresh()]);else await store.refresh();notify('清单已刷新。');}catch{}}
async function openDirectory(){try{await store.openDirectory();}catch(e){notify(errorMessage(e));}}
function keyboard(event:KeyboardEvent){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!store.workspace?.needsSetup&&!booting.value&&!startupError.value){event.preventDefault();if(!formDialog.value?.open&&!detailDialog.value?.open&&!deleteDialog.value?.open)capture();}}
function showUndated(){page.value='all';Object.assign(filters,{date:'undated',status:'open',kind:'all',owner:'',tag:'',query:''});}
onMounted(async()=>{document.addEventListener('keydown',keyboard);poller=setInterval(()=>{if(organizer.running&&!organizer.loading)void organizer.refresh().catch(()=>{});},1000);clock=setInterval(()=>now.value=Date.now(),60000);await boot();try{unlisten=await listen('todos-changed',()=>{if(!store.workspace?.needsSetup)void store.refresh().catch(()=>{});});organizerUnlisten=await listen<{phase:string}>('organizer-changed',event=>{organizer.phase=event.payload.phase;if(!store.workspace?.needsSetup&&['changed','started','storage_error'].includes(event.payload.phase))void organizer.refresh().catch(()=>{});});}catch{}});
onUnmounted(()=>{document.removeEventListener('keydown',keyboard);clearInterval(clock);clearTimeout(toastTimer);clearInterval(poller);unlisten?.();organizerUnlisten?.();});
</script>

<template>
  <main v-if="booting" class="startup"><img :src="pet" alt="班班"><h1>正在打开本地工作目录…</h1><p>已保存的事项会从本机读回。</p></main>
  <main v-else-if="startupError" class="startup"><img :src="pet" alt="班班"><h1>先把本地数据找回来。</h1><p role="alert">{{ startupError }}</p><TButton class="button entry" @click="boot">重新尝试</TButton><p class="muted">没有建立空清单替代原数据。</p></main>
  <main v-else-if="store.workspace?.needsSetup" class="startup onboarding">
    <img :src="pet" alt="班班"><h1>先给班班一个工作目录。</h1><p>事项、配置和运行资料，都放在你选的位置。<br>先记一条小事，之后再慢慢安排。</p>
    <div class="root-choice"><strong>{{ store.workspace.pendingRoot?'上次尚未完成的目录':'默认保存位置' }}</strong><code>{{ store.workspace.pendingRoot||store.workspace.defaultRoot }}</code></div>
    <div class="startup-actions"><TButton class="button entry" :loading="initializing" :disabled="initializing" @click="initialize(store.workspace.pendingRoot)">{{ store.workspace.pendingRoot?'继续初始化':'使用默认位置' }}<Icon name="arrow"/></TButton><TButton class="button ghost" :disabled="initializing" @click="chooseDirectory"><Icon name="folder"/>选择文件夹</TButton></div>
    <p v-if="setupError" class="form-error" role="alert">{{ setupError }}</p><p class="muted">自选目录请使用空文件夹，或已由跟班建立的工作目录。</p>
  </main>
  <div v-else class="workbench">
    <aside class="sidebar" aria-label="主导航"><button class="identity" aria-label="跟班 Sidekick，打开今日工作台" @click="page='today'"><img :src="mark" alt=""><span>sidekick<small>盯着呢，老板。</small></span></button>
      <nav><button class="nav-item" :class="{active:page==='today'}" :aria-current="page==='today'?'page':undefined" title="今日工作台" @click="page='today'"><Icon name="today"/><span>今日工作台</span><small class="nav-short">今日</small></button><button class="nav-item" :class="{active:page==='inbox'}" :aria-current="page==='inbox'?'page':undefined" title="待确认" @click="page='inbox'"><Icon name="inbox"/><span>待确认</span><small class="nav-short">确认</small><b v-if="organizer.pending">{{ organizer.pending }}</b></button><button class="nav-item" :class="{active:page==='all'}" :aria-current="page==='all'?'page':undefined" title="全部事项" @click="page='all'"><Icon name="list"/><span>全部事项</span><small class="nav-short">事项</small><b>{{ active.length }}</b></button></nav>
      <div class="sidebar-bottom"><button class="nav-item profile" :class="{active:page==='settings'}" :aria-label="`个人信息与设置，${profileName}`" :aria-current="page==='settings'?'page':undefined" title="个人信息与设置" @click="openSettings"><span class="avatar" aria-hidden="true">{{ Array.from(profileName)[0] }}</span><span class="profile-copy"><strong>{{ profileName }}</strong><small>个人信息与设置</small></span></button></div>
    </aside>
    <section class="workspace">
      <header class="toolbar"><span>{{ page==='today'?'今日工作台':page==='inbox'?'待确认':page==='all'?'全部事项':'设置' }}</span><div class="toolbar-actions"><button class="icon-button" aria-label="刷新清单" :disabled="store.loading" @click="refresh"><Icon name="refresh"/></button><TButton id="quick-entry" class="button entry" :disabled="store.saving" @click="capture()"><Icon name="plus"/>快速录入<kbd>⌘ K</kbd></TButton></div></header>
      <div v-if="store.error" class="inline-error" role="alert">{{ store.error }} <button class="text-button" @click="refresh">重新刷新</button></div>
      <div class="view" :aria-busy="page==='inbox'?organizer.loading:store.loading">
        <template v-if="page==='today'"><div class="page-intro"><h1>今天，先盯住这些事。</h1><p>{{ new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date(now)) }} · 执行的事和跟进的事，分别记清楚。</p></div>
          <div class="today-grid"><div class="work-list">
            <section class="task-section"><div class="section-heading"><h2>待我处理</h2><span class="count">{{ today.action.length }} 项</span></div><ul class="task-list"><TodoRow v-for="todo in today.action" :key="todo.id" :todo="todo" :busy="store.saving" :now="now" @detail="detail" @toggle="toggle"/></ul><p v-if="!today.action.length" class="section-empty">今天还没有需要到点处理的事项。</p></section>
            <section class="task-section"><div class="section-heading"><h2>待我跟进</h2><span class="count">{{ today.followup.length }} 项</span></div><ul class="task-list"><TodoRow v-for="todo in today.followup" :key="todo.id" :todo="todo" :busy="store.saving" :now="now" @detail="detail" @toggle="toggle"/></ul><p v-if="!today.followup.length" class="section-empty">今天没有安排跟进；有新事就先记下来。</p></section>
            <div v-if="undated" class="undated-note"><Icon name="clock"/><div><strong>还有 {{ undated }} 项未定期。</strong><p>没有时间的事，也替你留着了。</p></div><button class="text-button" @click="showUndated">去看看<Icon name="arrow"/></button></div>
            <div v-if="!active.length" class="first-task"><img :src="pet" alt="班班"><h2>先记下一件事。</h2><p>自己要做的，或需要盯着别人交付的，都可以。</p><TButton class="button entry" @click="capture()">记录第一条<Icon name="plus"/></TButton><button class="text-button empty-text-entry" @click="captureText">或者，整理一段原文<Icon name="arrow"/></button></div>
          </div><aside class="brief-rail" aria-label="班班简报"><h2><img :src="mark" alt="">班班简报</h2><div class="brief-message"><h3>{{ active.length?`${address}，事项都记着呢。`:`${address}，随时交给我。` }}</h3><p>{{ active.length?`目前还有 ${active.length} 项待闭环。先看时间，再看谁来处理。`:'先从一件小事开始，把靠记忆盯着的工作留下来。' }}</p><img class="brief-pet" :src="pet" alt="班班"></div><div class="rail-facts"><p><span>待我处理</span><strong>{{ active.filter(t=>t.data.kind==='action').length }}</strong></p><p><span>待我跟进</span><strong>{{ active.filter(t=>t.data.kind==='followup').length }}</strong></p><p><span>交付已逾期</span><strong :class="{danger:overdue}">{{ overdue }}</strong></p></div><p class="muted rail-note">依据已保存的本地事项统计。截止与下次跟进时间分别保留。</p></aside></div>
        </template>
        <InboxView v-else-if="page==='inbox'" @capture="captureText" @models="openModels" @signed="signed"/>
        <template v-else-if="page==='all'"><div class="page-intro"><h1>每件事，都有个着落。</h1><p>按执行、跟进或时间筛选；已完成和未定期的事项也在这里。</p></div>
          <div class="filter-bar"><label class="search-field"><Icon name="search"/><input v-model="filters.query" aria-label="搜索事项标题" placeholder="搜索事项标题"><button v-if="filters.query" class="icon-button small" aria-label="清除搜索" @click="filters.query=''"><Icon name="close"/></button></label>
            <select v-model="filters.kind" aria-label="事项类型筛选"><option value="all">所有类型</option><option value="action">待我处理</option><option value="followup">待我跟进</option></select><select v-model="filters.status" aria-label="状态筛选"><option value="all">全部状态</option><option value="open">未完成</option><option value="completed">已完成</option><option value="deleted">已删除</option></select><select v-model="filters.date" aria-label="时间筛选"><option value="all">所有时间</option><option value="today">今天及之前</option><option value="week">本周</option><option value="overdue">已逾期</option><option value="undated">未定期</option></select><select v-model="filters.owner" aria-label="负责人筛选"><option value="">所有负责人</option><option v-for="owner in owners" :key="owner">{{ owner }}</option></select><select v-model="filters.tag" aria-label="标签筛选"><option value="">所有标签</option><option v-for="tag in tags" :key="tag">{{ tag }}</option></select>
          </div><div class="results-heading"><span>{{ results.length }} 项事项</span><button class="text-button" @click="Object.assign(filters,{kind:'all',status:'all',date:'all',owner:'',tag:'',query:''})">清除筛选</button></div><ul class="task-list"><TodoRow v-for="todo in results" :key="todo.id" :todo="todo" :busy="store.saving" :now="now" @detail="detail" @toggle="toggle"/></ul>
          <div v-if="!results.length" class="empty-state"><img :src="pet" alt="班班"><h2>这里暂时没有事项。</h2><p>换个筛选条件，或者先记录一条。</p><TButton class="button entry" @click="capture()">记录一条</TButton></div>
        </template>
        <SettingsPanel v-else :tab="settingsTab" :root="store.workspace?.root||''" @select-tab="settingsTab=$event" @open-directory="openDirectory"/>
      </div>
    </section>
  </div>
  <dialog ref="formDialog" class="dialog capture-dialog" aria-labelledby="capture-heading" @cancel.prevent="close(formDialog)"><header class="dialog-header"><h2 id="capture-heading">{{ editing?'把这件事改清楚。':captureMode==='text'?'让班班先整理一遍。':'交给班班，先记下来。' }}</h2><button class="icon-button" aria-label="关闭录入" :disabled="store.saving||organizer.starting" @click="close(formDialog)"><Icon name="close"/></button></header>
    <div v-if="!editing" class="capture-tabs" role="tablist" aria-label="录入方式"><button role="tab" :aria-selected="captureMode==='manual'" :disabled="store.saving||organizer.starting" @click="captureMode='manual'">手工录入</button><button role="tab" :aria-selected="captureMode==='text'" :disabled="store.saving||organizer.starting" @click="captureMode='text'">文本智能整理</button></div>
    <TextIntake v-if="captureMode==='text'&&!editing" @submitted="sourceSubmitted" @models="openModels"/>
    <form v-else @submit.prevent="save"><div class="dialog-body"><div class="form-grid"><label class="field full">事项标题<input v-model="form.title" required maxlength="200" autofocus placeholder="要做什么，或需要盯住什么？"></label><label class="field">事项类型<select v-model="form.kind" @change="kindChanged"><option value="action">待我处理</option><option value="followup">待我跟进</option></select></label><label class="field">{{ form.kind==='followup'?'对方负责人':'实际负责人' }}<input v-model="form.owner" required maxlength="100" :placeholder="form.kind==='followup'?'由谁实际交付？':'我'"></label><TimeField :state="form.due" label="交付截止"/><TimeField v-if="form.kind==='followup'" :state="form.followup" label="下次跟进"/><label class="field">优先级<select v-model="form.priority"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label class="field">标签<input v-model="form.tags" placeholder="用逗号分隔"></label>

    </div><p class="muted time-note">按 {{ currentZone() }} 录入。交付截止与下次跟进可以不同；无时间的事项保留为未定期。</p><p v-if="formError" class="form-error" role="alert">{{ formError }}</p></div><footer class="dialog-footer"><span class="muted">手工记录直接保存到本机。</span><TButton class="button primary" type="submit" :loading="store.saving" :disabled="store.saving"><Icon name="check"/>{{ store.saving?'正在保存':'保存事项' }}</TButton></footer></form>
  </dialog>
  <dialog ref="detailDialog" class="dialog detail-dialog" aria-labelledby="detail-heading" @cancel.prevent="close(detailDialog)"><template v-if="selected"><header class="dialog-header"><h2 id="detail-heading">事项详情</h2><button class="icon-button" aria-label="关闭详情" @click="close(detailDialog)"><Icon name="close"/></button></header><div class="dialog-body"><span class="pill">{{ selected.status==='completed'?'已完成':selected.status==='deleted'?'已删除':selected.data.kind==='action'?'待我处理':'待我跟进' }}</span><h3 class="detail-title">{{ selected.data.title }}</h3><dl class="detail-fields"><dt>实际负责人</dt><dd>{{ selected.data.owner }}</dd><dt>交付截止</dt><dd>{{ selected.data.due?displayPoint(selected.data.due):'未设置' }}<small v-if="selected.data.due">原录入时区 {{ selected.data.due.timeZone }}</small></dd><dt v-if="selected.data.kind==='followup'">下次跟进</dt><dd v-if="selected.data.kind==='followup'">{{ selected.data.followup?displayPoint(selected.data.followup):'未设置' }}<small v-if="selected.data.followup">原录入时区 {{ selected.data.followup.timeZone }}</small></dd><dt>优先级</dt><dd>{{ {low:'低',medium:'中',high:'高'}[selected.data.priority] }}</dd><dt>标签</dt><dd>{{ selected.data.tags.join('、')||'未设置' }}</dd></dl>
    <section v-if="sourceLinks.length" class="detail-sources" aria-label="事项来源"><h3>事项来源</h3><div v-for="(link,index) in sourceLinks" :key="`${link.sourceId}-${index}`"><blockquote>{{ link.evidence }}</blockquote><button class="text-button" @click="viewSource(link.sourceId)">查看原文<Icon name="arrow"/></button></div></section>
    <h3 class="history-heading">本地活动历史</h3><p v-if="historyBusy" class="muted">正在读取历史…</p><p v-else-if="historyError" class="form-error" role="alert">{{ historyError }}</p><ol v-else class="history"><li v-for="event in events" :key="event.operationId"><span>{{ actionNames[event.action]||event.action }}</span><time>{{ displayTime(event.occurredAtMs) }}</time></li></ol></div><footer v-if="selected.status!=='deleted'" class="dialog-footer"><button class="text-button danger" :disabled="store.saving" @click="askDelete(selected)"><Icon name="trash"/>删除事项</button><div class="footer-actions"><TButton class="button ghost" :disabled="store.saving" @click="capture(selected)"><Icon name="edit"/>编辑／延期</TButton><TButton class="button primary" :disabled="store.saving" @click="toggle(selected)">{{ selected.status==='completed'?'重新打开':'标记完成' }}<Icon name="check"/></TButton></div></footer></template></dialog>
  <dialog ref="deleteDialog" class="dialog confirm-dialog" aria-labelledby="delete-heading" @cancel.prevent="close(deleteDialog)"><header class="dialog-header"><h2 id="delete-heading">删除这条事项？</h2></header><div class="dialog-body"><p>{{ deleteTarget?.data.title }}</p><p class="muted">从普通清单移除，本地历史仍保留。</p></div><footer class="dialog-footer"><TButton class="button ghost" :disabled="store.saving" @click="close(deleteDialog)">取消</TButton><TButton class="button destructive" :disabled="store.saving" :loading="store.saving" @click="remove">确认删除</TButton></footer></dialog>
  <div v-if="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div>
</template>
