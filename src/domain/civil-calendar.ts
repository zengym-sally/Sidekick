const pad=(value:number)=>String(value).padStart(2,'0');
export function civilDay(at:number):string {const d=new Date(at);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;}
export function calendarCells(month:string):string[]{const [y,m]=month.split('-').map(Number),first=Date.UTC(y,m-1,1),start=first-((new Date(first).getUTCDay()+6)%7)*86400000;return Array.from({length:42},(_,i)=>civilDay(start+i*86400000));}
export function shiftMonth(month:string,delta:number):string {const [y,m]=month.split('-').map(Number);return civilDay(Date.UTC(y,m-1+delta,1)).slice(0,7);}
