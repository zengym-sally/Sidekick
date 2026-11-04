import {ref} from 'vue';

export function desktopSurface(search:string):'main'|'pet'|'quick'|'probe'{
 const query=new URLSearchParams(search);
 if(['probe','pet','quick'].some(key=>query.has(key)))return 'probe';
 const surface=query.get('window');return surface==='pet'||surface==='quick'?surface:'main';
}
export function isLocalCaptureShortcut(event:Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'shiftKey'|'altKey'|'isComposing'>){
 return event.metaKey!==event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.isComposing&&event.key.toLowerCase()==='k';
}
export function observeWorkspaceChanges(subscribe:(changed:()=>void)=>Promise<()=>void>,initial:()=>Promise<void>,read:()=>Promise<void>){
 let alive=true,unlisten:(()=>void)|undefined;
 const connected=ref(false);
 async function refresh(){if(alive)await read();}
 const ready=(async()=>{
  try{const stop=await subscribe(()=>{void refresh().catch(()=>{});});if(!alive){stop();return;}unlisten=stop;connected.value=true;}catch{}
  if(alive)await initial();
 })();
 function stop(){alive=false;unlisten?.();unlisten=undefined;}
 return {ready,connected,refresh,stop};
}
