import { open, readFile, realpath, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig, parseConfig, demand, SafeError, type Config } from './config.js';
import { request } from './client.js';

export const revision = (text:string) => createHash('sha256').update(text).digest('hex');
export async function configPath(path:string) {
  try { return await realpath(path); } catch(e:any) {
    if(e.code!=='ENOENT') throw e;
    return resolve(await realpath(dirname(resolve(path))),basename(path));
  }
}
/** Cross-process exclusion shared by config writes and runtime acquisition.
 * Crash locks fail closed; never infer permission to delete them from a PID. */
export async function exclusive<T>(file:string, task:()=>Promise<T>):Promise<T> {
  let lock;
  try { lock=await open(file+'.mutation-lock','wx',0o600); }
  catch { throw new SafeError('Configuration operation locked; inspect before manual recovery'); }
  try { return await task(); } finally { await lock.close(); await unlink(file+'.mutation-lock'); }
}
export async function exists(file:string) {
  try { await lstat(file); return true; } catch(e:any) { if(e.code==='ENOENT')return false; throw e; }
}
export function summary(c:Config, rev:string) {
  return {configPath:c.file,project:c.id,apiPort:c.apiPort,revision:rev,
    services:c.services.map(s=>({name:s.name,port:s.port,readinessConfigured:!!s.readiness})),
    withheld:'Commands, args, environment and credential contents are not displayed'};
}
export async function inspectConfig(path:string) {
  const file=await configPath(path);const text=await readFile(file,'utf8');
  return summary(parseConfig(file,JSON.parse(text)),revision(text));
}
export async function saveConfig(path:string, value:unknown, expected?:string) {
  const file=await configPath(path);
  return exclusive(file,async()=>{
    demand(!await exists(file+'.runtime-lock'),'Runtime active or unreconciled runtime lock; shut down before updating configuration');
    let old:string|undefined;
    try { old=await readFile(file,'utf8'); } catch(e:any) { if(e.code!=='ENOENT')throw e; }
    demand(old===undefined ? expected===undefined : expected===revision(old),'Configuration revision mismatch; inspect before updating');
    // Also fence pre-integration runtimes that do not hold a runtime lock.
    if(old!==undefined) {
      const c=await loadConfig(file);
      try { await request(c,{action:'ping'},AbortSignal.timeout(1500)); }
      catch(e:any) {
        if(e?.cause?.code==='ECONNREFUSED')return persist();
        throw new SafeError('Management port conflicting or unavailable; configuration unchanged');
      }
      throw new SafeError('Runtime active; shut down before updating configuration');
    }
    return persist();
    async function persist() {
      const text=JSON.stringify(value,null,2)+'\n';
      demand(Buffer.byteLength(text)<=1024*1024,'Configuration too large');
      const c=parseConfig(file,value);
      const temp=file+'.'+randomUUID()+'.tmp';
      try {
        const f=await open(temp,'wx',0o600);try {await f.writeFile(text);await f.sync();} finally {await f.close();}
        // Cooperative writers use this same lock; detect ordinary external edits too.
        const now=await readFile(file,'utf8').catch((e:any)=>{if(e.code==='ENOENT')return undefined;throw e;});
        demand(now===old,'Configuration changed during update');
        await rename(temp,file);
      } finally {await unlink(temp).catch(()=>{});}
      return summary(c,revision(text));
    }
  });
}
