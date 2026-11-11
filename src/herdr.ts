import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { exclusive } from './config-store.js';
import { demand, SafeError, type Config } from './config.js';
import { appPanel, type AppOptions } from './herdr-app.js';

/** Decode package URLs with native path semantics, never URL.pathname (drive/UNC/escapes). */
export function panelCLIFrom(moduleURL:string|URL=import.meta.url,platform:string=process.platform) {
  return fileURLToPath(new URL('./cli.js',moduleURL),{windows:platform==='win32'});
}
export const panelCLI=panelCLIFrom();
export const shQuote=(s:string)=>`'${s.replaceAll("'", "'\\''")}'`;
export function panelCommand(file:string,cli=panelCLI,node=process.execPath,platform:string=process.platform) {
  demand(platform==='linux'||platform==='win32','Herdr panel automation supports Linux and Windows only');
  const args=[node,cli,'panel','--connect-only','--config',file];
  if(platform==='win32') {
    // Only fixed syntax/base64 enters PowerShell source (including for smart quote
    // characters PowerShell treats as delimiters). Decode each argv value as data;
    // no Invoke-Expression, cmd/npm shim or Start-Process argument reserialization.
    const literal=(s:string)=>`([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(s,'utf16le').toString('base64')}')))`;
    const script=`& ${args.map(literal).join(' ')}`;
    return `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`;
  }
  return `exec ${args.map(shQuote).join(' ')}`;
}
type Run=(args:string[])=>Promise<string>;
const run:Run=async args=>(await promisify(execFile)('herdr',args,{timeout:10000,maxBuffer:1024*1024})).stdout;
interface State {version:1|3;backend?:'legacy';placement?:'split'|'tab';callerTab?:string;project:string;workspace:string;marker:string;stage:string;pane?:string;tab?:string;terminal?:string}
/** No shell injection on reconnect. A submitted record verifies only display identity,
 * not the current foreground program. Pending/crashed records require manual recovery. */
export async function herdrPanel(c:Config,reconnect:boolean,options:AppOptions&{run?:Run}={}) {
  demand(options.placement===undefined||options.placement==='split'||options.placement==='tab','Invalid panel placement');
  demand(!reconnect||options.placement===undefined,'Reconnect does not accept placement');
  const env=options.env??process.env;
  const platform=options.platform??process.platform;
  demand(platform==='linux'||platform==='win32','Herdr panel automation supports Linux and Windows only');
  const coreIdentity=env.HC_TERMINAL_ID!==undefined||env.HC_TERMINAL_SOCKET!==undefined;
  const legacyIdentity=env.HERDR_ENV!==undefined||env.HERDR_PANE_ID!==undefined;
  demand(!(coreIdentity&&legacyIdentity),'Mixed Herdr backend identities; choose one environment explicitly');
  if(coreIdentity)return appPanel(c,reconnect,panelCLI,options);
  return legacyPanel(c,reconnect,options);
}

async function legacyPanel(c:Config,reconnect:boolean,options:AppOptions&{run?:Run}={}) {
  const platform=options.platform??process.platform;
  demand(platform==='linux'||platform==='win32','Herdr panel automation supports Linux and Windows only');
  const env=options.env??process.env;
  demand(env.HERDR_ENV==='1'&&!!env.HERDR_PANE_ID,'Herdr panel requires an explicit managed caller pane');
  const placement=options.placement??'split';
  const execute=options.run??run;
  const call=async(args:string[])=>{const text=await execute(args);return !text.trim()&&args[1]==='run'?{}:JSON.parse(text).result;};
  const file=c.file+'.panel.json';
  return exclusive(file,async()=>{
    let state:State|undefined;
    const save=async()=>{
      const temp=file+'.'+randomUUID()+'.tmp';
      try {const f=await open(temp,'wx',0o600);try {await f.writeFile(JSON.stringify(state));await f.sync();}finally{await f.close();}await rename(temp,file);}
      finally {await unlink(temp).catch(()=>{});}
    };
    try {
      const caller=(await call(['pane','current','--current']))?.pane;
      demand(caller?.pane_id===env.HERDR_PANE_ID&&typeof caller.workspace_id==='string'&&typeof caller.tab_id==='string','Missing or ambiguous Herdr caller identity');
      try {state=JSON.parse(await readFile(file,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
      const inventory=async()=>{
        const panes=(await call(['pane','list','--workspace',caller.workspace_id]))?.panes;
        demand(Array.isArray(panes)&&panes.every(p=>typeof p.pane_id==='string'&&typeof p.tab_id==='string'&&typeof p.terminal_id==='string'),'Missing Herdr terminal identity');
        return panes;
      };
      if(state) {
        demand((state.version===1&&state.placement===undefined||(state.version===3&&state.backend==='legacy'&&(state.placement==='split'||state.placement==='tab')&&typeof state.callerTab==='string'&&(state.placement==='tab'?state.tab!==state.callerTab:state.tab===state.callerTab)))&&state.project===c.id&&state.workspace===caller.workspace_id&&state.stage==='submitted'&&typeof state.marker==='string'&&state.marker.startsWith('ServiceHost ')&&typeof state.pane==='string'&&typeof state.tab==='string'&&typeof state.terminal==='string','Panel record uncertain or mismatched; inspect before manual recovery, no duplicate launch');
        const matches=(await inventory()).filter(p=>p.pane_id===state!.pane||p.label===state!.marker);
        demand(matches.length===1&&matches[0].pane_id===state.pane&&matches[0].tab_id===state.tab&&matches[0].terminal_id===state.terminal&&matches[0].label===state.marker,'Recorded panel identity missing or ambiguous; no replacement or injection');
        return {placement:state.placement??'split',focusChanged:false,pane:state.pane,tab:state.tab,outcome:'existing display verified; foreground process and panel readiness not verified',runtimeStarted:false};
      }
      demand(!reconnect,'No recorded panel; explicitly open a display first');
      await access(panelCLI);
      const before=await inventory();
      if(options.preflight)return {backend:'legacy',outcome:'caller and inventory verified; no mutation',runtimeStarted:false};
      state={version:3,backend:'legacy',placement,callerTab:caller.tab_id,project:c.id,workspace:caller.workspace_id,marker:'ServiceHost '+randomUUID(),stage:placement==='tab'?'tab_pending':'split_pending'};
      await save();
      const cwd=(platform==='win32'?win32.dirname:dirname)(c.file);
      const created=await call(placement==='tab'?['tab','create','--workspace',caller.workspace_id,'--cwd',cwd,'--label','ServiceHost','--no-focus']:['pane','split','--pane',caller.pane_id,'--direction','down','--cwd',cwd,'--no-focus']);
      const pane=placement==='tab'?created?.root_pane:created?.pane;
      const tab=placement==='tab'?created?.tab?.tab_id:pane?.tab_id;
      demand(typeof pane?.pane_id==='string'&&pane.pane_id!==caller.pane_id&&!before.some(p=>p.pane_id===pane.pane_id)&&typeof tab==='string'&&(placement==='tab'?tab!==caller.tab_id&&!before.some(p=>p.tab_id===tab):tab===caller.tab_id),'Creation returned invalid pane identity');
      state.pane=pane.pane_id;state.tab=tab;state.stage='identity_pending';await save();
      const matches=(await inventory()).filter(p=>p.pane_id===state!.pane);
      demand(matches.length===1&&matches[0].tab_id===state.tab,'Created pane identity unavailable');
      state.terminal=matches[0].terminal_id;
      if(placement==='split') {
        // Legacy v0.9.5 supports exact source/target IDs, not an "up" split.
        // Never use the focus-dependent/directional swap variant.
        state.stage='reorder_pending';await save();
        const swapped=await call(['pane','swap','--source-pane',state.pane!,'--target-pane',caller.pane_id]);
        demand(swapped?.changed===true&&swapped.source_pane_id===state.pane&&swapped.target_pane_id===caller.pane_id,'Invalid exact-ID swap acknowledgement');
        const layout=swapped.layout;
        demand(layout?.workspace_id===caller.workspace_id&&layout.tab_id===caller.tab_id&&Array.isArray(layout.panes),'Missing swapped layout');
        const top=layout.panes.filter((p:any)=>p.pane_id===state!.pane),bottom=layout.panes.filter((p:any)=>p.pane_id===caller.pane_id);
        demand(top.length===1&&bottom.length===1,'Ambiguous swapped panes');
        const a=top[0].rect,b=bottom[0].rect;
        demand(a&&b&&[a.x,a.y,a.width,a.height,b.x,b.y,b.width,b.height].every(n=>Number.isSafeInteger(n)&&n>=0)&&a.width>0&&a.height>0&&b.height>0&&a.x===b.x&&a.width===b.width&&a.y+a.height<=b.y,'Panel not above caller');
      }
      state.stage='rename_pending';await save();
      await call(['pane','rename',state.pane!,state.marker]);
      state.stage='run_pending';await save();
      await call(['pane','run',state.pane!,panelCommand(c.file,panelCLI,process.execPath,platform)]);
      state.stage='submitted';await save();
      return {placement,focusChanged:false,pane:state.pane,tab:state.tab,outcome:'panel command submitted; readiness not verified',runtimeStarted:false};
    } catch {throw new SafeError('Herdr panel unavailable, identity mismatch or launch uncertain. Inspect <config>.panel.json and panes before manual recovery; no automatic retry, replacement or cleanup');}
  });
}
