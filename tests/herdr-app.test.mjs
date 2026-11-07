import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {herdrPanel,panelCLI} from '../dist/herdr.js';
import {readCore,directPanelArgv} from '../dist/herdr-app.js';

test('direct Windows argv preserves drive/UNC and shell syntax as data without PowerShell',()=>{
 const node="C:\\Program Files\\O'Brien\\node.exe",cli='C:\\包 # % &\\dist\\cli.js';
 for(const config of ["C:\\a b\\smart ’ ' $(evil); 雪😀.json",'\\\\server\\share\\$HOME %PATH% ! ` &\\config.json'])
  assert.deepEqual(JSON.parse(JSON.stringify(directPanelArgv(config,cli,node))),[node,cli,'panel','--connect-only','--config',config]);
});

// Shapes from app v0.1.13 window.rs::world/mirror.rs and core v0.1.18 schema.
// No real Herdr mutation or terminal is used by this suite.
async function fixture(platform='linux') {
 const root=await mkdtemp(join(tmpdir(),"app-panel 雪 ' "));
 const c={file:join(root,"config ’ $HOME & ;.json"),id:'project'};
 const env={HC_TERMINAL_ID:'t10',HC_TERMINAL_SOCKET:platform==='win32'?'\\\\.\\pipe\\herdr-core-test':join(root,'core.sock'),HERDR_APP_HOME:root};
 const caller={terminal:'t10',pane:'p-caller',sub_agents:['t99']};
 const pane={terminal:'t11',pane:'p-panel',sub_agents:[]};
 const world={spaces:[{id:'sp-local',machine:null,tabs:[{id:'tb-local',terminals:[caller]}]}],recent:[]};
 const document={version:5,value:{spaces:[{id:'sp-local',tabs:[{id:'tb-local',root:{id:'p-caller',type:'block',content:{terminal:'t10'}}}]}]}};
 const labels={'herdr.space':'sp-local','herdr.tab':'tb-local'};
 const callerRecord={address:'t10',labels,created_ms:123,state:'live'};
 const panelRecord={address:'t11',labels,created_ms:456,state:'live',parent:null,die_with_parent:false,argv:[process.execPath,panelCLI,'panel','--connect-only','--config',c.file]};
 const hello={generation:1,core:{id:'core-unique'}};
 const calls=[];
 const appRun=async args=>{
  calls.push(['app',...args]);
  if(args[0]==='ls')return JSON.stringify(world);
  if(args[0]==='commands')return JSON.stringify([{name:'pane.split',args:['direction','pane','argv'].map(name=>({name}))}]);
  assert.deepEqual(args.slice(0,2),['do','pane.split']);
  const request=JSON.parse(args[2]);assert.deepEqual(request,{direction:'down',pane:'p-caller',argv:panelRecord.argv});
  world.spaces[0].tabs[0].terminals.push(pane);
  return JSON.stringify({pane:pane.pane,terminal:pane.terminal});
 };
 const coreRead=async(method,params)=>{
  calls.push(['core',method,params]);
  if(method==='hello')return hello;
  if(method==='doc.get'){assert.deepEqual(params,{name:'herdr-app'});return document;}
  assert.equal(method,'terminal.get');
  assert.ok(['t10','t11'].includes(params.terminal),'no unrelated terminal observations');
  return params.terminal==='t10'?callerRecord:panelRecord;
 };
 return {root,c,env,world,document,callerRecord,panelRecord,hello,pane,calls,appRun,coreRead,options:{env,platform,appRun,coreRead}};
}
const dispose=f=>rm(f.root,{recursive:true,force:true});
const mutations=f=>f.calls.filter(c=>c[0]==='app'&&c[1]==='do');
for(const platform of ['linux','win32'])test(`app/core ${platform}: explicit direct argv split, focus contract, versioned identity and read-only reuse`,async()=>{
 const f=await fixture(platform);try{
  const result=await herdrPanel(f.c,false,f.options);
  assert.equal(result.pane,'p-panel');assert.equal(result.terminal,'t11');assert.equal(result.runtimeStarted,false);assert.equal(result.focusChanged,true);assert.match(result.outcome,/readiness not verified/);
  const record=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));
  assert.equal(record.version,2);assert.equal(record.backend,'app-core');assert.equal(record.core,'core-unique');assert.equal(record.stage,'submitted');assert.equal(record.created,456);
  assert.ok(!JSON.stringify(record).includes('argv'));
  assert.equal(mutations(f).length,1);
  const args=JSON.parse(mutations(f)[0][3]);assert.deepEqual(args.argv,[process.execPath,panelCLI,'panel','--connect-only','--config',f.c.file]);
  assert.ok(!JSON.stringify(args).includes('powershell'));
  for(const reconnect of [false,true]) {
   f.calls.length=0;const reused=await herdrPanel(f.c,reconnect,f.options);
   assert.equal(reused.focusChanged,false);assert.match(reused.outcome,/foreground process and panel readiness not verified/);assert.equal(mutations(f).length,0);
  }
 }finally{await dispose(f);}
});
for(const broken of ['missing','duplicate','remote','subagent','core-labels','core-document','doc-duplicate','bad-schema','missing-api'])test(`app/core rejects ${broken} caller before mutation`,async()=>{
 const f=await fixture();try{
  if(broken==='missing')f.world.spaces[0].tabs[0].terminals=[];
  if(broken==='duplicate')f.world.spaces[0].tabs[0].terminals.push({terminal:'t10',pane:'p-other'});
  if(broken==='remote')f.world.spaces[0].machine='remote';
  if(broken==='subagent')f.env.HC_TERMINAL_ID='t99';
  if(broken==='core-labels')f.callerRecord.labels={'herdr.space':'wrong','herdr.tab':'tb-local'};
  if(broken==='core-document')f.document.value.spaces[0].id='different-core-space';
  if(broken==='doc-duplicate')f.document.value.spaces.push(structuredClone(f.document.value.spaces[0]));
  if(broken==='bad-schema')delete f.world.spaces[0].machine;
  if(broken==='missing-api')f.options.appRun=async args=>args[0]==='commands'?'[]':f.appRun(args);
  await assert.rejects(herdrPanel(f.c,false,f.options),/app\/core unavailable/);assert.equal(mutations(f).length,0);
  await assert.rejects(readFile(f.c.file+'.panel.json'),{code:'ENOENT'});
 }finally{await dispose(f);}
});
for(const stage of ['split','verify'])test(`app/core lost ${stage} acknowledgement is persisted before mutation and fenced`,async()=>{
 const f=await fixture();try{
  f.options.appRun=async args=>{
   if(args[0]==='do') {
    const state=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));assert.equal(state.stage,'split_pending');
    const result=await f.appRun(args);if(stage==='split')throw Error('secret stderr');return result;
   }
   if(args[0]==='ls'&&mutations(f).length&&stage==='verify')throw Error('secret inventory');
   return f.appRun(args);
  };
  await assert.rejects(herdrPanel(f.c,false,f.options),e=>!e.message.includes('secret'));
  assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,stage==='split'?'split_pending':'verification_pending');
  for(const reconnect of [false,true]) {
   f.calls.length=0;await assert.rejects(herdrPanel(f.c,reconnect,{...f.options,appRun:f.appRun}));assert.equal(f.calls.length,0);
  }
 }finally{await dispose(f);}
});
for(const changed of ['core','socket','app-home','space','pane','terminal','created','argv','parent','die-with-parent','finished'])test(`app/core recorded ${changed} mismatch never replaces`,async()=>{
 const f=await fixture();try{
  await herdrPanel(f.c,false,f.options);f.calls.length=0;
  if(changed==='core')f.hello.core.id='replacement-core';
  if(changed==='socket')f.env.HC_TERMINAL_SOCKET=join(f.root,'other.sock');
  if(changed==='app-home')f.env.HERDR_APP_HOME=tmpdir();
  if(changed==='space')f.world.spaces[0].id='different-space';
  if(changed==='pane')f.pane.pane='replacement-pane';
  if(changed==='terminal')f.pane.terminal='t12';
  if(changed==='created')f.panelRecord.created_ms++;
  if(changed==='argv')f.panelRecord.argv=['/bin/sh'];
  if(changed==='parent')f.panelRecord.parent='t10';
  if(changed==='die-with-parent')f.panelRecord.die_with_parent=true;
  if(changed==='finished')f.panelRecord.state='finished';
  await assert.rejects(herdrPanel(f.c,true,f.options));assert.equal(mutations(f).length,0);
 }finally{await dispose(f);}
});
test('backend selection is explicit, partial/mixed identity rejected, old record never migrated',async()=>{
 const f=await fixture();try{
  for(const env of [{...f.env,HERDR_ENV:'1',HERDR_PANE_ID:'legacy'},{HC_TERMINAL_ID:'t10'},{HC_TERMINAL_SOCKET:f.env.HC_TERMINAL_SOCKET},{...f.env,HC_SOCKET:'other'},{...f.env,HC_TERMINAL_ID:'remote/t10'}]) {
   await assert.rejects(herdrPanel(f.c,false,{...f.options,env}));assert.equal(f.calls.length,0);
  }
  await writeFile(f.c.file+'.panel.json',JSON.stringify({version:1,stage:'submitted'}));
  await assert.rejects(herdrPanel(f.c,false,f.options));assert.equal(f.calls.length,0);
  await assert.rejects(herdrPanel(f.c,false,{...f.options,platform:'darwin'}),/Linux and Windows only/);
 }finally{await dispose(f);}
});
test('missing app, missing record on reconnect, and unavailable core are inert and sanitized',async()=>{
 const f=await fixture();try{
  await assert.rejects(herdrPanel(f.c,true,f.options));assert.equal(f.calls.length,0);
  await assert.rejects(herdrPanel(f.c,false,{...f.options,appRun:async()=>{throw Error('private stderr');}}),e=>!e.message.includes('private'));
  await assert.rejects(herdrPanel(f.c,false,{...f.options,coreRead:async()=>{throw Error('private endpoint');}}),e=>!e.message.includes('private'));
  assert.equal(mutations(f).length,0);await assert.rejects(readFile(f.c.file+'.panel.json'),{code:'ENOENT'});
 }finally{await dispose(f);}
});
test('concurrent app opens share persistent exclusion; no duplicate split',async()=>{
 const f=await fixture();let release;try{
  const gate=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
  const pending=herdrPanel(f.c,false,{...f.options,coreRead:async(...a)=>{entered();await gate;return f.coreRead(...a);}});await ready;
  await assert.rejects(herdrPanel(f.c,false,f.options),/locked/);release();await pending;assert.equal(mutations(f).length,1);
 }finally{release?.();await dispose(f);}
});
test('core endpoint identity changed during launch leaves verification fence',async()=>{
 const f=await fixture();try{
  f.options.coreRead=async(...a)=>{if(a[0]==='hello'&&mutations(f).length)return {generation:1,core:{id:'replacement'}};return f.coreRead(...a);};
  await assert.rejects(herdrPanel(f.c,false,f.options));
  assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'verification_pending');
 }finally{await dispose(f);}
});

test('read-only core transport uses disposable socket/pipe, never CLI autostart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'core-rpc-'));
 const socket=process.platform==='win32'?`\\\\.\\pipe\\servicehost-test-${process.pid}`:join(root,'core.sock');
 const requests=[];
 const server=createServer(s=>{s.once('data',data=>{const req=JSON.parse(data.toString());requests.push(req);s.end(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{generation:1,core:{id:'test'}}})+'\n');});});
 try{
  await new Promise(r=>server.listen(socket,r));
  assert.equal((await readCore(socket,'hello',{generation:1})).core.id,'test');
  assert.deepEqual(requests,[{jsonrpc:'2.0',id:1,method:'hello',params:{generation:1}}]);
  assert.throws(()=>readCore(socket,'terminal.run',{}),/Unsupported/);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
for(const failure of ['invalid-json','wrong-id','error','oversized','closed'])test(`core transport rejects ${failure} without diagnostic leakage`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'core-rpc-'));
 const socket=process.platform==='win32'?`\\\\.\\pipe\\servicehost-test-${process.pid}-${failure}`:join(root,'core.sock');
 const server=createServer(s=>{s.on('error',()=>{});s.once('data',()=>s.end(failure==='closed'?'':failure==='oversized'?'x'.repeat(1024*1024+1):failure==='invalid-json'?'private invalid\n':JSON.stringify({jsonrpc:'2.0',id:failure==='wrong-id'?2:1,error:failure==='error'?{message:'private'}:undefined,result:{}})+'\n'));});
 try{await new Promise(r=>server.listen(socket,r));await assert.rejects(readCore(socket,'hello',{}),e=>!e.message.includes('private'));}
 finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
