# Validation record

## Feedback increment (local Linux, 2026-10-13)

Environment: Node v22.23.3, npm 10.9.9. This is an Unreleased source increment, not a new npm publication. The owner separately verified installation and a disposable Linux smoke test of the **registry 0.1.0** package. Trusted Publisher configuration is owner-reported; no remote CI/OIDC/provenance run was inspected or claimed here.

Final local suite results: Tests use disposable projects and cooperative/self-expiring fixture processes; no real services, live Herdr manipulation, Pi SDK, nested workers, external messaging, account changes, commits, pushes or publication.

- `npm run typecheck` — passed strict TypeScript checking.
- `npm test` — passed: 24 tests, 23 passed, 1 Windows-native integration skipped, 0 failures.
- `npm run check:package` — passed build, 2/2 package tests, and exact allowlisted pack dry run. The manifest contains 20 files, including all eleven built JS modules. Source, tests, feedback, legacy references, secrets and runtime state are excluded.
- Package tests create an actual tarball in a temporary directory and install it with `--ignore-scripts`, invoking its installed executable bin outside the checkout: help/up/status/start/logs/watch/follow/log-inventory/reconnect/stop/shutdown. The installed live watch, follow, default prompt and `panel --live` also run under a disposable PTY using Linux util-linux `script` (required for this Linux test). Quitting leaves the same fixture PID running. Consecutive polls neither repeat unchanged status nor reread an unchanged log chunk. This is terminal protocol/output evidence, not a human visual review or evidence for every terminal emulator.

- `git diff --check` — passed.

### New coverage

Readiness: strict config bounds/closed endpoint grammar; expected response; mismatched status retries; refusal to follow redirects; oversized headers; hung endpoint/startup timeout; success without collecting a body; explicit cancellation; stop/restart launch-generation separation; natural exit cancellation with known exit code. Timeout leaves process/ownership intact. Status exposes a generic observation only, not response text or credentials.

Logs and views: API and Manager follow cursors, empty follow after catch-up, bounded chunk advancement, invalid cursors and byte limits, reset after restart or cursor beyond file size, escaped ANSI/C1/bidi output, narrow terminal wrapping without losing fields, one-shot non-TTY commands, installed PTY quit preserving services. Inventory covers bounds, active/historical retained files, symlink/directory/hard-link/unrelated-name exclusions, and byte-for-byte nonmutation. It does not prove inactivity or authorize deletion.

### Existing regression coverage retained

Disposable parent → child → grandchild fixtures validate cooperative Linux process-group drain, stop/restart with and without natural parent exit, portless ownership, shutdown fencing, old stdout/stderr preservation, and TERM-resistant descendants retaining leases on bounded timeout. Lost-anchor stop fails closed; runtime loss leaves survivors logging and a new Manager unable to signal or relaunch from a lease. An escaped setsid descendant explicitly demonstrates survival beyond group stop.

Authentication/project handshake, origin rejection, conflicting runtime port, listener identity, adoption identity mismatch, observe-only adoption, bounded log reads, status credential withholding, raw log caveat, reconnection, stale leases, failed-launch cleanup, config-relative paths, duplicate validation, Windows pure planner and native argv regression tests remain in the suite.

## Historical evidence and limits

The 2026-10-12 release-preparation suite had 19 tests (18 passed, 1 Windows-native skipped), and an eight-module/17-file package. That earlier run also checked workflow YAML/shell syntax and local publication-guard cases; those checks are not remote Actions execution and were not re-run for this runtime increment. No workflow changes are part of this increment.

Linux group signaling uses the live anchor's own `kill(0)`, not saved numeric PID/PGID authority. Drain uses non-atomic procfs scans, excluding zombies; escaping or hostile processes are not contained. No crash/reboot cleanup, zombie-reaping, malicious filesystem-race, power-loss durability or production-supervision guarantee is made. Trusted project directories and same PID/network namespace/readable procfs remain prerequisites.

Readiness is a bounded startup observation, not continuous health, process identity attestation, or a trigger for lifecycle actions. Fast restarts can skip historical log output and byte boundaries can split UTF-8. Inventory is bounded filesystem-order reporting, not an exhaustive disk usage audit; destructive retention is deferred because even stopped processes may have escaped descriptor holders.

Windows native batch/PATH/log/lease execution, ACLs, console closure and Job Objects remain deferred; Linux tests cannot certify them. See [Windows ownership design](windows-lifecycle.md). Remote Linux Node 22.19/24 CI, publication provenance and human terminal visual review are not established by this local record.
