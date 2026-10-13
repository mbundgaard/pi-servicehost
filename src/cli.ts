#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { loadConfig, SafeError, demand } from './config.js';
import { request, up } from './client.js';
import { serve } from './runtime.js';
import { watch, safeText } from './watch.js';
import { panel } from './panel.js';

const help=`pi-servicehost [command] [service] [--config path]
  up                         Start detached runtime (no services auto-start)
  panel [--prompt|--live]     Select services + live logs (prompt/ledger optional)
  watch                      Live compact status (non-TTY: one JSON snapshot)
  follow NAME [stdout|stderr] Live escaped logs; may contain secrets (non-TTY: one snapshot)
  log-inventory [LIMIT]       Dry-run only; bounded scan, no deletion
  status                     Show service state
  start|stop|restart NAME     Control a runtime-owned service (platform scope)
  discover NAME              Inspect configured TCP listener identities
  adopt NAME PID IDENTITY    Explicit observe-only adoption; no stop permission
  logs NAME [stdout|stderr]  Read last 16 KiB (raw child output, may contain secrets)
  shutdown                   Stop runtime only after managed ownership is released
  serve                      Foreground runtime (normally launched by up)
  help                       Show this help
Panel closure never stops the runtime/services.`;
function operation(args:string[]) {
  const [action,name,arg,identity]=args;
  if(action==='log-inventory')return {action,limit:name===undefined?100:Number(name)};
  demand(['status','start','stop','restart','discover','adopt','logs','shutdown'].includes(action),'Unknown command; use help');
  if(action==='adopt') return {action,name,expected:{pid:Number(arg),identity}};
  return {action,name,stream:arg};
}
// Never render child-controlled escape sequences in the terminal panel.
function display(value:unknown) { console.log(safeText(value)); }
async function main() {
  const args=process.argv.slice(2); let file='ServiceHost.json'; const ci=args.indexOf('--config');
  if(ci>=0) {demand(Boolean(args[ci+1]),'Missing config path');file=args[ci+1];args.splice(ci,2);}
  const command=args[0]??'help';
  if(command==='help'||command==='--help'){console.log(help);return;}
  const c=await loadConfig(file);
  if(command==='serve'){await serve(c.file);return;}
  if(command==='up'){display(await up(c));return;}
  if(command==='watch'||command==='follow') {
    if(command==='follow')demand(Boolean(args[1]),'Missing service name');
    await watch(c,command==='follow'?args[1]:undefined,args[2]);return;
  }
  if(command==='panel') {
    demand(process.stdin.isTTY && process.stdout.isTTY,'Panel needs an interactive terminal');
    await up(c);
    if(args.includes('--live')){await watch(c);return;}
    if(!args.includes('--prompt')){await panel(c);return;}
    const rl=createInterface({input:process.stdin,output:process.stdout});
    console.log('ServiceHost — type status, start NAME, stop NAME, logs NAME, discover NAME, or quit.\nClosing this panel leaves services running.');
    try {
      display(await request(c,{action:'status'}));
      while(true) {
        let line:string; try{line=await rl.question('servicehost> ');}catch{break;}
        if(['quit','exit','q'].includes(line.trim()))break;
        if(!line.trim())continue;
        try {display(await request(c,operation(line.trim().split(/\s+/))));} catch(e){console.error(e instanceof SafeError?e.message:'Request failed');}
      }
    } finally {rl.close();}
    return;
  }
  display(await request(c,operation(args)));
}
main().catch(e=>{console.error(e instanceof SafeError?e.message:'ServiceHost failed; check configuration, permissions, and management port');process.exitCode=1;});
