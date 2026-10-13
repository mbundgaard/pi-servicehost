import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export class SafeError extends Error {}
export function demand(ok: unknown, message: string): asserts ok { if (!ok) throw new SafeError(message); }
export interface ReadinessConfig { port:number; path:string; expectedStatus:number; startupTimeoutMs:number }
export interface Service { readiness?:ReadinessConfig; name: string; command: string; args: string[]; workingDirectory: string; port?: number; environment: Record<string,string> }
export interface Config { file: string; root: string; id: string; apiPort: number; logDirectory: string; stateDirectory: string; services: Service[] }
const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 8192 && !s.includes('\0');
const port = (n: unknown): n is number => Number.isInteger(n) && Number(n) > 0 && Number(n) <= 65535;
export async function jsonFile(file: string): Promise<any> { const b = await readFile(file); demand(b.length <= 1024 * 1024, 'File too large'); return JSON.parse(b.toString()); }
export async function loadConfig(path: string): Promise<Config> {
  const file = await realpath(resolve(path)); const root = dirname(file); const c = await jsonFile(file);
  demand(c && port(c.apiPort) && text(c.logDirectory) && Array.isArray(c.services) && c.services.length <= 100, 'Invalid configuration');
  const names = new Set<string>(); const ports = new Set<number>([c.apiPort]);
  const services = c.services.map((s: any): Service => {
    demand(s && typeof s.name === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s.name) && !names.has(s.name), 'Invalid or duplicate service name'); names.add(s.name);
    demand(text(s.command) && !s.command.includes('${') && Array.isArray(s.args) && s.args.length <= 256 && s.args.every((a: unknown) => typeof a === 'string' && a.length <= 8192 && !a.includes('\0')) && text(s.workingDirectory), 'Invalid service command, args or directory');
    demand(s.port === undefined || (port(s.port) && !ports.has(s.port)), 'Invalid or duplicate service port'); if (s.port) ports.add(s.port);
    const readiness=s.readiness;
    if(readiness!==undefined) {
      demand(readiness && typeof readiness==='object' && !Array.isArray(readiness) && Object.keys(readiness).every(k=>['port','path','expectedStatus','startupTimeoutMs'].includes(k)), 'Invalid readiness configuration');
      demand(port(readiness.port) && readiness.port!==c.apiPort && typeof readiness.path==='string' && /^\/(?!\/)[A-Za-z0-9_./~-]*$/.test(readiness.path) && readiness.path.length<=1024, 'Invalid readiness endpoint');
      demand(Number.isInteger(readiness.expectedStatus) && readiness.expectedStatus>=200 && readiness.expectedStatus<=599 && Number.isInteger(readiness.startupTimeoutMs) && readiness.startupTimeoutMs>=100 && readiness.startupTimeoutMs<=120000, 'Invalid readiness bounds');
    }
    const env = s.environment ?? {}; demand(env && typeof env === 'object' && !Array.isArray(env) && Object.keys(env).length <= 256, 'Invalid environment');
    for (const [k,v] of Object.entries(env)) demand(/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v.length <= 8192 && !v.includes('\0'), 'Invalid environment entry');
    return { name: s.name, command: isAbsolute(s.command) || /[\\/]/.test(s.command) ? resolve(root,s.command) : s.command, args:s.args, workingDirectory:resolve(root,s.workingDirectory), port:s.port, readiness, environment:env };
  });
  return { file, root, id:createHash('sha256').update(process.platform === 'win32' ? file.toLowerCase() : file).digest('hex'), apiPort:c.apiPort, logDirectory:resolve(root,c.logDirectory), stateDirectory:resolve(root,'.servicehost'), services };
}
export async function launchValues(c: Config, s: Service) {
  let secrets: Record<string,string> = {};
  const values = [...s.args, ...Object.values(s.environment)];
  if (values.some(v => v.includes('${credential:'))) {
    secrets = await jsonFile(resolve(c.root,'ServiceHost.credentials.json'));
    demand(secrets && typeof secrets === 'object' && !Array.isArray(secrets), 'Invalid credentials file');
  }
  const expand = (v: string) => v.replace(/\$\{credential:([A-Za-z0-9_-]+)\}/g, (_, key) => {
    const value = secrets[key]; demand(typeof value === 'string' && value.length <= 8192 && !value.includes('\0'), 'Missing or invalid credential'); return value;
  });
  return { args:s.args.map(expand), env:{ ...process.env, ...Object.fromEntries(Object.entries(s.environment).map(([k,v]) => [k,expand(v)])) } };
}
