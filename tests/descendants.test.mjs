import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../dist/config.js';
import {auth,Manager} from '../dist/runtime.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {request} from '../dist/client.js';
import {LinuxGroup} from '../dist/linux-group.js';
import {fileURLToPath} from 'node:url';
async function liveGroup(pgid){
 const result=[];for(const pid of await readdir('/proc')){if(!/^\d+$/.test(pid))continue;
 try{const s=await readFile(`/proc/${pid}/stat`,'utf8');const f=s.slice(s.lastIndexOf(')')+2).split(' ');if(Number(f[2])===pgid&&!['Z','X'].includes(f[0]))result.push(Number(pid));}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}}
 return result;
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await delay(20);}throw Error('fixture timeout');}
async function fixture(parentExit=false,ignore=false,escape=false){
 const root=await mkdtemp(join(tmpdir(),'servicehost-group-'));
 // Every fixture self-expires even when an assertion fails. No cleanup by PID.
 await writeFile(join(root,'leaf.cjs'),`console.log('leaf-ready');console.error('leaf-error');${ignore?'process.on("SIGTERM",()=>{});':''}setTimeout(()=>process.exit(0),8000);`);
 await writeFile(join(root,'middle.cjs'),`require('child_process').spawn(process.execPath,['leaf.cjs'],{stdio:['ignore',1,2],detached:${escape}});console.log('middle-ready');setTimeout(()=>process.exit(0),8000);`);
 await writeFile(join(root,'parent.cjs'),`require('child_process').spawn(process.execPath,['middle.cjs'],{stdio:['ignore',1,2]});console.log('parent-ready');setTimeout(()=>process.exit(0),${parentExit?400:8000});`);
 await writeFile(join(root,'ServiceHost.json'),JSON.stringify({apiPort:19503,logDirectory:'logs',services:[{name:'tree',command:process.execPath,args:['parent.cjs'],workingDirectory:'.'}]}));
 const c=await loadConfig(join(root,'ServiceHost.json'));await auth(c);return {root,c,m:new Manager(c)};
}
for(const natural of [false,true])test(`Linux group drains child/grandchild, natural parent exit=${natural}, restart preserves logs`,{skip:process.platform!=='linux',timeout:20000},async()=>{
 const {root,m}=await fixture(natural);
 try {
  await m.start('tree');await until(async()=>/leaf-ready/.test((await m.logs('tree','stdout',4096)).text));
  if(natural)await until(async()=>(await m.status())[0].state!=='running');
  assert.equal(m.canShutdown(),false);
  const files=await readdir(join(root,'logs'));const old=await Promise.all(files.map(f=>readFile(join(root,'logs',f),'utf8')));
  assert.match((await m.logs('tree','stderr',4096)).text,/leaf-error/);
  const {pgid}=JSON.parse(await readFile(join(root,'.servicehost','tree.lease.json'),'utf8'));
  assert.ok((await liveGroup(pgid)).length>=3);
  const result=await m.stop('tree');assert.equal(result.scope,'linux-process-group');assert.ok(m.canShutdown());assert.deepEqual(await liveGroup(pgid),[]);
  await m.start('tree');await until(async()=>/leaf-ready/.test((await m.logs('tree','stdout',4096)).text));await m.restart('tree');await m.stop('tree');
  assert.deepEqual(await Promise.all(files.map(f=>readFile(join(root,'logs',f),'utf8'))),old);
 }finally{await m.stop('tree').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
test('Linux runtime death disconnects anchor: survivors log, stale lease cannot signal or relaunch',{skip:process.platform!=='linux',timeout:15000},async()=>{
 const {root,c}=await fixture();let runtime;
 try{
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');c.apiPort=probe.address().port;await new Promise(r=>probe.close(r));
  const raw=JSON.parse(await readFile(c.file,'utf8'));raw.apiPort=c.apiPort;await writeFile(c.file,JSON.stringify(raw));
  await writeFile(join(root,'leaf.cjs'),`console.log('leaf-ready');setInterval(()=>console.log('heartbeat'),100);setTimeout(()=>process.exit(0),2500);`);
  // Other ancestors also expire shortly, independent of runtime health.
  for(const f of ['middle.cjs','parent.cjs'])await writeFile(join(root,f),(await readFile(join(root,f),'utf8')).replaceAll('8000','2500'));
  runtime=spawn(process.execPath,[fileURLToPath(new URL('../dist/cli.js',import.meta.url)),'serve','--config',c.file],{stdio:'ignore'});
  await until(async()=>{try{await request(c,{action:'ping'});return true;}catch{return false;}});
  await request(c,{action:'start',name:'tree'});await until(async()=>/leaf-ready/.test((await request(c,{action:'logs',name:'tree'})).text));
  const files=await readdir(join(root,'logs'));const output=join(root,'logs',files.find(f=>f.includes('stdout')));const before=await readFile(output,'utf8');
  const closed=once(runtime,'close');runtime.kill('SIGKILL');await closed;
  const recovered=new Manager(c);await assert.rejects(recovered.stop('tree'),/Only a direct child/);await assert.rejects(recovered.start('tree'),/Stale launch lease/);
  await delay(300);assert.ok((await readFile(output,'utf8')).length>before.length);assert.deepEqual(await readdir(join(root,'logs')),files);
 }finally{if(runtime&&runtime.exitCode===null&&runtime.signalCode===null){const closed=once(runtime,'close');runtime.kill();await closed;}await delay(2700);await rm(root,{recursive:true,force:true});}
});
test('Lost anchor never falls back to saved PGID signaling',{skip:process.platform!=='linux',timeout:10000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'servicehost-anchor-'));const out=await open(join(root,'out'),'wx');let group;
 try{
  group=new LinuxGroup(process.execPath,['-e','console.log("ready");setInterval(()=>console.log("alive"),50);setTimeout(()=>process.exit(0),1500)'],root,process.env,out.fd,out.fd,()=>{});
  await group.ready;await until(async()=>/ready/.test(await readFile(join(root,'out'),'utf8')));
  const closed=once(group.anchor,'close');group.anchor.kill('SIGKILL');await closed;
  await assert.rejects(group.stop(),/anchor lost/);
  const before=await readFile(join(root,'out'),'utf8');await delay(150);assert.ok((await readFile(join(root,'out'),'utf8')).length>before.length);
 }finally{await delay(1600);await out.close();await rm(root,{recursive:true,force:true});}
});
test('Escaped setsid descendant is outside group scope (not a tree guarantee)',{skip:process.platform!=='linux',timeout:15000},async()=>{
 const {root,m}=await fixture(false,false,true);
 try{
  await writeFile(join(root,'leaf.cjs'),'console.log("leaf-ready");setInterval(()=>console.log("escaped-alive"),50);setTimeout(()=>process.exit(0),1500)');
  await m.start('tree');await until(async()=>/leaf-ready/.test((await m.logs('tree','stdout',4096)).text));await m.stop('tree');
  const before=(await m.logs('tree','stdout',4096)).text;await delay(150);assert.ok((await m.logs('tree','stdout',4096)).text.length>before.length);
 }finally{await m.stop('tree').catch(()=>{});await delay(1600);await rm(root,{recursive:true,force:true});}
});
test('Linux TERM-resistant group times out and fences restart without truncation',{skip:process.platform!=='linux',timeout:20000},async()=>{
 const {root,m}=await fixture(false,true);
 try {
  await m.start('tree');await until(async()=>/leaf-ready/.test((await m.logs('tree','stdout',4096)).text));const files=await readdir(join(root,'logs'));
  await assert.rejects(m.stop('tree'),/timed out/);assert.equal(m.canShutdown(),false);
  await assert.rejects(m.start('tree'),/Stale launch lease/);assert.deepEqual(await readdir(join(root,'logs')),files);
  await delay(3200);await m.stop('tree');assert.ok(m.canShutdown());
 }finally{await delay(3000);await m.stop('tree').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
