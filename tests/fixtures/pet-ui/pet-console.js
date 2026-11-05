import {invoke} from '@tauri-apps/api/core';
let clicks=0,busy=false;
document.addEventListener('click',event=>{if(event.target.closest('button,input,select,a,textarea'))return;document.querySelector('#clicks').textContent=String(++clicks);void invoke('pet_ui_action',{action:'underlay_click'}).catch(()=>{});});
document.querySelector('#actions').addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button||busy)return;busy=true;
 document.querySelector('#error').textContent='';
 try{const state=await invoke('pet_ui_action',{action:button.dataset.action});document.querySelector('#state').textContent=JSON.stringify(state,null,2);document.querySelector('#policy').textContent=state.policy?`客户端：${state.policy.clientReady?'已连接':'未就绪'}；页面：${state.policy.pageVisible?'可见':'不可见'}；减少动态效果：${state.policy.reducedMotion?'开启':'关闭'}；绘制确认：${state.policy.painted?'完成':'等待'}；键盘焦点：${state.policy.keyboardFocused?'有':'无'}`:'';}
 catch(error){document.querySelector('#error').textContent=error?.message||String(error);}
 finally{busy=false;}
});
