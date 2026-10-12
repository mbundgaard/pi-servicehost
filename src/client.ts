import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auth } from './runtime.js';
import { SafeError, type Config } from './config.js';
export async function request(c:Config,body:unknown) {
  const token=await auth(c);
  const r=await fetch(`http://127.0.0.1:${c.apiPort}/v1`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'x-servicehost-project':c.id},body:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error'});
  const data=await r.json() as any;
  if(!r.ok) throw new SafeError(typeof data.error==='string'?data.error:'Runtime request failed');
  if((body as any).action==='ping' && (data.project!==c.id || data.protocol!==1)) throw new SafeError('Runtime identity mismatch');
  return data;
}
export async function up(c:Config) {
  try { await request(c,{action:'ping'}); return {running:true,existing:true}; } catch(e:any) {
    // Only a refused connection permits a spawn. A live conflicting server must fail.
    if(e?.cause?.code!=='ECONNREFUSED') throw new SafeError('Management port unavailable or conflicting; runtime not launched');
  }
  await auth(c);
  const log=await open(resolve(c.stateDirectory,'runtime.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.js',import.meta.url)),'serve','--config',c.file],{cwd:c.root,detached:true,stdio:['ignore',log.fd,log.fd],windowsHide:true});
  let failed=false; child.once('error',()=>{failed=true;}); child.unref(); await log.close();
  for(let i=0;i<60;i++) {
    if(failed || child.exitCode!==null) throw new SafeError('Runtime failed to launch; inspect .servicehost/runtime.log');
    try {await request(c,{action:'ping'});return {running:true,existing:false};} catch {await new Promise(r=>setTimeout(r,100));}
  }
  throw new SafeError('Runtime launch unconfirmed; do not blindly retry. Inspect runtime.log and management port');
}
