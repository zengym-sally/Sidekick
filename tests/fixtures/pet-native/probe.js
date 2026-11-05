const invoke=(command,args={})=>window.__TAURI_INTERNALS__.invoke(command,args);
const pet=document.getElementById('pet'),image=pet.querySelector('img');
if(location.search.includes('underlay')){
 document.body.classList.add('underlay');
 let count=0;
 document.addEventListener('pointerdown',event=>{if(event.target.closest('button,select'))return;document.getElementById('clicks').textContent=String(++count);void invoke('probe_note',{event:'underlay-click'});});
 document.getElementById('show').addEventListener('click',()=>void invoke('probe_action',{action:'show'}));
 document.getElementById('quit').addEventListener('click',()=>void invoke('probe_action',{action:'quit'}));
 document.getElementById('hit').addEventListener('click',()=>void invoke('probe_action',{action:'hit'}).then(()=>{document.getElementById('status').textContent='透明命中已开启，可点击透明区检查下层计数。';}));
 document.getElementById('cancel-next').addEventListener('click',()=>void invoke('probe_action',{action:'arm-cancel'}).then(()=>{document.getElementById('status').textContent='下次按住拖动时，班班会自动隐藏。';}));
 document.getElementById('pose').addEventListener('change',event=>void invoke('probe_action',{action:`pose-${event.target.value}`}));
}else{
 let pose='idle';
 window.probeView=(left,top)=>{pet.style.left=`${left}px`;pet.style.top=`${top}px`;};
 window.probePose=next=>{pose=next;image.src=next==='idle'?'/banban.svg':`/banban-${next}.svg`;};
 pet.addEventListener('pointerdown',event=>{if(event.button===0){event.preventDefault();void invoke('probe_action',{action:'drag',input:{buttons:event.buttons,clientX:event.clientX,clientY:event.clientY,sentAtMs:Date.now(),trusted:event.isTrusted}});}});
 pet.addEventListener('contextmenu',event=>{event.preventDefault();void invoke('probe_action',{action:'menu'});});
 pet.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();void invoke('probe_action',{action:'menu'});}else if(event.key==='h'){void invoke('probe_action',{action:'hit'});}});
 const ready=async()=>{
  const canvas=document.createElement('canvas');canvas.width=112;canvas.height=112;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,112,112);
  const pixels=context.getImageData(0,0,112,112).data;
  await invoke('probe_mask',{mask:Array.from({length:112*112},(_,index)=>pixels[index*4+3]>16?1:0),pose});
 };
 image.addEventListener('load',()=>void ready());if(image.complete&&image.naturalWidth)void ready();
}
