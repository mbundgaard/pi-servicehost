import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {initialState,updateServices,renderPanel,textWidth,terminalText,fit,LogBuffer,handleKey,PanelController} from '../dist/panel.js';
import {SafeError} from '../dist/config.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const services=[
 {name:'api',state:'running',readiness:'ready',pid:8120,port:3000,ownership:'held',scope:'linux-process-group',output:'available',lastExitCode:0},
 {name:'worker',state:'stopped',readiness:'inactive',output:'unavailable',lastExitCode:7},
 {name:'assets',state:'running',readiness:'not-configured',pid:8124,port:5173,output:'available'},
];
function fixture(){const s=initialState();updateServices(s,services.map(s=>({...s})));s.notice='';const b=new LogBuffer();b.append('stdout',{text:'Listening on 127.0.0.1:3000\nGET /ready 204  2ms\n仕事を開始 · café\n',cursor:{offset:1}});b.append('stderr',{text:'Optional cache is not configured\n',cursor:{offset:2}});s.logs.set('api',b);return s;}
test('renderer fits typical, narrow, tiny and info layouts; snapshot preview',()=>{
 const s=fixture();let preview='Actual renderer output; ANSI styling and trailing padding omitted, not a screenshot.\n';
 for(const [w,h] of [[100,28],[80,24],[50,16],[32,8],[12,3],[1,1]]){
  for(const info of [false,true]){s.info=info;const frame=renderPanel(s,w,h,'0.2.0',false);assert.equal(frame.length,h);for(const line of frame)assert.equal(textWidth(line),w);if(!info&&w>=32)preview+=`\n${w} × ${h}\n${frame.join('\n')}\n`;}
 }
 s.info=false;s.pending='restart api';preview+='\nPending action / 80 × 12\n'+renderPanel(s,80,12,'0.2.0',false).join('\n')+'\n';
 s.pending=undefined;s.connected=false;s.notice='Disconnected. Retrying reads; controls disabled.';preview+='\nDisconnected / 50 × 16\n'+renderPanel(s,50,16,'0.2.0',false).join('\n')+'\n';
 s.info=true;s.infoOffset=6;preview+='\nScrolled key help / 50 × 16\n'+renderPanel(s,50,16,'0.2.0',false).join('\n')+'\n';
 const empty=initialState();preview+='\nLoading / 50 × 10\n'+renderPanel(empty,50,10,'0.2.0',false).join('\n')+'\n';updateServices(empty,[]);empty.notice='';preview+='\nEmpty / 50 × 10\n'+renderPanel(empty,50,10,'0.2.0',false).join('\n')+'\n';
 writeFileSync('artifacts/panel-preview.txt',preview.replace(/ +$/gm,''));
});
test('legacy layout has only compact service rows, full rules, logs and footer',()=>{
 const s=fixture();
 for(const [w,h] of [[80,24],[50,16],[32,8]]){
  const frame=renderPanel(s,w,h,'0.2.0',false);
  assert.equal(frame[0].trimEnd(),'> api running :3000');
  assert.equal(frame[h-2],'─'.repeat(w));
  assert.equal(frame.filter(line=>line==='─'.repeat(w)).length,2);
  assert.doesNotMatch(frame.join('\n'),/ServiceHost|Readiness|Connected|live output/);
  assert.match(frame[h-1],/F2 next.*v0.2.0$/);
 }
 const frame=renderPanel(s,80,24,'0.2.0',false);
 assert.equal(frame[3],'─'.repeat(80));assert.match(frame[4],/^out  Listening/);
 s.showServices=false;
 assert.match(renderPanel(s,80,24,'x',false)[0],/^out  Listening/);
 s.notice='Action outcome unknown. Inspect status; do not blindly retry.';s.noticeUntil=Date.now()+8000;
 assert.match(renderPanel(s,32,8,'x',false).join('\n'),/do not blindly retry/);
 s.noticeUntil=Date.now()-1;
 assert.doesNotMatch(renderPanel(s,80,24,'x',false).join('\n'),/outcome unknown/);
 s.connected=false;
 assert.match(renderPanel(s,80,24,'x',false).join('\n'),/Disconnected; cached output. Controls disabled/);
 s.pending='restart api';
 assert.match(renderPanel(s,32,8,'x',false).join('\n'),/Pending: restart api/);
});
test('untrusted escapes, OSC, C1, bidi, newlines and wide Unicode cannot control frames',()=>{
 const hostile='\x1b[2J\x1b]52;c;secret\x07\x1b[31mtext\x1b[0m\x9b2J\u202e\r\x1bunfinished';
 assert.doesNotMatch(terminalText(hostile),/[\x00-\x1f\x7f-\x9f\u202e]/);
 assert.equal(terminalText('你好 café'), '你好 café');assert.equal(textWidth('你好 e\u0301 😀'),9);
 assert.equal(terminalText('👩‍💻'),'👩‍💻');assert.equal(textWidth('👩‍💻'),2);
 for(let width=0;width<20;width++)assert.equal(textWidth(fit('你好 e\u0301 😀 hello',width)),width);
 const s=fixture();s.services[0]={...s.services[0],name:hostile};s.selected=hostile;s.notice=hostile;
 const b=new LogBuffer();b.append('stderr',{text:hostile,cursor:0});s.logs.set(hostile,b);
 const frame=renderPanel(s,80,24,hostile,true).join('\n');
 assert.doesNotMatch(frame.replace(/\x1b\[(?:0|1|7|32|33|90)m/g,''),/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e]/);
 assert.doesNotMatch(frame,/secret/);
 for(const line of renderPanel(fixture(),80,24,'0.2.0',true))assert.equal(textWidth(line.replace(/\x1b\[[0-9;]*m/g,'')),80);
});
test('loading, empty, output unavailable, view clear and long lists are explicit',()=>{
 const s=initialState();assert.match(renderPanel(s,80,24,'x',false).join('\n'),/Loading services/);
 updateServices(s,[]);assert.match(renderPanel(s,80,24,'x',false).join('\n'),/No services configured/);
 updateServices(s,Array.from({length:100},(_,i)=>({...services[0],name:`service-${i}`})));s.selected='service-90';
 assert.match(renderPanel(s,80,24,'x',false).join('\n'),/> service-90/);
 const b=new LogBuffer();s.logs.set(s.selected,b);handleKey(s,{name:'l',ctrl:true});assert.match(renderPanel(s,80,24,'x',false).join('\n'),/View cleared/);
 s.services[90].output='unavailable';assert.match(renderPanel(s,80,24,'x',false).join('\n'),/No output for this runtime/);
 for(const service of s.services){s.selected=service.name;handleKey(s,{name:'l',ctrl:true});}assert.equal(s.logs.size,8);
});
test('bounded stream ring preserves partial lines, cursors, reset and clear without truncation',()=>{
 const b=new LogBuffer();b.append('stdout',{text:'hel',cursor:3});b.append('stderr',{text:'warn\n',cursor:5});b.append('stdout',{text:'lo\n',cursor:6});assert.equal(b.rows[0].text,'hello');
 b.clear();assert.equal(b.rows.length,0);assert.equal(b.streams.stdout.cursor,6);
 const unseen=new LogBuffer();unseen.clear();unseen.append('stdout',{text:'old tail\n',cursor:100});assert.equal(unseen.rows.length,0);unseen.append('stdout',{text:'new\n',cursor:104});assert.equal(unseen.rows[0].text,'new');
 b.append('stdout',{text:'fresh\n',cursor:10,reset:true});assert.match(b.rows[0].text,/new launch/);
 b.append('stderr',{text:('a'.repeat(5000)+'\n').repeat(600),cursor:11});assert.equal(b.rows.length,500);assert.ok(b.rows.every(r=>r.text.length<=4096));
});
test('selection persists by name; legacy keys map safely; info never invokes actions',()=>{
 const s=fixture();handleKey(s,{name:'down'});assert.equal(s.selected,'worker');updateServices(s,[services[2],services[1],services[0]]);assert.equal(s.selected,'worker');
 assert.equal(handleKey(s,{name:'f3'}),'start');handleKey(s,{name:'f2'});assert.equal(s.selected,'api');assert.equal(handleKey(s,{name:'f3'}),'stop');assert.equal(handleKey(s,{name:'f4'}),'restart');
 handleKey(s,{name:'f6'});assert.equal(s.showServices,false);handleKey(s,{name:'f1'});assert.equal(handleKey(s,{name:'f4'}),undefined);handleKey(s,{name:'down'});assert.equal(s.infoOffset,1);assert.equal(s.selected,'api');handleKey(s,{name:'escape'});assert.equal(s.info,false);
 assert.equal(handleKey(s,{name:'f5'}),undefined);s.pending='start api';assert.equal(handleKey(s,{name:'f4'}),undefined);s.pending=undefined;s.connected=false;assert.equal(handleKey(s,{name:'f3'}),undefined);
 s.connected=true;s.services=[{...services[0],state:'observed'}];assert.equal(handleKey(s,{name:'f3'}),undefined);
 for(const key of [{name:'q'},{name:'q',ctrl:true},{name:'c',ctrl:true}])assert.equal(handleKey(s,key),'quit');
});
test('serial bounded read/action lane, pending guard, no retry on ambiguous action, no exit operation',async()=>{
 const calls=[];let active=0,max=0,release;
 const controller=new PanelController(async body=>{calls.push(body);max=Math.max(max,++active);try{
  if(body.action==='status')return {services};
  if(body.action==='log-follow'){if(!release)await new Promise(r=>release=r);return {text:'log\n',cursor:1};}
  if(body.action==='restart')throw Error('timeout');
 }finally{active--;}
 },()=>{});
 const run=controller.run();for(let i=0;i<100&&!release;i++)await delay(5);
 controller.key({name:'f4'});controller.key({name:'f4'});assert.equal(controller.state.pending,'restart api');
 controller.key({name:'down'});release();for(let i=0;i<100&&controller.state.pending;i++)await delay(5);
 assert.equal(controller.state.selected,'worker');assert.match(controller.state.notice,/outcome unknown/);controller.stop();await run;
 assert.equal(calls.filter(c=>c.action==='restart').length,1);assert.equal(calls.find(c=>c.action==='restart').name,'api');assert.equal(max,1);assert.ok(!calls.some(c=>c.action==='shutdown'));
});
test('clear during a read advances cursor but discards old content; read failure disables controls',async()=>{
 let release;const controller=new PanelController(async body=>{
  if(body.action==='status')return {services};
  if(body.stream==='stdout')return await new Promise(r=>release=()=>r({text:'old\n',cursor:8}));
  throw new SafeError('Output unavailable');
 },()=>{});
 const run=controller.run();for(let i=0;i<100&&!release;i++)await delay(5);controller.key({name:'l',ctrl:true});release();await delay(10);
 assert.equal(controller.state.logs.get('api').rows.length,0);assert.equal(controller.state.logs.get('api').streams.stdout.cursor,8);assert.equal(controller.state.connected,false);assert.match(controller.state.notice,/Read failed/);controller.stop();await run;
});
