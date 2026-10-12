# Changelog

## 0.1.0 — Unreleased

Initial Linux-first npm release candidate; not yet published.

- Standalone `pi-servicehost` CLI, detached authenticated loopback runtime, and line-oriented interactive panel; no Pi SDK or runtime dependencies.
- Explicit start/stop/restart, status, TCP listener discovery, observe-only adoption, and bounded log reads.
- Linux cooperative process-group ownership through a private live anchor; SIGTERM only, no escalation or whole-tree containment.
- Unique direct-file stdout/stderr, launch-time credential placeholders, persistent leases that block unsafe relaunch after runtime loss.
- Built JS tarball, MIT license, Linux CI and GitHub OIDC/provenance publishing workflow (owner setup pending).
- Windows launcher included as experimental: native validation and Job Object lifecycle deferred. Batch-wrapper leases require external reconciliation.

Limits: manual stale-lease recovery, no health/readiness checks, autostart, watchdog, log rotation, full-screen dashboard or production-supervision guarantee. See README before use.
