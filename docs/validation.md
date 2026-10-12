# Validation record

Local environment: Linux, Node v22.23.3, npm 10.9.9. Linux-first 0.1.0 release-preparation validation (2026-10-12):

- `npm ci --ignore-scripts` — passed; audit reported zero vulnerabilities in the four-package development tree. No runtime dependencies.
- `npm run typecheck` — passed strict TypeScript checking.
- `npm test` — 19 tests: 18 passed, 1 Windows-native integration skipped; zero failures on the final run.
- `npm run check:package` — build, **2/2 package tests**, and allowlisted pack dry run passed. Manifest assertions require exactly 17 files, including all eight compiled JS modules and no source, tests, references, secrets or runtime state. Lockfile identity/version/license and metadata consistency are checked.
- Actual tarball installation uses `--ignore-scripts` in a disposable prefix outside the checkout. Tests invoke the installed executable bin (not just the JS path) and exercise Linux up/status/start/logs/reconnect/stop/shutdown, including the packaged Linux helper.
- Both workflow YAML files parsed and all embedded shell steps passed `bash -n`. Six local publication-guard cases passed: matching release/manual tags accepted; branch, mismatched release tag, missing manual confirmation and mismatched repository rejected. GitHub Actions/OIDC/provenance were **not** executed locally; remote Node 22.19/24 gate results remain pending.
- Final artifact built with scripts disabled after an explicit build and inspected with `tar -tzf`: 17 allowlisted files. Release preparation did not publish it.

An earlier run caught a concurrent shared-checkout repository metadata change (`comput-sh` to `mbundgaard`) through the package assertion. The external edit was preserved, docs aligned, and assertions now check repository URL shape plus homepage/issues consistency; owner confirmation of the target remains on the release checklist.

## Linux evidence

Disposable parent → child → grandchild fixtures validate live process-group drain (procfs check after stop), stop/restart with and without natural parent exit, portless ownership, shutdown fencing until explicit release, historical stdout/stderr preservation, and TERM-resistant descendants retaining leases on a bounded timeout. A lost-anchor test kills only its retained fixture handle, then verifies stop fails closed and the service continues writing: there is no saved-PGID fallback. A disposable runtime SIGKILL test verifies IPC disconnect does not kill services, direct log writes continue, a replacement Manager cannot stop or relaunch from the stale lease, and output files remain unchanged in number. An explicit detached/setsid descendant test demonstrates the scope limitation: it survives group stop and continues logging until its fixture timer exits.

Existing tests still cover authenticated project handshake, origin rejection, conflicting runtime port, listener identity, identity-mismatch adoption rejection, observe-only adoption, bounded log reads, status not exposing configured credentials, raw child-log caveat, reconnection without truncation, stale leases, failed-launch cleanup, detached runtime reconnection, relative config paths, duplicate validation and package exclusions. No external listener is signaled by port.

## Release-critical review

Reviewed launch ownership, group stop/recovery, loopback authentication, log/credential exposure, artifact exclusions and release authentication against the documented scope. No new Linux release-critical runtime defect was identified in this bounded review; this is not a full security audit. No lifecycle/UI source changes were made. Known safety limits below remain prominent in README rather than being hidden by packaging. External publication blockers and first-package OIDC bootstrap uncertainty are in [release.md](release.md). MIT was selected to match sibling packages, pending owner confirmation.

## Limits, not claims

Linux group signaling uses the live anchor's own `kill(0)`, so PID/PGID reuse is structurally avoided rather than stress-tested by forcing kernel ID reuse. Drain uses two non-atomic procfs scans, excluding zombies; this is cooperative process-group supervision, not cgroup containment or proof against adversarial fork/exit churn. Escaped descendants are outside scope. Procfs must expose group members in the same PID namespace; restricted/hidden procfs and hostile same-user processes are not supported security boundaries. No reboot/crash cleanup, zombie-reaping, power-loss durability, malicious filesystem-race, or production-readiness guarantee is made.

Windows pure planner/native argv tests run locally; `.cmd`/`.bat`/PATH/direct-log/wrapper-lease integration remains skipped without Windows. PATH probes found no `cl.exe`, `clang-cl`, MinGW C++ compiler, Wine or CMake. Consequently no Job Object binary/source implementation is shipped or claimed tested: the reviewed-next-step protocol, suspended assignment/handle design, source/build artifact strategy and exact blockers are in `docs/windows-lifecycle.md`. Native Windows jobs, ACLs, nested jobs, console closure and failure injection still need native CI/manual validation. Existing Windows paths remain direct-child-only or conservatively fenced batch-wrapper control.

All fixtures were temporary and self-expiring where survivors were intentional. No real services, Herdr, siblings/legacy projects, external messaging, commits, pushes or publishing were used. Package tests install only their locally generated artifact into a temporary prefix. Remote CI and visual terminal behavior were not exercised.
