# ServiceHost

A standalone, project-local service runner with a detached HTTP runtime and a simple terminal prompt panel. **Linux-first, not production supervision.** Start services explicitly, reconnect from another terminal, and leave them running when the panel closes. No Pi SDK, extension, or Herdr dependency.

**Release status:** `@comput/pi-servicehost@0.1.0` is published; installation from the npm registry and a disposable Linux lifecycle smoke test were verified by the owner. Repository: [mbundgaard/pi-servicehost](https://github.com/mbundgaard/pi-servicehost). The owner reports npm Trusted Publisher is configured; this does not establish a successful OIDC publish or remote CI run. See the [release checklist](docs/release.md). This is a standalone npm CLI, **not a `pi install` extension**. This checkout targets 0.2.0; readiness, live views and log inventory are new in 0.2.0 and are not in the immutable 0.1.0 tarball.

## Install and use

Install the published CLI:

```sh
npm install -g @comput/pi-servicehost
pi-servicehost --help
```

Requires Node.js **22.19+** and npm. **Linux is the initial release target**, with readable procfs in the same PID/network namespace and cooperative foreground services. macOS and other platforms are unsupported. Windows code is included for experimentation only: native validation and lifecycle work are deferred, not Linux release gates. Windows discovery requires Windows PowerShell and `Get-NetTCPConnection`; no Windows tree-stop guarantee is provided.

For the new features, install version 0.2.0 once available, or a locally built tarball (see Development below). A project-local registry installation also works: `npm install --save-dev @comput/pi-servicehost`, then `npx --no-install pi-servicehost --help`. No install scripts or runtime dependencies are needed.

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

The default panel remains an interactive command prompt. In this checkout, `panel --live` opens an optional compact status ledger; `watch` attaches to an existing runtime without launching it. `follow api [stdout|stderr]` follows that runtime's current launch logs. These are separate views, not full-screen panes; they do not steal focus or send cursor-control sequences. Live status prints only changed snapshots; logs are JSON-escaped and may contain secrets. Polling is sequential, at most once per second after each bounded request (20 seconds), with no overlap. `q` + Enter, EOF, Ctrl-C, or disconnect ends only the view. Narrow terminals wrap status rows without discarding fields. Non-TTY `watch`/`follow` return one JSON snapshot and exit; `panel` still requires a TTY. No view performs service lifecycle operations. `lastExitCode` retains the last observed exit across launches within this runtime only (`?` means unknown; `no-code` means exit without a numeric code, usually a signal). The existing `exitCode` remains scoped to the current launch. Type `quit` or close its terminal to leave the runtime and services running. You can launch it manually in a Herdr terminal. Nothing here configures or manipulates Herdr.

Every command accepts `--config /path/to/ServiceHost.json`. Config directories and executable paths containing separators resolve relative to the config file; bare executable names use PATH. Native executable arguments are passed without shell expansion and are interpreted by the child relative to its working directory. Windows batch launches use the restricted grammar below. `port` is optional and is **TCP discovery**, not a readiness or health assertion. Services never auto-start.

Configuration is read at runtime startup. Stop services and shut down the runtime **before editing** configuration, especially `apiPort`. There is no hot reload. Duplicate names/ports and sharing the management port are rejected.

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
```

Also ignore any custom log directory. Protect your project and credentials with owner-only permissions/Windows ACLs. Created state/log files request POSIX modes 0700/0600; Node's mode flags do **not** establish Windows ACLs. The runtime inherits its launcher's environment and services inherit it too.

Each launch opens two unique files, `NAME-ID.stdout.log` and `.stderr.log`, with exclusive creation and passes their file descriptors directly to the child. **No existing log is ever truncated**, including reconnect/adoption. Logs are not rotated or pruned. The API tails up to 64 KiB from the current runtime's launch; old files remain on disk but are not automatically reattached.

New in 0.2.0: `log-inventory [LIMIT]` is an opt-in **dry-run only** inventory, not a cleanup command. It scans at most LIMIT directory entries (default 100, range 1–1000), without recursion, and reports sizes/basenames only for known service names with exact unique-launch filenames. Symlinks, directories, hard-linked files, unknown services and other filenames are excluded. `truncated` means the scan was incomplete; order is filesystem-dependent, with no pagination or whole-directory size claim. Every reported file is `retained-inactivity-unproven`, including stopped/historical launches. Group drain, file age and missing leases cannot prove escaped processes released inherited descriptors. **Deletion/retention enforcement is intentionally deferred** until positive inactivity can be established; this command never deletes or truncates anything. Do not treat the inventory as permission to remove files.

## Ownership and recovery

- Start refuses an existing configured TCP listener, including an uninspectable listener. A port probe cannot eliminate a bind race; a started child is not necessarily ready.
- `discover api` returns PID plus opaque process identity. `adopt api PID IDENTITY` rechecks both listener and process identity. **Adoption is observe-only**: output unavailable, stop/restart forbidden. No automatic adoption or destructive action against discovered PIDs.
- **Linux:** each launch has a private Node anchor in a new session/process group. The anchor retains membership after the service parent exits; stop asks this live anchor to send SIGTERM to its **own** group, never a saved numeric PGID. It ignores TERM itself, waits up to five seconds for group drain, then exits. No forced escalation; timeout, anchor loss, inspection failure or a remaining configured listener retains the lease and blocks restart. Shutdown refuses unreleased ownership, including after natural parent exit.
- **Windows:** stop remains direct-child-only using the retained Node handle (not graceful POSIX SIGTERM); batch leases remain fenced. No Job Object helper/binary is shipped.
- **Group scope is not whole-tree containment.** Linux descendants that use `setsid`/`setpgid` can escape. Procfs drain verification uses two empty non-zombie observations, not an atomic kernel tree-empty operation; hostile fork/exit churn is not supported. Prefer cooperative foreground services. Zombies cannot run or write logs and are excluded from drain; reaping orphan zombies belongs to the system init/subreaper. Unique logs protect files still inherited by escaped descendants.
- A persisted per-service launch lease blocks re-launch after runtime loss. There is no PID-based reconnect or automatic stale-lease clearing. Natural service-parent exit also retains the lease until an explicit `stop` confirms the platform ownership outcome and configured port is free. Windows batch-wrapper leases require external reconciliation even after `stop` (see below).
- After a crash, externally inspect the saved lease, OS processes and descendants, and logs. Only after **independently confirming termination** and ensuring no other runtime for that config is active, remove the particular `.servicehost/NAME.lease.json`. This is manual recovery, not a verified recovery command. Never delete leases to bypass uncertainty.
- `shutdown` refuses while any managed child is live or Linux group ownership is unreleased. Runtime death disconnects the Linux anchor, which exits without signaling services; surviving processes continue direct-file logging. No new runtime regains signal authority from a lease. There is no crash cleanup guarantee, reboot recovery, autostart, watchdog, Job Object, pidfd, or system service installation.

## Windows launching (experimental; validation deferred)

Native `.exe`/`.com` images use Node's normal argument quoting, never `shell:true` or verbatim arguments. Prefer `node.exe` with the installed package's CLI `.js` file in `args`, especially for credentials or complex arguments. Individual native programs can implement nonstandard argument parsing.

Bare names resolve on the child's PATH, trying `.exe`, `.com`, `.cmd`, then `.bat` per directory; no implicit current-directory search, relative PATH entries, or custom PATHEXT handlers. Supply `./script.cmd` for a config-relative script. Explicit extensions must be one of those four. Files are resolved before spawning; trusted local files/PATH are required, not protected against malicious file replacement.

**Experimental, restricted `.cmd`/`.bat` launching** (including npm/pnpm/yarn shims when found on PATH) invokes the system `cmd.exe /d /s /v:off /c` with a deliberately closed grammar:

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
# install the generated comput-pi-servicehost-0.2.0.tgz locally if desired
npm install -g ./comput-pi-servicehost-0.2.0.tgz
```

`prepack` builds standalone ES modules into `dist/`. When disabling scripts, run `npm run build` **before** `npm pack --ignore-scripts`; the release workflow does this explicitly. The tarball contains built JS, selected docs, example config and MIT license, not source, tests, legacy references, credentials or runtime state. Tests install the actual tarball with scripts disabled into a disposable prefix and run its CLI outside the checkout.

The checked-in CI workflow targets Linux on Node 22.19 and 24; local validation is not evidence of remote CI success. Windows native validation is deferred; Linux planner tests do not prove Windows execution. Fixtures use disposable projects/processes, never real configured services.

See [design and next steps](docs/design.md), [validation record](docs/validation.md), [changelog](CHANGELOG.md) and [release/setup checklist](docs/release.md).

## License

MIT — see [LICENSE](LICENSE).
