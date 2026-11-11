import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,win32} from 'node:path';
import {herdrPanel,panelCLI} from '../dist/herdr.js';

async function fixture(platform='linux') {
 const root=await mkdtemp(join(tmpdir(),'core-display-'));
 const c={file:join(root,"config 雪 ’ $HOME &.json"),id:'project'};
 const env={HC_TERMINAL_ID:'t10',HC_TERMINAL_SOCKET:platform==='win32'?'\\\\.\\pipe\\core-display-test':join(root,'core.sock'),HERDR_APP_HOME:join(root,'does-not-exist')};
 const doc={version:5,value:{spaces:[{id:'space',name:'work',folder:'/work',tabs:[{id:'tab',name:'caller',root:{id:'tab',type:'row',children:[{id:'caller',type:'block',size:{weight:3},content:{terminal:'t10'}},{id:'other',type:'block',content:{terminal:'t20'}}]}}]}]}};
 const caller={address:'t10',created_ms:123,state:'live',labels:{'herdr.space':'space','herdr.tab':'tab'}};
 const hello={generation:1,core:{id:'core-id'},methods:['terminal.run','terminal.get','doc.get','doc.set']};
 const calls=[];let terminal;
 const options={env,platform,
  coreRead:async(m,p)=>{calls.push([m,p]);if(m==='hello')return structuredClone(hello);if(m==='doc.get')return structuredClone(doc);assert.equal(m,'terminal.get');assert.ok(['t10','t11'].includes(p.terminal));return structuredClone(p.terminal==='t10'?caller:terminal);},
  coreRun:async p=>{calls.push(['terminal.run',p]);assert.equal(JSON.parse(await readFile(c.file+'.panel.json','utf8')).stage,'run_pending');assert.equal(p.no_parent,true);assert.equal(p.outlive_parent,true);assert.equal(p.keep,false);assert.equal(p.wait,false);assert.equal(p.no_notify,true);assert.deepEqual(p.argv,[process.execPath,panelCLI,'panel','--connect-only','--config',c.file]);assert.equal(p.cwd,(platform==='win32'?win32.dirname:dirname)(c.file));assert.equal(p.labels['herdr.space'],undefined);terminal={address:'t11',created_ms:456,state:'live',parent:null,die_with_parent:false,argv:p.argv,cwd:p.cwd,labels:p.labels};return structuredClone(terminal);},
  coreSet:async p=>{calls.push(['doc.set',p]);assert.equal(JSON.parse(await readFile(c.file+'.panel.json','utf8')).stage,'registration_pending');assert.equal(p.version,doc.version);doc.value=structuredClone(p.value);doc.version++;return {version:doc.version};}
 };
 return {root,c,env,doc,caller,hello,calls,options,get terminal(){return terminal;}};
}
const effects=f=>f.calls.filter(c=>['terminal.run','doc.set'].includes(c[0]));
const dispose=f=>rm(f.root,{recursive:true,force:true});
for(const platform of ['linux','win32'])for(const placement of ['split','tab'])test(`no local app: ${platform} ${placement} persists display, direct argv and lifetime; reconnect is read-only`,async()=>{
 const f=await fixture(platform);try {
  const before=structuredClone(f.doc);
  await herdrPanel(f.c,false,{...f.options,placement,preflight:true});assert.equal(effects(f).length,0);await assert.rejects(readFile(f.c.file+'.panel.json'),{code:'ENOENT'});
  const r=await herdrPanel(f.c,false,{...f.options,placement});assert.equal(r.backend,'core-document');assert.equal(r.displayRegistered,true);assert.equal(r.viewerObserved,false);assert.equal(r.focusChanged,false);assert.equal(effects(f).length,2);
  const s=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));assert.equal(s.version,4);assert.equal(s.stage,'submitted');assert.equal(s.core,'core-id');assert.equal(s.created,456);
  const tabs=f.doc.value.spaces[0].tabs;
  if(placement==='split') {
   const group=tabs[0].root.children[0];assert.equal(group.type,'column');assert.deepEqual(group.size,{weight:3});assert.equal(group.children[0].id,s.pane);assert.equal(group.children[0].content.terminal,'t11');assert.equal(group.children[1].id,'caller');assert.equal(group.children[1].size,undefined);assert.deepEqual(tabs[0].root.children[1],before.value.spaces[0].tabs[0].root.children[1]);
  } else {assert.deepEqual(tabs[0],before.value.spaces[0].tabs[0]);assert.equal(tabs[1].name,'ServiceHost');assert.equal(tabs[1].root.id,s.pane);assert.equal(tabs[1].id,s.tab);}
  f.calls.length=0;
  assert.equal((await herdrPanel(f.c,false,{...f.options,placement:placement==='tab'?'split':'tab'})).placement,placement);
  assert.equal((await herdrPanel(f.c,true,f.options)).viewerObserved,false);assert.equal(effects(f).length,0);
 }finally{await dispose(f);}
});
for(const failure of ['run-lost','invalid-ack','cas-conflict','cas-lost','doc-observation','argv','cwd','lifetime','incarnation','core-change'])test(`core display ${failure} permanently fences uncertain launch`,async()=>{
 const f=await fixture();try {
  const run=f.options.coreRun,set=f.options.coreSet,read=f.options.coreRead;
  f.options.coreRun=async p=>{const r=await run(p);if(failure==='run-lost')throw Error('secret');if(failure==='invalid-ack')return {address:'machine/t11'};if(failure==='argv')f.terminal.argv=['bad'];if(failure==='cwd')f.terminal.cwd='/bad';if(failure==='lifetime')f.terminal.die_with_parent=true;if(failure==='core-change')f.hello.core.id='other';return r;};
  f.options.coreSet=async p=>{if(failure==='cas-conflict'){f.calls.push(['doc.set',p]);throw Error('conflict');}const r=await set(p);if(failure==='cas-lost')throw Error('secret');return r;};
  f.options.coreRead=async(m,p)=>{if(failure==='doc-observation'&&m==='doc.get'&&effects(f).length===2)throw Error('secret');return read(m,p);};
  if(failure==='incarnation') {await herdrPanel(f.c,false,f.options);f.terminal.created_ms++;await assert.rejects(herdrPanel(f.c,true,f.options));}
  else {await assert.rejects(herdrPanel(f.c,false,f.options),e=>!e.message.includes('secret'));const state=JSON.parse(await readFile(f.c.file+'.panel.json','utf8'));assert.notEqual(state.stage,'submitted');}
  f.calls.length=0;for(const reconnect of [true,false])await assert.rejects(herdrPanel(f.c,reconnect,f.options));assert.equal(effects(f).length,0);
 }finally{await dispose(f);}
});
for(const failure of ['missing-document','unmapped-caller','remote-id','duplicate-pane','duplicate-terminal','labels','unknown-node','no-api','conflicting-endpoint','hidden-float-alias'])test(`invalid core mapping ${failure} fails before launch`,async()=>{
 const f=await fixture();try {
  const root=f.doc.value.spaces[0].tabs[0].root;
  if(failure==='missing-document')f.doc.version=0;
  if(failure==='unmapped-caller')f.env.HC_TERMINAL_ID='t99';
  if(failure==='remote-id')f.env.HC_TERMINAL_ID='remote/t10';
  if(failure==='duplicate-pane')root.children[1].id='caller';
  if(failure==='duplicate-terminal')root.children[1].content.terminal='t10';
  if(failure==='labels')f.caller.labels['herdr.space']='another';
  if(failure==='unknown-node')root.type='unknown';
  if(failure==='no-api')f.hello.methods=[];
  if(failure==='conflicting-endpoint')f.env.HC_SOCKET='/other';
  if(failure==='hidden-float-alias')root.floating=[{id:'float',content:{terminal:'t10'}}];
  await assert.rejects(herdrPanel(f.c,false,{...f.options,preflight:true}));assert.equal(effects(f).length,0);await assert.rejects(readFile(f.c.file+'.panel.json'),{code:'ENOENT'});
 }finally{await dispose(f);}
});
test('concurrent direct-core display requests cannot create duplicates',async()=>{
 const f=await fixture();let release;try {
  let entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const read=f.options.coreRead;
  const pending=herdrPanel(f.c,false,{...f.options,coreRead:async(...a)=>{entered();await gate;return read(...a);}});
  await ready;await assert.rejects(herdrPanel(f.c,false,f.options),/locked/);release();await pending;assert.equal(effects(f).length,2);
 }finally{release?.();await dispose(f);}
});
