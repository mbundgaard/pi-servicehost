# Initial design and next steps

## Scope and decisions

This is a standalone TypeScript npm CLI/runtime/prompt-panel vertical slice. The legacy .NET example informed configuration names only; legacy files are untouched. Sibling @comput packages informed ESM naming, allowlisted packaging, scripts and Node baseline; no Pi SDK dependency or extension metadata is included.

Modules:

- `src/config.ts`: canonical config identity, bounded validation, config-relative paths, launch-time credentials.
- `src/platform.ts`: Linux `/proc` TCP socket/PID discovery and boot/start-time/executable identity; Windows PowerShell listener/start-time/path identity. Shell-free native child launch, Windows executable resolution and restricted batch adapter in `src/windows-launch.ts`.
- `src/runtime.ts`: authenticated loopback API, serial lifecycle operations, in-memory ownership, exclusive launch leases, unique direct-file output, observe-only adoption.
- `src/linux-group.ts` / `src/linux-group-helper.ts`: private IPC capability and detached Node group anchor. Target inherits direct log descriptors; no pipe logging or shell. Helper is compiled/packed with the other JS modules, with no native dependency.
- `src/client.ts`: identity-checked connection and detached runtime launch, append-only runtime diagnostic log.
- `src/cli.ts`: commands and independent interactive prompt panel.
- `src/readiness.ts`: opt-in, per-launch bounded loopback HTTP startup observation; cancellation only, never lifecycle authority.
- `src/logs.ts`: bounded dry-run inventory; no deletion because escaped descriptor holders cannot be ruled out.
- `src/watch.ts`: independent sequential status/log polling, escaped monochrome output and per-launch byte cursors. Default prompt remains unchanged.

Terminal design plan: retain the user's terminal palette/font (no forced colors), left-aligned service/process/readiness/exit ledger, and no alternate screen or focus-stealing controls. Rather than a decorative dashboard, print changed status snapshots; narrow terminals wrap all fields. Logs stay escaped JSON, with a secret warning. This deliberately adapts the UI design guidance to a terminal, not a web page. Quit/disconnect cancels only client polling. A launch-scoped readiness object is never shared with a subsequent launch; exit/stop/anchor closure cancel it. Successful HTTP status attests only an endpoint observation, never process identity or ongoing health. Readiness requests have independent bounded deadlines and do not occupy the serialized lifecycle queue.

A launch lease is created before opening fresh output. It persists across runtime loss and natural exit, with no automatic stale-PID signaling. A live Windows child handle or Linux anchor IPC connection is the sole signal authority. The Linux anchor calls `kill(0, SIGTERM)` on its own pinned process group; no runtime-side PID/PGID check-then-kill race exists. Anchor loss fails closed with no numeric signaling fallback. The helper stays in the group after target exit, including portless launches. Stop performs two empty procfs membership scans (excluding anchor/zombies), reports drain, then releases the anchor and verifies its close. Five-second drain and bounded handshake/release deadlines retain leases on uncertainty. No SIGKILL escalation is implemented. Persisted numeric PIDs are diagnostic only. New filenames plus `wx` eliminate truncation altogether rather than guessing whether an old descendant still has a log open. A failed spawn with no PID removes its lease; successful spawn followed by bookkeeping failure retains it. Batch wrapper leases additionally remain after explicit stop, regardless of configured-port observations.

Only the management socket decides whether a runtime can bind. Concurrent runtime launch attempts can yield a losing process, which exits without controlling any services. The launcher may confirm a winning compatible runtime rather than its own child. It does not claim singleton execution outside that socket or cross-config coordination when users change the management port. Project config/state must be trusted local files. Config is a startup snapshot.

API requests are authenticated before parsing; body <=16 KiB, at most 32 connections and bounded queued operations, 15-second request/socket timeouts, 64-KiB maximum log read. Serial operations prevent concurrent start/stop on one runtime. A lost HTTP response can still mean the operation ran: inspect status rather than blindly retry. No generic error exposes raw spawn/config arguments. User-created child logs are intentionally not redacted.

## Explicit blockers and limits

1. **Whole-tree lifecycle**: Linux now owns a cooperative process group, not an inescapable tree. Descendants can escape with setsid/setpgid; procfs enumeration is not atomic and adversarial fork/exit churn can evade drain observations. A pidfd alone does not contain a tree. Need delegated cgroup containment and Windows Job Objects for stronger guarantees. No automatic adopted-process termination.
2. **Windows batch scripts**: a closed-grammar cmd adapter now allows simple batch/npm shim tokens, rejecting unsafe/ambiguous inputs instead of general escaping. Actual Windows execution remains unvalidated locally. Batch leases always survive stop/natural exit because ownership covers only cmd, not descendants; restart requires external reconciliation. See [Windows/native ownership design](windows-lifecycle.md).
3. **Recovery**: after runtime death ownership cannot be reconstructed safely. Leases require manual independent reconciliation. No kill-by-saved-PID escape hatch.
4. **Discovery races**: listening PID identity is an observation, not ownership. Linux procfs visibility restrictions and Windows permission/cmdlet failures fail closed. TCP only, current network namespace only; no UDP/socket activation.
5. **Runtime termination**: abrupt termination leaves Linux services/descendants alive by policy; IPC disconnect lets the anchor exit without signaling, and leases fence replacement runtimes. A lost anchor blocks further stop/restart/shutdown in its owning runtime even if the target later exits. No guarantee for terminal host job policies on Windows. Detached child/stdio semantics must be verified on supported Windows hosts.
6. **Durability/security**: lease files are not a transactional fsync journal, Windows file modes are not ACLs, local project writers are trusted, same-user process inspection may expose argument/environment credentials. No disk quotas, rotation, or secret-free output promises.
7. **UI/config**: default panel is a line-oriented prompt, with optional live compact status and log-follow views. Readiness is startup-only, not continuous health. No full-screen panes, config editor, reload, credential editor, service dependencies, or autostart. Runtime logs are local diagnostics only.

## Next steps

- Run/observe Windows CI and manual console-close tests on supported Windows versions, including detached services after launcher/panel exit.
- Add platform-native ownership helpers, process-tree fixtures, crash/descendant recovery tests and reliable escalation policy before relaxing blockers.
- Add explicit recovery workflow with no blind PID signaling, durable metadata transaction design, config revision checks, and launch identity attestation.
- Expand adversarial HTTP/backpressure/timeouts, symlink/ACL, malformed configuration and platform-failure tests.
- Consider richer terminal views and safe retention only after stronger inactivity proof exists. Current inventory deliberately never removes files. No automatic restart policy is supplied.
- Follow the [release checklist](release.md) for the next version. 0.1.0 is published and registry-installed; Trusted Publisher configuration is owner-reported, not proof of a tested OIDC run. Linux remains the release target; Windows validation is deferred.
- Pi/Herdr integrations are later work, after reading their current APIs/documentation; do not imply extension compatibility from npm name.
