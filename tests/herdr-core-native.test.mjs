import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {corePanel} from '../dist/herdr-core-panel.js';
import {coreRequest} from '../dist/herdr-app.js';

// Opt-in native protocol/PTY test: own HOME/XDG/session/socket only, no viewer,
// no ServiceHost runtime or real service. It never connects to the caller core.
test('disposable native core: direct launch and shared layout registration', {skip:process.platform!=='linux'||process.env.SERVICEHOST_CORE_NATIVE_TEST!=='1'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'servicehost-native-core-'));
 const env={...process.env,HOME:root,XDG_CONFIG_HOME:join(root,'config'),XDG_STATE_HOME:join(root,'state'),XDG_RUNTIME_DIR:join(root,'run'),HC_SESSION:'servicehost-test'};
 for(const k of Object.keys(env))if(k.startsWith('HC_')&&k!=='HC_SESSION')delete env[k];
 delete env.HERDR_ENV;delete env.HERDR_PANE_ID;
 await mkdir(env.XDG_RUNTIME_DIR,{mode:0o700});
 const cli=join(root,'fake-panel.mjs');await writeFile(cli,'setInterval(()=>{},1000);');
 const run=async(...args)=>JSON.parse((await promisify(execFile)('herdr-core',args,{env,timeout:15000})).stdout);
 let started=false;const terminals=[];
 try {
  const status=await run('server','start');started=true;assert.equal(status.live,0);
  const socket=join(env.XDG_RUNTIME_DIR,'herdr-core','servicehost-test.sock');await access(socket);
  const rpc=(m,p)=>coreRequest(socket,m,p);
  const caller=await rpc('terminal.run',{argv:[process.execPath,cli],cwd:root,no_parent:true,outlive_parent:true,labels:{'herdr.space':'space','herdr.tab':'tab'}});terminals.push(caller.address);
  await rpc('doc.set',{name:'herdr-app',version:0,value:{spaces:[{id:'space',name:'fixture',folder:root,tabs:[{id:'tab',name:'caller',root:{id:'tab',type:'row',children:[{id:'caller',type:'block',content:{terminal:caller.address}}]}}]}]}});
  const options={env:{...env,HC_TERMINAL_ID:caller.address,HC_TERMINAL_SOCKET:socket}};
  for(const placement of ['split','tab']) {
   const c={id:'project-'+placement,file:join(root,placement+'.json')};
   await corePanel(c,false,cli,{...options,placement,preflight:true});
   const r=await corePanel(c,false,cli,{...options,placement});terminals.push(r.terminal);
   assert.equal(r.displayRegistered,true);assert.equal(r.viewerObserved,false);assert.equal(r.focusChanged,false);
   const t=await rpc('terminal.get',{terminal:r.terminal});assert.equal(t.parent,null);assert.equal(t.die_with_parent,false);assert.equal(t.keep,false);assert.equal(t.cwd,root);assert.deepEqual(t.argv,[process.execPath,cli,'panel','--connect-only','--config',c.file]);
   assert.equal((await corePanel(c,true,cli,options)).terminal,r.terminal);
  }
  await run('kill',caller.address);
  for(const terminal of terminals.slice(1))assert.equal((await rpc('terminal.get',{terminal})).state,'live','owned display outlives its caller');
 } finally {
  if(started)await run('server','stop');
  await rm(root,{recursive:true,force:true});
 }
});
