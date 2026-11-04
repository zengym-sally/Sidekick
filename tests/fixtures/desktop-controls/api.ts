let saved={version:1,workMode:false,petOnStartup:false};
export const calls:{command:string;input?:unknown}[]=[];
export const disabledUpdates:{label:string;value:boolean}[]=[];
export const snapshot=()=>structuredClone(saved);
export async function invoke(command:string,args?:Record<string,unknown>){
 if(command==='read_desktop_preferences')return snapshot();
 if(command==='save_desktop_preferences'){
  const input=args?.input as {expected:typeof saved;preferences:typeof saved};
  if(JSON.stringify(input.expected)!==JSON.stringify(saved))throw {code:'DESKTOP_CONFLICT',message:'合成配置冲突'};
  calls.push({command,input:structuredClone(input)});saved=structuredClone(input.preferences);return {preferences:snapshot(),warning:null};
 }
 throw Error('Unsupported synthetic desktop command');
}
export async function listen(){return ()=>{};}
