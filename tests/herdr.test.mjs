import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {herdrPanel,panelCommand,panelCLI} from '../dist/herdr.js';
const env={HERDR_ENV:'1',HERDR_PANE_ID:'w:p1'};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'panel-'));const c={file:join(root,'ServiceHost.json'),id:'project'};const caller={pane_id:'w:p1',tab_id:'w:t1',workspace_id:'w',terminal_id:'term1'};const pane={pane_id:'w:p2',tab_id:'w:t1',workspace_id:'w',terminal_id:'term2'};const calls=[];let created=false;
 const run=async a=>{calls.push(a);let result={};if(a[1]==='current')result={pane:caller};if(a[1]==='list')result={panes:created?[caller,pane]:[caller]};if(a[1]==='split'){created=true;result={pane};}if(a[1]==='rename')pane.label=a[3];if(a[1]==='run')return '';return JSON.stringify({result});};return {root,c,pane,calls,run};}
test('explicit non-focusing split; returned IDs, connect-only command; reuse never injects',async()=>{const f=await fixture();try{
 const result=await herdrPanel(f.c,false,{run:f.run,env});assert.equal(result.pane,'w:p2');assert.equal(result.runtimeStarted,false);
 assert.ok(f.calls.find(a=>a[1]==='split').includes('--no-focus'));assert.equal(f.calls.find(a=>a[1]==='run')[2],'w:p2');assert.match(f.calls.find(a=>a[1]==='run')[3],/--connect-only/);
 f.calls.length=0;assert.equal((await herdrPanel(f.c,true,{run:f.run,env})).pane,'w:p2');assert.deepEqual(f.calls.map(a=>a[1]),['current','list']);
 f.pane.terminal_id='replaced';await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}),/uncertain/);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('uncertain submission persists fence; sanitized errors; no blind retry',async()=>{const f=await fixture();try{
 const run=async a=>{if(a[1]==='run')throw new Error('secret transport stderr');return f.run(a);};
 await assert.rejects(herdrPanel(f.c,false,{run,env}),e=>!e.message.includes('secret transport'));
 assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'run_pending');f.calls.length=0;
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}));assert.deepEqual(f.calls.map(a=>a[1]),['current']);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('concurrent opens excluded; reconnect without record and unsupported platform inert',async()=>{const f=await fixture();try{
 await assert.rejects(herdrPanel(f.c,true,{run:f.run,env}));assert.ok(!f.calls.some(a=>a[1]==='split'));
 let release;const gate=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
 const run=async a=>{if(a[1]==='current'){entered();await gate;}return f.run(a);};const pending=herdrPanel(f.c,false,{run,env});await ready;
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}),/locked/);
 const child=`import {exclusive} from ${JSON.stringify(new URL('../dist/config-store.js',import.meta.url).href)};try{await exclusive(${JSON.stringify(f.c.file+'.panel.json')},async()=>{});process.exitCode=1}catch(e){console.log(e.message)}`;
 assert.match((await promisify(execFile)(process.execPath,['--input-type=module','-e',child])).stdout,/locked/);release();await pending;
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env,platform:'win32'}),/Linux only/);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('lost split acknowledgement remains fenced without command submission or duplicate split',async()=>{const f=await fixture();try{
 const run=async a=>{const result=await f.run(a);if(a[1]==='split')throw new Error('lost acknowledgement');return result;};
 await assert.rejects(herdrPanel(f.c,false,{run,env}));assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'split_pending');
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}));assert.equal(f.calls.filter(a=>a[1]==='split').length,1);assert.ok(!f.calls.some(a=>a[1]==='run'));
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('package-relative CLI and shell quoting executed only against disposable argument recorder',async()=>{const root=await mkdtemp(join(tmpdir(),"panel ' quote-"));try{
 const script=join(root,"recorder ' $.mjs");await writeFile(script,'console.log(JSON.stringify(process.argv.slice(2)))');const config=join(root,"config ' $(false);.json");
 const {stdout}=await promisify(execFile)('/bin/sh',['-c',panelCommand(config,script)]);assert.deepEqual(JSON.parse(stdout),['panel','--connect-only','--config',config]);assert.match(panelCLI,/\/dist\/cli\.js$/);
 }finally{await rm(root,{recursive:true,force:true});}});
