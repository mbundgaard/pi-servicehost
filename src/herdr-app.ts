import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createConnection } from 'node:net';
import { access, readFile, open, rename, unlink, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exclusive } from './config-store.js';
import { demand, SafeError, type Config } from './config.js';

type CoreMethod='hello'|'terminal.get'|'doc.get';
export type CoreRead=(method:CoreMethod,params:Record<string,unknown>)=>Promise<any>;
export interface AppOptions {
  appRun?:(args:string[])=>Promise<string>;
  coreRead?:CoreRead;
  env?:NodeJS.ProcessEnv;
  platform?:string;
}

/** Read-only JSON-RPC on the inherited endpoint. No CLI connect/autostart, TCP,
 * remote routing, terminal reads, or shell input. Windows core uses named pipes. */
export function readCore(socket:string,method:CoreMethod,params:Record<string,unknown>):Promise<any> {
  demand(['hello','terminal.get','doc.get'].includes(method),'Unsupported core observation');
  return new Promise((resolve,reject)=>{
    const stream=createConnection(socket);
    let bytes=0, data='';
    const timer=setTimeout(()=>finish(new Error('Core observation timed out')),10000);
    const finish=(error?:Error,value?:unknown)=>{clearTimeout(timer);stream.destroy();error?reject(error):resolve(value);};
    stream.setEncoding('utf8');
    stream.on('connect',()=>stream.write(JSON.stringify({jsonrpc:'2.0',id:1,method,params})+'\n'));
    stream.on('error',()=>finish(new Error('Core observation unavailable')));
    stream.on('end',()=>finish(new Error('Core observation incomplete')));
    stream.on('data',(chunk:string)=>{
      bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024)return finish(new Error('Core observation too large'));
      data+=chunk;
      const end=data.indexOf('\n');if(end<0)return;
      try {
        const reply=JSON.parse(data.slice(0,end));
        demand(reply.jsonrpc==='2.0'&&reply.id===1&&!reply.error&&'result' in reply,'Invalid core observation');
        finish(undefined,reply.result);
      } catch {finish(new Error('Invalid core observation'));}
    });
  });
}

const localID=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
interface Place {space:string;tab:string;pane:string;terminal:string;local:boolean}
// v0.1.13 window.rs::world. Do not search titles or recursively mistake a
// sub-agent for a displayed caller. Unknown schemas are rejected, not guessed.
function places(world:any):Place[] {
  demand(Array.isArray(world?.spaces),'Missing app inventory');
  const result:Place[]=[];
  const spaces=new Set<string>(), tabs=new Set<string>(), panes=new Set<string>(), terminals=new Set<string>();
  for(const s of world.spaces) {
    demand(typeof s.id==='string'&&!spaces.has(s.id)&&Array.isArray(s.tabs)&&('machine' in s),'Invalid app spaces');spaces.add(s.id);
    for(const t of s.tabs) {
      demand(typeof t.id==='string'&&!tabs.has(t.id)&&Array.isArray(t.terminals),'Invalid app tabs');tabs.add(t.id);
      for(const p of t.terminals) {
        demand(typeof p.pane==='string'&&typeof p.terminal==='string'&&!panes.has(p.pane)&&!terminals.has(p.terminal),'Ambiguous app panes');
        panes.add(p.pane);terminals.add(p.terminal);
        result.push({space:s.id,tab:t.id,pane:p.pane,terminal:p.terminal,local:s.machine===null});
      }
    }
  }
  return result;
}
function uniquePlace(world:any,terminal:string):Place {
  const matches=places(world).filter(p=>p.terminal===terminal);
  demand(matches.length===1&&matches[0].local&&[matches[0].space,matches[0].tab,matches[0].pane,terminal].every(localID),'Caller/display missing, ambiguous or remote');
  return matches[0];
}
function samePlace(a:Place,b:Place) {return a.space===b.space&&a.tab===b.tab&&a.pane===b.pane&&a.terminal===b.terminal;}
function terminalAt(t:any,p:Place) {
  demand(t?.address===p.terminal&&t.state==='live'&&t.labels?.['herdr.space']===p.space&&t.labels?.['herdr.tab']===p.tab&&Number.isSafeInteger(t.created_ms),'Core/app terminal identity mismatch');
}
/** Match the app's unique random layout IDs to the inherited core's persisted
 * local document as well as its terminal labels; bare tN addresses are not identity. */
function documentAt(doc:any,p:Place) {
  demand(Number.isSafeInteger(doc?.version)&&doc.version>0&&Array.isArray(doc.value?.spaces),'Missing core layout document');
  const found:Place[]=[];
  let nodes=0;
  const visit=(n:any,space:string,tab:string,depth:number)=>{
    demand(n&&typeof n==='object'&&depth<64&&++nodes<=10000,'Invalid core layout');
    if(n.type==='block'&&typeof n.content?.terminal==='string')found.push({space,tab,pane:n.id,terminal:n.content.terminal,local:true});
    if(n.children!==undefined) {demand(Array.isArray(n.children),'Invalid layout children');for(const child of n.children)visit(child,space,tab,depth+1);}
  };
  for(const s of doc.value.spaces) {
    demand(typeof s.id==='string'&&Array.isArray(s.tabs),'Invalid core spaces');
    for(const t of s.tabs) {demand(typeof t.id==='string','Invalid core tab');visit(t.root,s.id,t.id,0);}
  }
  const matches=found.filter(x=>x.terminal===p.terminal||x.pane===p.pane);
  demand(matches.length===1&&samePlace(matches[0],p),'App does not match caller core layout');
}
interface State {
  version:2;backend:'app-core';project:string;appHome:string;socket:string;core:string;
  space:string;tab:string;callerPane:string;stage:'split_pending'|'verification_pending'|'submitted';
  pane?:string;terminal?:string;created?:number;
}
export const directPanelArgv=(file:string,cli:string,node=process.execPath)=>[node,cli,'panel','--connect-only','--config',file];

export async function appPanel(c:Config,reconnect:boolean,cli:string,options:AppOptions={}) {
  const env=options.env??process.env, platform=options.platform??process.platform;
  const socket=env.HC_TERMINAL_SOCKET!;
  demand(localID(env.HC_TERMINAL_ID)&&typeof socket==='string'&&socket.length<=4096&&
    (platform==='win32'?/^\\\\\.\\pipe\\[^\r\n]+$/.test(socket):isAbsolute(socket)),
    'Herdr app panel requires a local HC_TERMINAL_ID and HC_TERMINAL_SOCKET');
  demand(!env.HC_SOCKET||env.HC_SOCKET===socket,'Conflicting core endpoint identities');
  const core=options.coreRead??((method,params)=>readCore(socket,method,params));
  const file=c.file+'.panel.json';
  return exclusive(file,async()=>{
    let state:State|undefined;
    const save=async()=>{
      const temp=file+'.'+randomUUID()+'.tmp';
      try {const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(state));await f.sync();}finally{await f.close();}await rename(temp,file);}
      finally{await unlink(temp).catch(()=>{});}
    };
    try {
      // Pin the selected app home, including symlink identity. Never open a window.
      const appHome=await realpath(env.HERDR_APP_HOME||join(homedir(),'.config','herdr-app'));
      const execute=options.appRun??(async(args:string[])=>(await promisify(execFile)('herdr-app',args,{env:{...env,HERDR_APP_HOME:appHome},timeout:10000,maxBuffer:1024*1024})).stdout);
      const app=async(args:string[])=>{const text=await execute(args);demand(Buffer.byteLength(text)<=1024*1024,'App response too large');const value=JSON.parse(text);demand(value&&!value.error,'App unavailable');return value;};
      try{state=JSON.parse(await readFile(file,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
      if(state)demand(state.version===2&&state.backend==='app-core'&&state.project===c.id&&state.appHome===appHome&&state.socket===socket&&state.stage==='submitted'&&localID(state.core)&&localID(state.space)&&localID(state.tab)&&localID(state.pane)&&localID(state.terminal)&&Number.isSafeInteger(state.created),'Panel record uncertain or backend mismatch');
      demand(state||!reconnect,'No recorded panel; explicitly open first');
      const identity=async()=>{const h=await core('hello',{generation:1});demand(h?.generation===1&&localID(h.core?.id),'Missing core identity');return h.core.id as string;};
      const coreID=await identity();
      if(state)demand(state.core===coreID,'Core identity changed');
      const caller=uniquePlace(await app(['ls']),env.HC_TERMINAL_ID!);
      terminalAt(await core('terminal.get',{terminal:caller.terminal}),caller);
      documentAt(await core('doc.get',{name:'herdr-app'}),caller);
      const argv=directPanelArgv(c.file,cli);
      const verify=async()=>{
        const p=uniquePlace(await app(['ls']),state!.terminal!);
        demand(p.space===state!.space&&p.tab===state!.tab&&p.pane===state!.pane,'Recorded display moved or replaced');
        const t=await core('terminal.get',{terminal:p.terminal});terminalAt(t,p);
        demand(t.parent===null&&t.die_with_parent===false&&Number.isSafeInteger(t.created_ms)&&Array.isArray(t.argv)&&JSON.stringify(t.argv)===JSON.stringify(argv),'Panel launch identity or lifetime mismatch');
        if(state!.created!==undefined)demand(t.created_ms===state!.created,'Terminal incarnation changed');
        demand(await identity()===coreID,'Core changed during observation');
        return t;
      };
      if(state) {
        demand(state.space===caller.space,'Caller is in another space');
        await verify();
        return {backend:'app-core',pane:state.pane,tab:state.tab,terminal:state.terminal,focusChanged:false,outcome:'existing display and launch argv verified; foreground process and panel readiness not verified',runtimeStarted:false};
      }
      await access(cli);
      const commands=await app(['commands']);
      demand(Array.isArray(commands)&&commands.some(x=>x.name==='pane.split'&&Array.isArray(x.args)&&['direction','pane','argv'].every(n=>x.args.some((a:any)=>a.name===n))),'Required explicit split API unavailable');
      demand(await identity()===coreID,'Core changed before launch');
      // The app's explicit pane split passes argv directly to core (unlike
      // tab.new's shell wrapper). It inherits the caller's live cwd; all panel
      // paths are absolute/config-relative, so project cwd is not required.
      state={version:2,backend:'app-core',project:c.id,appHome,socket,core:coreID,space:caller.space,tab:caller.tab,callerPane:caller.pane,stage:'split_pending'};
      await save();
      const reply=await app(['do','pane.split',JSON.stringify({direction:'down',pane:caller.pane,argv})]);
      demand(localID(reply.pane)&&localID(reply.terminal)&&reply.pane!==caller.pane&&reply.terminal!==caller.terminal,'Invalid split acknowledgement');
      state.pane=reply.pane;state.terminal=reply.terminal;state.stage='verification_pending';await save();
      const terminal=await verify();state.created=terminal.created_ms;state.stage='submitted';await save();
      return {backend:'app-core',pane:state.pane,tab:state.tab,terminal:state.terminal,focusChanged:true,outcome:'panel split created; new pane receives tab focus; launch argv verified, readiness not verified',runtimeStarted:false};
    } catch {throw new SafeError('Herdr app/core unavailable, identity mismatch or launch uncertain. Inspect <config>.panel.json, caller mapping and app/core before manual recovery; no fallback, duplicate launch or cleanup');}
  });
}
