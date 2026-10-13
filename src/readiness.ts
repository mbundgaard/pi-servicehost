import { request } from 'node:http';
import type { ReadinessConfig } from './config.js';
export type ReadinessState = 'not-configured'|'inactive'|'pending'|'ready'|'timed-out';
// Startup observation only. Never follows redirects, reads bodies, or controls a process.
export class Readiness {
  state:ReadinessState='pending';
  private cancelled=false;
  private cancelRequest?:()=>void;
  private wake?:()=>void;
  constructor(private config:ReadinessConfig) { void this.run(); }
  cancel() { this.cancelled=true; this.wake?.(); this.cancelRequest?.(); this.state='inactive'; }
  private probe(timeout:number):Promise<boolean> {
    return new Promise(resolve=>{
      let done=false;
      const finish=(ok:boolean)=>{if(done)return;done=true;clearTimeout(timer);this.cancelRequest=undefined;req.destroy();resolve(ok);};
      const req=request({hostname:'127.0.0.1',port:this.config.port,path:this.config.path,method:'GET',agent:false,maxHeaderSize:8192},res=>{finish(res.statusCode===this.config.expectedStatus);res.destroy();});
      const timer=setTimeout(()=>finish(false),timeout);
      this.cancelRequest=()=>finish(false);
      req.on('error',()=>finish(false));req.end();
    });
  }
  private async run() {
    const deadline=performance.now()+this.config.startupTimeoutMs;
    let nextProbeAt=0;
    while(!this.cancelled) {
      const now=performance.now();
      if(now<nextProbeAt && now<deadline) {
        await new Promise<void>(resolve=>{const timer=setTimeout(done,Math.ceil(Math.min(nextProbeAt,deadline)-now));const self=this;function done(){clearTimeout(timer);self.wake=undefined;resolve();}this.wake=done;});
        continue;
      }
      const remaining=deadline-performance.now();
      if(remaining<=0){this.state='timed-out';return;}
      const ok=await this.probe(Math.min(remaining,1000));
      if(this.cancelled)return;
      if(ok && performance.now()<deadline){this.state='ready';return;}
      if(performance.now()>=deadline){this.state='timed-out';return;}
      nextProbeAt=performance.now()+250;
    }
  }
}
