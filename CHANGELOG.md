# Changelog

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
