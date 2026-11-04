import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { resolve } from 'node:path';
import { perform } from './integration.js';
import { SafeError } from './config.js';

const descriptions:Record<string,string>={
  config_inspect:'Inspect validated configuration metadata and revision; never displays commands, args, environment or credentials.',
  config_validate:'Validate existing configuration without starting anything; returns safe metadata.',
  config_create:'Create a validated configuration with an explicit authoritative apiPort. Never overwrites an existing config. Inspect the project first; use credential placeholders, not secrets.',
  config_update:'Atomically replace configuration using the inspected revision. Refuses active/unreconciled runtimes and concurrent changes. Editing apiPort never moves a listener.',
  host_start:'Explicitly start or identity-verify the independent runtime at configured apiPort. No services auto-start, no port fallback or process killing. Returns project, config path and bound port.',
  host_status:'Verify the runtime identity on configured apiPort. No launch or fallback.',
  host_shutdown:'Request runtime shutdown; fails while owned services/groups remain. Stop each service first. Uncertain outcomes must not be blindly retried.',
  service_status:'Inspect one hosted service without args, env or logs.',
  service_start:'Start one configured service through the independent runtime, never in model context.',
  service_stop:'Stop one runtime-owned service; never kills a discovered/adopted process.',
  service_restart:'Stop then start one runtime-owned service. No retry on uncertainty.',
  service_wait:'Wait at most timeoutMs (100–30000) for startup readiness to leave pending. Not continuous health, no lifecycle changes.',
  service_logs:'Inspect bounded logs. includeText:true explicitly acknowledges potentially sensitive application output entering model context; use only for authorized log diagnosis. No credential files are read and no secret-free guarantee. Default metadata only.',
  service_discover:'Inspect configured TCP listener identities; observation grants no stop authority or automatic adoption.',
  panel_open:'Explicitly open a non-focusing Linux Herdr display for an already-running host, or verify its recorded pane. No runtime auto-start. Uncertain launches require manual inspection; Windows deferred.',
  panel_reconnect:'Verify recorded Linux Herdr display identity and runtime connection, without shell input, focus, replacement or runtime launch. Pane presence is not foreground process readiness.',
};
export default function extension(pi:ExtensionAPI) {
  for(const [operation,description] of Object.entries(descriptions)) {
    const fields:any={configPath:Type.Optional(Type.String({maxLength:4096,description:'Config path relative to current project; default ServiceHost.json'}))};
    if(operation.startsWith('service_'))fields.name=Type.String({pattern:'^[a-zA-Z0-9_-]{1,64}$'});
    if(operation==='config_create'||operation==='config_update')fields.configuration=Type.Unknown({description:'Full ServiceHost configuration: apiPort, logDirectory, services. Use credential placeholders; never supply credential contents.'});
    if(operation==='config_update')fields.revision=Type.String({pattern:'^[a-f0-9]{64}$'});
    if(operation==='service_wait')fields.timeoutMs=Type.Optional(Type.Integer({minimum:100,maximum:30000}));
    if(operation==='service_logs'){
      fields.includeText=Type.Optional(Type.Boolean({description:'Explicit sensitive-log opt-in: application text may contain secrets and enters model context. Only for authorized debugging.'}));
      fields.bytes=Type.Optional(Type.Integer({minimum:1,maximum:16384}));
      fields.stream=Type.Optional(Type.String({enum:['stdout','stderr']}));
    }
    pi.registerTool({name:`servicehost_${operation}`,label:`ServiceHost ${operation}`,description,
      parameters:Type.Object(fields,{additionalProperties:false}),
      async execute(_id,params,signal,_update,ctx) {
        try {
          const run=()=>perform(operation,params,ctx.cwd,signal);
          const result=operation==='config_create'||operation==='config_update'
            ?await withFileMutationQueue(resolve(ctx.cwd,(params as any).configPath??'ServiceHost.json'),run):await run();
          const text=JSON.stringify(result);
          return {content:[{type:'text',text:text.length<=24000?text:JSON.stringify({truncated:true,notice:'Result exceeds public limit; inspect locally'})}],details:undefined};
        } catch(e) {
          return {isError:true,content:[{type:'text',text:e instanceof SafeError?e.message:'Operation failed or cancelled; details withheld. Inspect configuration/status locally before retrying; an issued action may still complete'}],details:undefined};
        }
      },
    });
  }
}
