import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import net from 'node:net';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
async function ttyView(bin,args,cwd,marker,wait=0,keys='q\n'){
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const child=spawn('script',['-q','-e','-c',[bin,...args].map(quote).join(' '),'/dev/null'],{cwd,stdio:['pipe','pipe','pipe']});
 let output='';let sent=false;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error(`PTY view timeout: ${args.join(' ')} waiting for ${marker}`));},10000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.stdout.on('data',b=>{output+=b;if(!sent&&output.includes(marker)){sent=true;setTimeout(()=>child.stdin.write(keys),wait);}});
  child.once('close',code=>{clearTimeout(timer);code===0&&sent?resolve():reject(Error('PTY view failed'));});
 });return output;
}
test('package is standalone compiled JS and excludes legacy, credentials and runtime',()=>{
 assert.ok(process.env.npm_execpath,'Run package tests through npm scripts');
 const output=execFileSync(process.execPath,[process.env.npm_execpath,'pack','--dry-run','--ignore-scripts','--json'],{encoding:'utf8'});
 const [pkg]=JSON.parse(output);const files=pkg.files.map(f=>f.path);
 const expected=['package.json','README.md','LICENSE','CHANGELOG.md','ServiceHost.example.json',
  'docs/design.md','docs/panel-design.md','docs/validation.md','docs/windows-lifecycle.md','docs/release.md',
  ...['cli','client','config','runtime','readiness','logs','watch','panel','platform','linux-group','linux-group-helper','windows-launch'].map(n=>`dist/${n}.js`)];
 assert.deepEqual(files.sort(),expected.sort(),'Only reviewed files may ship; no references, source, tests, secrets or state');
 const p=JSON.parse(readFileSync('package.json','utf8'));assert.equal(p.bin['pi-servicehost'],'dist/cli.js');assert.ok(!p.dependencies&&!p.peerDependencies&&!p.pi);
 assert.equal(p.name,'@comput/pi-servicehost');assert.equal(p.license,'MIT');
 assert.match(p.repository.url,/^git\+https:\/\/github\.com\/[A-Za-z0-9_-]+\/pi-servicehost\.git$/);
 const repo=p.repository.url.replace(/^git\+/,'').replace(/\.git$/,'');
 assert.equal(p.homepage,`${repo}#readme`);assert.equal(p.bugs.url,`${repo}/issues`);
 const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
 assert.equal(lock.name,p.name);assert.equal(lock.version,p.version);assert.equal(lock.packages[''].version,p.version);assert.equal(lock.packages[''].license,p.license);
 assert.match(readFileSync('dist/cli.js','utf8'),/^#!\/usr\/bin\/env node\n/);
 assert.match(execFileSync(process.execPath,['dist/cli.js','help'],{encoding:'utf8'}),/panel/);
});
test('packed artifact installs without scripts and CLI lifecycle runs outside checkout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'servicehost-package-'));
 const run=(args)=>execFileSync(process.execPath,[process.env.npm_execpath,...args],{encoding:'utf8',timeout:60000});
 let cli;
 try {
  const [pack]=JSON.parse(run(['pack','--ignore-scripts','--json','--pack-destination',dir]));
  run(['install','--prefix',join(dir,'install'),'--ignore-scripts','--no-audit','--no-fund',join(dir,pack.filename)]);
  const installed=join(dir,'install','node_modules','@comput','pi-servicehost','dist','cli.js');assert.ok(existsSync(installed));
  assert.match(execFileSync(process.execPath,[installed,'--help'],{cwd:dir,encoding:'utf8',timeout:10000}),/Panel closure never stops/);
  const bin=join(dir,'install','node_modules','.bin',process.platform==='win32'?'pi-servicehost.cmd':'pi-servicehost');assert.ok(existsSync(bin));
  if(process.platform==='linux') {
   assert.match(execFileSync(bin,['--help'],{cwd:dir,encoding:'utf8',timeout:10000}),/panel/);
   const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const apiPort=probe.address().port;await new Promise(r=>probe.close(r));
   writeFileSync(join(dir,'ServiceHost.json'),JSON.stringify({apiPort,logDirectory:'logs',services:[{name:'fixture',command:process.execPath,args:['-e','console.log("tarball-ready");setTimeout(()=>process.exit(0),15000)'],workingDirectory:'.'}]}));
   cli=(...args)=>JSON.parse(execFileSync(bin,args,{cwd:dir,encoding:'utf8',timeout:25000}));
   assert.equal(cli('up').running,true);
   assert.equal(cli('status').services[0].state,'stopped');
   assert.equal(cli('start','fixture').scope,'linux-process-group');
   for(let i=0;i<50;i++){if(cli('logs','fixture').text.includes('tarball-ready'))break;await new Promise(r=>setTimeout(r,20));}
   assert.match(cli('logs','fixture').text,/tarball-ready/);
   const livePid=cli('status').services[0].pid;
   // util-linux script supplies a real disposable PTY; no Herdr or real service.
   const live=await ttyView(bin,['watch'],dir,'ready:"not-configured"',1200);assert.match(live,/exit:\?/);assert.equal(live.match(/ready:"not-configured"/g).length,1);
   const followed=await ttyView(bin,['follow','fixture'],dir,'tarball-ready',1200);assert.match(followed,/may contain secrets/);assert.equal(followed.match(/tarball-ready/g).length,1);
   await ttyView(bin,['panel','--live'],dir,'ready:"not-configured"');
   const logsBefore=cli('logs','fixture').text;
   const panel=await ttyView(bin,['panel'],dir,'tarball-ready',0,'\x0cq');assert.match(panel,/\u001b\[\?1049h/);assert.match(panel,/\u001b\[\?25h\u001b\[\?1049l/);
   assert.equal(cli('logs','fixture').text,logsBefore,'Ctrl+L and quit do not truncate logs');
   const prompt=await ttyView(bin,['panel','--prompt'],dir,'servicehost>');assert.match(prompt,/Closing this panel leaves services running/);
   assert.equal(cli('status').services[0].pid,livePid);
   assert.equal(cli('watch').services[0].state,'running');
   assert.match(cli('follow','fixture').text,/tarball-ready/);
   assert.equal(cli('log-inventory','10').dryRun,true);
   assert.equal(cli('log-inventory','10').entries.length,2);
   assert.equal(cli('up').existing,true);
   assert.equal(cli('stop','fixture').stopped,true);
   assert.equal(cli('shutdown').stopped,true);cli=undefined;
  }
 }finally{
  if(cli){try{cli('stop','fixture');}catch{}try{cli('shutdown');}catch{}}
  await new Promise(r=>setTimeout(r,200));rmSync(dir,{recursive:true,force:true});
 }
});
