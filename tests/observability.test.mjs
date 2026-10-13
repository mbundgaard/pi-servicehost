import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readdir,readFile,rm,symlink,link,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {loadConfig} from '../dist/config.js';
import {Manager,auth} from '../dist/runtime.js';
import {Readiness} from '../dist/readiness.js';
import {logInventory} from '../dist/logs.js';
import {safeText,compact} from '../dist/watch.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await delay(20);}throw Error('timeout');}
async function server(handler){const s=createServer(handler);s.listen(0,'127.0.0.1');await once(s,'listening');return s;}
const probe=(s,extra={})=>({port:s.address().port,path:'/ready',expectedStatus:204,startupTimeoutMs:1000,...extra});
async function fixture(readiness){const root=await mkdtemp(join(tmpdir(),'servicehost-observe-'));const raw={apiPort:19507,logDirectory:'logs',services:[{name:'fixture',command:process.execPath,args:['-e','console.log("hello\\x1b[2J");setTimeout(()=>{},10000)'],workingDirectory:'.',readiness}]};const file=join(root,'ServiceHost.json');await writeFile(file,JSON.stringify(raw));const c=await loadConfig(file);await auth(c);return {root,c,raw,m:new Manager(c)};}
test('readiness validates closed loopback configuration without echoing values',async()=>{
 const {root,c,raw}=await fixture();try{
 for(const readiness of [{port:80,path:'//evil',expectedStatus:200,startupTimeoutMs:100},{port:80,path:'/secret?token=x',expectedStatus:200,startupTimeoutMs:100},{port:80,path:'/',expectedStatus:99,startupTimeoutMs:100},{port:80,path:'/',expectedStatus:200,startupTimeoutMs:120001},{port:80,path:'/',expectedStatus:200,startupTimeoutMs:100,host:'evil'}]){raw.services[0].readiness=readiness;await writeFile(c.file,JSON.stringify(raw));await assert.rejects(loadConfig(c.file),/Invalid readiness/);}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('readiness headers only, timeout, redirect refusal and cancellation',async()=>{
 for(const mode of ['ready','hang','redirect','headers']){
  let count=0;const s=await server((req,res)=>{count++;if(mode==='ready'){res.writeHead(204);res.end();}if(mode==='redirect'){res.writeHead(302,{location:'/ready'});res.end();}if(mode==='headers'){res.writeHead(204,{'x-large':'a'.repeat(9000)});res.end();}});
  const r=new Readiness(probe(s,{startupTimeoutMs:150}));try{await until(()=>r.state!=='pending');assert.equal(r.state,mode==='ready'?'ready':'timed-out');assert.ok(count<=1);}finally{r.cancel();s.closeAllConnections();await new Promise(r=>s.close(r));}
 }
 const s=await server((req,res)=>setTimeout(()=>{res.writeHead(204);res.end();},100));const r=new Readiness(probe(s));r.cancel();await delay(150);assert.equal(r.state,'inactive');s.closeAllConnections();await new Promise(r=>s.close(r));
});
test('readiness is separate from ownership; stop/restart fences old generation; timeout never stops',async()=>{
 let ready=false;const s=await server((req,res)=>{setTimeout(()=>{res.writeHead(ready?204:503);res.end();},50);});
 const {root,m}=await fixture(probe(s,{startupTimeoutMs:200}));try{
  await m.start('fixture');await until(async()=>(await m.status())[0].readiness==='timed-out');assert.equal((await m.status())[0].state,'running');assert.equal(m.canShutdown(),false);
  await m.restart('fixture');await m.stop('fixture');ready=true;await delay(300);assert.equal((await m.status())[0].readiness,'inactive');
  await m.start('fixture');await until(async()=>(await m.status())[0].readiness==='ready');assert.equal((await m.status())[0].state,'running');
 }finally{await m.stop('fixture').catch(()=>{});s.closeAllConnections();await new Promise(r=>s.close(r));await rm(root,{recursive:true,force:true});}
});
test('readiness retries mismatched status, accepts headers without collecting a body, and cancels on natural exit',async()=>{
 let count=0;const s=await server((req,res)=>{res.writeHead(++count<2?503:200);res.flushHeaders();});
 const p=new Readiness(probe(s,{expectedStatus:200}));try{await until(()=>p.state==='ready');assert.equal(count,2);}finally{p.cancel();}
 const {root,c,m}=await fixture(probe(s,{expectedStatus:204}));c.services[0].args=['-e','setTimeout(()=>process.exit(7),100)'];
 try{await m.start('fixture');await until(async()=>(await m.status())[0].exitCode===7);const state=(await m.status())[0];assert.equal(state.readiness,'inactive');assert.equal(state.exitCode,7);assert.equal(state.lastExitCode,7);assert.equal(m.canShutdown(),process.platform!=='linux');await m.stop('fixture');c.services[0].args=['-e','setTimeout(()=>{},10000)'];await m.start('fixture');assert.equal((await m.status())[0].lastExitCode,7);assert.equal((await m.status())[0].exitCode,undefined);}
 finally{await m.stop('fixture').catch(()=>{});s.closeAllConnections();await new Promise(r=>s.close(r));await rm(root,{recursive:true,force:true});}
});
test('follow cursor, bounds, restart reset, escaped rendering and inventory never mutates logs',async()=>{
 const {root,c,m}=await fixture();try{
  await m.start('fixture');await until(async()=>!!(await m.logs('fixture','stdout',100)).text);
  const first=await m.follow('fixture','stdout',100);assert.equal(first.reset,false);assert.match(safeText(first.text),/\\u001b/);assert.ok(!safeText('\u009b\u202e').includes('\u009b'));
  assert.equal((await m.follow('fixture','stdout',100,first.cursor)).text,'');
  const file=(await readdir(c.logDirectory)).find(x=>x.endsWith('stdout.log'));await appendFile(join(c.logDirectory,file),'next');const next=await m.follow('fixture','stdout',2,first.cursor);assert.equal(next.text,'ne');assert.equal(next.cursor.offset,first.cursor.offset+2);
  await assert.rejects(m.follow('fixture','stdout',1,{launchId:first.cursor.launchId,offset:-1}),/cursor/);await assert.rejects(m.follow('fixture','stdout',65537),/limit/);
  const truncated=await m.follow('fixture','stdout',100,{launchId:first.cursor.launchId,offset:Number.MAX_SAFE_INTEGER});assert.equal(truncated.reset,true);
  await m.restart('fixture');assert.equal((await m.follow('fixture','stdout',100,first.cursor)).reset,true);
  await m.stop('fixture');const before=await readFile(join(c.logDirectory,file));
  await writeFile(join(c.logDirectory,'unrelated.log'),'keep');await symlink(join(c.logDirectory,file),join(c.logDirectory,`fixture-${'a'.repeat(24)}.stdout.log`));await mkdir(join(c.logDirectory,`fixture-${'b'.repeat(24)}.stdout.log`));await link(join(c.logDirectory,file),join(c.logDirectory,`fixture-${'c'.repeat(24)}.stdout.log`));
  const inventory=await logInventory(c,100);assert.equal(inventory.dryRun,true);assert.ok(inventory.entries.every(e=>e.disposition==='retained-inactivity-unproven'));assert.ok(!inventory.entries.some(e=>e.file===file));assert.equal(inventory.entries.length,3);
  const bounded=await logInventory(c,1);assert.equal(bounded.scanned,1);assert.equal(bounded.truncated,true);await assert.rejects(logInventory(c,1001),/limit/);assert.deepEqual(await readFile(join(c.logDirectory,file)),before);
  const narrow=compact([{name:'fixture',state:'running',readiness:'ready'}],12);assert.ok(narrow.split('\n').every(line=>line.length<=12));assert.match(narrow.replaceAll('\n',''),/ready:"ready"  exit:\?/);
 }finally{await m.stop('fixture').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
