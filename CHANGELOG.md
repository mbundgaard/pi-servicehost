# Changelog

## 0.6.1

First npm release of the changes below. The 0.6.0 GitHub tag failed Node 24 validation and was not published. The runtime-loss logging test now waits for actual heartbeat output with a bounded deadline instead of assuming a 300 ms scheduler window; its disposable fixture lifetime includes that observation budget.

## 0.6.0 (GitHub tag only)

- Add PageUp/PageDown, Home and End log navigation with per-service anchored history, live/paused/pruned indicators, and a 500-row buffer. Incoming output does not displace paused history. Ctrl+L clears only the view and resumes follow; log files remain unchanged.

- Make explicit `servicehost_host_start` start/connect the runtime AND open/reuse its visible Herdr panel, with optional split/tab placement (default split). Registration/session start/reload remain inert and services remain individually explicit. Panel failures return structured runtime status, authoritative config/port identity and a sanitized panel error; no runtime rollback, destructive stop-all or blind retry. Standalone CLI `up` remains headless.
- Fix same-process extension upgrades by shipping a complete explicit TypeScript import graph for Pi/Jiti while preserving the compiled standalone CLI. Add actual-loader reload regressions and [upgrade guidance](docs/extension-loading.md): fully exit/restart Pi once when upgrading from an already-loaded compiled entry; subsequent TS-entry upgrades can use rediscovery and `/reload`.

- Add creation-only optional `placement: "split" | "tab"` to `servicehost_panel_open`, default split above the caller. Both backends use their supported down split followed by an exact-ID reorder: one version-checked core document write on app/core, explicit source/target pane swap on legacy. Top placement is verified, with pending fences and no mutation retry on failure. Tab creates an explicitly named ServiceHost tab in the caller's workspace/space with project cwd. Existing displays are verified/reused in place and return actual recorded placement; reconnect remains read-only with no placement option.
- Preserve legacy Linux/Windows non-focus commands and encoded PowerShell quoting. App/core split keeps direct argv; tab uses the app 0.1.13 shell wrapper, verified exactly, and selects the new tab/space. No focused-default targeting or focus restoration.
- Version-3 records retain placement and caller/target tabs, with existing v1/v2 split reuse and unchanged locks/pending uncertainty fences. No runtime startup by the display adapters, migration, duplicate retry or lifecycle redesign.
- Add mocked Linux/Windows split/tab, target/focus/argv/cwd, failure, concurrency, compatibility, schema and installed-package checks. Contracts inspected through installed read-only help/skills and tagged source; no live display mutations or native Windows validation.

## 0.5.0

- Support new Herdr app/core environments selected by explicit HC caller/socket identity, while preserving the v0.4.1 legacy Linux and Windows adapters. Mixed/partial identities fail; there is no automatic backend fallback or record migration.
- Verify the local caller against app inventory, core labels and persisted layout; pin core ID, app home, endpoint and returned pane/terminal incarnation in version-2 launch state. Persist pending stages before mutation; uncertain launches remain fenced. Reconnect observes without shell input, focus changes or replacement.
- Use an explicit caller-targeted down split with direct exact Node/bundled CLI/config argv and `--connect-only`, bypassing shell/PowerShell on the new backend. **New splits change tab focus to the new pane and clear tab zoom**; legacy non-focus behavior remains. Inherited caller cwd is safe because paths are absolute/config-relative.
- Add Linux/mocked Windows app/core and disposable socket tests, backend/identity/failure fences, and installed-package checks. Core observations never auto-start core or read terminal output. Runtime authentication and service/process management are unchanged; no native helper or lifecycle redesign.
- Native Windows execution and new-backend live smoke remain unverified; no app was open at the current default home. See validation and integration docs for source-derived contracts and permission needed for live display testing.

## 0.4.1

- Add narrowly scoped Windows Herdr panel open/reconnect using non-focusing pane creation and encoded PowerShell invoking the exact Node executable, bundled CLI and config with `--connect-only`. Argument data is base64-decoded, including Unicode/apostrophes/metacharacters; package URL conversion preserves native drive/UNC paths.
- Preserve Linux commands, runtime authentication, pane/tab/terminal identity checks, mutation locks and uncertain-launch fencing. Reconnect never injects commands; foreground readiness is not claimed. No service launcher/lifecycle redesign, Job Objects or native helper.
- Add deterministic Windows command/URL tests, mocked Herdr transport and failure-fence tests, installed-tarball command checks and a gated native PowerShell argv test. Native Windows execution/live Herdr/TUI/focus validation remains pending; Windows service limitations are unchanged.

## 0.4.0

- Register focused Pi config/host/service tools and a packaged servicehost workflow skill over the independent runtime. Loading Pi starts no services; runtime/panel remain standalone and bundled.
- Add validated revision-checked atomic config creation/update, cross-process mutation exclusion and lifetime runtime guards. apiPort remains authoritative with identity checks, no fallback, and active-port-change refusal; crashes require independent manual reconciliation.
- Return bounded safe metadata and sanitized errors; never display configuration args/env or credential contents. Log text requires explicit sensitive-output opt-in, bounded and terminal-escaped; arbitrary application logs are not guaranteed secret-free.
- Add explicit non-focusing Linux Herdr display open/reconnect, persisted launch fencing, pane/terminal identity checks and package-relative connect-only commands. Foreground process readiness is not claimed; Windows integration remains deferred. Standalone manual panel use is retained.
- Add mock Pi, disposable config/runtime integration and peers-disabled installed-tarball checks; document user-first Pi and standalone workflows. Live Linux Pi/Herdr smoke test verified config creation, configured-port runtime start, panel opening/reconnection, HTTP readiness, service restart and cleanup.

## 0.3.0

- Replace default `panel` prompt with a selectable service list, live stdout/stderr pane, compact shortcuts and package version; retain `panel --prompt`, `panel --live`, watch/follow and JSON commands.
- Add legacy-inspired F1/F2/F3/F4/F6 controls through the authenticated API, persistent selection, pending-action guard, read-only reconnect and UI-only quit. F5 batch actions remain omitted; Ctrl+L clears only the view.
- Bound log rings/cursors, neutralize child terminal controls, adapt layouts to narrow terminals, and restore raw mode/cursor/alternate screen on exit and handled signals.
- Add renderer preview artifacts, hostile-output/layout/controller tests and disposable authenticated PTY/installed-tarball coverage. No runtime dependencies or version bump.

## 0.2.0

- Correct published/registry installation status and repository/owner-reported Trusted Publisher documentation without claiming remote CI or OIDC success.
- Optional bounded loopback HTTP startup readiness, separate from process state and ownership; no automatic lifecycle effects.
- Optional compact live status (`watch`, `panel --live`) and escaped log follow with per-launch cursors; existing prompt and JSON commands retained.
- Opt-in bounded `log-inventory` dry run. No deletion or retention enforcement: escaped descriptor holders prevent positive inactivity proof.

## 0.1.0 — Published

Initial Linux-first npm release; registry installation and disposable Linux smoke test verified by the owner.

- Standalone `pi-servicehost` CLI, detached authenticated loopback runtime, and line-oriented interactive panel; no Pi SDK or runtime dependencies.
- Explicit start/stop/restart, status, TCP listener discovery, observe-only adoption, and bounded log reads.
- Linux cooperative process-group ownership through a private live anchor; SIGTERM only, no escalation or whole-tree containment.
- Unique direct-file stdout/stderr, launch-time credential placeholders, persistent leases that block unsafe relaunch after runtime loss.
- Built JS tarball, MIT license, Linux CI and GitHub OIDC/provenance publishing workflow (workflow availability is not evidence of execution).
- Windows launcher included with direct-child/wrapper-only ownership; no Job Object lifecycle. Batch-wrapper leases require external reconciliation.

0.1.0 limits: manual stale-lease recovery, no health/readiness checks, autostart, watchdog, log rotation, full-screen dashboard or production-supervision guarantee. See README before use.
