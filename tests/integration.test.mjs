import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createServer} from 'node:http';
import {registerHooks} from 'node:module';
// Mock only the host import; no Pi initialization, model access or session needed.
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@earendil-works/pi-coding-agent')return {url:'data:text/javascript,export async function withFileMutationQueue(path,task){return task()}',shortCircuit:true};
 return next(specifier,context);
}});
const {default:extension}=await import('../dist/extension.js');
hooks.deregister();
import {perform} from '../dist/integration.js';
import {saveConfig,inspectConfig,exists,exclusive} from '../dist/config-store.js';
import {serve} from '../dist/runtime.js';
import {loadConfig} from '../dist/config.js';
import {request} from '../dist/client.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(){const root=await mkdtemp(join(tmpdir(),'servicehost-pi-'));return {root,file:join(root,'ServiceHost.json'),raw:{apiPort:await port(),logDirectory:'logs',services:[]}};}
async function closed(runtime){await new Promise(r=>runtime.server.close(r));for(let i=0;i<100&&await exists(runtime.config.file+'.runtime-lock');i++)await delay(10);}

test('mock Pi registration is inert; schemas expose focused tools and safe errors',async()=>{
 const {root}=await fixture();const tools=[];
 try {
  extension({registerTool:t=>tools.push(t)});
  assert.equal(tools.length,16);assert.deepEqual(await readdir(root),[]);
  assert.ok(tools.every(t=>t.name.startsWith('servicehost_')&&t.parameters.additionalProperties===false));
  const panel=tools.find(t=>t.name==='servicehost_panel_open').parameters;
  assert.deepEqual(panel.properties.placement.enum,['split','tab']);assert.ok(!panel.required?.includes('placement'));
  const start=tools.find(t=>t.name==='servicehost_host_start').parameters;
  assert.deepEqual(start.properties.placement.enum,['split','tab']);assert.ok(!start.required?.includes('placement'));
  assert.ok(tools.filter(t=>!['servicehost_panel_open','servicehost_host_start'].includes(t.name)).every(t=>!t.parameters.properties.placement));
  for(const op of ['panel_open','host_start'])for(const placement of [null,'new-tab',1])await assert.rejects(perform(op,{placement},root),/Invalid panel placement/);
  const reloaded=[];extension({registerTool:t=>reloaded.push(t)});
  assert.equal(reloaded.length,16);assert.deepEqual(await readdir(root),[]);
  await assert.rejects(perform('panel_reconnect',{placement:'tab'},root),/Reconnect/);
  const execute=(op,p={})=>tools.find(t=>t.name==='servicehost_'+op).execute('id',p,undefined,undefined,{cwd:root});
  await writeFile(join(root,'ServiceHost.json'),'{secret-parse-value');
  const result=await execute('config_inspect');assert.equal(result.isError,true);assert.doesNotMatch(JSON.stringify(result),/secret-parse-value/);
  for(const op of ['panel_open','panel_reconnect']){const r=await execute(op);assert.equal(r.isError,true);assert.doesNotMatch(JSON.stringify(r),/secret-parse-value/);}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('config create/update revision, validation, concurrency and sanitized metadata',async()=>{
 const {root,file,raw}=await fixture();
 try {
  raw.services=[{name:'api',command:'secret-command',args:['secret-arg'],workingDirectory:'.',environment:{TOKEN:'secret-env'}}];
  const first=await saveConfig(file,raw);assert.equal(first.apiPort,raw.apiPort);assert.doesNotMatch(JSON.stringify(first),/secret-command|secret-arg|secret-env/);
  await assert.rejects(saveConfig(file,raw),/revision/);
  await assert.rejects(saveConfig(file,{...raw,apiPort:0},first.revision),/configuration/);
  assert.equal((await inspectConfig(file)).revision,first.revision);
  const outcomes=await Promise.allSettled([saveConfig(file,{...raw,apiPort:await port()},first.revision),saveConfig(file,{...raw,apiPort:await port()},first.revision)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(saveConfig(file,raw,first.revision),/revision/);
  await exclusive(file,async()=>{await assert.rejects(saveConfig(file,raw,(await inspectConfig(file)).revision),/locked/);});
  assert.equal(await exists(file+'.mutation-lock'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('active runtime fences updates and duplicate runtime even after external port edit',async()=>{
 const {root,file,raw}=await fixture();let runtime;
 try {
  const first=await saveConfig(file,raw);runtime=await serve(file);
  await assert.rejects(saveConfig(file,{...raw,apiPort:await port()},first.revision),/Runtime active/);
  const info=await perform('host_status',{},root);assert.equal(info.project,runtime.config.id);assert.equal(info.apiPort,raw.apiPort);
  const next={...raw,apiPort:await port()};await writeFile(file,JSON.stringify(next));
  await assert.rejects(serve(file),/Runtime active/);
  assert.equal((await request(runtime.config,{action:'ping'})).apiPort,raw.apiPort);
  await closed(runtime);runtime=undefined;
  const updated=await saveConfig(file,raw,(await inspectConfig(file)).revision);assert.equal(updated.apiPort,raw.apiPort);
 }finally{if(runtime)await closed(runtime);await rm(root,{recursive:true,force:true});}
});

test('conflicting port never falls back; failed bind releases only its own guard; stale guards fence',async()=>{
 const {root,file,raw}=await fixture();const conflict=createServer((req,res)=>{res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'sensitive-remote-error'}));});
 conflict.listen(raw.apiPort,'127.0.0.1');await once(conflict,'listening');
 try {
  const first=await saveConfig(file,raw);
  await assert.rejects(perform('host_start',{},root),/conflicting/);
  await assert.rejects(perform('host_status',{},root),e=>!e.message.includes('sensitive-remote-error'));
  for(const placement of ['split','tab'])await assert.rejects(perform('panel_open',{placement},root),/Runtime request/);
  assert.equal(await exists(file+'.panel.json'),false);
  await assert.rejects(saveConfig(file,{...raw,apiPort:await port()},first.revision),/conflicting/);
  await assert.rejects(serve(file),/EADDRINUSE/);assert.equal(await exists(file+'.runtime-lock'),false);
  await writeFile(file+'.runtime-lock','stale');await assert.rejects(serve(file),/stale runtime lock/);
  assert.equal(await readFile(file+'.runtime-lock','utf8'),'stale');
 }finally{await new Promise(r=>conflict.close(r));await rm(root,{recursive:true,force:true});}
});

test('host start panel failure is structured, preserves runtime, and never exposes adapter secrets',async()=>{
 const {root,file,raw}=await fixture();let started=false;let calls=0;
 try {
  await saveConfig(file,raw);
  await assert.rejects(perform('host_start',{placement:'tab'},root,undefined,async(c,reconnect,options)=>{
   started=true;calls++;assert.equal(options.placement,'tab');assert.equal(reconnect,false);
   assert.equal((await request(c,{action:'ping'})).apiPort,raw.apiPort);
   throw Error('sensitive-adapter-secret');
  }),e=>{
   const result=JSON.parse(e.message);
   assert.equal(result.error,'host_start_panel_failed');assert.equal(result.runtimeRunning,true);
   assert.equal(result.runtimeStarted,true);assert.equal(result.existing,false);
   assert.equal(result.apiPort,raw.apiPort);assert.equal(result.configPath,file);
   assert.ok(result.project);assert.match(result.panel.error,/uncertain/);
   assert.doesNotMatch(e.message,/sensitive-adapter-secret/);return true;
  });
  assert.equal(calls,1);assert.equal((await perform('host_status',{},root)).running,true);
  // Real registered tool, real default adapter, but explicitly no Herdr caller.
  // No pane or external Herdr process can be launched by this test.
  const keys=['HC_TERMINAL_ID','HC_TERMINAL_SOCKET','HERDR_ENV','HERDR_PANE_ID'];
  const saved=keys.map(k=>process.env[k]);for(const k of keys)delete process.env[k];
  try {
   const tools=[];extension({registerTool:t=>tools.push(t)});
   const result=await tools.find(t=>t.name==='servicehost_host_start').execute('id',{},undefined,undefined,{cwd:root});
   assert.equal(result.isError,true);
   const error=JSON.parse(result.content[0].text);
   assert.equal(error.runtimeRunning,true);assert.equal(error.existing,true);assert.equal(error.runtimeStarted,false);
   assert.equal(error.apiPort,raw.apiPort);assert.equal(error.configPath,file);assert.ok(error.panel.error);
   assert.equal(await exists(file+'.panel.json'),false);
  }finally{keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
 }finally{
  if(started)await perform('host_shutdown',{},root);
  for(let i=0;i<100&&await exists(file+'.runtime-lock');i++)await delay(10);
  await rm(root,{recursive:true,force:true});
 }
});

test('panel failure reports unknown rather than falsely asserting a lost runtime stopped',async()=>{
 const {root,file,raw}=await fixture();let runtime;
 try {
  await saveConfig(file,raw);runtime=await serve(file);
  await assert.rejects(perform('host_start',{},root,undefined,async()=>{
   await closed(runtime);runtime=undefined;throw Error('private-panel-error');
  }),e=>{
   const result=JSON.parse(e.message);assert.equal(result.runtimeRunning,null);
   assert.equal(result.runtimeStatus,'unconfirmed');assert.equal(result.apiPort,raw.apiPort);
   assert.doesNotMatch(e.message,/private-panel-error/);return true;
  });
 }finally{if(runtime)await closed(runtime);await rm(root,{recursive:true,force:true});}
});

test('detached tools lifecycle uses packaged runtime; logs withheld; bounded readiness and cancellation',async()=>{
 const {root,file,raw}=await fixture();let started=false;
 const panelCalls=[];
 const mockPanel=async(c,reconnect,options)=>{panelCalls.push({project:c.id,apiPort:c.apiPort,reconnect,...options});return {placement:'split',pane:'fixture-pane',runtimeStarted:false};};
 raw.services=[{name:'fixture',command:process.execPath,args:['-e','console.log("sensitive-log-value");console.log(String.fromCharCode(27)+"]52;c;secret"+String.fromCharCode(7)+String.fromCharCode(0x202e));setTimeout(()=>{},20000)'],workingDirectory:'.',readiness:{port:await port(),path:'/',expectedStatus:200,startupTimeoutMs:10000}}];
 try {
  await saveConfig(file,raw);
  const first=await perform('host_start',{},root,undefined,mockPanel);started=true;
  assert.equal(first.apiPort,raw.apiPort);assert.equal(first.configPath,file);assert.equal(first.project,(await loadConfig(file)).id);
  assert.equal(first.existing,false);assert.equal(first.panel.pane,'fixture-pane');
  const again=await perform('host_start',{placement:'tab'},root,undefined,mockPanel);
  assert.equal(again.existing,true);assert.equal(again.panel.placement,'split','adapter owns existing-display placement');
  assert.deepEqual(panelCalls,[{project:first.project,apiPort:raw.apiPort,reconnect:false,placement:'split'},{project:first.project,apiPort:raw.apiPort,reconnect:false,placement:'tab'}]);
  assert.equal((await perform('service_status',{name:'fixture'},root)).state,'stopped');
  await perform('service_start',{name:'fixture'},root);
  await assert.rejects(perform('host_start',{},root,undefined,async()=>{throw Error('sensitive-panel-log');}),e=>{
   const error=JSON.parse(e.message);assert.equal(error.runtimeRunning,true);assert.equal(error.existing,true);
   assert.doesNotMatch(e.message,/sensitive-panel-log|sensitive-log-value/);return true;
  });
  assert.equal((await perform('service_status',{name:'fixture'},root)).state,'running','panel failure never stops hosted services');
  await assert.rejects(perform('host_shutdown',{},root),/refused/);
  await assert.rejects(perform('service_wait',{name:'fixture',timeoutMs:100},root));
  assert.equal((await perform('service_status',{name:'fixture'},root)).state,'running');
  const abort=new AbortController();abort.abort();await assert.rejects(perform('service_wait',{name:'fixture'},root,abort.signal));
  await delay(100);
  await writeFile(join(root,'ServiceHost.credentials.json'),'invalid-json-private-credential-file');
  const log=await perform('service_logs',{name:'fixture'},root);assert.equal(log.textWithheld,true);assert.ok(log.bytes>0);assert.doesNotMatch(JSON.stringify(log),/sensitive-log-value/);
  const text=await perform('service_logs',{name:'fixture',includeText:true},root);assert.match(text.text,/sensitive-log-value/);assert.match(text.warning,/may contain secrets/);assert.doesNotMatch(text.text,/[\u001b\u0007\u202e]/);assert.ok(text.text.includes('\\u001b'));assert.doesNotMatch(JSON.stringify(text),/invalid-json-private-credential-file/);
  const bounded=await perform('service_logs',{name:'fixture',includeText:true,bytes:4},root);assert.ok(bounded.bytes<=4);
  await assert.rejects(perform('service_logs',{name:'fixture',includeText:true,bytes:16385},root),/limit/);
  await perform('service_restart',{name:'fixture'},root);
  await perform('service_stop',{name:'fixture'},root);
  await perform('host_shutdown',{},root);started=false;
  for(let i=0;i<100&&await exists(file+'.runtime-lock');i++)await delay(10);
  assert.equal(await exists(file+'.runtime-lock'),false);
 }finally{
  if(started){await perform('service_stop',{name:'fixture'},root).catch(()=>{});await perform('host_shutdown',{},root).catch(()=>{});}
  await delay(100);await rm(root,{recursive:true,force:true});
 }
});
