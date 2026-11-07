import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {herdrPanel,panelCommand,panelCLI,panelCLIFrom} from '../dist/herdr.js';
const env={HERDR_ENV:'1',HERDR_PANE_ID:'w:p1'};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'panel-'));const c={file:join(root,'ServiceHost.json'),id:'project'};const caller={pane_id:'w:p1',tab_id:'w:t1',workspace_id:'w',terminal_id:'term1'};const pane={pane_id:'w:p2',tab_id:'w:t1',workspace_id:'w',terminal_id:'term2'};const calls=[];let created=false;
 const run=async a=>{calls.push(a);let result={};if(a[1]==='current')result={pane:caller};if(a[1]==='list')result={panes:created?[caller,pane]:[caller]};if(a[1]==='split'){created=true;result={pane};}if(a[1]==='rename')pane.label=a[3];if(a[1]==='run')return '';return JSON.stringify({result});};return {root,c,pane,calls,run};}
test('explicit non-focusing split; returned IDs, connect-only command; reuse never injects',async()=>{const f=await fixture();try{
 const result=await herdrPanel(f.c,false,{run:f.run,env});assert.equal(result.pane,'w:p2');assert.equal(result.runtimeStarted,false);
 assert.ok(f.calls.find(a=>a[1]==='split').includes('--no-focus'));assert.equal(f.calls.find(a=>a[1]==='run')[2],'w:p2');assert.equal(f.calls.find(a=>a[1]==='run')[3],panelCommand(f.c.file));
 f.calls.length=0;assert.equal((await herdrPanel(f.c,true,{run:f.run,env})).pane,'w:p2');assert.deepEqual(f.calls.map(a=>a[1]),['current','list']);
 f.pane.terminal_id='replaced';await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}),/uncertain/);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('uncertain submission persists fence; sanitized errors; no blind retry',async()=>{const f=await fixture();try{
 const run=async a=>{if(a[1]==='run')throw new Error('secret transport stderr');return f.run(a);};
 await assert.rejects(herdrPanel(f.c,false,{run,env}),e=>!e.message.includes('secret transport'));
 assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'run_pending');f.calls.length=0;
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}));assert.deepEqual(f.calls.map(a=>a[1]),['current']);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('concurrent opens excluded; reconnect without record and unsupported platform inert',async()=>{const f=await fixture();try{
 await assert.rejects(herdrPanel(f.c,true,{run:f.run,env}));assert.ok(!f.calls.some(a=>a[1]==='split'));
 let release;const gate=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
 const run=async a=>{if(a[1]==='current'){entered();await gate;}return f.run(a);};const pending=herdrPanel(f.c,false,{run,env});await ready;
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}),/locked/);
 const child=`import {exclusive} from ${JSON.stringify(new URL('../dist/config-store.js',import.meta.url).href)};try{await exclusive(${JSON.stringify(f.c.file+'.panel.json')},async()=>{});process.exitCode=1}catch(e){console.log(e.message)}`;
 assert.match((await promisify(execFile)(process.execPath,['--input-type=module','-e',child])).stdout,/locked/);release();await pending;
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env,platform:'darwin'}),/Linux and Windows only/);
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('lost split acknowledgement remains fenced without command submission or duplicate split',async()=>{const f=await fixture();try{
 const run=async a=>{const result=await f.run(a);if(a[1]==='split')throw new Error('lost acknowledgement');return result;};
 await assert.rejects(herdrPanel(f.c,false,{run,env}));assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'split_pending');
 await assert.rejects(herdrPanel(f.c,false,{run:f.run,env}));assert.equal(f.calls.filter(a=>a[1]==='split').length,1);assert.ok(!f.calls.some(a=>a[1]==='run'));
 }finally{await rm(f.root,{recursive:true,force:true});}});
test('package-relative CLI and shell quoting executed only against disposable argument recorder',{skip:process.platform!=='linux'},async()=>{const root=await mkdtemp(join(tmpdir(),"panel ' quote-"));try{
 const script=join(root,"recorder ' $.mjs");await writeFile(script,'console.log(JSON.stringify(process.argv.slice(2)))');const config=join(root,"config ' $(false);.json");
 const {stdout}=await promisify(execFile)('/bin/sh',['-c',panelCommand(config,script)]);assert.deepEqual(JSON.parse(stdout),['panel','--connect-only','--config',config]);assert.match(panelCLI,/\/dist\/cli\.js$/);
 }finally{await rm(root,{recursive:true,force:true});}});

// A strict decoder of our fixed command grammar, not a PowerShell emulator.
function windowsArgv(command){
 const match=/^powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command);assert.ok(match);
 const script=Buffer.from(match[1],'base64').toString('utf16le');
 const literal=/\(\[Text\.Encoding\]::Unicode\.GetString\(\[Convert\]::FromBase64String\('([A-Za-z0-9+/=]*)'\)\)\)/g;
 const args=[...script.matchAll(literal)];
 assert.equal(script,'& '+args.map(m=>m[0]).join(' '),'no path data becomes executable source');
 return args.map(m=>Buffer.from(m[1],'base64').toString('utf16le'));
}
test('Windows package URL and encoded argv preserve drive/UNC, spaces, Unicode and shell syntax',()=>{
 assert.equal(panelCLIFrom('file:///C:/Program%20Files/O%27Brien/%E9%9B%AA/dist/herdr.js','win32'),"C:\\Program Files\\O'Brien\\雪\\dist\\cli.js");
 assert.equal(panelCLIFrom('file://server/share/a%20b/dist/herdr.js','win32'),'\\\\server\\share\\a b\\dist\\cli.js');
 const node="C:\\Program Files\\O'Brien\\node.exe",cli='C:\\包 # % &\\dist\\cli.js';
 for(const file of ["C:\\a b\\O'Brien\\雪😀.json",'C:\\$HOME $(evil); & | %PATH% ! ^ ` [x]\\config.json',"C:\\smart ’; $(evil) ‘ quote\\config.json"]){
  assert.deepEqual(windowsArgv(panelCommand(file,cli,node,'win32')),[node,cli,'panel','--connect-only','--config',file]);
 }
});
test('mock Windows Herdr transport opens once with exact bundled Node argv and reconnect never injects',async()=>{
 const f=await fixture();f.c.file=join(f.root,"雪 O'Brien $HOME & (x).json");
 try{
  const options={run:f.run,env,platform:'win32'};
  const result=await herdrPanel(f.c,false,options);assert.equal(result.runtimeStarted,false);assert.match(result.outcome,/readiness not verified/);
  assert.deepEqual(f.calls.map(a=>a[1]),['current','list','split','list','rename','run']);
  const split=f.calls.find(a=>a[1]==='split');assert.deepEqual(split,['pane','split','--pane','w:p1','--direction','down','--cwd',win32.dirname(f.c.file),'--no-focus']);
  const run=f.calls.find(a=>a[1]==='run');assert.equal(run.length,4);assert.equal(run[2],'w:p2');
  assert.deepEqual(windowsArgv(run[3]),[process.execPath,panelCLI,'panel','--connect-only','--config',f.c.file]);
  assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,'submitted');
  for(const reconnect of [true,false]){f.calls.length=0;assert.match((await herdrPanel(f.c,reconnect,options)).outcome,/foreground process and panel readiness not verified/);assert.deepEqual(f.calls.map(a=>a[1]),['current','list']);}
  f.pane.terminal_id='replacement';f.calls.length=0;await assert.rejects(herdrPanel(f.c,true,options),/uncertain/);assert.deepEqual(f.calls.map(a=>a[1]),['current','list']);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
for(const stage of ['split','rename','run'])test(`Windows lost ${stage} acknowledgement fences open and reconnect`,async()=>{
 const f=await fixture();try{
  const options={env,platform:'win32',run:async a=>{const reply=await f.run(a);if(a[1]===stage)throw Error('private stderr');return reply;}};
  await assert.rejects(herdrPanel(f.c,false,options),e=>!e.message.includes('private stderr'));
  assert.equal(JSON.parse(await readFile(f.c.file+'.panel.json','utf8')).stage,stage+'_pending');
  for(const reconnect of [false,true]){f.calls.length=0;await assert.rejects(herdrPanel(f.c,reconnect,{run:f.run,env,platform:'win32'}));assert.deepEqual(f.calls.map(a=>a[1]),['current']);}
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('native Windows PowerShell transport runs only a disposable Node argv recorder',{skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),"panel 雪 O'Brien & "));try{
  const script=join(root,'recorder $x;.mjs');await writeFile(script,"import {writeFileSync} from 'node:fs';writeFileSync(new URL('./argv.json',import.meta.url),JSON.stringify(process.argv.slice(2)));");
  const config=join(root,"smart ’ quote ' %PATH% ! ` $(evil);.json");
  const command=panelCommand(config,script,process.execPath,'win32');
  await promisify(execFile)('powershell.exe',command.split(' ').slice(1),{timeout:10000});
  // Read UTF-8 from the recorder, independent of the host console output codepage.
  assert.deepEqual(JSON.parse(await readFile(join(root,'argv.json'),'utf8')),['panel','--connect-only','--config',config]);
 }finally{await rm(root,{recursive:true,force:true});}
});
