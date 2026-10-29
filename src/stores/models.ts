import { computed,reactive,ref } from 'vue';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './todos.ts';
import type { ModelConfiguration,ProviderDocument,ModelDocument,Provider,ModelDefinition } from '../domain/organizer.ts';
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export function createModelSettings(api:Backend){
  const configuration=ref<ModelConfiguration|null>(null),ready=ref(false),loading=ref(false),saving=ref(false),error=ref(''),notice=ref('');
  const basic=reactive({name:'我的模型服务',url:'',apiModelId:'',selected:'',apiKey:''});
  const providerJson=ref(''),modelJson=ref(''),importDefault=ref('');let generation=0;let loaded=false;
  const baselineJson=ref('');
  const jsonSignature=()=>JSON.stringify([providerJson.value,modelJson.value,importDefault.value]);
  const basicSignature=()=>JSON.stringify([basic.name,basic.url,basic.apiModelId,basic.selected,basic.apiKey]);
  const baselineBasic=ref(basicSignature());
  const signature=()=>JSON.stringify([basic.name,basic.url,basic.apiModelId,basic.selected,basic.apiKey,jsonSignature()]);
  const dirty=computed(()=>{const config=configuration.value;if(!config)return true;const m=config.models.models.find(m=>m.id===config.defaultModelId),p=config.providers.providers.find(p=>p.id===m?.providerId);return jsonSignature()!==baselineJson.value||!!basic.apiKey||basic.selected!==config.defaultModelId||basic.url!==(p?.baseUrl||'')||basic.apiModelId!==(m?.apiModelId||'')||basic.name!==(p?.name||'我的模型服务');});
  function select(id:string){basic.selected=id;basic.apiKey='';const model=configuration.value?.models.models.find(m=>m.id===id);const provider=configuration.value?.providers.providers.find(p=>p.id===model?.providerId);basic.name=provider?.name||'我的模型服务';basic.url=provider?.baseUrl||'';basic.apiModelId=model?.apiModelId||'';}
  function resetJson(){const value=configuration.value;providerJson.value=value?JSON.stringify(value.providers,null,2):'{"providers":[]}';modelJson.value=value?JSON.stringify(value.models,null,2):'{"models":[]}';importDefault.value=value?.defaultModelId||'';baselineJson.value=jsonSignature();}
  function resetBasic(){select(configuration.value?.defaultModelId||'');baselineBasic.value=basicSignature();}
  function fill(value:ModelConfiguration|null){configuration.value=value;select(value?.defaultModelId||'');providerJson.value=value?JSON.stringify(value.providers,null,2):'{"providers":[]}';modelJson.value=value?JSON.stringify(value.models,null,2):'{"models":[]}';importDefault.value=value?.defaultModelId||'';baselineJson.value=jsonSignature();baselineBasic.value=basicSignature();}
  async function load(){const request=++generation,start=signature(),clean=!loaded||!dirty.value;loading.value=true;error.value='';try{const value=await api('read_model_configuration') as ModelConfiguration|null;if(request===generation){if(clean&&signature()===start)fill(value);else configuration.value=value;ready.value=true;loaded=true;}}catch(e){if(request===generation){ready.value=false;error.value=errorMessage(e);}}finally{if(request===generation)loading.value=false;}}
  async function save(input:{providers:ProviderDocument;models:ModelDocument;defaultModelId:string;apiKeys:Record<string,string>},mode:'basic'|'import'){if(!ready.value||saving.value)throw new Error('请先读取模型配置。');saving.value=true;error.value='';notice.value='';++generation;const start=signature(),jsonChanged=jsonSignature()!==baselineJson.value,basicChanged=basicSignature()!==baselineBasic.value;const beforeJson=[providerJson.value,modelJson.value,importDefault.value],beforeBasic={...basic};
    try{const value=await api('save_model_configuration',{input}) as {configuration:ModelConfiguration;warning:string|null};if(signature()===start){fill(value.configuration);if(mode==='basic'&&jsonChanged){[providerJson.value,modelJson.value,importDefault.value]=beforeJson;}if(mode==='import'&&basicChanged)Object.assign(basic,beforeBasic);}else configuration.value=value.configuration;notice.value=value.warning||'模型配置已保存，可以测试连接。';return value.configuration;}catch(e){error.value=errorMessage(e);if(e&&typeof e==='object'&&'code' in e&&e.code==='MODEL_CONFIG_UNCERTAIN')ready.value=false;throw e;}finally{saving.value=false;}
  }
  async function saveBasic(){
    const providers:ProviderDocument=configuration.value?JSON.parse(JSON.stringify(configuration.value.providers)):{providers:[]};
    const models:ModelDocument=configuration.value?JSON.parse(JSON.stringify(configuration.value.models)):{models:[]};
    let model=models.models.find(m=>m.id===basic.selected);let provider=providers.providers.find(p=>p.id===model?.providerId);
    if(!provider){provider={id:'primary',name:basic.name,apiFormat:'openai-compatible',baseUrl:basic.url,auth:{type:'bearer',apiKeyEnv:'SIDEKICK_API_KEY'},extraHeaders:{},network:{timeoutMs:120000,retry:{maxRetries:2,backoff:'exponential'}},enabled:true};providers.providers.push(provider);}
    provider.name=basic.name;provider.baseUrl=basic.url;
    if(!model){model={id:'default',providerId:provider.id,apiModelId:basic.apiModelId,name:basic.apiModelId,capabilities:{toolCall:true,input:['text'],streaming:true}} as ModelDefinition;models.models.push(model);}
    model.apiModelId=basic.apiModelId;
    return save({providers,models,defaultModelId:model.id,apiKeys:basic.apiKey?{[provider.id]:basic.apiKey}:{}},'basic');
  }
  async function importPair(){try{
    const providers=JSON.parse(providerJson.value) as ProviderDocument,models=JSON.parse(modelJson.value) as ModelDocument;
    if(!Array.isArray(providers.providers)||!Array.isArray(models.models))throw new Error('请提供providers与models两份JSON对象。');
    return await save({providers,models,defaultModelId:importDefault.value,apiKeys:{}},'import');
  }catch(e){error.value=e instanceof SyntaxError?'JSON格式不正确，请检查两份配置。':errorMessage(e);throw e;}}
  return {configuration,ready,loading,saving,error,notice,dirty,resetJson,resetBasic,basic,providerJson,modelJson,importDefault,load,select,saveBasic,importPair};
}
export const useModelSettings=defineStore('models',()=>createModelSettings(invoke));
