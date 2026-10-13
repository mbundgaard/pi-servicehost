import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('disposable PTY restores terminal and exercises actual key decoding with authenticated fixtures',{skip:process.platform!=='linux'},()=>{
 const output=execFileSync('python3',['tests/panel-pty.py'],{encoding:'utf8',timeout:30000,env:{...process.env,NODE:process.execPath}});
 assert.match(output,/restoration passed/);
});
