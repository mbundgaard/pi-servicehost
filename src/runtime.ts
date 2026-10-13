import { createServer } from 'node:http';
import { mkdir, open, readFile, unlink, chmod, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { loadConfig, launchValues, demand, SafeError, type Config, type Service } from './config.js';
import { identity, listeners, launch, isBatchChild, type Identity } from './platform.js';
import { LinuxGroup } from './linux-group.js';
import { Readiness } from './readiness.js';
import { logInventory } from './logs.js';

export async function auth(c:Config):Promise<string> {
  await mkdir(c.stateDirectory,{recursive:true,mode:0o700});
  const file=resolve(c.stateDirectory,'token');
  try { const f=await open(file,'wx',0o600); try { await f.writeFile(randomBytes(32).toString('hex')); } finally { await f.close(); } } catch(e:any) { if(e.code !== 'EEXIST') throw e; }
  const st=await lstat(file); demand(st.isFile() && !st.isSymbolicLink(),'Invalid token file');
  if(process.platform !== 'win32') { demand(st.uid === process.getuid?.(),'Token owned by another user'); await chmod(file,0o600); }
  // A concurrent initializer can briefly leave an empty file. Never replace it.
  for(let i=0;i<20;i++) { const token=await readFile(file,'utf8'); if(/^[a-f0-9]{64}$/.test(token)) return token; await new Promise(r=>setTimeout(r,50)); }
  throw new SafeError('Invalid token file');
}
interface RecordState { lastExitCode?:number|null; readiness?:Readiness; launchId?:string; group?:LinuxGroup; child?:ChildProcess; adopted?:Identity; running:boolean; stdout?:string; stderr?:string; exitCode?:number|null; stopRequested?:boolean }
export class Manager {
  private states=new Map<string,RecordState>();
  constructor(readonly config:Config) {}
  private service(name:string):Service { const s=this.config.services.find(s=>s.name===name); demand(s,'Unknown service'); return s; }
  private lease(name:string) { return resolve(this.config.stateDirectory,`${name}.lease.json`); }
  async status() {
    return Promise.all(this.config.services.map(async s=> {
      const r=this.states.get(s.name); let stale=false; try { await lstat(this.lease(s.name)); stale=!r?.running; } catch(e:any) { if(e.code!=='ENOENT') throw e; }
      let adoptionValid=false; if(r?.adopted) { try { adoptionValid=(await identity(r.adopted.pid)).identity===r.adopted.identity; } catch {} }
      return {name:s.name,port:s.port,readiness:s.readiness?(r?.readiness?.state??'inactive'):'not-configured',scope:r?.group?'linux-process-group':undefined,ownership:r?.group?(r.group.released?'released':r.group.anchor.connected?'held':'lost'):undefined,state:r?.running?'running':r?.adopted?(adoptionValid?'observed':'observation-ended'):stale?'blocked-stale-lease':'stopped',pid:r?.running?(r.group?.pid??r.child?.pid):r?.adopted?.pid,output:r?.stdout?'available':'unavailable',exitCode:r?.exitCode,lastExitCode:r?.lastExitCode};
    }));
  }
  async discover(name:string) { const s=this.service(name); demand(s.port,'Service has no configured port'); return listeners(s.port); }
  async adopt(name:string, expected:Identity) {
    this.service(name); demand(!this.states.get(name)?.running && (!this.states.get(name)?.group || this.states.get(name)?.group?.released),'Service already managed');
    demand(expected && Number.isSafeInteger(expected.pid) && typeof expected.identity==='string' && /^[a-f0-9]{64}$/.test(expected.identity),'Invalid adoption identity');
    const candidates=await this.discover(name); demand(candidates.some(p=>p.pid===expected.pid && p.identity===expected.identity),'Listener identity changed');
    demand((await identity(expected.pid)).identity===expected.identity,'Process identity changed');
    this.states.set(name,{running:false,adopted:expected}); return {adopted:true,mode:'observe-only',output:'unavailable'};
  }
  async start(name:string) {
    const s=this.service(name); const previous=this.states.get(name);
    demand(!previous?.running,'Service already running'); demand(!previous?.adopted,'Observed process cannot be launched or controlled; restart runtime after external reconciliation');
    if(s.port) demand((await listeners(s.port)).length===0,'Port already listening; explicit observation/adoption required');
    const values=await launchValues(this.config,s);
    await mkdir(this.config.logDirectory,{recursive:true,mode:0o700});
    let lease; try { lease=await open(this.lease(name),'wx',0o600); } catch(e:any) { if(e.code==='EEXIST') throw new SafeError('Stale launch lease: external reconciliation required; no automatic reconnect'); throw e; }
    const launchId=randomBytes(12).toString('hex');
    const stdout=resolve(this.config.logDirectory,`${name}-${launchId}.stdout.log`); const stderr=resolve(this.config.logDirectory,`${name}-${launchId}.stderr.log`);
    let out,err; let child:ChildProcess|undefined;
    try {
      await lease.writeFile(JSON.stringify({project:this.config.id,name,launchId,state:'launching'}));
      out=await open(stdout,'wx',0o600); err=await open(stderr,'wx',0o600);
      if(process.platform==='linux') {
        const record:RecordState={running:true,stdout,stderr,launchId,lastExitCode:previous?.lastExitCode};this.states.set(name,record);
        const group=new LinuxGroup(s.command,values.args,s.workingDirectory,values.env,out.fd,err.fd,code=>{record.running=false;record.exitCode=code;record.lastExitCode=code;record.readiness?.cancel();});
        record.group=group;child=group.anchor;record.child=child;
        child.once('close',()=>record.readiness?.cancel());
        try {await group.ready;} catch(e) {
          // Even a failed target launch must drain the anchor before lease release.
          await group.stop();await unlink(this.lease(name));this.states.delete(name);throw e;
        }
        await lease.truncate(0);await lease.write(JSON.stringify({project:this.config.id,name,launchId,pid:group.pid,pgid:child.pid,state:'launched',scope:'linux-process-group'}),0,'utf8');
        if(s.readiness && record.running && group.anchor.connected && child.exitCode===null && child.signalCode===null)record.readiness=new Readiness(s.readiness);
        return {started:true,pid:group.pid,scope:'linux-process-group'};
      }
      child=launch(s.command,values.args,{cwd:s.workingDirectory,env:values.env,stdio:['ignore',out.fd,err.fd]});
      const record:RecordState={child,running:true,stdout,stderr,launchId,lastExitCode:previous?.lastExitCode}; this.states.set(name,record);
      // close confirms the direct child ended, NOT its descendants. Logs are never reused.
      child.once('close',code=>{ record.running=false; record.exitCode=code; record.lastExitCode=code; record.readiness?.cancel(); });
      await new Promise<void>((res,rej)=>{child!.once('spawn',res); child!.once('error',()=>rej(new SafeError('Service launch failed; check executable and directory')));});
      await lease.truncate(0); await lease.write(JSON.stringify({project:this.config.id,name,launchId,pid:child.pid,state:'launched',scope:isBatchChild(child)?'batch-wrapper-only':'direct-child-only'}),0,'utf8');
      if(s.readiness && record.running)record.readiness=new Readiness(s.readiness);
      return {started:true,pid:child.pid};
    } catch(e) {
      // A successful spawn followed by metadata failure must retain the lease.
      if(!child?.pid) { this.states.delete(name); await unlink(this.lease(name)); }
      throw e;
    } finally { await out?.close(); await err?.close(); await lease.close(); }
  }
  async stop(name:string) {
    this.service(name); const r=this.states.get(name);
    demand(r && !r.adopted,'Only a direct child launched by this runtime can be stopped');
    r.readiness?.cancel();
    if(r.group) {await r.group.stop();r.running=false;}
    else if(r.running) {
      const child=r.child!;
      // Node retains the live child handle; never signal a discovered or persisted numeric PID.
      demand(child.exitCode===null && child.signalCode===null,'Child is already exiting');
      r.stopRequested=true;
      demand(child.kill('SIGTERM'),'Unable to request child termination');
      const ended=await new Promise<boolean>(res=>{ const timer=setTimeout(()=>{child.off('close',done);res(false);},5000); const done=()=>{clearTimeout(timer);res(true);}; child.once('close',done); });
      demand(ended,'Stop timed out; no escalation, restart blocked');
    }
    // Keep lease while any configured listener remains, including descendants.
    const s=this.service(name); if(s.port) demand((await listeners(s.port)).length===0,'Child ended but listener remains; restart blocked');
    // cmd is only a wrapper. Even an empty configured port cannot attest descendant exit.
    demand(!r.child || !isBatchChild(r.child),'Batch wrapper ended; descendant ownership unavailable, lease retained for external reconciliation');
    await unlink(this.lease(name)).catch((e:any)=>{if(e.code!=='ENOENT') throw e;});
    return {stopped:true,scope:r.group?'linux-process-group':'direct-child-only'};
  }
  async restart(name:string) { await this.stop(name); return this.start(name); }
  async logs(name:string, stream:string, bytes:number) {
    this.service(name); demand(stream==='stdout'||stream==='stderr','Invalid log stream'); demand(Number.isInteger(bytes)&&bytes>=1&&bytes<=65536,'Invalid log byte limit');
    const r=this.states.get(name); const path=stream==='stdout'?r?.stdout:r?.stderr; demand(path && !r?.adopted,'Output unavailable for this runtime');
    const f=await open(path,'r'); try { const st=await f.stat(); const size=Math.min(st.size,bytes); const b=Buffer.alloc(size); await f.read(b,0,size,st.size-size); return {text:b.toString('utf8'),bytes:size}; } finally {await f.close();}
  }
  async follow(name:string,stream:string,bytes:number,cursor?:{launchId:string;offset:number}) {
    this.service(name);demand(stream==='stdout'||stream==='stderr','Invalid log stream');
    demand(Number.isInteger(bytes)&&bytes>=1&&bytes<=65536,'Invalid log byte limit');
    demand(cursor===undefined || (cursor && typeof cursor==='object' && !Array.isArray(cursor) && typeof cursor.launchId==='string' && /^[a-f0-9]{24}$/.test(cursor.launchId) && Number.isSafeInteger(cursor.offset) && cursor.offset>=0),'Invalid log cursor');
    const r=this.states.get(name);const path=stream==='stdout'?r?.stdout:r?.stderr;
    demand(path && r?.launchId && !r.adopted,'Output unavailable for this runtime');
    const f=await open(path,'r');try {
      const st=await f.stat();const reset=!!cursor && (cursor.launchId!==r.launchId || cursor.offset>st.size);
      const offset=!cursor||reset?Math.max(0,st.size-bytes):cursor.offset;
      const b=Buffer.alloc(Math.min(bytes,st.size-offset));const read=await f.read(b,0,b.length,offset);
      return {text:b.subarray(0,read.bytesRead).toString('utf8'),bytes:read.bytesRead,reset,cursor:{launchId:r.launchId,offset:offset+read.bytesRead}};
    }finally{await f.close();}
  }
  canShutdown() { return ![...this.states.values()].some(r=>r.running || (r.group && !r.group.released)); }
}
export async function serve(path:string) {
  const c=await loadConfig(path); const token=await auth(c); const manager=new Manager(c); let queue=Promise.resolve(); let pending=0; let queued=0;
  const server=createServer((req,res)=>{
    const reply=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
    const given=req.headers.authorization; const expected=`Bearer ${token}`;
    if(req.headers.origin || req.headers['x-servicehost-project']!==c.id || typeof given!=='string' || !/^Bearer [a-f0-9]{64}$/.test(given) || !timingSafeEqual(Buffer.from(given),Buffer.from(expected))) { reply(403,{error:'Authentication/project mismatch'}); req.resume(); return; }
    if(req.method!=='POST' || req.url!=='/v1' || req.headers['content-type']!=='application/json') {reply(404,{error:'Unknown route'});req.resume();return;}
    if(pending>=32) {reply(429,{error:'Runtime busy'});req.resume();return;}
    pending++; res.once('close',()=>{pending--;});
    const chunks:Buffer[]=[]; let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>16384){req.destroy();return;}chunks.push(chunk);});
    req.on('end',()=>{
      if(queued>=32) {reply(429,{error:'Runtime busy'});return;}
      queued++;
      queue=queue.then(async()=>{
      try {
        let b; try { b=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {throw new SafeError('Invalid JSON');}
        demand(b && typeof b==='object' && !Array.isArray(b),'Invalid request');
        if(b.action==='ping') {reply(200,{project:c.id,protocol:1});return;}
        if(b.action==='status') {reply(200,{project:c.id,services:await manager.status()});return;}
        if(b.action==='shutdown') {demand(manager.canShutdown(),'Managed children still running');reply(200,{stopped:true});server.close();return;}
        if(b.action==='log-inventory') {reply(200,await logInventory(c,b.limit??100));return;}
        demand(typeof b.name==='string' && b.name.length<=64,'Invalid service name');
        let result;
        switch(b.action) {
          case 'start':result=await manager.start(b.name);break;
          case 'stop':result=await manager.stop(b.name);break;
          case 'restart':result=await manager.restart(b.name);break;
          case 'discover':result=await manager.discover(b.name);break;
          case 'adopt':result=await manager.adopt(b.name,b.expected);break;
          case 'log-follow':result=await manager.follow(b.name,b.stream??'stdout',b.bytes??16384,b.cursor);break;
          case 'logs':result=await manager.logs(b.name,b.stream??'stdout',b.bytes??16384);break;
          default:throw new SafeError('Unknown action');
        }
        reply(200,result);
      } catch(e) {reply(409,{error:e instanceof SafeError?e.message:'Operation failed (details withheld; check local configuration/permissions)'});}
      finally {queued--;}
    }).catch(()=>{if(!res.headersSent)reply(500,{error:'Runtime operation failed'});});});
  });
  server.requestTimeout=15000; server.headersTimeout=10000; server.timeout=15000; server.maxConnections=32;
  await new Promise<void>((res,rej)=>{server.once('error',rej);server.listen(c.apiPort,'127.0.0.1',res);});
  return {server,manager,config:c};
}
