# Validation record

## Interactive panel increment (local Linux, 2026-10-13; Unreleased)

- `npm run typecheck` passed.
- `npm test` passed: 33 tests, 32 passed, one Windows-native test skipped, zero failures.
- `npm run check:package` passed the installed-tarball test and exact allowlist dry run (22 files / twelve JS modules). Tarball installation uses `--ignore-scripts` outside the checkout, including the new default panel and retained prompt/ledger. Ctrl+L leaves fixture logs unchanged; quitting preserves its PID.
- Renderer tests verify exact cell widths/heights at 100×28, 80×24, 50×16, 32×8 and tiny sizes, including info, selection viewport, empty/loading/unavailable/pending/disconnected states, ANSI/OSC/C1/bidi neutralization and CJK/combining/emoji fitting. Controller tests cover serial requests, pending guard, captured action target, selection persistence, ambiguous outcomes without automatic action retry, and clear-during-read cursor advancement.
- A separate Python-standard-library PTY fixture uses an authenticated local mock API, **no child services**: actual function-key decoding, selection/list toggle, pending-action guard, Ctrl+L, resize, Ctrl+Q/q, SIGTERM and disconnect. It checks termios before/after plus cursor/alternate-screen restore sequences. Linux test prerequisites are `python3` and util-linux `script`; neither is a runtime/package dependency.
- `artifacts/panel-preview.txt` is an actual renderer-generated plain-text review artifact; it is not shipped. Frames were read/reviewed at the listed sizes. The layout now matches the requested legacy structure: compact service rows, full-width rules, selected logs and shortcuts/version only; no title, column headings or persistent connection banner. Tests cover F2 in the footer, transient notice expiry and disconnected cached-output warnings. No emulator screenshot, live Herdr test, native Windows TUI evidence or owner visual approval is claimed.
- No live services, Pi host dependency, external messaging, nested workers, version bump, commit, push or publication. Runtime API/lifecycle implementation and `FEEDBACK.md` are unchanged.

Limitations: ANSI/Unicode rendering conventions vary by terminal; byte-cursor boundaries may split UTF-8, stream interleaving is not timestamp ordering, long log rows are clipped, and cache eviction reattaches to a bounded tail. F5 is omitted. Handled signals restore the terminal; SIGKILL/power loss cannot run cleanup. Disconnection retries reads only. Existing runtime ownership/lease restrictions are unchanged.

## Previous feedback increment (local Linux, 2026-10-13)

The following records the earlier pre-panel run, not the current package manifest.

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
