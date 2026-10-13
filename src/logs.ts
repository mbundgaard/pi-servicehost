import { opendir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from './config.js';
import { demand } from './config.js';
// No inactivity proof exists for escaped descriptor holders. Inventory is never deletion authority.
export async function logInventory(c:Config,limit=100) {
  demand(Number.isInteger(limit)&&limit>=1&&limit<=1000,'Invalid inventory limit');
  const entries:{file:string;bytes:number;disposition:string}[]=[];let scanned=0;let truncated=false;
  let dir;try{dir=await opendir(c.logDirectory);}catch(e:any){if(e.code==='ENOENT')return {dryRun:true,scanned, truncated,entries};throw e;}
  for await(const entry of dir) {
    if(scanned>=limit){truncated=true;break;}scanned++;
    const match=/^([a-zA-Z0-9_-]{1,64})-[a-f0-9]{24}\.(stdout|stderr)\.log$/.exec(entry.name);
    if(!match || !c.services.some(s=>s.name===match[1]) || !entry.isFile())continue;
    try {const st=await lstat(resolve(c.logDirectory,entry.name));if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)continue;
      entries.push({file:entry.name,bytes:st.size,disposition:'retained-inactivity-unproven'});
    }catch(e:any){if(e.code!=='ENOENT')throw e;}
  }
  return {dryRun:true,scanned,truncated,entries};
}
