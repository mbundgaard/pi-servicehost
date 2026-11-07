# ServiceHost

A project-local service runner with a detached HTTP runtime, standalone terminal panel, and **Pi extension + skill (0.6.1)**. Start services explicitly and leave them running when Pi or the panel closes. No services start on extension load; no continuous logs enter model context.

Version **0.5.0** adds the new Herdr app/core adapter and preserves the legacy Linux/Windows integration from 0.4.1. Version 0.3.0 is standalone-only. Install with `pi install npm:@comput/pi-servicehost`. When upgrading a Pi process that loaded the older compiled extension, **fully exit and restart Pi once**; subsequent TS-entry upgrades can use resource rediscovery and `/reload`. See [extension loading and upgrade recovery](docs/extension-loading.md). [Pi installation, tools and limitations](docs/pi-integration.md) describes the workflow and local testing. Explicit Linux/Windows Herdr tools open a display or verify its recorded identity; **the new app/core adapter changes tab focus to its split pane**, while legacy Herdr remains non-focusing. Log excerpts require sensitive-text opt-in. See the integration contract for limits. Repository: [mbundgaard/pi-servicehost](https://github.com/mbundgaard/pi-servicehost).

### New in 0.6.1

**Explicit `servicehost_host_start` now starts/connects the runtime and opens/reuses its visible Herdr panel in the same operation.** Extension registration, session start and reload remain inert; services still require individual `servicehost_service_start` calls. Host start accepts optional `placement: "split" | "tab"` (default split), using the same adapter ownership checks as panel open. Panel failure is a structured tool error with `runtimeRunning` (true after identity verification, null if unconfirmed), project/config/authoritative `apiPort`, and a panel error. Runtime/services are left intact; inspect status and recorded panes before any retry. `host_shutdown` still refuses owned services. Standalone CLI `up` remains explicitly headless.

`servicehost_panel_open` now accepts optional `placement: "split" | "tab"` (default `"split"`). Split opens above the explicit caller; tab creates a **ServiceHost** tab in the caller's workspace/space with project cwd. This is creation-only: an existing recorded display is verified/reused **in place**, even when a different placement is requested; the result reports its actual recorded placement. `panel_reconnect` has no placement option and remains read-only. New app/core changes focus; legacy preserves it. No runtime auto-start or duplicate launch on uncertainty.

## Install and use

For Pi, build this checkout and `pi install /absolute/path/to/pi-servicehost`, then use `/skill:servicehost`. Ask the agent to inspect project scripts and propose config before starting anything. The same package bundles all compiled runtime/panel files; no separate global CLI is needed. Host/typebox peer dependencies come from Pi, not the standalone runtime. See the [integration guide](docs/pi-integration.md).

For standalone use, install the published CLI:

```sh
npm install -g @comput/pi-servicehost
pi-servicehost --help
```

Requires Node.js **22.19+** and npm. Linux requires readable procfs in the same PID/network namespace and cooperative foreground services. macOS and other platforms are unsupported. Windows discovery requires Windows PowerShell and `Get-NetTCPConnection`; no Windows tree-stop guarantee is provided.

Use version 0.3.0 or newer for the interactive panel described below, or install a locally built tarball (see Development below). A project-local registry installation also works: `npm install --save-dev @comput/pi-servicehost`, then `npx --no-install pi-servicehost --help`. No install scripts or runtime dependencies are needed by the standalone CLI. Standalone installs can use `--legacy-peer-deps` to suppress Pi peers.

Put `ServiceHost.json` in your project:

```json
{
  "apiPort": 9500,
  "logDirectory": "./logs",
  "services": [{
    "name": "api",
    "command": "node",
    "args": ["server.js"],
    "workingDirectory": "./api",
    "port": 5000,
    "environment": { "PORT": "5000" }
  }]
}
```

```sh
pi-servicehost up
pi-servicehost panel
# or use independent commands:
pi-servicehost start api
pi-servicehost status
pi-servicehost logs api stderr
pi-servicehost stop api
pi-servicehost shutdown
```

### Interactive panel (0.3.0)

`panel` starts/reconnects the runtime, then opens the compact legacy-style alternate-screen TUI: service rows such as `> api running :3000`, a full-width separator, selected-service stdout/stderr, then a full-width separator and shortcuts/package version. No title, column headings or persistent connection banner. No services auto-start. Names stay selected across polls; updates never move focus. F2 cycles services; arrows also select. F1 shows PID, readiness, ownership and last exit; these observations are **not control authority**. Colors follow the terminal palette (`NO_COLOR` disables styling); selection also has a `>` marker. Pending/disconnected warnings remain visible while relevant; action results/errors and clear confirmations appear temporarily in log-pane space (eight seconds), with the last message retained in F1.

- **↑/↓ / F2:** select previous/next service (F2 wraps).
- **F1 / Esc:** open/close info and full key help (↑/↓ scroll info).
- **F3:** start/stop selected service; **F4:** restart via the existing authenticated API. Runtime ownership/lease checks still apply; observe-only and known lost-ownership services have no controls. One action at a time; ambiguous results are never retried automatically. Inspect status before deciding to retry.
- **Page Up / Page Down:** scroll buffered logs. **Home:** oldest buffered output. **End:** resume live follow. New output preserves your per-service history position; the footer shows live, paused or pruned history.
- **F6:** hide/show service list. **Ctrl+L:** clear selected log **view only** and resume live follow, never truncate/delete log files.
- **q / Ctrl+Q / Ctrl+C:** quit UI only. Terminal modes/cursor/screen are restored on normal exit and handled termination signals. Services and runtime remain running; quitting does not undo an action already sent. F5 batch operations are deliberately omitted.

The panel keeps at most 500 log rows per cached service (4096 characters per row, at most eight service caches; revisiting an evicted service reattaches to its tail), follows both streams with separate per-launch byte cursors, and reads at most 8 KiB per stream per poll. Initial attachment shows a bounded tail, not all history. Rows are clipped to terminal width; `logs`/`follow` remain available for inspection. Stream labels distinguish output; there is no reliable cross-stream chronological order. Complete ANSI sequences are stripped and residual controls escaped: child output cannot drive the terminal. Ordinary Unicode is preserved with grapheme-aware, approximate wide-character layout (terminal emoji/ambiguous-width conventions and split UTF-8 byte boundaries can differ). Logs may contain secrets.

Reads and controls share one serial lane; reads refresh one second after each cycle, requests are bounded to 20 seconds. On disconnect, cached content is marked stale, controls are disabled and only reads reconnect automatically. Ctrl+L discards any in-flight old chunk while advancing its cursor; clearing before the first read discards that first tail. Under 32×8 the panel requests a resize. Log navigation covers the 500-row buffer; there is no mouse handling or historical file backfill, adoption or destructive maintenance.

`panel --prompt` retains the command prompt; `panel --live` retains the line-oriented compact ledger. `watch` attaches without launching a runtime; `follow api [stdout|stderr]` follows one stream. These older views remain line-oriented and JSON-escape logs; `q` + Enter, EOF or Ctrl-C ends the view. Unlike the panel, their request errors exit. Non-TTY `watch`/`follow` return one JSON snapshot and exit; all panel modes require a TTY. Machine-readable commands/API are unchanged. `lastExitCode` persists across launches within this runtime (`?` unknown, `no-code` a nonnumeric exit); `exitCode` remains current-launch only.

You can launch the panel manually in a Herdr terminal. Explicit Pi panel tools can also create a Linux/Windows Herdr pane or verify its recorded identity; nothing manipulates Herdr on extension load. The adapter selects new `herdr-app`/`herdr-core` from explicit `HC_TERMINAL_ID` + `HC_TERMINAL_SOCKET` identity, verifies the caller against the app and core layout, and creates a split **above** that pane with direct Node argv. App 0.1.13 only splits right/down, so creation uses a down split followed by one exact-ID, version-checked core layout reorder; it verifies the top position before reporting success. A transient lower pane or an incomplete fenced launch can remain if reordering fails; there is no mutation retry. **The new pane receives tab focus; no non-focus guarantee or focus restoration is offered.** Its cwd follows the caller; absolute bundled CLI/config paths make project cwd unnecessary. With `placement:"tab"`, app/core instead uses explicitly space-targeted `tab.new`, selects the new ServiceHost tab, and starts in the project directory. Unlike direct-argv splits, app 0.1.13 wraps tab argv in its interactive shell (PowerShell on Windows); the adapter verifies the complete source-defined wrapper, launch folder and layout. The legacy `HERDR_ENV`/`HERDR_PANE_ID` adapter retains non-focusing splits/tabs and Windows encoded PowerShell. Both invoke the exact Node executable and bundled CLI with `--connect-only`, not npm/cmd shims. Mixed identities, unavailable APIs and pending/mismatched records fail without backend fallback. This panel adapter does not change Windows service ownership or lifecycle behavior. See the [display contract](docs/pi-integration.md#herdr-display-contract-linux-and-windows). See [panel design and evidence](docs/panel-design.md).

Every command accepts `--config /path/to/ServiceHost.json`. Config directories and executable paths containing separators resolve relative to the config file; bare executable names use PATH. Native executable arguments are passed without shell expansion and are interpreted by the child relative to its working directory. Windows batch launches use the restricted grammar below. `port` is optional and is **TCP discovery**, not a readiness or health assertion. Services never auto-start.

Configuration is read at runtime startup. Stop services and shut down the runtime **before editing** configuration, especially `apiPort`. There is no hot reload or alternate-port fallback. Pi config tools use revisions, atomic replacement and cross-process exclusion; new runtimes hold `<config>.runtime-lock` until normal shutdown. Crashes leave guards requiring independent manual reconciliation, never deletion based only on a saved PID. Duplicate names/ports and sharing the management port are rejected. See [concurrency/recovery](docs/pi-integration.md#management-port-and-concurrency-contract).

## Optional startup readiness (0.2.0)

Add to a service, explicitly:

```json
"readiness": { "port": 5000, "path": "/ready", "expectedStatus": 200, "startupTimeoutMs": 10000 }
```

Only HTTP GET to literal `127.0.0.1` is supported. All four fields are required: port 1–65535 (not the management port), status 200–599, startup deadline 100–120000 ms, path up to 1024 characters starting with a single `/` and containing only ASCII letters/digits or `_ . / ~ -`. No hosts, credentials, query strings, fragments, redirects, TLS, DNS or custom headers. Choose a side-effect-free local endpoint; do not place secrets in its path. The probe port can differ from discovery `port`, and its response is **not proof that the managed process owns that listener**.

Status separates process `state`/`ownership` from `readiness`: `not-configured`, `inactive`, `pending`, `ready`, or `timed-out`. A launch starts probes asynchronously; `start` acknowledges process launch, not readiness. Probes run sequentially with up to 1 second per request and 250 ms between attempts, bounded by the startup deadline. Only headers (8 KiB limit) are inspected; bodies are not collected. Success is an expected status observed before the deadline, not ongoing health monitoring. Exit, explicit stop request (even if stop fails), and anchor closure cancel the launch's observation. Restart uses a fresh observation; stale callbacks cannot mark the new launch ready. No response text, endpoint, errors or credentials are returned in status. Timeout never signals, restarts, releases ownership, or clears a lease. Adopted/stale services are not probed.

## Credentials and logs

For `${credential:apiKey}` in service args/environment, create a separate `ServiceHost.credentials.json` alongside the config:

```json
{ "apiKey": "your-local-value" }
```

Placeholders resolve only when launching. Prefer environment variables over arguments (arguments may be visible to OS process inspection). There is no shell expansion, credential editor, vault, or automatic redaction. Do not put secrets in commands or directories. Missing/invalid credentials block launch.

**Child output may contain secrets**, including expanded credentials. The authenticated logs endpoint deliberately returns raw child output in JSON. Terminal rendering JSON-escapes control characters; it does not remove secrets. API status/discovery never returns arguments, environment, credentials, or executable paths. Launch errors are sanitized.

Add these patterns to **your project's** `.gitignore`:

```gitignore
.servicehost/
logs/
ServiceHost.credentials.json
*.runtime-lock
*.mutation-lock
ServiceHost.json.*.tmp
```

Also ignore any custom log directory. Protect your project and credentials with owner-only permissions/Windows ACLs. Created state/log files request POSIX modes 0700/0600; Node's mode flags do **not** establish Windows ACLs. The runtime inherits its launcher's environment and services inherit it too.

Each launch opens two unique files, `NAME-ID.stdout.log` and `.stderr.log`, with exclusive creation and passes their file descriptors directly to the child. **No existing log is ever truncated**, including reconnect/adoption. Logs are not rotated or pruned. The API tails up to 64 KiB from the current runtime's launch; old files remain on disk but are not automatically reattached.

New in 0.2.0: `log-inventory [LIMIT]` is an opt-in **dry-run only** inventory, not a cleanup command. It scans at most LIMIT directory entries (default 100, range 1–1000), without recursion, and reports sizes/basenames only for known service names with exact unique-launch filenames. Symlinks, directories, hard-linked files, unknown services and other filenames are excluded. `truncated` means the scan was incomplete; order is filesystem-dependent, with no pagination or whole-directory size claim. Every reported file is `retained-inactivity-unproven`, including stopped/historical launches. Group drain, file age and missing leases cannot prove escaped processes released inherited descriptors. This command never deletes or truncates files, because positive inactivity cannot be established. Do not treat the inventory as permission to remove files.

## Ownership and recovery

- Start refuses an existing configured TCP listener, including an uninspectable listener. A port probe cannot eliminate a bind race; a started child is not necessarily ready.
- `discover api` returns PID plus opaque process identity. `adopt api PID IDENTITY` rechecks both listener and process identity. **Adoption is observe-only**: output unavailable, stop/restart forbidden. No automatic adoption or destructive action against discovered PIDs.
- **Linux:** each launch has a private Node anchor in a new session/process group. The anchor retains membership after the service parent exits; stop asks this live anchor to send SIGTERM to its **own** group, never a saved numeric PGID. It ignores TERM itself, waits up to five seconds for group drain, then exits. No forced escalation; timeout, anchor loss, inspection failure or a remaining configured listener retains the lease and blocks restart. Shutdown refuses unreleased ownership, including after natural parent exit.
- **Windows:** stop remains direct-child-only using the retained Node handle (not graceful POSIX SIGTERM); batch leases remain fenced. No Job Object helper/binary is shipped.
- **Group scope is not whole-tree containment.** Linux descendants that use `setsid`/`setpgid` can escape. Procfs drain verification uses two empty non-zombie observations, not an atomic kernel tree-empty operation; hostile fork/exit churn is not supported. Prefer cooperative foreground services. Zombies cannot run or write logs and are excluded from drain; reaping orphan zombies belongs to the system init/subreaper. Unique logs protect files still inherited by escaped descendants.
- A persisted per-service launch lease blocks re-launch after runtime loss. There is no PID-based reconnect or automatic stale-lease clearing. Natural service-parent exit also retains the lease until an explicit `stop` confirms the platform ownership outcome and configured port is free. Windows batch-wrapper leases require external reconciliation even after `stop` (see below).
- After a crash, externally inspect the saved lease, OS processes and descendants, and logs. Only after **independently confirming termination** and ensuring no other runtime for that config is active, remove the particular `.servicehost/NAME.lease.json`. This is manual recovery, not a verified recovery command. Never delete leases to bypass uncertainty.
- `shutdown` refuses while any managed child is live or Linux group ownership is unreleased. Runtime death disconnects the Linux anchor, which exits without signaling services; surviving processes continue direct-file logging. No new runtime regains signal authority from a lease. There is no crash cleanup guarantee, reboot recovery, autostart, watchdog, Job Object, pidfd, or system service installation.

## Windows launching

Native `.exe`/`.com` images use Node's normal argument quoting, never `shell:true` or verbatim arguments. Prefer `node.exe` with the installed package's CLI `.js` file in `args`, especially for credentials or complex arguments. Individual native programs can implement nonstandard argument parsing.

Bare names resolve on the child's PATH, trying `.exe`, `.com`, `.cmd`, then `.bat` per directory; no implicit current-directory search, relative PATH entries, or custom PATHEXT handlers. Supply `./script.cmd` for a config-relative script. Explicit extensions must be one of those four. Files are resolved before spawning; trusted local files/PATH are required, not protected against malicious file replacement.

**Restricted `.cmd`/`.bat` launching** (including npm/pnpm/yarn shims when found on PATH) invokes the system `cmd.exe /d /s /v:off /c` with a deliberately closed grammar:

- Batch path: local drive-absolute ASCII letters/digits, spaces, underscore, dot, dash and path separators; no UNC/device paths, shell syntax, or components ending in space/dot.
- Each argument: nonempty ASCII letters/digits or `_ . / : + -` (the spaces in this list are separators, not allowed characters). No whitespace, quotes, backslashes, comma, equals, semicolon, `%`, `!`, shell operators, controls or Unicode. For example `args: ["run", "dev", "--", "--port", "3000"]`; `"--port=3000"` is rejected because batch parameter parsing treats equals as a separator.
- Expanded credentials are checked against the same grammar; errors do not echo rejected values. Complex input must use a native executable/JS entrypoint or environment variables. Batch script contents remain trusted executable code, responsible for their own environment expansion and forwarding.
- Command text is capped at 8000 characters. There is no unsafe quoting fallback or ComSpec override.

**Batch lifecycle is wrapper-only.** Stop can terminate only the owned `cmd.exe`, not its launched program. Its lease always remains: stop reports that external descendant reconciliation is required; restart is blocked even if no port is configured/listening. After independent termination verification, shut down the runtime and follow manual lease recovery above. This intentionally limits batch convenience until reviewed Job Object ownership exists. Explicitly configuring your own shell/wrapper does not confer tree guarantees.

Planner tests run on Linux; actual Windows argv/batch/PATH/log/lease tests are supplied but were not run locally. This is not a claim of complete Windows support. See [native ownership design/blockers](docs/windows-lifecycle.md).

## Local control API

The runtime binds only `127.0.0.1:apiPort`. All requests use `POST /v1`, exact `Content-Type: application/json`, `Authorization: Bearer TOKEN` from `.servicehost/token`, and `X-ServiceHost-Project: ID` (SHA-256 of the canonical config path, lowercased on Windows). Browser Origin requests are rejected, no CORS is enabled. Clients must check `ping`'s project and protocol. A conflicting port fails; there is no alternate-port fallback.

Bodies: `{ "action": "status" }`, or `{ "action": "start|stop|restart|discover", "name": "api" }`; `logs` accepts `stream` and `bytes`; `adopt` takes `expected: { pid, identity }`; `ping` and `shutdown` have no service. 0.2.0 additions: `log-inventory` takes optional `limit` and no service; `log-follow` takes `name`, `stream`, `bytes` (1–65536, default 16384), and an optional per-stream `cursor: { launchId, offset }`. The first read tails at most `bytes`; subsequent reads advance by actual bytes read. A new launch or size smaller than the cursor resets to a bounded tail and returns `reset: true`. Follow does not drain historical launches after restart; fast restarts/backlogs can lose output. UTF-8 characters split across byte reads may render replacement characters. No historical file path can be selected through this API. This is an initial protocol, not a stable public API. Authentication is not a security boundary against other code running as the same OS user. Protect the project directory from untrusted writers/symlinks. Containers/network namespaces and socket activation are not supported discovery environments.

## Development (source checkout only)

```sh
npm ci
npm run typecheck
npm test
npm run check:package
npm pack
# install the generated comput-pi-servicehost-0.6.1.tgz locally if desired
npm install -g ./comput-pi-servicehost-0.6.1.tgz
```

`prepack` builds standalone ES modules into `dist/`. When disabling scripts, run `npm run build` **before** `npm pack --ignore-scripts`; the release workflow does this explicitly. The tarball contains built JS (including Pi extension and independent runtime), packaged skill, selected docs, example config and MIT license, not source, tests, legacy references, credentials or runtime state. Tests install the actual tarball with scripts disabled into a disposable prefix and run its CLI outside the checkout.

The checked-in CI workflow targets Linux on Node 22.19 and 24; local validation is not evidence of remote CI success. Platform-specific validation results are recorded in [validation.md](docs/validation.md). Fixtures use disposable projects/processes, never real configured services.

See [design and next steps](docs/design.md), [validation record](docs/validation.md), [changelog](CHANGELOG.md) and [release/setup checklist](docs/release.md).

## License

MIT — see [LICENSE](LICENSE).
