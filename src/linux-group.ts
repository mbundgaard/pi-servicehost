import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SafeError, demand } from './config.js';
export class LinuxGroup {
  readonly anchor:ChildProcess;
  released=false;
  pid?:number;
  constructor(command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,out:number,err:number,onExit:(code:number|null)=>void) {
    this.anchor=spawn(process.execPath,[fileURLToPath(new URL('./linux-group-helper.js',import.meta.url))],{
      detached:true,stdio:['ignore',out,err,'ipc'],env:process.env,
    });
    // Install error listener immediately, including before the spawn handshake.
    this.anchor.on('error',()=>{});
    this.anchor.on('message',(m:any)=>{if(m?.event==='exit')onExit(m.code);});
    this.ready=this.wait(['launched','launch-error'],10000).then(m=>{
      demand(m.event==='launched','Service launch failed; check executable and directory');this.pid=m.pid;
    });
    this.anchor.once('spawn',()=>this.anchor.send({action:'launch',command,args,cwd,env},()=>{}));
  }
  readonly ready:Promise<void>;
  private wait(events:string[],timeout:number):Promise<any> {
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.anchor.off('message',message);this.anchor.off('close',closed);this.anchor.off('error',closed);};
      const closed=()=>{cleanup();reject(new SafeError('Linux group anchor lost; lease retained for external reconciliation'));};
      const message=(m:any)=>{if(events.includes(m?.event)){cleanup();resolve(m);}};
      const timer=setTimeout(()=>{cleanup();reject(new SafeError('Linux group operation timed out; lease retained'));},timeout);
      this.anchor.on('message',message);this.anchor.once('close',closed);this.anchor.once('error',closed);
    });
  }
  async stop() {
    if(this.released)return;
    demand(this.anchor.connected && this.anchor.exitCode===null && this.anchor.signalCode===null,'Linux group anchor lost; lease retained for external reconciliation');
    const result=this.wait(['drained','stop-error'],6500);
    this.anchor.send({action:'stop'},()=>{});
    demand((await result).event==='drained','Group stop timed out or membership unavailable; no escalation, restart blocked');
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new SafeError('Group anchor release timed out; lease retained')),1000);
      this.anchor.once('close',()=>{clearTimeout(timer);this.released=true;resolve();});
      this.anchor.send({action:'release'},()=>{});
    });
  }
}
