export const contractors=['KCCDECO','KCCL','JARPL','PRTPL'];
export const equipment=['Shovel - 314','Shovel - 229','Shovel - 002','Shovel - 003','PC - 180','PC - 249','PC - 250','Payloader198'];
export const rows=[...contractors,...equipment];
export const metrics=['Coal trips','Coal quantity','OB trips','OB quantity'];
export const shifts=['First Shift','Second Shift','Third Shift'];
export const hours=['06:00 – 14:00','14:00 – 22:00','22:00 – 06:00'];
export const sumps=['LK-1','LK-2','OLD DIPKA'];
export const pumpFields=['Installed','Running','Initial','Final'];
export type Entries=Record<string,string>;
export function key(s:number,r:string,m:number){return `${s}:${r}:${m}`}
export function sum(values:(string|undefined)[]){const numbers=values.filter(v=>v!==undefined&&v!=='');return numbers.length?numbers.reduce((a,v)=>a+Number(v),0):null}
export function total(e:Entries,ss:number[],rs:string[],m:number){return sum(ss.flatMap(s=>rs.map(r=>e[key(s,r,m)])))}
export function display(n:number|null){return n===null?'—':n.toLocaleString('en-IN',{maximumFractionDigits:6})}
export function reportingDay(now=new Date()){return new Date(now.getTime()-30*60000).toISOString().slice(0,10)}
export function dayLabel(date:string){return new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})}
