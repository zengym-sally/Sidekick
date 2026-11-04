import {ref} from 'vue';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {errorMessage} from './todos.ts';

export type DesktopAction='open_main'|'open_quick'|'show_pet'|'hide_pet'|'hide_quick';
interface DesktopStatus {enabled:boolean;shortcutRegistered:boolean}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export const workspaceEvents=(changed:()=>void)=>listen('todos-changed',changed);
export function createDesktopWindows(api:Backend=invoke){
 const status=ref<DesktopStatus|null>(null),statusError=ref(''),error=ref('');
 let alive=true,statusSequence=0,actionSequence=0;
 async function refreshStatus(){if(!alive)return;const request=++statusSequence;try{const value=await api('read_desktop_status') as DesktopStatus;if(alive&&request===statusSequence){status.value=value;statusError.value='';}}catch(e){if(alive&&request===statusSequence){status.value=null;statusError.value=errorMessage(e);}}}
 async function act(action:DesktopAction){if(!alive)return false;const request=++actionSequence;error.value='';try{await api('desktop_window_action',{action});return true;}catch(e){if(alive&&request===actionSequence)error.value=errorMessage(e);return false;}}
 function dispose(){alive=false;++statusSequence;++actionSequence;}
 return {status,statusError,error,refreshStatus,act,dispose};
}
