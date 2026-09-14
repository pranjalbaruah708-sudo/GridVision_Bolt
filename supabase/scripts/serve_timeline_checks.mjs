// Local synthetic UI harness. No credentials or connections to Supabase.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
const root=process.cwd();
const fixture=`
import {useState,useEffect} from 'react';
export const state={online:true,mode:'normal',role:'FIELD_OFFICER',calls:[]};
export function change(key,value){state[key]=value;window.dispatchEvent(new Event('fixture'));}
function refresh(){const [,set]=useState(0);useEffect(()=>{const f=()=>set(n=>n+1);window.addEventListener('fixture',f);return()=>window.removeEventListener('fixture',f);},[]);}
export function useAuth(){refresh();return {user:{id:state.role}};}
export function useApp(){refresh();return {online:state.online,activeStationId:'unrelated',feeders:[{id:'feeder',name:'Test Feeder'}]};}
export function useOnlineStatus(){return {online:state.online,pending:0};}
const station={scope_kind:'STATION',scope_id:'station',label:'Authorized Station With A Long Descriptive Name',office_type:null};
const office={scope_kind:'OFFICE',scope_id:'office',label:'Assigned Division',office_type:'DIVISION'};
const types=['PARAMETER_ENTRY','INTERRUPTION','RESTORATION','ALERT','STATION_CONDITION','DUTY_STARTED','DUTY_ENDED','HANDOVER_SUBMITTED','HANDOVER_ACCEPTED'];
export const operationalApi={
getScopeOptions:async()=>state.role==='OPERATOR'?[station]:[station,office,{scope_kind:'ALL',scope_id:null,label:state.role==='ADMIN'?'Entire Utility':'All authorized stations',office_type:null}],
getTimeline:async(query,limit,offset)=>{
state.calls.push({query,limit,offset});
if(state.mode==='denied')throw {code:'42501'};
if(state.mode==='error')throw new Error('Synthetic failure');
if(state.mode==='empty')return [];
await new Promise(resolve=>setTimeout(resolve,150));
return Array.from({length:offset===0?50:12},(_,i)=>{const n=offset+i-(offset?1:0);return {event_type:types[n%9],source_id:'source-'+n,station_id:'station',feeder_id:'feeder',event_time:new Date(Date.now()-n*60000).toISOString(),title:types[n%9]==='STATION_CONDITION'?'Station condition':'Operational event',details:n===4?'Historical offline observation with a long equipment description '+ 'word'.repeat(50):'Test observation '+n,equipment_area:null,severity:n%9===4?'ATTENTION':null,status:n%9===1?'OPEN':null};});
}};
`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationalTimelinePage} from './src/pages/OperationalTimelinePage';import {change} from 'timeline-fixture';
createRoot(document.getElementById('root')).render(<><div style={{padding:8,display:'flex',gap:8,flexWrap:'wrap'}}><label>Test role<select onChange={e=>change('role',e.target.value)} defaultValue="FIELD_OFFICER"><option>FIELD_OFFICER</option><option>OPERATOR</option><option>ADMIN</option></select></label><label>Test response<select onChange={e=>change('mode',e.target.value)}><option value="normal">Normal</option><option value="empty">Empty</option><option value="denied">Denied</option><option value="error">Error</option></select></label><button onClick={()=>change('online',false)}>Test offline</button><button onClick={()=>change('online',true)}>Test online</button></div><OperationalTimelinePage onBack={()=>{}}/></>);`;
const result=await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'esm',jsx:'automatic',platform:'browser',alias:{'@':root+'/src'},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^(timeline-fixture|.*\/operationalApi|.*\/AppContext|.*\/useAuth|.*\/useOnlineStatus)$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js',resolveDir:root}));}}]});
const assets=await readdir('dist/assets');const css=await readFile('dist/assets/'+assets.find(n=>n.endsWith('.css')));
createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].text);}else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Timeline UI checks</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/bundle.js"></script>');}}).listen(4182,'127.0.0.1',()=>console.log('Synthetic Timeline UI: http://127.0.0.1:4182'));
