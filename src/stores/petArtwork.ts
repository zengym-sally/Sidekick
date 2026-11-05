import idle from '../assets/brand/banban-idle.svg?raw';
import found from '../assets/brand/banban-found.svg?raw';
import remind from '../assets/brand/banban-remind.svg?raw';
import done from '../assets/brand/banban-done.svg?raw';
import type {PetPose} from '../domain/pet';

export const petArtwork:Record<PetPose,string>={idle,found,remind,done};
const masks=new Map<PetPose,Promise<number[]>>();
export function petMask(pose:PetPose):Promise<number[]>{
 const cached=masks.get(pose);if(cached)return cached;
 const task=new Promise<number[]>((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>{
   try{
    const canvas=document.createElement('canvas');canvas.width=112;canvas.height=112;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('班班轮廓暂不可确认。');
    context.drawImage(image,0,0,112,112);const pixels=context.getImageData(0,0,112,112).data;
    resolve(Array.from({length:112*112},(_,index)=>pixels[index*4+3]!>16?1:0));
   }catch(error){reject(error);}
  };
  image.onerror=()=>reject(Error('班班图案暂不可读取。'));
  image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(petArtwork[pose])}`;
 });
 masks.set(pose,task);void task.catch(()=>masks.delete(pose));return task;
}
