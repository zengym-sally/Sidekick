const formatters=new Map();
const pad=n=>String(n).padStart(2,'0');
function parts(at,zone){
  let formatter=formatters.get(zone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(zone,formatter);}
  return Object.fromEntries(formatter.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
export function calendarDate(at,zone){const p=parts(at,zone);return `${p.year}-${pad(p.month)}-${pad(p.day)}`;}
export function zonedCandidates(raw,zone){
  const match=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw);if(!match)return [];
  const [year,month,day,hour,minute]=match.slice(1).map(Number);if(year<100||hour>23||minute>59)return [];
  const naive=Date.UTC(year,month-1,day,hour,minute);const offsets=new Set();
  for(const h of [-48,-24,0,24,48]){const at=naive+h*3600000,p=parts(at,zone);offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-at);}
  return [...offsets].map(offset=>naive-offset).filter(at=>{const p=parts(at,zone);return p.year===year&&p.month===month&&p.day===day&&p.hour===hour&&p.minute===minute;}).sort((a,b)=>a-b);
}
export function dayCoordinate(date,zone){
  for(let h=0;h<24;h++){const candidates=zonedCandidates(`${date}T${pad(h)}:00`,zone);if(candidates.length)return candidates[0];}
  return null;
}
export function nextCalendarDate(date){const [y,m,d]=date.split('-').map(Number);const next=new Date(Date.UTC(y,m-1,d+1));return `${next.getUTCFullYear()}-${pad(next.getUTCMonth()+1)}-${pad(next.getUTCDate())}`;}
export function dayEnd(at,zone){let date=calendarDate(at,zone);for(let n=0;n<4;n++){date=nextCalendarDate(date);const next=dayCoordinate(date,zone);if(next!==null)return next;}return null;}
function civilDate(y,m,d){const at=new Date(Date.UTC(y,m-1,d));if(at.getUTCFullYear()!==y||at.getUTCMonth()!==m-1||at.getUTCDate()!==d)return null;return `${y}-${pad(m)}-${pad(d)}`;}
const weekday={'一':0,'二':1,'三':2,'四':3,'五':4,'六':5,'日':6,'天':6,'1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6};
export function resolveExpression(expression,anchor,zone){
  if(expression===null||expression===undefined||expression==='')return {point:null,warnings:[],unresolved:false};
  const raw=String(expression).trim();
  const unresolved=()=>({point:null,warnings:['原文日期存在多个选择、区间或不明确表达，请人工核对。'],unresolved:true});
  const dates=raw.match(/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}(?:日|号)?|\d{1,2}[月/]\d{1,2}(?:日|号)?|(?:下周|下星期|本周|本星期|周|星期)[一二三四五六日天1-7]|后天|明天|次日|今天|今日|当天/g)||[];
  const clocks=raw.match(/\d{1,2}(?::|点|时)(?:\d{1,2}分?|半)?/g)||[];
  if(/或|每|隔周|前后|左右|大概|大约|约|之后|以后|过后|\bor\b/i.test(raw)||dates.length>1||clocks.length>1)return unresolved();
  const p=parts(anchor,zone);let date=null;const warnings=[];
  const explicit=/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})(?:日|号)?/.exec(raw);
  const short=/(\d{1,2})[月/](\d{1,2})(?:日|号)?/.exec(raw);
  const week=/(下周|下星期|本周|本星期|周|星期)([一二三四五六日天1-7])/.exec(raw);
  const base=Date.UTC(p.year,p.month-1,p.day);
  const shifted=days=>{const d=new Date(base+days*86400000);return civilDate(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());};
  if(explicit)date=civilDate(Number(explicit[1]),Number(explicit[2]),Number(explicit[3]));
  else if(week){const current=(new Date(base).getUTCDay()+6)%7;const target=weekday[week[2]];date=shifted(week[1].startsWith('下')?7-current+target:week[1].startsWith('本')?target-current:(target-current+7)%7);}
  else if(/后天/.test(raw))date=shifted(2);
  else if(/明天|次日/.test(raw))date=shifted(1);
  else if(/今天|今日|当天/.test(raw))date=shifted(0);
  else if(short){date=civilDate(p.year+(/明年/.test(raw)?1:0),Number(short[1]),Number(short[2]));warnings.push('未注明完整年份时按来源年份理解。');}
  const clock=/(\d{1,2})(?::|点|时)(?:(\d{1,2})分?|半)?/.exec(raw);
  if(!date&&clock&&!explicit&&!short&&!week){if(/[天周月年日后]/.test(raw))return unresolved();date=shifted(0);warnings.push('原文只有时刻，按锚点当天理解。');}
  if(!date)return {point:null,warnings:['无法确定日期，请补充或明确保留未定期。'],unresolved:true};
  const dateToken=explicit?.[0]||week?.[0]||(/后天|明天|次日|今天|今日|当天/.exec(raw)?.[0])||short?.[0];
  let remainder=raw;if(dateToken)remainder=remainder.replace(dateToken,'');if(clock)remainder=remainder.replace(clock[0],'');
  if(short&&!explicit)remainder=remainder.replace(/明年|今年/g,'');
  remainder=remainder.replace(/上午|下午|晚上|中午|凌晨|早上|截至|截止|之前|为止|交付|提交|完成|跟进|提醒|整|在|于|到|前|[T\s，,。;；（）()]/g,'');
  if(remainder)return unresolved();
  if(!clock){
    const at=dayCoordinate(date,zone);if(at===null)return {point:null,warnings:['这个日期在来源时区不存在，请核对。'],unresolved:true};
    const period=/上午|下午|晚上|中午|凌晨|早上/.test(raw);
    return {point:{atMs:at,timeZone:zone,localText:raw,precision:'day'},warnings:[...warnings,...(period?['原文只有时段，未补造具体时刻，请核对。']:[])],unresolved:period};
  }
  if(/晚上|上午/.test(raw)&&Number(clock[1])===12)return unresolved();
  let hour=Number(clock[1]),minute=clock[2]?Number(clock[2]):clock[0].endsWith('半')?30:0;
  if(/下午|晚上|中午/.test(raw)&&hour<12)hour+=12;
  if(/凌晨/.test(raw)&&hour===12)hour=0;
  const candidates=zonedCandidates(`${date}T${pad(hour)}:${pad(minute)}`,zone);
  if(candidates.length!==1)return {point:null,warnings:[candidates.length?'该时刻在来源时区出现两次，请选择明确偏移。':'该日期或时刻不存在，请核对。'],unresolved:true};
  return {point:{atMs:candidates[0],timeZone:zone,localText:raw},warnings,unresolved:false};
}
