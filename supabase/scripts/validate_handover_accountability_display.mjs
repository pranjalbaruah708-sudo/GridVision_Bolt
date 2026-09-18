// Render the real shared display with deliberately different roster/action identities.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const result = await build({stdin:{contents:`
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HandoverAccountability} from './src/components/HandoverAccountability';
import assert from 'node:assert/strict';
const value={id:'fixture',status:'ACCEPTED',outgoing_shift_name:'Outgoing',incoming_shift_name:'Incoming',outgoing_in_charge_name:'Roster A',incoming_in_charge_name:'Roster B',submitted_by_name:'Submit C',submitted_at:'2026-09-15T08:00:00Z',accepted_by_name:'Accept D',accepted_at:'2026-09-15T09:00:00Z'};
for(const side of ['outgoing','incoming','history']) {
 const html=renderToStaticMarkup(<HandoverAccountability value={value} side={side}/>);
 for(const text of ['Outgoing','Incoming','Submit C','Accept D','ACCEPTED','IST']) assert.ok(html.includes(text),side+': '+text);
 assert.ok(!html.includes('AWAITING ACCEPTANCE'));
 assert.ok(html.includes(side==='incoming'?'Roster B':'Roster A'));
}
const submitted=renderToStaticMarkup(<HandoverAccountability value={{...value,status:'SUBMITTED',incoming_in_charge_name:null,accepted_at:null,accepted_by_name:null}} side="incoming"/>);
assert.ok(submitted.includes('Not assigned') && submitted.includes('AWAITING ACCEPTANCE'));
assert.ok(!submitted.includes('Accepted By'));
console.log('PASS: shared cards preserve distinct roster/action identities, complete accepted audit, current status and unassigned fallback');
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic'});
new Function('require',result.outputFiles[0].text)(createRequire(import.meta.url));
