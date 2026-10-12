import { statSync, realpathSync } from 'node:fs';
import { win32 } from 'node:path';
import { demand, SafeError } from './config.js';

export interface WindowsLaunchPlan { command:string; args:string[]; windowsVerbatimArguments:boolean; batch:boolean }
// Pure planner: command must already be a resolved absolute file path. No shell for native images.
export function windowsLaunchPlan(command:string,args:string[],systemRoot:string):WindowsLaunchPlan {
  demand(win32.isAbsolute(command) && !command.includes('\0'),'Windows executable path must be absolute');
  if (/\.(exe|com)$/i.test(command)) return {command,args,windowsVerbatimArguments:false,batch:false};
  demand(/\.(cmd|bat)$/i.test(command),'Unsupported Windows executable extension');
  // Intentionally small grammar, NOT a general cmd escaping algorithm. In particular reject
  // percent/delayed expansion, quotes, operators, controls, batch parameter separators
  // (including comma and equals), and empty/space-containing arguments.
  demand(/^[A-Za-z]:\\[A-Za-z0-9_ .\\/-]+$/.test(command) && !command.split(/[\\/]/).some(p=>/[ .]$/.test(p)),
    'Windows batch path blocked: unsupported characters or path form; use node.exe plus a JS entrypoint');
  demand(args.every(a=>/^[A-Za-z0-9_./:+\-]+$/.test(a)),
    'Windows batch argument blocked: only nonempty ASCII tokens without whitespace or shell syntax are supported; use node.exe plus a JS entrypoint');
  demand(/^[A-Za-z]:\\[A-Za-z0-9_ .\\-]+$/.test(systemRoot),'Windows system directory unavailable');
  const line=`""${command}"${args.length ? ' '+args.join(' ') : ''}"`;
  demand(line.length<=8000,'Windows batch command line too long');
  return {command:win32.join(systemRoot,'System32','cmd.exe'),args:['/d','/s','/v:off','/c',line],windowsVerbatimArguments:true,batch:true};
}

// Deliberately do not search the current directory or honor arbitrary PATHEXT entries.
// Config-relative paths were made absolute by config.ts; bare names use the child's PATH.
export function resolveWindowsCommand(command:string,env:NodeJS.ProcessEnv,cwd:string):string {
  demand(!command.includes('\0') && !/["\r\n]/.test(command),'Invalid Windows command');
  const pathKey=Object.keys(env).sort().find(k=>k.toLowerCase()==='path');
  const pathEntry=(pathKey ? env[pathKey] : undefined) ?? '';
  const explicit=/[\\/:]/.test(command);
  const bases=explicit ? [win32.resolve(cwd,command)] : pathEntry.split(';').filter(Boolean).map(p=> {
    const dir=p.startsWith('"') && p.endsWith('"') ? p.slice(1,-1) : p;
    // Relative PATH entries are not stable authority for an executable search.
    return win32.isAbsolute(dir) ? win32.join(dir,command) : '';
  }).filter(Boolean);
  const ext=win32.extname(command);
  demand(!ext || /^\.(exe|com|cmd|bat)$/i.test(ext),'Unsupported Windows executable extension');
  for(const base of bases) for(const candidate of ext ? [base] : ['.exe','.com','.cmd','.bat'].map(e=>base+e)) {
    try { if(statSync(candidate).isFile()) return realpathSync(candidate); }
    catch(e:any) { if(!['ENOENT','ENOTDIR'].includes(e.code)) throw new SafeError('Windows executable cannot be inspected'); }
  }
  throw new SafeError('Windows executable not found in configured path');
}
