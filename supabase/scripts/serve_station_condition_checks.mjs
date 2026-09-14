// Local browser harness: actual application queue/IndexedDB/React, synthetic
// authentication and RPC transport. Never connects to a Supabase project.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const mock = `
import { useEffect, useState } from 'react';
export const state = { user: 'operator-a', station: 'station-a', online: true, mode: 'ok', calls: 0, rows: new Map() };
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>state.online});
export function toggleOnline(value) { state.online=value; window.dispatchEvent(new Event(value?'online':'offline')); }
function create(args) {
  let row=state.rows.get(args.p_client_operation_id);
  if (!row) { row={id:crypto.randomUUID(),station_id:args.p_station_id,observed_at:args.p_observed_at,
    category:args.p_category,condition:args.p_condition,equipment_area:args.p_equipment_area,
    observation:args.p_observation,recorded_by:state.user,client_operation_id:args.p_client_operation_id,
    status:'OPEN',entry_mode:args.p_entry_mode,recorded_at:args.p_recorded_at,synced_at:new Date().toISOString()}; state.rows.set(args.p_client_operation_id,row); }
  return row;
}
globalThis.fetch=async (_url,options)=>{
  state.calls++;
  if(!_url.includes('/rpc/'))return new Response(JSON.stringify([{id:crypto.randomUUID()}]),{status:200});
  if(state.mode==='denied')return new Response(JSON.stringify({code:'42501',message:'Access denied'}),{status:403});
  if(state.mode==='malformed')return new Response('{}',{status:200});
  const row=create(JSON.parse(options.body));
  if(state.mode==='lost'){state.mode='ok';throw new TypeError('Synthetic lost response');}
  return new Response(JSON.stringify(row),{status:200});
};
export const REST_URL='https://synthetic.invalid/rest/v1';
export const REST_HEADERS={'Content-Type':'application/json'};
export const supabase={
  auth:{getSession:async()=>({data:{session:state.user?{user:{id:state.user},access_token:'synthetic'}:null},error:null})},
  rpc:async(name,args)=>{
    if(name==='rectify_station_condition'){const row=[...state.rows.values()].find(r=>r.id===args.p_id);row.status='RECTIFIED';return {data:row,error:null};}
    return {data:create(args),error:null};
  },
  from:()=>{let station;const query={select:()=>query,eq:(_key,value)=>{station=value;return query;},order:()=>query,
    limit:async()=>({data:[...state.rows.values()].filter(r=>r.station_id===station).sort((a,b)=>b.observed_at.localeCompare(a.observed_at)),error:null})};return query;}
};
function useRefresh(){const [,setTick]=useState(0);useEffect(()=>{const update=()=>setTick(n=>n+1);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);}
export function useAuth(){return {user:{id:state.user}};}
export function useApp(){useRefresh();return {activeStation:{id:state.station,name:'Synthetic Test Station'},stations:[{id:'station-a',name:'Synthetic Test Station'}],setActiveStationId:()=>{},online:state.online,loading:false};}
`;
const result = await build({ entryPoints: ['supabase/scripts/station_condition_browser_checks.tsx'], alias: {'@':path.join(root,'src')}, bundle: true, write: false, format: 'esm', jsx: 'automatic', platform: 'browser',
  plugins: [{ name: 'synthetic-context', setup(builder) {
    builder.onResolve({filter: /^(synthetic-test-context|.*\/supabase|.*\/AppContext|.*\/useAuth)$/}, args => ({path:'synthetic',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js',resolveDir:root}));
  }}], define: {'process.env.NODE_ENV':'"development"'} });
const bundle=result.outputFiles[0].text;
const assets=await readdir(path.join(root,'dist/assets'));
const css=await readFile(path.join(root,'dist/assets',assets.find(name=>name.endsWith('.css'))));
const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  res.setHeader('Content-Type','text/html');
  if(req.url?.startsWith('/mobile')){res.end('<!doctype html><title>Mobile condition preview</title><a href="/preview">Desktop preview</a><iframe title="390px mobile condition preview" src="/preview" style="display:block;width:390px;height:1000px;border:0"></iframe>');return;}
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Station condition browser checks</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
});
server.listen(4179,'127.0.0.1',()=>console.log('Synthetic browser checks: http://127.0.0.1:4179/tests · /preview · /mobile'));
