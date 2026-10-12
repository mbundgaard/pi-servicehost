import { execFile, spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { resolveWindowsCommand, windowsLaunchPlan } from './windows-launch.js';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { demand, SafeError } from './config.js';
const exec = promisify(execFile);
export interface Identity { pid: number; identity: string }
const hash = (v:string) => createHash('sha256').update(v).digest('hex');
async function powershell(script: string): Promise<any> {
  const {stdout} = await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; ${script}`],{timeout:10000,maxBuffer:1024*1024,windowsHide:true});
  return JSON.parse(stdout.trim() || '[]');
}
export async function identity(pid:number): Promise<Identity> {
  demand(Number.isSafeInteger(pid) && pid > 0, 'Invalid PID');
  if (process.platform === 'linux') {
    const stat = await readFile(`/proc/${pid}/stat`,'utf8'); const fields = stat.slice(stat.lastIndexOf(')')+2).split(' ');
    const boot = await readFile('/proc/sys/kernel/random/boot_id','utf8');
    return {pid,identity:hash(`${boot}:${pid}:${fields[19]}:${await readlink(`/proc/${pid}/exe`)}`)};
  }
  if (process.platform === 'win32') {
    const p = await powershell(`$p=Get-Process -Id ${pid}; @{start=$p.StartTime.ToUniversalTime().Ticks.ToString(); path=$p.Path} | ConvertTo-Json -Compress`);
    demand(p.start && p.path, 'Process identity unavailable'); return {pid,identity:hash(`${pid}:${p.start}:${p.path}`)};
  }
  throw new SafeError('Unsupported platform');
}
// Any listener without an inspectable identity blocks launch/adoption. No guessed PID.
export async function listeners(port:number): Promise<Identity[]> {
  demand(Number.isInteger(port) && port > 0 && port <= 65535,'Invalid port');
  if (process.platform === 'win32') {
    const ids = await powershell(`@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq ${port} | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress`);
    return Promise.all((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean).map(identity));
  }
  demand(process.platform === 'linux','Unsupported platform');
  const inodes = new Set<string>();
  for (const table of ['tcp','tcp6']) {
    let data: string; try { data = await readFile(`/proc/net/${table}`,'utf8'); } catch(e:any) { if (table === 'tcp6' && e.code === 'ENOENT') continue; throw e; }
    for (const line of data.trim().split('\n').slice(1)) { const f=line.trim().split(/\s+/); if (f[3] === '0A' && parseInt(f[1].split(':')[1],16) === port) inodes.add(f[9]); }
  }
  if (!inodes.size) return [];
  const found = new Set<string>(); const result:Identity[]=[];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      let match=false;
      for (const fd of await readdir(`/proc/${pid}/fd`)) {
        try { const link=await readlink(`/proc/${pid}/fd/${fd}`); const inode=/^socket:\[(\d+)\]$/.exec(link)?.[1]; if (inode && inodes.has(inode)) { found.add(inode); match=true; } } catch { /* raced descriptor */ }
      }
      if (match) result.push(await identity(Number(pid)));
    } catch { /* inaccessible processes are accounted for by unmatched sockets */ }
  }
  demand(found.size === inodes.size && result.length > 0,'Listener identity unavailable; launch blocked');
  return result;
}
const batchChildren = new WeakSet<ChildProcess>();
export const isBatchChild = (child:ChildProcess) => batchChildren.has(child);
export function launch(command:string,args:string[],options:SpawnOptions) {
  if (process.platform === 'win32') {
    const resolved=resolveWindowsCommand(command,options.env ?? process.env,String(options.cwd ?? process.cwd()));
    const plan=windowsLaunchPlan(resolved,args,process.env.SystemRoot ?? '');
    const child=spawn(plan.command,plan.args,{...options,shell:false,windowsHide:true,windowsVerbatimArguments:plan.windowsVerbatimArguments});
    if(plan.batch) batchChildren.add(child);
    return child;
  }
  return spawn(command,args,{...options,shell:false,windowsHide:true,windowsVerbatimArguments:false});
}
