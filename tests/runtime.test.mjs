import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { loadConfig } from '../dist/config.js';
import { serve, auth } from '../dist/runtime.js';
import { request, up } from '../dist/client.js';
import { identity } from '../dist/platform.js';

async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'servicehost-test-'));const apiPort=await freePort();let port=await freePort();while(port===apiPort)port=await freePort();
 const config={apiPort,logDirectory:'logs',services:[{name:'fixture',command:process.execPath,args:['fixture.cjs'],workingDirectory:'.',port,environment:{FIXTURE_SECRET:'${credential:secret}',FIXTURE_PORT:String(port)}}]};
 await writeFile(join(root,'ServiceHost.json'),JSON.stringify(config));await writeFile(join(root,'ServiceHost.credentials.json'),JSON.stringify({secret:'private-value'}));
 await writeFile(join(root,'fixture.cjs'),`require('node:net').createServer().listen(Number(process.env.FIXTURE_PORT),'127.0.0.1',()=>{console.log('READY '+process.env.FIXTURE_SECRET);console.error('stderr-line')});`);
 return {root,c:await loadConfig(join(root,'ServiceHost.json')),config};
}
async function ready(c){for(let i=0;i<100;i++){const d=await request(c,{action:'discover',name:'fixture'});if(d.length)return d;await new Promise(r=>setTimeout(r,50));}throw Error('not listening');}

test('managed lifecycle, identity, credentials, logs, leases, auth and port conflict',async()=>{
 const {root,c}=await fixture(); const runtime=await serve(c.file);
 try {
  assert.equal((await request(c,{action:'ping'})).project,c.id);
  await assert.rejects(serve(c.file),/EADDRINUSE/);
  const bad=await fetch(`http://127.0.0.1:${c.apiPort}/v1`,{method:'POST',body:'{}'});assert.equal(bad.status,403);
  const token=await auth(c);
  const origin=await fetch(`http://127.0.0.1:${c.apiPort}/v1`,{method:'POST',headers:{authorization:`Bearer ${token}`,'x-servicehost-project':c.id,origin:'https://evil.invalid'}});assert.equal(origin.status,403);
  await request(c,{action:'start',name:'fixture'});const ids=await ready(c);assert.equal(ids.length,1);
  assert.deepEqual(await identity(ids[0].pid),ids[0]);
  const status=await request(c,{action:'status'});assert.equal(status.services[0].state,'running');assert.ok(!JSON.stringify(status).includes('private-value'));
  assert.match((await request(c,{action:'logs',name:'fixture'})).text,/READY private-value/); // arbitrary child logs are NOT redacted
  assert.match((await request(c,{action:'logs',name:'fixture',stream:'stderr'})).text,/stderr-line/);
  await assert.rejects(request(c,{action:'logs',name:'fixture',bytes:65537}),/Invalid/);
  await assert.rejects(request(c,{action:'logs',name:'../token'}),/Unknown service/);
  await assert.rejects(request(c,{action:'shutdown'}),/still running/);
  await assert.rejects(request(c,{action:'start',name:'fixture'}),/already running/);
  const logsBefore=await readdir(join(root,'logs'));const oldContent=await readFile(join(root,'logs',logsBefore.find(x=>x.includes('stdout'))),'utf8');
  await request(c,{action:'restart',name:'fixture'});await ready(c);
  assert.equal((await readdir(join(root,'logs'))).length,4);assert.equal(await readFile(join(root,'logs',logsBefore.find(x=>x.includes('stdout'))),'utf8'),oldContent);
  await request(c,{action:'stop',name:'fixture'});
  await writeFile(join(root,'.servicehost','fixture.lease.json'),'{}');
  await assert.rejects(request(c,{action:'start',name:'fixture'}),/Stale launch lease/);
  assert.equal((await request(c,{action:'status'})).services[0].state,'blocked-stale-lease');
 } finally {
  await runtime.manager.stop('fixture').catch(()=>{});await new Promise(r=>runtime.server.close(r));await rm(root,{recursive:true,force:true});
 }
});

test('explicit adoption rechecks identity and grants no signal/log authority',async()=>{
 const {root,c}=await fixture(); const runtime=await serve(c.file);const s=net.createServer();s.listen(c.services[0].port,'127.0.0.1');await once(s,'listening');
 try {
  await assert.rejects(request(c,{action:'start',name:'fixture'}),/Port already listening/);
  const found=await request(c,{action:'discover',name:'fixture'});const me=found.find(p=>p.pid===process.pid);assert.ok(me);
  await assert.rejects(request(c,{action:'adopt',name:'fixture',expected:{...me,identity:'0'.repeat(64)}}),/identity changed/);
  assert.equal((await request(c,{action:'adopt',name:'fixture',expected:me})).mode,'observe-only');
  assert.equal((await request(c,{action:'status'})).services[0].output,'unavailable');
  await assert.rejects(request(c,{action:'stop',name:'fixture'}),/Only a direct child/);
  await assert.rejects(request(c,{action:'logs',name:'fixture'}),/unavailable/);
 } finally {await new Promise(r=>s.close(r));await new Promise(r=>runtime.server.close(r));await rm(root,{recursive:true,force:true});}
});

test('detached runtime survives launcher, reconnect does not truncate logs',async()=>{
 const {root,c}=await fixture();let started=false;
 try {
  await up(c);started=true;await request(c,{action:'start',name:'fixture'});await ready(c);
  const before=await readdir(join(root,'logs'));assert.equal((await up(c)).existing,true);
  assert.deepEqual(await readdir(join(root,'logs')),before);
  await request(c,{action:'stop',name:'fixture'});await request(c,{action:'shutdown'});started=false;
 } finally {
  if(started){await request(c,{action:'stop',name:'fixture'}).catch(()=>{});await request(c,{action:'shutdown'}).catch(()=>{});}
  await new Promise(r=>setTimeout(r,200));await rm(root,{recursive:true,force:true});
 }
});

test('config validation and relative path source of truth',async()=>{
 const {root,c,config}=await fixture();
 try {
  assert.equal(c.services[0].workingDirectory,root);assert.equal(c.logDirectory,join(root,'logs'));
  config.services.push({...config.services[0]});await writeFile(c.file,JSON.stringify(config));await assert.rejects(loadConfig(c.file),/duplicate/);
 } finally{await rm(root,{recursive:true,force:true});}
});
