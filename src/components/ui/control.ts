import {computed,inject,onMounted,onUpdated,ref,watchPostEffect,type ComputedRef,type InjectionKey,type Ref} from 'vue';
export const fieldKey:InjectionKey<{id:string;description:ComputedRef<string|undefined>;invalid:ComputedRef<boolean>;required:ComputedRef<boolean>}> = Symbol('field');
export const disabledKey:InjectionKey<ComputedRef<boolean>> = Symbol('disabled');
export function useDisabled(props:{disabled?:boolean}){const parent=inject(disabledKey,computed(()=>false));return computed(()=>props.disabled||parent.value);}
export function useControl(attrs:Record<string,unknown>,selector='input'){
 const root=ref<HTMLElement>(),field=inject(fieldKey,null);
 function sync(){const el=root.value?.querySelector<HTMLElement>(selector);if(!el)return;const values:Record<string,unknown>={id:attrs.id||field?.id,'aria-describedby':attrs['aria-describedby']||field?.description.value,'aria-invalid':attrs['aria-invalid']||field?.invalid.value||undefined,'aria-label':attrs['aria-label'],name:attrs.name,required:attrs.required||field?.required.value};for(const [key,value] of Object.entries(values)){if(value!==undefined&&value!==false)el.setAttribute(key,String(value===true&&key==='required'?'':value));else el.removeAttribute(key);}}
 onMounted(sync);onUpdated(sync);watchPostEffect(sync);return {root,field};
}
export type SelectOption={value:string|number;label:string;description?:string;disabled?:boolean;group?:string};
