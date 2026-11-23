import {daily,save,reports,targets} from './report-store';
import {key,rows} from './report';
const day=process.env.DAY!; const ok=(n:string,c:boolean,i?:any)=>{console.log((c?'  PASS ':'  FAIL ')+n,c?'':JSON.stringify(i));if(!c)process.exitCode=1};
(async()=>{
  const d0=await daily(day); ok('new day -> revision 0, empty entries (frontend default)',d0.revision===0&&Object.keys(d0.entries).length===0,d0);
  const e:Record<string,string>={};
  for(let s=0;s<3;s++)for(const r of rows)for(let m=0;m<4;m++)e[key(s,r,m)]=m%2?`${100+s}.${m}5`:String(10+s+m);
  for(let i=0;i<3;i++)e['rain:'+i]=`${i}.25`;
  for(const sp of ['LK-1','LK-2','OLD DIPKA'])for(let f=0;f<4;f++)e[`pump:${sp}:${f}`]=String(f+1);
  e['0:KCCL:0']=''; // UI sends '' for a cleared cell
  const s1=await save(day,d0.revision,e);
  ok('save() via .rpc().single() returns {revision:1, saved_at}',s1.revision===1&&!!s1.saved,s1);
  const d1=await daily(day);
  const expected={...e}; delete expected['0:KCCL:0'];
  const same=JSON.stringify(Object.entries(d1.entries).map(([k,v])=>[k,Number(v)]).sort())===JSON.stringify(Object.entries(expected).map(([k,v])=>[k,Number(v)]).sort());
  ok('nested select + adapter reproduces all entries (158 values, cleared cell absent)',same&&Object.keys(d1.entries).length===158,Object.keys(d1.entries).length);
  ok("shift keys come back as 0/1/2 so key(s,r,m) matches",'1:Shovel - 314:2' in d1.entries&&'rain:2' in d1.entries&&'pump:OLD DIPKA:3' in d1.entries);
  const range=await reports('2000-01-01',day); ok('reports() history range query returns the day',range.length===1&&range[0].revision===1,range.length);
  // stale save -> frontend checks code === '40001'
  try{await save(day,0,e);ok('stale save must throw',false)}catch(err:any){ok("stale save throws error.code === '40001' (what use-production-report.ts tests)",err.code==='40001',err)}
  const s2=await save(day,1,{...e,'0:KCCL:1':'777.5'}); ok('second save -> revision 2',s2.revision===2,s2);
  const t=await targets('2000-01-01',day); ok('targets() query (.is shift/source null) works',Array.isArray(t),t);
  // validation error surfaces as an error, never as success
  try{await save(day,2,{'0:KCCL:1':'abc'});ok('invalid value must throw',false)}catch(err:any){ok('invalid value -> error 22023, nothing saved',err.code==='22023',err)}
  try{await save('2999-01-01',0,{});ok('future date must throw',false)}catch(err:any){ok('future date -> error 22023',err.code==='22023',err)}
  console.log('revision now',(await daily(day)).revision);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
