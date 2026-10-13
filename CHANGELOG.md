# Changelog

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
- Windows launcher included as experimental: native validation and Job Object lifecycle deferred. Batch-wrapper leases require external reconciliation.

0.1.0 limits: manual stale-lease recovery, no health/readiness checks, autostart, watchdog, log rotation, full-screen dashboard or production-supervision guarantee. See README before use.
