import { createInterface } from 'node:readline';
import type { Config } from './config.js';
import { request } from './client.js';
// Monochrome terminal-native ledger: no focus changes, cursor controls or alternate screen.
// ASCII JSON escaping also neutralizes C1 and bidi/format controls in child output.
export function safeText(value:unknown):string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
export function compact(services:any[],width:number):string {
  const columns=Math.max(1,Math.min(120,Math.floor(width)||80));
  return services.map(s=>{
    const line=`${safeText(s.name)}  ${safeText(s.state)}  ready:${safeText(s.readiness)}  exit:${s.lastExitCode===undefined?'?':s.lastExitCode===null?'no-code':safeText(s.lastExitCode)}`;
    const rows=[];for(let i=0;i<line.length;i+=columns)rows.push(line.slice(i,i+columns));return rows.join('\n');
  }).join('\n');
}
export async function watch(c:Config,name?:string,stream='stdout') {
  const tty=!!process.stdin.isTTY && !!process.stdout.isTTY;
  let cursor:unknown;let previous:string|undefined;let stopped=false;let wake:(()=>void)|undefined;
  const abort=new AbortController();
  const stop=()=>{stopped=true;abort.abort();wake?.();};
  const rl=tty?createInterface({input:process.stdin,output:process.stdout}):undefined;
  rl?.on('line',line=>{if(['q','quit','exit'].includes(line.trim()))stop();});rl?.on('close',stop);
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGHUP',stop);
  if(tty)console.log(name?'Following logs (may contain secrets). q + Enter returns; services keep running.':'Service / process / readiness / last exit. q + Enter returns; services keep running.');
  try {
    do {
      const result=await request(c,name?{action:'log-follow',name,stream,cursor}:{action:'status'},abort.signal);
      if(stopped)break;
      if(!tty)console.log(safeText(result));
      else if(name){if(result.reset)console.log('[new launch or truncated log; cursor reset]');if(result.text)console.log(safeText(result.text));}
      else {const text=compact(result.services,process.stdout.columns??80);if(text!==previous){console.log(text||'(no services configured)');previous=text;}}
      cursor=result.cursor;
      if(!tty)break; // pipes get one bounded JSON snapshot, never an endless stream
      await new Promise<void>(resolve=>{const timer=setTimeout(done,1000);function done(){clearTimeout(timer);wake=undefined;resolve();}wake=done;});
    }while(!stopped);
  }catch(e){if(!stopped)throw e;}
  finally {rl?.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('SIGHUP',stop);}
}
