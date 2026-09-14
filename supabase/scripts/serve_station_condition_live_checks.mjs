// DEV-only integration harness. Requires an existing browser-authenticated token.
// No authentication settings are changed and no service key reaches the browser.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createClient } from '@supabase/supabase-js';
import { loadShutdownDevEnvironment, createShutdownValidationActor } from './load_shutdown_dev_env.mjs';

loadShutdownDevEnvironment();
const url = process.env.DEV_SUPABASE_URL;
if (!process.argv.includes('--dev') || new URL(url).hostname !== 'eetlzxntgvjompmipprb.supabase.co') throw new Error('Explicit DEV target required');
const actor = await createShutdownValidationActor({url,anonKey:process.env.DEV_SUPABASE_ANON_KEY,label:'Operator A',
  expectedEmail:process.env.DEV_OPERATOR_A_EMAIL,accessToken:process.env.DEV_OPERATOR_A_ACCESS_TOKEN});
const role = await actor.client.rpc('get_my_role');
if (role.error || role.data !== 'OPERATOR') throw new Error('Verified operator token required');
const service = createClient(url,process.env.DEV_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const run = `stage35-${crypto.randomUUID()}`;
const stationId=crypto.randomUUID(), feederId=crypto.randomUUID();
const outsideStationId=process.env.DEV_STATION_B_ID;
const origin='http://127.0.0.1:4181';
const config={run,stationId,feederId,outsideStationId,userId:actor.user.id,accessToken:process.env.DEV_OPERATOR_A_ACCESS_TOKEN};
let createdStation=false;
async function checked(query){const r=await query;if(r.error)throw r.error;return r.data;}
async function cleanup(){
  if (!createdStation) return;
  // Only the fresh station from this run is touched; FK order is deliberate.
  for(const table of ['notification_events','station_conditions','interruptions','log_book_entries','feeders','user_stations']) {
    await checked(service.from(table).delete().eq('station_id',stationId));
  }
  await checked(service.from('stations').delete().eq('id',stationId));
  createdStation=false;
  console.log('PASS: live integration fixtures cleaned up');
}
try {
  const compiled=await build({entryPoints:['supabase/scripts/station_condition_live_checks.tsx'],bundle:true,write:false,format:'esm',jsx:'automatic',platform:'browser',alias:{'@':`${process.cwd()}/src`},
    define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(url),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(process.env.DEV_SUPABASE_ANON_KEY),'process.env.NODE_ENV':'"development"'}});
  const assetNames=await readdir('dist/assets');
  const css=await readFile(`dist/assets/${assetNames.find(name=>name.endsWith('.css'))}`);
  await checked(service.from('stations').insert({id:stationId,code:run,name:`Integration ${run}`}));createdStation=true;
  await checked(service.from('feeders').insert({id:feederId,station_id:stationId,code:run,name:'Synthetic integration feeder'}));
  await checked(service.from('user_stations').insert({user_id:actor.user.id,station_id:stationId,active:true}));
  const server=createServer(async(req,res)=>{
    if(req.headers.host!=='127.0.0.1:4181' || (req.headers.origin && req.headers.origin!==origin)) {res.writeHead(403);res.end();return;}
    res.setHeader('Cache-Control','no-store');
    try {
      if(req.url==='/context' && req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
      if(req.url==='/cleanup' && req.method==='POST' && req.headers.origin===origin){await cleanup();res.end('cleaned');return;}
      if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(compiled.outputFiles[0].text);return;}
      if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEV live station condition validation</title><link rel="stylesheet" href="/style.css"><div id="results"></div><div id="root"></div><script type="module" src="/bundle.js"></script>');
    }catch{res.writeHead(500);res.end('Validation request failed');}
  });
  server.listen(4181,'127.0.0.1',()=>console.log(`Live integration harness: ${origin}/checks · ${origin}/page`));
  process.once('SIGINT',()=>{void cleanup().finally(()=>server.close(()=>process.exit(0)));});
} catch(error){await cleanup();throw error;}
