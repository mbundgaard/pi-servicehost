import { emitKeypressEvents } from 'node:readline';
import { readFileSync } from 'node:fs';
import { request } from './client.js';
import { SafeError, type Config } from './config.js';

export interface PanelService {
  name:string; state:string; readiness:string; pid?:number; port?:number;
  ownership?:string; scope?:string; output?:string; lastExitCode?:number|null;
}
interface LogRow { stream:string; text:string }
interface StreamState { cursor?:unknown; partial?:LogRow; skipInitial?:boolean }
export class LogBuffer {
  rows:LogRow[]=[];
  streams:Record<string,StreamState>={stdout:{},stderr:{}};
  generation=0;
  cleared=false;
  append(stream:string,result:{text:string;cursor:unknown;reset?:boolean}) {
    const state=this.streams[stream];
    state.cursor=result.cursor;
    if(state.skipInitial){state.skipInitial=false;return;}
    if(result.reset) {state.partial=undefined;this.rows.push({stream:'sys',text:`${stream}: new launch or truncated log`});}
    // Bound even a newline-free stream. Never retain child escape sequences.
    const pieces=terminalText(result.text,true).split('\n');
    for(let i=0;i<pieces.length;i++) {
      if(pieces[i]) {
        if(!state.partial || !this.rows.includes(state.partial)) {state.partial={stream,text:''};this.rows.push(state.partial);}
        state.partial.text=(state.partial.text+pieces[i]).slice(-4096);
      }
      if(i<pieces.length-1)state.partial=undefined;
    }
    this.rows=this.rows.slice(-500);
  }
  clear() {this.rows=[];for(const s of Object.values(this.streams)){s.partial=undefined;if(s.cursor===undefined)s.skipInitial=true;}this.generation++;this.cleared=true;}
}

// Strip complete ANSI sequences, then neutralize remaining controls (including
// incomplete escapes, C1, bidi and format controls). Keep ordinary Unicode.
export function terminalText(value:unknown,newlines=false):string {
  return String(value??'').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
    .replace(/\r\n/g,'\n').replace(/\t/g,'    ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,c=>(newlines&&c==='\n')||c==='\u200c'||c==='\u200d'?c:`\\u${c.codePointAt(0)!.toString(16).padStart(4,'0')}`);
}
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function cellWidth(s:string):number {
  if(/^[\p{Mark}\u200c\u200d]+$/u.test(s))return 0;
  const c=s.codePointAt(0)!;
  if(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s) || s.includes('\ufe0f'))return 2;
  return c>=0x1100 && (c<=0x115f || c===0x2329 || c===0x232a || (c>=0x2e80&&c<=0xa4cf) || (c>=0xac00&&c<=0xd7a3) || (c>=0xf900&&c<=0xfaff) || (c>=0xfe10&&c<=0xfe19) || (c>=0xfe30&&c<=0xfe6f) || (c>=0xff00&&c<=0xff60) || (c>=0xffe0&&c<=0xffe6) || (c>=0x20000&&c<=0x3fffd))?2:1;
}
export function textWidth(s:string):number {return [...segmenter.segment(s)].reduce((n,g)=>n+cellWidth(g.segment),0);}
export function fit(value:unknown,width:number):string {
  width=Math.max(0,width);const text=terminalText(value);let out='',used=0;
  const truncated=textWidth(text)>width;const limit=truncated?Math.max(0,width-1):width;
  for(const g of segmenter.segment(text)){const n=cellWidth(g.segment);if(used+n>limit)break;out+=g.segment;used+=n;}
  if(truncated&&width){out+='…';used++;}return out+' '.repeat(Math.max(0,width-used));
}
export interface PanelState {
  services:PanelService[]; selected?:string; loaded:boolean; connected:boolean;
  showServices:boolean; info:boolean; infoOffset?:number; notice:string; noticeUntil?:number; pending?:string; logs:Map<string,LogBuffer>;
}
export function initialState():PanelState {return {services:[],loaded:false,connected:false,showServices:true,info:false,notice:'',logs:new Map()};}
export function updateServices(state:PanelState,services:PanelService[]) {
  state.services=services;state.loaded=true;state.connected=true;
  if(!services.some(s=>s.name===state.selected))state.selected=services[0]?.name;
  for(const name of state.logs.keys())if(!services.some(s=>s.name===name))state.logs.delete(name);
}
function logBuffer(state:PanelState,name:string):LogBuffer {
  let buffer=state.logs.get(name);
  if(!buffer){
    while(state.logs.size>=8)state.logs.delete(state.logs.keys().next().value!);
    buffer=new LogBuffer();state.logs.set(name,buffer);
  }
  return buffer;
}
export function selectedService(state:PanelState) {return state.services.find(s=>s.name===state.selected);}
function exitText(s:PanelService) {return s.lastExitCode===undefined?'unknown':s.lastExitCode===null?'no code':String(s.lastExitCode);}
function wrapInfo(value:string,width:number):string[] {
  const lines:string[]=[];let line='',used=0;
  for(const word of terminalText(value).split(/\s+/u)) {
    if(line&&used+1+textWidth(word)>width){lines.push(line);line='';used=0;}
    if(line){line+=' ';used++;}
    for(const g of segmenter.segment(word)) {
      const n=cellWidth(g.segment);
      if(used+n>width){lines.push(line);line='';used=0;}
      line+=g.segment;used+=n;
    }
  }
  if(line)lines.push(line);return lines;
}
function infoLines(state:PanelState):string[] {
  const s=selectedService(state);
  return [`Selected: ${s?.name??'none'}`,`Process: ${s?.state??'unknown'}   Readiness: ${s?.readiness??'unknown'}`,
    `PID: ${s?.pid??'-'}   Port: ${s?.port??'-'}   Last exit: ${s?exitText(s):'unknown'}`,
    `Ownership: ${s?.ownership??'not reported'}   Scope: ${s?.scope??'not reported'}`,
    'Readiness and last exit do not grant control.',
    '↑/↓ select service   F2 next (wraps)', 'F3 start/stop selected   F4 restart selected',
    'F6 hide/show services   Ctrl+L clear view only', 'F1 / Esc close info   q / Ctrl+Q quit UI only',
    'F5 batch operations are not enabled.', 'Logs may contain secrets. No cross-stream time order.',
    'Closing this panel leaves services running.', `Message: ${state.notice}`];
}
function setNotice(state:PanelState,text:string) {state.notice=text;state.noticeUntil=Date.now()+8000;}
function footer(left:string,right:string,width:number) {return width>right.length+2?fit(left,width-right.length-1)+' '+right:fit(right,width);}
/** Exactly height rows, each width cells. Styling is renderer-owned only. */
export function renderPanel(state:PanelState,width:number,height:number,version:string,color=true):string[] {
  width=Math.max(1,Math.min(500,Math.floor(width)||1));height=Math.max(1,Math.min(200,Math.floor(height)||1));
  const rows:string[]=[];
  const add=(text:string,style='')=>rows.push((color&&style?`\x1b[${style}m`:'')+fit(text,width)+(color&&style?'\x1b[0m':''));
  const s=selectedService(state);
  if(width<32||height<8){add('Resize terminal to at least 32×8');while(rows.length<height-1)add('');if(rows.length<height)add('q quits UI only');return rows.slice(0,height);}
  const message=state.pending?`Pending: ${state.pending} · do not retry`:!state.connected?`${state.loaded?'Disconnected; cached output. Controls disabled.':'Connecting to runtime…'} ${state.loaded&&state.notice.startsWith('Read failed:')?state.notice:''}`:(!state.noticeUntil||Date.now()<state.noticeUntil?state.notice:'');
  const notices=message?wrapInfo(message,width).slice(0,3):[];
  const contentEnd=height-2-notices.length;
  if(state.info) {
    const lines=infoLines(state);
    for(const line of lines.slice(state.infoOffset??0)) {
      for(const part of wrapInfo(line,width))if(rows.length<contentEnd)add(part);
      if(rows.length>=contentEnd)break;
    }
  } else {
    if(state.showServices) {
      const count=Math.max(1,Math.min(state.services.length,Math.floor(height/3),contentEnd-3));
      const index=Math.max(0,state.services.findIndex(x=>x.name===state.selected));
      const start=Math.max(0,Math.min(index-count+1,state.services.length-count));
      if(!state.services.length)add(state.loaded?'  No services configured. Edit ServiceHost.json.':'  Loading services…','90');
      for(const item of state.services.slice(start,start+count)) {
        const active=item.name===state.selected;
        add(`${active?'>':' '} ${item.name} ${item.state}${item.port?` :${item.port}`:''}`,active?'7':'');
      }
      if(state.services.length>count)add(`  ${start+1}–${start+count} of ${state.services.length}; F2 next`,'90');
      add('─'.repeat(width),'90');
    }
    const room=Math.max(0,contentEnd-rows.length);
    const buffer=s?state.logs.get(s.name):undefined;
    const lines=room?buffer?.rows.slice(-room)??[]:[];
    if(!lines.length&&room) add(!state.loaded?'Waiting for service status…':!s?'Add a service to the project configuration.':s.output!=='available'?'No output for this runtime. F1 for service info.':buffer?.cleared?'View cleared. Waiting for new output…':'Waiting for stdout / stderr…','90');
    else for(const line of lines) add(`${line.stream==='stderr'?'err':line.stream==='stdout'?'out':' · '}  ${line.text}`,line.stream==='stderr'?'33':line.stream==='sys'?'90':'');
  }
  while(rows.length<contentEnd)add('');
  for(const line of notices)add(line,'33');
  add('─'.repeat(width),'90');
  const toggle=s?.state==='running'?'stop':'start';
  const keys=state.info?'↑↓ scroll F1 back q quit':width>=76?`F1 info F2 next F3 ${toggle} F4 restart F6 list ^L clear q quit`:width>=48?'F1 info F2 next F3 toggle F6 list q quit':'F1 info F2 next q quit';
  add(footer(keys,`v${version}`,width),'7');
  return rows.slice(0,height);
}
export interface PanelKey {name?:string;ctrl?:boolean;meta?:boolean;shift?:boolean}
export type Intent='quit'|'start'|'stop'|'restart'|undefined;
export function handleKey(state:PanelState,key:PanelKey):Intent {
  if(key.name==='q'&&!key.meta || key.ctrl&&key.name==='c')return 'quit';
  if(key.name==='f1'||key.name==='escape'&&state.info){state.info=!state.info;state.infoOffset=0;return;}
  if(state.info){
    if(key.name==='up')state.infoOffset=Math.max(0,(state.infoOffset??0)-1);
    if(key.name==='down')state.infoOffset=Math.min(infoLines(state).length-1,(state.infoOffset??0)+1);
    return;
  }
  if(key.name==='f6'){state.showServices=!state.showServices;return;}
  if(key.ctrl&&key.name==='l') {if(state.selected)logBuffer(state,state.selected).clear();setNotice(state,'View cleared; log files unchanged.');return;}
  const index=state.services.findIndex(s=>s.name===state.selected);
  if(['up','down','f2'].includes(key.name??'')&&state.services.length) {
    const next=key.name==='up'?Math.max(0,index-1):key.name==='f2'?(index+1)%state.services.length:Math.min(state.services.length-1,index+1);
    state.selected=state.services[next].name;return;
  }
  if(key.name!=='f3'&&key.name!=='f4')return;
  if(state.pending){setNotice(state,'An action is already pending.');return;}
  const s=selectedService(state);
  if(!state.connected||!s){setNotice(state,'Controls unavailable until connected.');return;}
  if(s.state==='observed'||s.state==='observation-ended'||s.ownership==='lost') {setNotice(state,'Observe-only or lost ownership; controls unavailable.');return;}
  return key.name==='f4'?'restart':s.state==='running'?'stop':'start';
}

export type PanelRequest=(body:Record<string,unknown>,signal?:AbortSignal)=>Promise<any>;
/** One serial request lane for reads and actions. No side-effect retries. */
export class PanelController {
  readonly state=initialState();
  private queued?:{action:string;name:string};
  private abort=new AbortController();
  private stopped=false;
  private wake?:()=>void;
  constructor(private call:PanelRequest,private changed:()=>void) {}
  key(key:PanelKey) {
    const intent=handleKey(this.state,key);
    if(intent==='quit'){this.stop();return;}
    if(intent&&this.state.selected){this.queued={action:intent,name:this.state.selected};this.state.pending=`${intent} ${this.state.selected}`;this.wake?.();}
    this.changed();
  }
  stop(){this.stopped=true;this.abort.abort();this.wake?.();}
  async run() {
    while(!this.stopped) {
      try {
        if(this.queued) {
          const action=this.queued;this.queued=undefined;
          try{await this.call(action,this.abort.signal);setNotice(this.state,`${action.action} ${action.name}: completed`);}
          catch(e){setNotice(this.state,e instanceof SafeError?`Action refused: ${e.message}`:'Action outcome unknown. Inspect status; do not blindly retry.');}
          finally{this.state.pending=undefined;}
          if(this.stopped)break;
          this.changed();
        }
        const result=await this.call({action:'status'},this.abort.signal);
        if(this.stopped)break;
        const wasConnected=this.state.connected;
        updateServices(this.state,result.services);
        if(!wasConnected){this.state.notice='';this.state.noticeUntil=undefined;}
        this.changed();
        const s=selectedService(this.state);
        if(s?.output==='available') {
          const buffer=logBuffer(this.state,s.name);
          for(const stream of ['stdout','stderr']) {
            if(this.stopped||this.queued||this.state.selected!==s.name)break;
            const generation=buffer.generation;
            const response=await this.call({action:'log-follow',name:s.name,stream,bytes:8192,cursor:buffer.streams[stream].cursor},this.abort.signal);
            if(this.stopped)break;
            // Clear while reading discards that response but advances its cursor.
            if(generation===buffer.generation)buffer.append(stream,response);
            else {buffer.streams[stream].cursor=response.cursor;buffer.streams[stream].skipInitial=false;}
            this.changed();
          }
        }
      } catch(e) {
        if(this.stopped)break;
        this.state.connected=false;
        this.state.notice=e instanceof SafeError?`Read failed: ${e.message}`:'Disconnected. Retrying reads; controls disabled.';
        this.changed();
      }
      if(this.stopped)break;
      if(this.queued)continue;
      await new Promise<void>(resolve=>{const timer=setTimeout(done,1000);const self=this;function done(){clearTimeout(timer);self.wake=undefined;resolve();}this.wake=done;});
    }
  }
}

export async function panel(c:Config) {
  const input=process.stdin,output=process.stdout;
  const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  let last='';
  const draw=()=>{
    const rows=renderPanel(controller.state,output.columns||80,output.rows||24,version,!process.env.NO_COLOR);
    const frame=rows.map((row,i)=>`\x1b[${i+1};1H${row}\x1b[K`).join('');
    if(frame!==last){output.write(`\x1b[?25l${frame}`);last=frame;}
  };
  const controller=new PanelController((body,signal)=>request(c,body,signal),draw);
  const key=(_text:string,k:PanelKey)=>controller.key(k);
  const stop=()=>controller.stop();
  const resize=()=>{last='';draw();};
  const raw=input.isRaw;const paused=input.readableFlowing!==true;
  let restored=false;
  const restore=()=>{
    if(restored)return;restored=true;
    input.off('keypress',key);input.off('end',stop);input.off('close',stop);input.off('error',stop);output.off('resize',resize);output.off('error',stop);
    for(const signal of ['SIGINT','SIGTERM','SIGHUP','SIGQUIT'] as const)process.off(signal,stop);
    try{input.setRawMode(raw);}catch{}
    if(paused)input.pause();
    if(!output.destroyed)output.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  };
  process.once('exit',restore);
  try {
    emitKeypressEvents(input);input.setRawMode(true);input.resume();
    input.on('keypress',key);input.once('end',stop);input.once('close',stop);input.once('error',stop);output.on('resize',resize);output.once('error',stop);
    for(const signal of ['SIGINT','SIGTERM','SIGHUP','SIGQUIT'] as const)process.once(signal,stop);
    output.write('\x1b[?1049h\x1b[2J\x1b[?25l');draw();
    await controller.run();
  } finally {controller.stop();restore();process.off('exit',restore);}
}
