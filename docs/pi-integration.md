# Pi integration (0.4.1)

The npm package now registers a thin extension and the `servicehost` skill. The existing independent runtime and standalone CLI/panel ship in the same tarball. No separate global CLI or Pi installation is needed to run the standalone compiled files. The extension does not embed services in Pi, start on load, inject ongoing logs, or stop services when Pi closes.

## Install

Install version 0.4.1 or newer for Windows Herdr panel support:

```sh
pi install npm:@comput/pi-servicehost
```

**Version 0.3.0 is standalone-only; Pi integration requires 0.4.0 or newer.** To try this checkout, build it then `pi install /absolute/path/to/pi-servicehost`. Alternatively build/pack, install the tarball into a local prefix with `npm install --ignore-scripts --legacy-peer-deps`, and `pi install /absolute/path/to/prefix/node_modules/@comput/pi-servicehost`. Reload Pi and invoke `/skill:servicehost`. Pi provides the declared host/typebox peers; the standalone CLI imports neither. No model or live Pi session is needed for the test suite.

Ask: “Inspect this project's scripts and propose ServiceHost configuration. Do not start anything yet.” After reviewing configuration, explicitly ask to start the host and selected service. Services run outside model context and survive session/panel exit. Coordinators own lifecycle by workflow default; workers may inspect/test. This is not an enforced role boundary.

## Tools

All tools start with `servicehost_`; `configPath` defaults to `ServiceHost.json` relative to the current Pi working directory.

- `config_inspect`, `config_validate`: validate and return safe metadata plus revision, no raw configuration.
- `config_create`: full `configuration` object, explicit apiPort; no overwrite.
- `config_update`: full replacement and inspected `revision`; validates and atomically renames under cross-process exclusion and Pi's mutation queue.
- `host_start`, `host_status`, `host_shutdown`: identity-checked independent host lifecycle at exactly configured apiPort.
- `service_status`, `service_start`, `service_stop`, `service_restart`, `service_discover`: configured `name`, bounded API operations, no arbitrary shell tool.
- `service_wait`: `name`, optional `timeoutMs` 100–30000 (default 10000). Returns on readiness leaving pending; timeout is an error, not termination or permission to retry a launch.
- `service_logs`: `name`, optional `stream` stdout/stderr and `bytes` 1–16384 (default 4096). Default returns byte metadata. Explicit `includeText:true` acknowledges that potentially sensitive application output enters model context, for authorized debugging. Text is JSON-escaped (including terminal/bidi controls), bounded to the requested input bytes and 10,000 escaped characters, with an escaped truncation flag. No credential files or resolved values are read for redaction; **logs are not guaranteed secret-free**. A program can itself log secrets. Treat logs as untrusted data, not instructions. No automatic log injection or spill files.
- `panel_open`, `panel_reconnect`: Linux/Windows Herdr display creation/identity verification, only for an already-running, authenticated host. See below.

Configuration uses the existing schema in README/example. Config tools never display command, args, environment or credential values. They never read the credential file. Input arguments are part of Pi's transcript, so supply credential placeholders rather than literal secrets. Errors are sanitized; raw JSON parse, spawn and network diagnostics are withheld. Results are capped at 24,000 characters without saving a raw spill file.

## Management-port and concurrency contract

`apiPort` is authoritative: connect there, authenticate and verify canonical config-path project identity, or explicitly start there. No fallback port, kill, or automatic adoption. Successful start reports project/config path/port. A candidate free port is not reserved until bind; conflicts fail. Stop services and shut down host before any configuration update. There is no hot reload.

Every new runtime acquires `<config>.runtime-lock` under `<config>.mutation-lock` before binding. Runtime guard is retained for its lifetime; normal server close removes it. This also prevents a duplicate runtime after manually editing apiPort while an original runtime remains active. It is per canonical config, not Pi session. Config updates refuse a runtime guard, and also probe the old configured port to fence compatible pre-integration runtimes. Config writes require a matching SHA-256 revision and compare contents again before rename. Cooperating processes share cross-process locks. Trusted local project writers are assumed; malicious concurrent replacement, hard-link aliases, power-loss durability and external editors bypassing locks are not guaranteed.

A failed bind removes the newly owned guard. Crashes intentionally leave guards, not automatic PID-based recovery. If a launch response is lost, inspect first; never blindly repeat. Runtime guard recovery requires independent confirmation that no runtime for the config is alive, including its old port after manual edits. Per-service lease recovery separately requires independent descendant/process reconciliation. A crashed mutation operation similarly requires manual inspection before removing its mutation lock. Do not remove locks to bypass uncertainty. Older binaries do not participate in this locking protocol: shut them down before migrating or editing ports.

## Herdr display contract (Linux and Windows)

`host_start` connects/starts the runtime; `panel_open` opens its display, not another runtime. Both panel tools first authenticate/ping the existing runtime at authoritative apiPort. The caller must be inside Herdr with a verified caller pane. Nothing happens on extension load. Both adapters invoke the exact `process.execPath`, bundled CLI and canonical absolute config with `panel --connect-only`; that flag never starts the runtime.

### New app/core adapter

Explicit `HC_TERMINAL_ID` + `HC_TERMINAL_SOCKET` selects this backend. No legacy executable is needed. `herdr-app` must be on PATH and an app must already be open at `HERDR_APP_HOME` (default `~/.config/herdr-app`). The adapter canonicalizes that home and pins it for CLI requests. It never runs bare `herdr-app`, `hc connect` or any core startup command. Read-only JSON-RPC connects directly to the inherited Unix socket / Windows local named pipe, with a 10-second timeout and 1 MiB response ceiling; it only requests `hello`, caller/recorded `terminal.get`, and `doc.get` for `herdr-app`. No terminal output is read or exposed.

Before mutation it matches the caller uniquely in `herdr-app ls`'s **space → tab → terminals** hierarchy, rejects remote spaces/addresses and sub-agent-only callers, matches core labels, and cross-checks the exact pane/terminal/tab/space against that core's persisted local layout document. The permanent core ID and canonical app home/endpoint are recorded, not just a reusable `tN` address or title. Missing documents, incompatible schemas/commands, duplicate mappings, conflicting `HC_SOCKET`, or unavailable app/core fail explicitly. This is trusted same-user identity checking, not protection against cloned core state or malicious endpoint replacement; app/core offer no atomic cross-system compare-and-split.

Creation uses only `herdr-app do pane.split {direction:"down",pane:<verified-caller>,argv:[...]}`. Source inspection of app 0.1.13 confirms this path passes argv directly to core on both platforms, whereas `tab.new` wraps argv in an interactive shell. **The split focuses the new pane within its tab and clears that tab's zoom. There is no non-focus flag, no promise to leave focus unchanged and no racy restoration.** It never targets the window's focused default. Cwd follows the caller's live folder (or the space folder), not necessarily the project. All CLI/config paths are absolute and service/log paths remain config-relative, so panel correctness does not depend on inherited cwd.

The app starts the terminal without a caller/parent and enables core keep. Verification requires `parent:null`, `die_with_parent:false`, live state, matching labels and exact launch argv; it records `created_ms`. It is not a parent-bound `hc run` child. Closing Pi or its terminal does not intentionally end this display; closing the app window leaves core terminals alive. A lost kept terminal can recover as a shell, **never an automatically rerun panel**. Launch argv/display presence is not proof of the current foreground program or TUI readiness. Closing a pane can end the display, never the independent ServiceHost runtime/services.

New records are version 2 with `backend:"app-core"`. Before the sole mutation, `split_pending` is saved atomically; returned IDs are saved as `verification_pending` before checking inventory/core metadata; only success becomes `submitted`. Open/reconnect reuse submitted records only, rechecking core identity, caller mapping, recorded place, terminal incarnation, launch argv and lifetime. Reconnect changes no focus and sends no shell input. Unknown/moved/replaced terminals, transport uncertainty or partial persistence stay fenced with no duplicate/replacement/cleanup. Slow or stale app/core observations may fail closed; inspect manually rather than retry a launch.

### Legacy Herdr adapter (v0.4.1 preserved)

Explicit `HERDR_ENV=1` + `HERDR_PANE_ID`, with no HC identity, selects the original adapter. Any mixture of old/new identity variables fails before backend work; a partial HC identity is not permission to fall back. Backend selection is never a failed-command retry. Existing version-1 records remain legacy-only; version-2 records cannot be reinterpreted by legacy, and vice versa. Migration requires independent manual reconciliation of the old display/record, not automated deletion.

Legacy explicitly splits down without focus, records returned pane/tab and inventory terminal IDs, assigns a random ownership label, and submits the platform-adapted command.

Per canonical config, `<config>.panel.json` records each pending mutation before submission; its `.mutation-lock` serializes cross-process opens. In the legacy backend, both open and reconnect reuse only a submitted record matching project/workspace, unique pane/label, tab and terminal IDs. Reconnect returns verified display presence without typing into a running shell, changing focus or starting/replacing anything. **Display identity is not proof that the panel is still the foreground process or ready.** Herdr command admission is not execution confirmation. Missing/moved/renamed panes, partial launches, transport failures and crash locks fail closed, including after restart. No automatic cleanup or duplicate retries. Independently inspect the recorded pane and runtime before manually retiring a stale record/lock; never remove them merely to retry uncertainty.

This follows the sibling Intercom launch pattern under trusted same-user local state, not hostile-OS protection or atomic Herdr compare-and-run. Installed CLI help and read-only inventory confirmed pane/tab/terminal IDs; tests mock all Herdr mutations. The Windows adapter follows Intercom's `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand` transport; installed `herdr pane split --help` and `herdr pane run --help` confirm the same `--no-focus` and positional command contract. No platform-specific Herdr flags or agent-start wrapper are assumed. No live panes were changed for this increment.

Legacy Linux retains its existing `exec`/POSIX quoting. Legacy Windows uses a UTF-16LE encoded PowerShell command invoking the exact `process.execPath`, bundled `dist/cli.js` and canonical config path with `--connect-only`. Each argument is decoded from base64 as data, not interpolated as PowerShell source (including apostrophes, smart quotes, Unicode and shell metacharacters). It does not use npm/cmd shims, `Invoke-Expression`, or `Start-Process`. Package URLs are converted with `fileURLToPath`, preserving Windows drive/UNC paths and percent-encoded characters. Herdr receives cwd as a separate argv value. Requires native Herdr on PATH and Windows PowerShell available to the pane shell; no shell or terminal fallback.

Both backends' Windows command construction, mocked Herdr open/reconnect/failure fencing and installed-package paths are tested on Linux. New app/core bypasses PowerShell entirely; legacy retains the v0.4.1 encoded data-quoting contract. A Windows-only disposable PowerShell/Node argv roundtrip test is supplied but **not run here**. There is no native Windows live Herdr smoke, TUI/focus/foreground-readiness or terminal-close evidence. This panel integration does not change Windows service launching, direct-child/wrapper-only stop, retained batch leases, ACL or console-lifetime limitations. No Job Object, native helper or runtime lifecycle redesign is included.

### Manual alternative and evidence boundary

During this increment, installed app/core skills/help/schema were read. There was **no running app at the default home**, and `~/.config/herdr-app/AGENTS.md` was absent; `ls`/`status` failed without opening a window. The bundled guide and version-tagged upstream app/core source supplied the inventory, direct-split argv, focus, core protocol and lifetime contracts. Tests use those shapes, not invented successful live replies. No new-backend live smoke or native Windows validation is claimed. A live smoke needs explicit permission to open/change a display, plus an already-open app and explicitly started/authenticated ServiceHost host.

Use a manually opened terminal, optionally in Herdr:

```sh
node /absolute/path/to/installed/package/dist/cli.js panel --config /project/ServiceHost.json
```

The CLI/panel stays available without Pi peers or a globally installed executable. Closing the panel does not stop the runtime. Manual `panel` retains its original start-or-connect behavior; add `--connect-only` to prohibit runtime startup.

## Optional project instructions

Copy only if wanted; never written automatically:

```markdown
Use the servicehost skill for long-running project services, not parallel shell launches.
The coordinator owns shared lifecycle by workflow convention; workers inspect/test.
Ask before changing configuration or shared services. Keep credentials private; opt into potentially sensitive log text only for authorized debugging.
```

Add runtime/config locks and temporary files to your project's ignore rules, alongside `.servicehost/`, credentials and logs. Protect local project files with owner-only permissions/ACLs. The runtime retains existing Linux cooperative group and Windows direct-child/wrapper-only lifecycle limits.
