import { ref } from 'vue';
import { defineStore } from 'pinia';
import { WebApiClient } from '../lib/web-api-client.ts';
import type { Todo, TodoInput, TodoEvent, WorkspaceInfo } from '../domain/todos.ts';

type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export function errorMessage(error:unknown):string {
  if(error && typeof error==='object' && 'message' in error && typeof error.message==='string')return error.message;
  return '操作暂未完成，请重试。原有事项没有被重置。';
}
export function createTodoModel(api:Backend) {
  const workspace=ref<WorkspaceInfo|null>(null),rows=ref<Todo[]>([]),loading=ref(false),saving=ref(false),error=ref('');
  let generation=0;
  async function refresh(){
    const request=++generation;loading.value=true;
    try {const result=await api('list_todos') as Todo[];if(request!==generation)return;rows.value=result;error.value='';}
    catch(reason){if(request!==generation)return;error.value=errorMessage(reason);throw reason;}
    finally{if(request===generation)loading.value=false;}
  }
  async function boot(){workspace.value=await api('workspace_info') as WorkspaceInfo;if(!workspace.value.needsSetup)await refresh();}
  async function initialize(path:string|null){workspace.value=await api('initialize_workspace',{path,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}) as WorkspaceInfo;await refresh();}
  function applyCommitted(result:Todo[]){++generation;for(const todo of result){const previous=rows.value.find(t=>t.id===todo.id);if(!previous||previous.version<=todo.version)rows.value=[todo,...rows.value.filter(t=>t.id!==todo.id)];}}
  async function mutation(command:string,args:Record<string,unknown>){
    ++generation;loading.value=false;saving.value=true;
    try {
      const result=await api(command,args) as Todo;
      applyCommitted([result]);
      try{await refresh();}catch{error.value='事项已保存，但清单暂时无法刷新。请重试刷新。';}
      return result;
    }
    finally{saving.value=false;}
  }
  return {workspace,rows,loading,saving,error,refresh,boot,initialize,applyCommitted,
    create:(input:TodoInput,operationId:string)=>mutation('create_todo',{input,operationId}),
    update:(todo:Todo,input:TodoInput,operationId:string)=>mutation('update_todo',{id:todo.id,expectedVersion:todo.version,input,operationId}),
    setCompleted:(todo:Todo,completed:boolean,operationId:string)=>mutation('set_todo_completed',{id:todo.id,expectedVersion:todo.version,completed,operationId}),
    deleteTodo:(todo:Todo,operationId:string)=>mutation('delete_todo',{id:todo.id,expectedVersion:todo.version,operationId}),
    history:(id:string)=>api('todo_history',{id}) as Promise<TodoEvent[]>,
    sources:(id:string)=>api('todo_source_links',{id}) as Promise<{sourceId:string;evidence:string;association:string;createdAtMs:number}[]>,
    openDirectory:()=>api('open_workspace_directory'),
  };
}
export const useTodos=defineStore('todos',()=>createTodoModel(new WebApiClient().asBackend()));
