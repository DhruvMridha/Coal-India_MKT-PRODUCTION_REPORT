import {createBrowserClient} from '@supabase/ssr';
import {key,type Entries} from './report';

export const isSupabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
let browserClient: ReturnType<typeof createBrowserClient> | undefined;
export const db = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase client configuration is missing.');
  browserClient ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  return browserClient;
};
const projection='day,revision,saved_at,mtk_shifts(shift,rainfall,mtk_production(source,coal_trips,coal_qty,ob_trips,ob_qty)),mtk_pumps(sump,installed,running,initial,final)';
export async function reports(start:string,end:string){const result=[];for(let offset=0;;offset+=100){const {data,error}=await db().from('mtk_reports').select(projection).gte('day',start).lte('day',end).order('day').range(offset,offset+99);if(error)throw error;for(const r of data){const entries:Entries={};const put=(k:string,v:unknown)=>{if(v!=null)entries[k]=String(v)};for(const s of r.mtk_shifts){put('rain:'+s.shift,s.rainfall);for(const p of s.mtk_production)[p.coal_trips,p.coal_qty,p.ob_trips,p.ob_qty].forEach((v,i)=>put(key(s.shift,p.source,i),v))}for(const p of r.mtk_pumps)[p.installed,p.running,p.initial,p.final].forEach((v,i)=>put('pump:'+p.sump+':'+i,v));result.push({day:String(r.day),revision:Number(r.revision),saved:String(r.saved_at),entries})}if(data.length<100)return result}}
export async function daily(day:string){return (await reports(day,day))[0]??{day,revision:0,saved:'',entries:{} as Entries}}
export async function save(day:string,revision:number,entries:Entries){const {data,error}=await db().rpc('mtk_save',{p_day:day,p_revision:revision,p_entries:entries}).single();if(error)throw error;const saved=data as {revision:number;saved_at:string}|null;if(!saved)throw new Error('The save procedure returned no confirmation.');return {day,entries,revision:saved.revision,saved:saved.saved_at}}
export async function targets(start:string,end:string){const list=[];for(let i=0;;i+=100){const {data,error}=await db().from('mtk_targets').select('day,coal_qty,ob_qty').gte('day',start).lte('day',end).is('shift',null).is('source',null).order('day').range(i,i+99);if(error)throw error;list.push(...data);if(data.length<100)return list}}

export async function saveTarget(day:string,coalQty:number|null,obQty:number|null){
  const payload={day,coal_qty:coalQty,ob_qty:obQty,shift:null,source:null};
  const {data:existing,error:findError}=await db().from('mtk_targets').select('id').eq('day',day).is('shift',null).is('source',null).maybeSingle();
  if(findError)throw findError;
  if(existing){
    const {error}=await db().from('mtk_targets').update(payload).eq('id',existing.id);
    if(error)throw error;
  }else{
    const {error}=await db().from('mtk_targets').insert(payload);
    if(error)throw error;
  }
}
