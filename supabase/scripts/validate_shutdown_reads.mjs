/*
 * Legacy DEV token-auth read validation, retained for compatibility.
 * Superseded by supabase/tests/database/shutdown_security_test.sql.
 */
import { createClient } from '@supabase/supabase-js';
import { createShutdownValidationActor, loadShutdownDevEnvironment } from './load_shutdown_dev_env.mjs';

loadShutdownDevEnvironment();
const REF='eetlzxntgvjompmipprb';
if(!process.argv.includes('--dev')) throw new Error('STOPPED: pass --dev explicitly');
const names=['DEV_SUPABASE_URL','DEV_SUPABASE_ANON_KEY','DEV_SUPABASE_SERVICE_ROLE_KEY','DEV_OPERATOR_A_EMAIL','DEV_OPERATOR_B_EMAIL','DEV_OFFICER_A_EMAIL','DEV_ADMIN_EMAIL','DEV_STATION_A_ID','DEV_STATION_B_ID','DEV_FEEDER_A_ID','DEV_FEEDER_B_ID'];
for(const name of names) if(!process.env[name]) throw new Error(`STOPPED: missing ${name}`);
const url=process.env.DEV_SUPABASE_URL;if(new URL(url).hostname!==`${REF}.supabase.co`) throw new Error('STOPPED: URL is not GridVision DEV');
const opts={auth:{persistSession:false,autoRefreshToken:false}};const anonKey=process.env.DEV_SUPABASE_ANON_KEY;const service=createClient(url,process.env.DEV_SUPABASE_SERVICE_ROLE_KEY,opts);
const users={operatorA:{label:'Operator A',email:process.env.DEV_OPERATOR_A_EMAIL,password:process.env.DEV_OPERATOR_A_PASSWORD,accessToken:process.env.DEV_OPERATOR_A_ACCESS_TOKEN,refreshToken:process.env.DEV_OPERATOR_A_REFRESH_TOKEN,refreshTokenVariable:'DEV_OPERATOR_A_REFRESH_TOKEN'},operatorB:{label:'Operator B',email:process.env.DEV_OPERATOR_B_EMAIL,password:process.env.DEV_OPERATOR_B_PASSWORD,accessToken:process.env.DEV_OPERATOR_B_ACCESS_TOKEN,refreshToken:process.env.DEV_OPERATOR_B_REFRESH_TOKEN,refreshTokenVariable:'DEV_OPERATOR_B_REFRESH_TOKEN'},officerA:{label:'Officer A',email:process.env.DEV_OFFICER_A_EMAIL,password:process.env.DEV_OFFICER_A_PASSWORD,accessToken:process.env.DEV_OFFICER_A_ACCESS_TOKEN,refreshToken:process.env.DEV_OFFICER_A_REFRESH_TOKEN,refreshTokenVariable:'DEV_OFFICER_A_REFRESH_TOKEN'},admin:{label:'Admin',email:process.env.DEV_ADMIN_EMAIL,password:process.env.DEV_ADMIN_PASSWORD,accessToken:process.env.DEV_ADMIN_ACCESS_TOKEN,refreshToken:process.env.DEV_ADMIN_REFRESH_TOKEN,refreshTokenVariable:'DEV_ADMIN_REFRESH_TOKEN'}};
const stationA=process.env.DEV_STATION_A_ID,stationB=process.env.DEV_STATION_B_ID;
const feederA=process.env.DEV_FEEDER_A_ID,feederB=process.env.DEV_FEEDER_B_ID;
const clients={},ids={},created=[];let failures=0;const ok=(v,n,d='')=>v?console.log(`[PASS] ${n}`):(failures++,console.error(`[FAIL] ${n}${d?`: ${d}`:''}`));
const has=(rows,id)=>rows?.some(r=>r.id===id);const rpc=(who,name,args={})=>clients[who].rpc(name,args);const run=`READ-${Date.now()}`;
try{
 for(const [name,user] of Object.entries(users)){const authenticated=await createShutdownValidationActor({url,anonKey,label:user.label,expectedEmail:user.email,password:user.password,accessToken:user.accessToken,refreshToken:user.refreshToken,refreshTokenVariable:user.refreshTokenVariable});clients[name]=authenticated.client;ids[name]=authenticated.user.id;}
 const base={shutdown_type:'Planned',purpose:'Testing',work_description:'Read RPC validation',planned_start:new Date(Date.now()+86400000).toISOString(),expected_restoration:new Date(Date.now()+90000000).toISOString(),status:'PENDING_APPROVAL'};
 const fixtures=[
  {...base,id:crypto.randomUUID(),sd_number:`SD-2098-${run}-A1`,station_id:stationA,feeder_id:feederA,equipment_name:`${run}-Transformer`,requested_by:ids.operatorA,requested_at:'2026-09-10T06:00:00Z'},
  {...base,id:crypto.randomUUID(),sd_number:`SD-2098-${run}-A2`,station_id:stationA,feeder_id:feederA,equipment_name:`${run}-Line`,requested_by:ids.operatorB,requested_at:'2026-09-11T06:00:00Z'},
  {...base,id:crypto.randomUUID(),sd_number:`SD-2098-${run}-B1`,station_id:stationB,feeder_id:feederB,equipment_name:`${run}-Remote`,requested_by:ids.operatorB,requested_at:'2026-09-12T06:00:00Z'},
 ];
 const setup=await service.from('shutdown_requests').insert(fixtures);if(setup.error)throw new Error(`Fixture setup failed: ${setup.error.message}`);created.push(...fixtures.map(x=>x.id));
 const dashA=await rpc('operatorA','list_shutdown_dashboard_requests',{p_search:run,p_limit:100});ok(!dashA.error&&has(dashA.data,fixtures[0].id)&&has(dashA.data,fixtures[1].id)&&!has(dashA.data,fixtures[2].id),'operator dashboard is station scoped',dashA.error?.message);
 const officer=await rpc('officerA','list_shutdown_dashboard_requests',{p_search:run,p_limit:100});ok(has(officer.data,fixtures[0].id)&&has(officer.data,fixtures[1].id)&&!has(officer.data,fixtures[2].id),'field officer dashboard follows jurisdiction');
 const admin=await rpc('admin','list_shutdown_dashboard_requests',{p_search:run,p_limit:100});ok(fixtures.every(x=>has(admin.data,x.id)),'admin dashboard follows existing global station scope');
 const page=await rpc('operatorA','list_shutdown_dashboard_requests',{p_search:run,p_limit:1,p_offset:1});ok(!page.error&&page.data.length===1&&Number(page.data[0].total_count)===2,'dashboard pagination and total count work');
 const filtered=await rpc('operatorA','list_shutdown_dashboard_requests',{p_search:'Transformer',p_status:'PENDING_APPROVAL',p_station_id:stationA,p_from_date:'2026-09-10',p_to_date:'2026-09-10'});ok(!filtered.error&&filtered.data.length===1&&filtered.data[0].id===fixtures[0].id,'dashboard combined filters work');
 const kpi=await rpc('operatorA','get_shutdown_dashboard_kpis');const scopedTotal=dashA.data?.[0]?.total_count??0;ok(!kpi.error&&Number(kpi.data?.[0]?.total)>=Number(scopedTotal),'KPI counts cover visible station scope');
 const mineA=await rpc('operatorA','list_my_shutdown_requests',{p_search:run,p_limit:100});ok(!mineA.error&&mineA.data.length===1&&mineA.data[0].requested_by===ids.operatorA,'My Requests derives caller ownership');
 ok((await rpc('operatorA','list_my_shutdown_requests',{p_requester:ids.operatorB})).error!==null,'My Requests rejects identity parameter manipulation');
 const ownerDetail=await rpc('operatorA','get_shutdown_request',{p_shutdown_id:fixtures[0].id});ok(!ownerDetail.error&&ownerDetail.data?.[0]?.can_decide===false,'owner detail visible and cannot decide');
 const officerDetail=await rpc('officerA','get_shutdown_request',{p_shutdown_id:fixtures[0].id});ok(!officerDetail.error&&officerDetail.data?.[0]?.can_decide===true,'in-scope eligible officer can_decide');
 const operatorDetail=await rpc('operatorA','get_shutdown_request',{p_shutdown_id:fixtures[1].id});ok(!operatorDetail.error&&operatorDetail.data?.[0]?.can_decide===false,'operator cannot decide another in-scope request');
 ok((await rpc('operatorA','get_shutdown_request',{p_shutdown_id:fixtures[2].id})).error!==null,'out-of-scope unrelated detail denied');
 const report=await rpc('operatorA','list_shutdown_report_requests',{p_from_date:'2026-09-10',p_to_date:'2026-09-10',p_station_id:stationA,p_status:'PENDING_APPROVAL',p_feeder_id:feederA,p_equipment:'Transformer',p_requester:ids.operatorA,p_limit:1});ok(!report.error&&report.data.length===1&&report.data[0].id===fixtures[0].id,'report combined filters and limit work');
 const remoteReport=await rpc('operatorA','list_shutdown_report_requests',{p_station_id:stationB,p_limit:100});ok(!has(remoteReport.data,fixtures[2].id),'report never exposes out-of-scope station');
 const anonymous=createClient(url,anonKey,opts);ok((await anonymous.rpc('get_shutdown_dashboard_kpis')).error!==null,'anonymous RPC execution denied');
 const after=await service.from('shutdown_requests').select('id,status,updated_at').in('id',created);ok(!after.error&&after.data.every(row=>row.status==='PENDING_APPROVAL'),'read RPCs have no mutation side effects');
 if(failures)throw new Error(`${failures} validation assertion(s) failed`);
}finally{if(created.length){const cleanup=await service.from('shutdown_requests').delete().in('id',created);if(cleanup.error)console.error(`[WARN] cleanup failed: ${cleanup.error.message}`);}}
