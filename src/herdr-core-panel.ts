import { access, readFile, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, dirname, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exclusive } from './config-store.js';
import { demand, SafeError, type Config } from './config.js';
import { coreRequest, readCore, directPanelArgv, type AppOptions, type Placement } from './herdr-app.js';

const id=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
interface Place {space:string;tab:string;pane:string;terminal:string;node:any}
interface RecordState {
  version:4;backend:'core-document';project:string;socket:string;core:string;
  placement:Placement;space:string;tab:string;callerTab:string;callerPane:string;
  pane:string;marker:string;stage:'run_pending'|'registration_pending'|'verification_pending'|'submitted';
  terminal?:string;created?:number;
}
// Herdr app v0.1.13 mirror::{Document,SharedSpace,SharedTab}, layout::{Node,Kind}.
// These are machine-local IDs. Remote viewers qualify them on receipt; never
// send a viewer's machine alias to this core or infer a pane from terminal tN.
function inventory(doc:any):Place[] {
  demand(Number.isSafeInteger(doc?.version)&&doc.version>0&&Array.isArray(doc.value?.spaces),'Missing shared Herdr layout');
  // Tab::new uses the tab ID for its root container too. Identity namespaces
  // are distinct; rejecting that legitimate alias rejects real app documents.
  const ids=new Set<string>(), spaces=new Set<string>(), tabs=new Set<string>(), terminals=new Set<string>(), result:Place[]=[];
  const unique=(x:unknown,set=ids)=>{demand(id(x)&&!set.has(x),'Ambiguous shared layout identity');set.add(x as string);};
  let count=0;
  const visit=(n:any,space:string,tab:string,depth:number)=>{
    demand(n&&typeof n==='object'&&depth<64&&++count<10000,'Invalid shared layout');unique(n.id);
    demand(['block','row','column','stack'].includes(n.type),'Unsupported shared layout node');
    // Floating blocks are not split targets, but their identities must not alias.
    if(n.floating!==undefined) {
      demand(Array.isArray(n.floating),'Invalid floating layout');
      for(const f of n.floating) {unique(f.id);if(f.content?.terminal!==undefined){demand(id(f.content.terminal)&&!terminals.has(f.content.terminal),'Ambiguous floating terminal');terminals.add(f.content.terminal);}}
    }
    if(n.type==='block') {
      demand(n.content&&typeof n.content==='object'&&n.children===undefined,'Invalid block');
      if(n.content.terminal!==undefined) {
        demand(id(n.content.terminal)&&!terminals.has(n.content.terminal),'Ambiguous shared terminal');terminals.add(n.content.terminal);
        result.push({space,tab,pane:n.id,terminal:n.content.terminal,node:n});
      }
    } else {demand(Array.isArray(n.children),'Invalid layout children');for(const c of n.children)visit(c,space,tab,depth+1);}
  };
  for(const s of doc.value.spaces) {
    unique(s.id,spaces);demand(Array.isArray(s.tabs)&&s.machine===undefined,'Invalid machine-owned space');
    for(const t of s.tabs) {unique(t.id,tabs);visit(t.root,s.id,t.id,0);}
  }
  return result;
}
function locate(doc:any,terminal:string):Place {
  const found=inventory(doc).filter(p=>p.terminal===terminal);
  demand(found.length===1,'Caller/display not uniquely mapped in core layout');return found[0];
}
function above(doc:any,callerPane:string,panelPane:string,space:string,tab:string) {
  const t=doc.value.spaces.find((s:any)=>s.id===space)?.tabs.find((t:any)=>t.id===tab);
  let matches=0;
  const visit=(n:any)=>{if(n.type==='column')for(let i=0;i<n.children.length-1;i++)if(n.children[i].id===panelPane&&n.children[i+1].id===callerPane)matches++;for(const c of n.children??[])visit(c);};
  demand(t,'Recorded tab missing');visit(t.root);demand(matches===1,'Registered above placement changed');
}
function register(doc:any,caller:Place,state:RecordState) {
  const value=structuredClone(doc.value),space=value.spaces.find((s:any)=>s.id===caller.space);
  const panel={id:state.pane,type:'block',content:{terminal:state.terminal},title:'ServiceHost'};
  if(state.placement==='tab')space.tabs.push({id:state.tab,name:'ServiceHost',root:panel});
  else {
    const tab=space.tabs.find((t:any)=>t.id===caller.tab);
    const replace=(n:any):any=>{
      if(n.id===caller.pane) {
        // Keep outer sizing in the original parent and the caller's styling.
        const child=structuredClone(n),container:any={id:'n'+randomUUID().replaceAll('-',''),type:'column',children:[panel,child]};
        for(const k of ['size','min','max'])if(k in child){container[k]=child[k];delete child[k];}
        return container;
      }
      if(n.children)n.children=n.children.map(replace);return n;
    };
    tab.root=replace(tab.root);
  }
  inventory({version:doc.version,value});return value;
}

/** A persisted display request, not an assertion that a viewer is connected.
 * One terminal.run and one layout CAS only. No CLI autostart, shell input,
 * label-triggered automatic adoption, focus change, or fallback after effects. */
export async function corePanel(c:Config,reconnect:boolean,cli:string,options:AppOptions={}) {
  const env=options.env??process.env,platform=options.platform??process.platform;
  const socket=env.HC_TERMINAL_SOCKET,callerID=env.HC_TERMINAL_ID,placement=options.placement??'split';
  demand(platform==='linux'||platform==='win32','Herdr panel automation supports Linux and Windows only');
  demand(options.placement===undefined||options.placement==='split'||options.placement==='tab','Invalid panel placement');
  demand(!reconnect||options.placement===undefined,'Reconnect does not accept placement');
  demand(id(callerID)&&typeof socket==='string'&&socket.length<=4096&&(platform==='win32'?/^\\\\\.\\pipe\\[^\r\n]+$/.test(socket):isAbsolute(socket)),'Core display requires a local caller terminal and Unix socket or Windows named pipe');
  demand(!env.HC_SOCKET||env.HC_SOCKET===socket,'Conflicting core endpoint identities');
  const read=options.coreRead??((m,p)=>readCore(socket,m,p));
  const file=c.file+'.panel.json';
  return exclusive(file,async()=>{
    let state:RecordState|undefined;
    const save=async()=>{
      const temp=file+'.'+randomUUID()+'.tmp';
      try {const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(state));await f.sync();}finally{await f.close();}await rename(temp,file);}
      finally {await unlink(temp).catch(()=>{});}
    };
    try {
      try {state=JSON.parse(await readFile(file,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
      if(state)demand(state.version===4&&state.backend==='core-document'&&state.project===c.id&&state.socket===socket&&state.stage==='submitted'&&[state.core,state.space,state.tab,state.callerTab,state.callerPane,state.pane,state.terminal,state.marker].every(id)&&Number.isSafeInteger(state.created)&&(state.placement==='split'?state.tab===state.callerTab:state.placement==='tab'&&state.tab!==state.callerTab),'Panel record uncertain or mismatched');
      demand(state||!reconnect,'No recorded display; explicitly open first');
      const hello=await read('hello',{generation:1});
      demand(hello?.generation===1&&id(hello.core?.id)&&Array.isArray(hello.methods)&&['terminal.run','terminal.get','doc.get','doc.set'].every(m=>hello.methods.includes(m)),'Core lacks shared display APIs');
      const core=hello.core.id;
      if(state)demand(state.core===core,'Core identity changed');
      const identity=async()=>{const h=await read('hello',{generation:1});demand(h?.generation===1&&h.core?.id===core,'Core identity changed');};
      const doc=await read('doc.get',{name:'herdr-app'}),caller=locate(doc,callerID);
      const t=await read('terminal.get',{terminal:callerID});
      demand(t?.address===callerID&&t.state==='live'&&Number.isSafeInteger(t.created_ms)&&t.labels?.['herdr.space']===caller.space&&t.labels?.['herdr.tab']===caller.tab,'Caller labels and core layout disagree');
      const argv=directPanelArgv(c.file,cli),cwd=(platform==='win32'?win32.dirname:dirname)(c.file);
      const verify=async(d:any)=>{
        const p=locate(d,state!.terminal!);
        demand(p.space===state!.space&&p.tab===state!.tab&&p.pane===state!.pane,'Recorded display moved or replaced');
        if(state!.placement==='split')above(d,state!.callerPane,state!.pane,state!.space,state!.tab);
        const record=await read('terminal.get',{terminal:state!.terminal});
        demand(record?.address===state!.terminal&&record.state==='live'&&record.parent===null&&record.die_with_parent===false&&record.cwd===cwd&&record.labels?.['servicehost.panel']===state!.marker&&JSON.stringify(record.argv)===JSON.stringify(argv)&&Number.isSafeInteger(record.created_ms),'Panel launch identity or lifetime mismatch');
        if(state!.created!==undefined)demand(state!.created===record.created_ms,'Terminal incarnation changed');
        await identity();return record;
      };
      const result=()=>({backend:'core-document',placement:state!.placement,pane:state!.pane,tab:state!.tab,terminal:state!.terminal,focusChanged:false,displayRegistered:true,viewerObserved:false,outcome:'display request registered in shared Herdr layout; launch argv verified; viewer visibility, foreground process and panel readiness not verified',runtimeStarted:false});
      if(state) {demand(state.space===caller.space,'Caller is in another space');await verify(doc);return result();}
      await access(cli);await identity();
      if(options.preflight)return {backend:'core-document',outcome:'core caller mapping and shared display APIs verified; no mutation',runtimeStarted:false};
      state={version:4,backend:'core-document',project:c.id,socket,core,placement,space:caller.space,tab:placement==='split'?caller.tab:'tb'+randomUUID().replaceAll('-',''),callerTab:caller.tab,callerPane:caller.pane,pane:'p'+randomUUID().replaceAll('-',''),marker:randomUUID(),stage:'run_pending'};
      await save();
      // Deliberately omit herdr.space/tab: automatic label adoption can race our
      // exact placement CAS and create the wrong split. The document itself is
      // authoritative; the app attaches terminals referenced by its nodes.
      const run=options.coreRun??(p=>coreRequest(socket,'terminal.run',p));
      const ack=await run({argv,cwd,no_parent:true,outlive_parent:true,no_notify:true,keep:false,wait:false,labels:{'servicehost.panel':state.marker}});
      demand(id(ack?.address)&&ack.address!==callerID&&!inventory(doc).some(p=>p.terminal===ack.address),'Invalid terminal creation acknowledgement');
      state.terminal=ack.address;state.stage='registration_pending';await save();
      await identity();
      const value=register(doc,caller,state);
      const set=options.coreSet??(p=>coreRequest(socket,'doc.set',p));
      const written=await set({name:'herdr-app',version:doc.version,value});
      demand(Number.isSafeInteger(written?.version)&&written.version>doc.version,'Invalid shared layout CAS acknowledgement');
      state.stage='verification_pending';await save();
      const observed=await read('doc.get',{name:'herdr-app'});
      demand(observed.version>=written.version,'Shared display write not observed');
      const record=await verify(observed);state.created=record.created_ms;state.stage='submitted';await save();
      return result();
    } catch(e) {
      // No raw RPC errors/terminal metadata. Pending records permanently fence
      // uncertain run/CAS results, including a lost reply after successful write.
      const detail=e instanceof SafeError?e.message:'Core request failed or outcome uncertain';
      throw new SafeError(`Herdr core display unavailable: ${detail}. Inspect <config>.panel.json and caller core layout before manual recovery; no retry, fallback or cleanup`);
    }
  });
}
