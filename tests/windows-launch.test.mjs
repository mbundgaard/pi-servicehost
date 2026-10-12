import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {windowsLaunchPlan,resolveWindowsCommand} from '../dist/windows-launch.js';
import {launch} from '../dist/platform.js';
import {loadConfig} from '../dist/config.js';
import {auth,Manager} from '../dist/runtime.js';
const script='C:\\Program Files\\fixture\\run.cmd';
test('Windows batch planner uses a closed grammar and explicit cmd switches',()=>{
 const p=windowsLaunchPlan(script,['run','dev','--port','3000'], 'C:\\Windows');
 assert.deepEqual(p,{command:'C:\\Windows\\System32\\cmd.exe',args:['/d','/s','/v:off','/c','""C:\\Program Files\\fixture\\run.cmd" run dev --port 3000"'],windowsVerbatimArguments:true,batch:true});
 for(const arg of ['', 'a=b', 'a,b', 'a;b', 'two words','a\tb','a\nb','"','%PATH%','!secret!','a&b','a|b','<x','>x','(x)','^x','é','a\\']) {
  assert.throws(()=>windowsLaunchPlan(script,[arg],'C:\\Windows'),/argument blocked/);
 }
 for(const path of ['C:\\x&y\\run.cmd','C:\\%x%\\run.cmd','C:\\x!\\run.bat','C:\\x^\\run.cmd','C:\\x"\\run.cmd','\\\\server\\share\\run.cmd','C:\\x.\\run.cmd'])assert.throws(()=>windowsLaunchPlan(path,[],'C:\\Windows'),/blocked/);
 assert.throws(()=>windowsLaunchPlan(script,['a'.repeat(8000)],'C:\\Windows'),/too long/);
 assert.throws(()=>windowsLaunchPlan('C:\\run.ps1',[],'C:\\Windows'),/extension/);
});
test('native planner keeps arbitrary argv on Node quoting path',()=>{
 const args=['','two words','"quoted"','trailing\\','%PATH%','!x!','&|<>^()','雪'];
 const plan=windowsLaunchPlan('C:\\Program Files\\node.exe',args,'');
 assert.equal(plan.windowsVerbatimArguments,false);assert.equal(plan.batch,false);assert.deepEqual(plan.args,args);
});
test('native executable argv roundtrip uses no shell',async()=>{
 const args=['','two words','"quoted"','trailing\\','a\\"b','%PATH%','!x!','&|<>^()','雪'];
 const child=launch(process.execPath,['-e','console.log(JSON.stringify(process.argv.slice(1)))','--',...args],{stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);const [code]=await once(child,'close');assert.equal(code,0);assert.deepEqual(JSON.parse(output),args);
});
test('Windows native batch execution, PATH resolution, direct logs and retained wrapper lease',{skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'servicehost batch '));let m;
 try {
  const script=join(root,'fixture.cmd');await writeFile(script,'@echo off\r\necho %1,%2\r\necho batch-error 1>&2\r\n');
  await writeFile(join(root,'args.cjs'),'console.log(JSON.stringify(process.argv.slice(2)))');
  const bat=join(root,'forward.bat');await writeFile(bat,`@"${process.execPath}" "%~dp0args.cjs" %*\r\n`);
  const forwarded=launch(bat,['run','--flag','3000'],{stdio:['ignore','pipe','pipe']});
  let output='';forwarded.stdout.on('data',b=>output+=b);const [code]=await once(forwarded,'close');
  assert.equal(code,0);assert.deepEqual(JSON.parse(output),['run','--flag','3000']);
  assert.equal(resolveWindowsCommand('fixture',{Path:root},root).toLowerCase(),script.toLowerCase());
  assert.throws(()=>resolveWindowsCommand('fixture',{Path:''},root),/not found/);
  await writeFile(join(root,'ServiceHost.json'),JSON.stringify({apiPort:19502,logDirectory:'logs',services:[{name:'batch',command:'fixture.cmd',args:['hello','--flag'],workingDirectory:'.',environment:{PATH:root,Path:root}}]}));
  const c=await loadConfig(join(root,'ServiceHost.json'));await auth(c);m=new Manager(c);
  await m.start('batch');for(let i=0;i<100&&!m.canShutdown();i++)await new Promise(r=>setTimeout(r,20));assert.ok(m.canShutdown());
  assert.match((await m.logs('batch','stdout',4096)).text,/hello,--flag/);
  assert.match((await m.logs('batch','stderr',4096)).text,/batch-error/);
  await assert.rejects(m.stop('batch'),/lease retained/);await assert.rejects(m.start('batch'),/Stale launch lease/);
  assert.ok(await readFile(join(root,'.servicehost','batch.lease.json')));
  for(const arg of ['& echo injected','%PATH%','!PATH!'])assert.throws(()=>launch(script,[arg],{}),/argument blocked/);
 } finally {await m?.stop('batch').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
