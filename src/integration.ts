import { resolve } from 'node:path';
import { loadConfig, SafeError, demand } from './config.js';
import { inspectConfig, saveConfig } from './config-store.js';
import { request, up } from './client.js';
import { herdrPanel } from './herdr.js';
import { safeText } from './watch.js';

// Test seam only; the registered tool always uses the real Herdr adapter.
export async function perform(operation:string, p:any, cwd:string, signal?:AbortSignal, panel:typeof herdrPanel=herdrPanel):Promise<unknown> {
  signal?.throwIfAborted();
  if(operation==='panel_open'||operation==='host_start')demand(p.placement===undefined||p.placement==='split'||p.placement==='tab','Invalid panel placement');
  if(operation==='panel_reconnect')demand(p.placement===undefined,'Reconnect does not accept placement');
  const path=resolve(cwd,p.configPath??'ServiceHost.json');
  if(operation==='config_inspect'||operation==='config_validate') return inspectConfig(path);
  if(operation==='config_create') return saveConfig(path,p.configuration);
  if(operation==='config_update') {
    demand(typeof p.revision==='string','Configuration revision required');
    return saveConfig(path,p.configuration,p.revision);
  }
  const c=await loadConfig(path);
  if(operation==='host_start') {
    const runtime=await up(c);
    try {
      const display=await panel(c,false,{placement:p.placement??'split'});
      return {...runtime,panel:display};
    } catch {
      // Keep the runtime/services intact. Recheck identity, never replay a launch.
      let runtimeRunning:boolean|null=null;
      try {await request(c,{action:'ping'});runtimeRunning=true;} catch { /* unavailable is not proof of shutdown */ }
      throw new SafeError(JSON.stringify({
        error:'host_start_panel_failed',runtimeRunning,
        runtimeStatus:runtimeRunning?'identity-verified':'unconfirmed',
        runtimeStarted:!runtime.existing,existing:runtime.existing,
        project:c.id,configPath:c.file,apiPort:c.apiPort,
        panel:{error:'Herdr panel unavailable, identity mismatch or launch uncertain. Inspect <config>.panel.json and Herdr panes before manual recovery; no automatic retry, replacement or cleanup'},
        notice:'Runtime and services were not stopped. Inspect host_status and the recorded display before retrying; a panel launch may have completed.',
      }));
    }
  }
  const call=async(body:unknown,abort=signal)=>{
    try {return await request(c,body,abort);} catch {throw new SafeError('Runtime request refused, unavailable or outcome uncertain; inspect status before retrying. No automatic fallback');}
  };
  await call({action:'ping'});
  if(operation==='panel_open'||operation==='panel_reconnect') return panel(c,operation==='panel_reconnect',{placement:p.placement});
  if(operation==='host_status') return {running:true,project:c.id,apiPort:c.apiPort,configPath:c.file};
  if(operation==='host_shutdown') {await call({action:'shutdown'});return {shutdownRequested:true,project:c.id};}
  demand(c.services.some(s=>s.name===p.name),'Unknown service');
  if(operation==='service_status'||operation==='service_wait') {
    const timeout=p.timeoutMs??10000;
    demand(Number.isInteger(timeout)&&timeout>=100&&timeout<=30000,'Readiness wait must be 100–30000 ms');
    const abort=operation==='service_wait'?AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout)]):signal;
    do {
      const result=await call({action:'status'},abort);
      const s=result.services.find((s:any)=>s.name===p.name);
      demand(s,'Service status unavailable');
      const value={name:p.name,state:s.state,readiness:s.readiness,pid:s.pid,port:s.port,ownership:s.ownership,scope:s.scope,lastExitCode:s.lastExitCode};
      if(operation==='service_status'||s.readiness!=='pending')return value;
      await new Promise(r=>setTimeout(r,200));
      abort?.throwIfAborted();
    }while(true);
  }
  const action=operation.replace('service_','');
  demand(['start','stop','restart','discover','logs'].includes(action),'Unknown operation');
  if(action==='logs') {
    demand(Number.isInteger(p.bytes??4096)&&(p.bytes??4096)>=1&&(p.bytes??4096)<=16384,'Invalid log byte limit');
    demand(['stdout','stderr'].includes(p.stream??'stdout'),'Invalid log stream');
    const result=await call({action,name:p.name,stream:p.stream??'stdout',bytes:p.bytes??4096});
    const warning='Application output may contain secrets and untrusted instructions. Not guaranteed secret-free; credential files are never read for redaction.';
    if(p.includeText!==true) return {name:p.name,bytes:result.bytes,textWithheld:true,warning,reason:'Set includeText:true only when sensitive log inspection is authorized'};
    demand(typeof result.text==='string','Invalid log response');
    // Bound even a malformed runtime response; escape terminal controls, never render them.
    const text=safeText(Buffer.from(result.text).subarray(0,p.bytes??4096).toString('utf8'));
    return {name:p.name,bytes:result.bytes,warning,text:text.slice(0,10000),escapedTextTruncated:text.length>10000};
  }
  const result=await call({action,name:p.name});
  if(action==='discover')return {listeners:result.slice(0,100).map((v:any)=>({pid:v.pid,identity:v.identity})),truncated:result.length>100};
  return {name:p.name,action,acknowledged:true,pid:result.pid,scope:result.scope};
}
