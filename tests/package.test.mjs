import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import net from 'node:net';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('package is standalone compiled JS and excludes legacy, credentials and runtime',()=>{
 assert.ok(process.env.npm_execpath,'Run package tests through npm scripts');
 const output=execFileSync(process.execPath,[process.env.npm_execpath,'pack','--dry-run','--ignore-scripts','--json'],{encoding:'utf8'});
 const [pkg]=JSON.parse(output);const files=pkg.files.map(f=>f.path);
 const expected=['package.json','README.md','LICENSE','CHANGELOG.md','ServiceHost.example.json',
  'docs/design.md','docs/validation.md','docs/windows-lifecycle.md','docs/release.md',
  ...['cli','client','config','runtime','platform','linux-group','linux-group-helper','windows-launch'].map(n=>`dist/${n}.js`)];
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
   assert.equal(cli('up').existing,true);
   assert.equal(cli('stop','fixture').stopped,true);
   assert.equal(cli('shutdown').stopped,true);cli=undefined;
  }
 }finally{
  if(cli){try{cli('stop','fixture');}catch{}try{cli('shutdown');}catch{}}
  await new Promise(r=>setTimeout(r,200));rmSync(dir,{recursive:true,force:true});
 }
});
