import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {loadConfig} from '../dist/config.js';
import {Manager,auth} from '../dist/runtime.js';
import {up} from '../dist/client.js';
async function fixture(command,args){
 const root=await mkdtemp(join(tmpdir(),'servicehost-safety-'));
 await writeFile(join(root,'ServiceHost.json'),JSON.stringify({apiPort:19501,logDirectory:'logs',services:[{name:'fixture',command,args,workingDirectory:'.'}]}));
 const c=await loadConfig(join(root,'ServiceHost.json'));await auth(c);return {root,c,m:new Manager(c)};
}
test('failed executable launch does not retain a false ownership lease',async()=>{
 const {root,m}=await fixture('servicehost-deliberately-nonexistent-fixture-exe',[]);
 try {await assert.rejects(m.start('fixture'),/launch failed|executable not found/);assert.ok(!(await readdir(join(root,'.servicehost'))).includes('fixture.lease.json'));}
 finally{await rm(root,{recursive:true,force:true});}
});
test('natural exit requires explicit stop acknowledgement; new runtime cannot recover ownership',async()=>{
 const {root,c,m}=await fixture(process.execPath,['-e','console.log("short-lived fixture")']);
 try {
  await m.start('fixture');for(let i=0;i<100;i++){if((await m.status())[0].state!=='running')break;await new Promise(r=>setTimeout(r,20));}assert.equal(m.canShutdown(),process.platform!=='linux');
  const recovered=new Manager(c);assert.equal((await recovered.status())[0].state,'blocked-stale-lease');
  await assert.rejects(recovered.start('fixture'),/Stale launch lease/);await assert.rejects(recovered.stop('fixture'),/Only a direct child/);
  await m.stop('fixture');assert.equal((await m.status())[0].state,'stopped');
 }finally{await m.stop('fixture').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
test('conflicting management server prevents detached runtime launch',async()=>{
 const {root,c}=await fixture(process.execPath,[]);const s=createServer((req,res)=>{res.writeHead(403,{'content-type':'application/json'});res.end('{}');});s.listen(0,'127.0.0.1');await once(s,'listening');c.apiPort=s.address().port;
 try {await assert.rejects(up(c),/conflicting/);assert.ok(!(await readdir(join(root,'.servicehost'))).includes('runtime.log'));}
 finally{await new Promise(r=>s.close(r));await rm(root,{recursive:true,force:true});}
});
