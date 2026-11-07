import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,win32} from 'node:path';
import {createServer} from 'node:net';
import {herdrPanel,panelCLI} from '../dist/herdr.js';
import {readCore,directPanelArgv,tabPanelArgv} from '../dist/herdr-app.js';

test('direct Windows argv preserves drive/UNC and shell syntax as data without PowerShell',()=>{
 const node="C:\\Program Files\\O'Brien\\node.exe",cli='C:\\包 # % &\\dist\\cli.js';
 for(const config of ["C:\\a b\\smart ’ ' $(evil); 雪😀.json",'\\\\server\\share\\$HOME %PATH% ! ` &\\config.json'])
  assert.deepEqual(JSON.parse(JSON.stringify(directPanelArgv(config,cli,node))),[node,cli,'panel','--connect-only','--config',config]);
});

// Shapes from app v0.1.13 window.rs::world/mirror.rs and core v0.1.18 schema.
// No real Herdr mutation or terminal is used by this suite.
async function fixture(platform='linux',placement='split') {
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
  if(args[0]==='commands')return JSON.stringify([{name:'pane.split',args:['direction','pane','argv'].map(name=>({name}))},{name:'tab.new',args:['space','name','folder','argv'].map(name=>({name}))}]);
  if(placement==='tab') {
   assert.deepEqual(args.slice(0,2),['do','tab.new']);
   assert.deepEqual(JSON.parse(args[2]),{space:'sp-local',name:'ServiceHost',folder:(platform==='win32'?win32.dirname:dirname)(c.file),argv:directPanelArgv(c.file,panelCLI)});
   world.spaces[0].tabs.push({id:'tb-panel',terminals:[pane]});
   document.value.spaces[0].tabs.push({id:'tb-panel',root:{id:pane.pane,type:'block',content:{terminal:pane.terminal}}});
   panelRecord.labels={...labels,'herdr.tab':'tb-panel'};
   panelRecord.cwd=(platform==='win32'?win32.dirname:dirname)(c.file);
   panelRecord.argv=tabPanelArgv(directPanelArgv(c.file,panelCLI),platform==='win32'?'pwsh.exe':'/bin/bash',platform);
   return JSON.stringify({space:'sp-local',tab:'tb-panel',terminal:pane.terminal});
  }
  assert.deepEqual(args.slice(0,2),['do','pane.split']);
  const request=JSON.parse(args[2]);assert.deepEqual(request,{direction:'down',pane:'p-caller',argv:panelRecord.argv});
  world.spaces[0].tabs[0].terminals.push(pane);
  document.value.spaces[0].tabs[0].root={id:'column',type:'column',children:[document.value.spaces[0].tabs[0].root,{id:pane.pane,type:'block',content:{terminal:pane.terminal}}]};
  document.version++;
  return JSON.stringify({pane:pane.pane,terminal:pane.terminal});
 };
 const coreRead=async(method,params)=>{
  calls.push(['core',method,params]);
  if(method==='hello')return hello;
  if(method==='doc.get'){assert.deepEqual(params,{name:'herdr-app'});return structuredClone(document);}
  assert.equal(method,'terminal.get');
  assert.ok(['t10','t11'].includes(params.terminal),'no unrelated terminal observations');
  return params.terminal==='t10'?callerRecord:panelRecord;
 };
 const coreSet=async params=>{
  calls.push(['core','doc.set',params]);
  assert.equal(JSON.parse(await readFile(c.file+'.panel.json','utf8')).stage,'reorder_pending');
  assert.equal(params.name,'herdr-app');assert.equal(params.version,document.version);
  document.value=structuredClone(params.value);document.version++;
  world.spaces[0].tabs[0].terminals=[pane,caller];
  return {version:document.version};
 };
 return {root,c,env,world,document,callerRecord,panelRecord,hello,pane,calls,appRun,coreRead,coreSet,options:{env,platform,appRun,coreRead,coreSet}};
}
const dispose=f=>rm(f.root,{recursive:true,force:true});
for(const platform of ['linux','win32'])test(`app/core ${platform} named tab uses caller space, project cwd, exact wrapper and creation-only placement`,async()=>{
 const f=await fixture(platform,'tab');try{
  // An unrelated space/tab exists; the command must still name the caller's space.
  f.world.spaces.push({id:'sp-other',machine:null,tabs:[{id:'tb-other',terminals:[{pane:'p-other',terminal:'t20'}]}]});
  const result=await herdrPanel(f.c,false,{...f.options,placement:'tab'});
  assert.equal(result.placement,'tab');assert.equal(result.tab,'tb-panel');assert.equal(result.focusChanged,true);
  const record=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));
  assert.equal(record.version,3);assert.equal(record.callerTab,'tb-local');assert.equal(record.tab,'tb-panel');assert.equal(record.placement,'tab');
  assert.equal(mutations(f).length,1);
  f.calls.length=0;
  assert.equal((await herdrPanel(f.c,false,{...f.options,placement:'split'})).placement,'tab');
  assert.equal((await herdrPanel(f.c,true,f.options)).focusChanged,false);assert.equal(mutations(f).length,0);
  f.panelRecord.argv.push('unexpected');await assert.rejects(herdrPanel(f.c,true,f.options));assert.equal(mutations(f).length,0);
 }finally{await dispose(f);}
});
for(const platform of ['linux','win32'])for(const failure of ['lost','verify','wrong-space','old-tab','cwd','layout','wrapper'])test(`app/core ${platform} tab ${failure} leaves fence without retry`,async()=>{
 const f=await fixture(platform,'tab');try{
  f.options.appRun=async args=>{
   if(args[0]==='do') {
    assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'tab_pending');
    const reply=JSON.parse(await f.appRun(args));
    if(failure==='lost')throw Error('private');
    if(failure==='wrong-space')reply.space='elsewhere';
    if(failure==='old-tab')reply.tab='tb-local';
    if(failure==='cwd')f.panelRecord.cwd='/wrong';
    if(failure==='layout')f.document.value.spaces[0].tabs.pop();
    if(failure==='wrapper')f.panelRecord.argv=['/bin/sh','-c','unsafe'];
    return JSON.stringify(reply);
   }
   if(failure==='verify'&&args[0]==='ls'&&mutations(f).length)throw Error('private');
   return f.appRun(args);
  };
  await assert.rejects(herdrPanel(f.c,false,{...f.options,placement:'tab'}),e=>!e.message.includes('private'));
  const record=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));assert.notEqual(record.stage,'submitted');
  f.calls.length=0;
  for(const reconnect of [false,true])await assert.rejects(herdrPanel(f.c,reconnect,f.options));
  assert.equal(f.calls.length,0);
 }finally{await dispose(f);}
});
test('app split reuse ignores requested tab, v2 remains compatible, invalid placement is inert',async()=>{
 const f=await fixture();try{
  for(const placement of ['other',null,1])await assert.rejects(herdrPanel(f.c,false,{...f.options,placement}),/Invalid panel placement/);
  await assert.rejects(herdrPanel(f.c,true,{...f.options,placement:'tab'}),/Reconnect/);assert.equal(f.calls.length,0);
  await herdrPanel(f.c,false,f.options);
  assert.equal((await herdrPanel(f.c,false,{...f.options,placement:'tab'})).placement,'split');assert.equal(mutations(f).length,1);
  const record=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));record.version=2;delete record.placement;delete record.callerTab;
  await writeFile(f.c.file+'.panel.json',JSON.stringify(record));f.calls.length=0;
  assert.equal((await herdrPanel(f.c,false,{...f.options,placement:'tab'})).placement,'split');assert.equal(mutations(f).length,0);
  record.stage='split_pending';await writeFile(f.c.file+'.panel.json',JSON.stringify(record));
  await assert.rejects(herdrPanel(f.c,false,{...f.options,placement:'tab'}));
 }finally{await dispose(f);}
});
test('concurrent tab/split opens never duplicate the display',async()=>{
 const f=await fixture('linux','tab');let release;try{
  let entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const pending=herdrPanel(f.c,false,{...f.options,placement:'tab',coreRead:async(...args)=>{entered();await gate;return f.coreRead(...args);}});
  await ready;await assert.rejects(herdrPanel(f.c,false,f.options),/locked/);release();await pending;assert.equal(mutations(f).length,1);
 }finally{release?.();await dispose(f);}
});
test('tab wrapper matches source-derived Linux bash/fish and Windows smart-quote contracts',()=>{
 const argv=['C:\\雪 \\node.exe',"a'‘’‚‛ $HOME $(evil); &",'--connect-only'];
 assert.deepEqual(tabPanelArgv(argv,'/bin/bash','linux'),['/bin/bash','-ic','"$@"; exec "$0" -i','/bin/bash',...argv]);
 assert.deepEqual(tabPanelArgv(argv,'/usr/bin/fish','linux'),['/usr/bin/fish','-ic','command $argv[2..]; exec $argv[1] -i','/usr/bin/fish',...argv]);
 const wrapped=tabPanelArgv(argv,'powershell.exe','win32');
 assert.deepEqual(wrapped,['powershell.exe','-NoExit','-Command',"& 'C:\\雪 \\node.exe' 'a''‘‘’’‚‚‛‛ $HOME $(evil); &' '--connect-only'"]);
 assert.throws(()=>tabPanelArgv(argv,'cmd.exe','win32'));
});
const mutations=f=>f.calls.filter(c=>c[0]==='app'&&c[1]==='do');
for(const platform of ['linux','win32'])test(`app/core ${platform}: explicit direct argv split, focus contract, versioned identity and read-only reuse`,async()=>{
 const f=await fixture(platform);try{
  const result=await herdrPanel(f.c,false,f.options);
  assert.equal(result.pane,'p-panel');assert.equal(result.terminal,'t11');assert.equal(result.runtimeStarted,false);assert.equal(result.focusChanged,true);assert.match(result.outcome,/readiness not verified/);
  const record=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));
  assert.equal(record.version,3);assert.equal(record.backend,'app-core');assert.equal(record.core,'core-unique');assert.equal(record.stage,'submitted');assert.equal(record.created,456);
  assert.ok(!JSON.stringify(record).includes('argv'));
  assert.deepEqual(f.document.value.spaces[0].tabs[0].root.children.map(n=>n.id),['p-panel','p-caller']);
  assert.equal(f.calls.filter(c=>c[1]==='doc.set').length,1);
  assert.match(result.outcome,/above caller/);
  assert.equal(mutations(f).length,1);
  const args=JSON.parse(mutations(f)[0][3]);assert.deepEqual(args.argv,[process.execPath,panelCLI,'panel','--connect-only','--config',f.c.file]);
  assert.ok(!JSON.stringify(args).includes('powershell'));
  for(const reconnect of [false,true]) {
   f.calls.length=0;const reused=await herdrPanel(f.c,reconnect,f.options);
   assert.equal(reused.focusChanged,false);assert.match(reused.outcome,/foreground process and panel readiness not verified/);assert.equal(mutations(f).length,0);assert.ok(!f.calls.some(c=>c[1]==='doc.set'));
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

for(const failure of ['conflict','lost','bad-ack','wrong-order','app-stale','bad-pair'])test(`above split ${failure} remains fenced without another mutation`,async()=>{
 const f=await fixture();try{
  f.options.coreSet=async params=>{
   if(failure==='conflict') {f.calls.push(['core','doc.set',params]);throw Error('private conflict');}
   const ack=await f.coreSet(params);
   if(failure==='lost')throw Error('private lost acknowledgement');
   if(failure==='bad-ack')return {};
   if(failure==='wrong-order')f.document.value.spaces[0].tabs[0].root.children.reverse();
   if(failure==='app-stale')f.world.spaces[0].tabs[0].terminals.reverse();
   return ack;
  };
  if(failure==='bad-pair')f.options.appRun=async args=>{
   const r=await f.appRun(args);if(args[0]==='do')f.document.value.spaces[0].tabs[0].root.type='row';return r;
  };
  await assert.rejects(herdrPanel(f.c,false,f.options),e=>!e.message.includes('private'));
  const state=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));
  assert.equal(state.stage,['conflict','lost','bad-ack'].includes(failure)?'reorder_pending':'verification_pending');
  assert.equal(f.calls.filter(c=>c[1]==='doc.set').length,failure==='bad-pair'?0:1);
  f.calls.length=0;
  for(const reconnect of [false,true])await assert.rejects(herdrPanel(f.c,reconnect,f.options));
  assert.equal(f.calls.length,0);
 }finally{await dispose(f);}
});
test('above CAS preserves unrelated layout nodes and properties in a shared column',async()=>{
 const f=await fixture();try{
  const other={id:'p-other',type:'block',content:{terminal:'t20'},size:{weight:7}};
  f.options.appRun=async args=>{
   const r=await f.appRun(args);
   if(args[0]==='do')f.document.value.spaces[0].tabs[0].root.children.unshift(structuredClone(other));
   return r;
  };
  await herdrPanel(f.c,false,f.options);
  const children=f.document.value.spaces[0].tabs[0].root.children;
  assert.deepEqual(children.map(n=>n.id),['p-other','p-panel','p-caller']);assert.deepEqual(children[0],other);
 }finally{await dispose(f);}
});

test('above split production CAS transport writes once to the inherited disposable endpoint',async()=>{
 const f=await fixture(process.platform);const requests=[];
 const server=createServer(s=>{s.once('data',async data=>{
  const req=JSON.parse(data.toString());requests.push(req);
  const result=await f.coreSet(req.params);
  s.end(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');
 });});
 try{
  await new Promise(r=>server.listen(f.env.HC_TERMINAL_SOCKET,r));
  delete f.options.coreSet;
  await herdrPanel(f.c,false,f.options);
  assert.equal(requests.length,1);assert.equal(requests[0].method,'doc.set');
  assert.equal(requests[0].params.version,6);
  assert.deepEqual(requests[0].params.value.spaces[0].tabs[0].root.children.map(n=>n.id),['p-panel','p-caller']);
  await herdrPanel(f.c,true,f.options);assert.equal(requests.length,1);
 }finally{await new Promise(r=>server.close(r));await dispose(f);}
});
test('above placement waits only for observations, never repeats its CAS',async()=>{
 const f=await fixture();try{
  let staleReads=0;
  f.options.coreRead=async(method,params)=>{
   const r=await f.coreRead(method,params);
   if(method==='doc.get'&&f.calls.some(c=>c[1]==='doc.set')&&staleReads++<2)r.value.spaces[0].tabs[0].root.children.reverse();
   return r;
  };
  await herdrPanel(f.c,false,f.options);
  assert.equal(f.calls.filter(c=>c[1]==='doc.set').length,1);assert.ok(staleReads>=3);
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
