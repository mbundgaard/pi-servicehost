import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { exclusive } from './config-store.js';
import { demand, SafeError, type Config } from './config.js';

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
interface State {version:1;project:string;workspace:string;marker:string;stage:string;pane?:string;tab?:string;terminal?:string}
/** No shell injection on reconnect. A submitted record verifies only display identity,
 * not the current foreground program. Pending/crashed records require manual recovery. */
export async function herdrPanel(c:Config,reconnect:boolean,options:{run?:Run;env?:NodeJS.ProcessEnv;platform?:string}={}) {
  const platform=options.platform??process.platform;
  demand(platform==='linux'||platform==='win32','Herdr panel automation supports Linux and Windows only');
  const env=options.env??process.env;
  demand(env.HERDR_ENV==='1'&&!!env.HERDR_PANE_ID,'Herdr panel requires an explicit managed caller pane');
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
        demand(state.version===1&&state.project===c.id&&state.workspace===caller.workspace_id&&state.stage==='submitted'&&typeof state.marker==='string'&&state.marker.startsWith('ServiceHost ')&&typeof state.pane==='string'&&typeof state.tab==='string'&&typeof state.terminal==='string','Panel record uncertain or mismatched; inspect before manual recovery, no duplicate launch');
        const matches=(await inventory()).filter(p=>p.pane_id===state!.pane||p.label===state!.marker);
        demand(matches.length===1&&matches[0].pane_id===state.pane&&matches[0].tab_id===state.tab&&matches[0].terminal_id===state.terminal&&matches[0].label===state.marker,'Recorded panel identity missing or ambiguous; no replacement or injection');
        return {pane:state.pane,tab:state.tab,outcome:'existing display verified; foreground process and panel readiness not verified',runtimeStarted:false};
      }
      demand(!reconnect,'No recorded panel; explicitly open a display first');
      await access(panelCLI);
      await inventory();
      state={version:1,project:c.id,workspace:caller.workspace_id,marker:'ServiceHost '+randomUUID(),stage:'split_pending'};
      await save();
      const pane=(await call(['pane','split','--pane',caller.pane_id,'--direction','down','--cwd',(platform==='win32'?win32.dirname:dirname)(c.file),'--no-focus']))?.pane;
      demand(typeof pane?.pane_id==='string'&&pane.pane_id!==caller.pane_id&&pane.tab_id===caller.tab_id,'Split returned invalid pane identity');
      state.pane=pane.pane_id;state.tab=pane.tab_id;state.stage='identity_pending';await save();
      const matches=(await inventory()).filter(p=>p.pane_id===state!.pane);
      demand(matches.length===1&&matches[0].tab_id===state.tab,'Created pane identity unavailable');
      state.terminal=matches[0].terminal_id;state.stage='rename_pending';await save();
      await call(['pane','rename',state.pane!,state.marker]);
      state.stage='run_pending';await save();
      await call(['pane','run',state.pane!,panelCommand(c.file,panelCLI,process.execPath,platform)]);
      state.stage='submitted';await save();
      return {pane:state.pane,tab:state.tab,outcome:'panel command submitted; readiness not verified',runtimeStarted:false};
    } catch {throw new SafeError('Herdr panel unavailable, identity mismatch or launch uncertain. Inspect <config>.panel.json and panes before manual recovery; no automatic retry, replacement or cleanup');}
  });
}
