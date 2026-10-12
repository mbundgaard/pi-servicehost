// Private launch anchor. Never import this module: it is an executable adapter.
// Its own live membership pins the PGID; kill(0) cannot address a reused group.
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
process.on('SIGTERM',()=>{});
let target:ReturnType<typeof spawn>|undefined;
let stopping=false;
let drained=false;
const keepalive=setInterval(()=>{},60000);
const send=(value:unknown)=>{if(process.connected) process.send?.(value,()=>{});};
async function members() {
  let count=0;
  for(const pid of await readdir('/proc')) {
    if(!/^\d+$/.test(pid) || Number(pid)===process.pid) continue;
    let stat:string;
    try {stat=await readFile(`/proc/${pid}/stat`,'utf8');}
    catch(e:any) {if(e.code==='ENOENT'||e.code==='ESRCH')continue;throw e;}
    const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    if(Number(fields[2])===process.pid && fields[0]!=='Z' && fields[0]!=='X')count++;
  }
  return count;
}
process.on('message',async (m:any)=>{
  if(m?.action==='launch' && !target) {
    target=spawn(m.command,m.args,{cwd:m.cwd,env:m.env,stdio:['ignore',1,2],shell:false});
    target.once('spawn',()=>send({event:'launched',pid:target!.pid}));
    target.once('error',()=>send({event:'launch-error'}));
    target.once('close',code=>send({event:'exit',code}));
  } else if(m?.action==='stop' && !stopping) {
    stopping=true;
    try {
      process.kill(0,'SIGTERM');
      const deadline=Date.now()+5000;
      // Two empty observations reduce ordinary fork/exit scan races. procfs is
      // not atomic containment: intentionally escaping/hostile churn is excluded.
      let empty=0;
      while(empty<2) {
        empty=(await members())===0 ? empty+1 : 0;
        if(Date.now()>=deadline)throw Error('timeout');
        await new Promise(r=>setTimeout(r,25));
      }
      drained=true;send({event:'drained'});
    } catch {send({event:'stop-error'});}
    finally {stopping=false;}
  } else if(m?.action==='release' && drained) {
    clearInterval(keepalive);process.disconnect?.();
  }
});
// Runtime loss is NOT an instruction to signal anything. No future runtime can
// recover this capability. Exit the anchor; survivors and lease require recovery.
process.on('disconnect',()=>{clearInterval(keepalive);target?.unref();});
