# ServiceHost feedback

Add feedback below by copying the template. Bugs, feature requests, confusing behavior, and documentation suggestions are welcome. You can also open an issue at https://github.com/mbundgaard/pi-servicehost/issues.

Do not include credentials, tokens, private project configuration, or unredacted logs. Service output can contain secrets. Remove sensitive paths and values before sharing examples.

## Template

```markdown
### Short title

- Type: Bug / Feature request / Usability / Documentation
- Package version:
- OS and version:
- Node.js version (`node --version`):
- Terminal / Herdr version (if relevant):

**What were you trying to do?**

**Steps to reproduce or suggested improvement**
1.

**Expected behavior**

**Actual behavior**

**Sanitized error messages or examples (optional)**

```

## Feedback entries

<!-- Copy the template above here. Leave existing entries intact. -->

### Positive experience: lightweight local service management

- Type: Usability
- Package version: Published npm package `@comput/pi-servicehost@0.1.0` (not the current source checkout)
- OS and version: Ubuntu 24.04.4 LTS
- Node.js version: v22.23.3
- Terminal / Herdr version: Herdr 0.9.1; interactive panel additionally exercised through a pseudo-terminal

**What were you trying to do?**

Evaluate ServiceHost for local Nexus development without starting real application services, scheduled jobs or production-connected processes.

**Steps tested**
1. Installed the published package with install scripts disabled into a user-owned prefix.
2. Created a disposable project containing a cooperative Node HTTP service and a child process.
3. Ran `up`, checked that no service auto-started, then explicitly started the service.
4. Checked HTTP readiness independently and read service logs.
5. Reconnected to the existing runtime, opened the interactive panel, then quit the panel.
6. Restarted the service, stopped it and shut down the runtime.

**Actual behavior**

All these checks passed. Panel closure left the service running. Restart produced a new service process, and both stop and restart terminated the old cooperative service and its child. The launch lease was released after successful stop. The disposable runtime was shut down afterward.

**Assessment**

A good fit for local development: small installation, no runtime dependencies, explicit starts, authenticated project-scoped control, and separation between panel and runtime. The documented ownership limits are useful and appropriately cautious. This smoke test does not establish containment of escaped or hostile descendants, crash recovery, Windows support or production-supervision guarantees.

### Make the panel more useful for watching services

- Type: Feature request / Usability
- Package version: 0.1.0
- OS and version: Ubuntu 24.04.4 LTS
- Node.js version: v22.23.3
- Terminal / Herdr version: Herdr 0.9.1

**Suggested improvement**

Offer an optional live status view and log-follow command, while retaining the simple command prompt and machine-readable CLI/API. For example, a compact list of service name, process state, readiness and last exit result would let a developer notice changes without repeatedly typing `status`.

**Expected behavior**

The panel should make ongoing activity visible without stealing focus or changing service lifecycle. Keep terminal-control escaping and clearly warn that logs may contain secrets.

**Actual behavior**

The current prompt works, but status and log output are snapshots requested manually. This is an enhancement request, not a claim that the documented prompt panel is broken.

### Distinguish process running from application ready

- Type: Feature request
- Package version: 0.1.0
- OS and version: Ubuntu 24.04.4 LTS
- Node.js version: v22.23.3

**Suggested improvement**

Add optional, explicit readiness probes with bounded startup timeouts—for example an HTTP path and expected status. Keep process ownership and readiness as separate fields. A configured port remains discovery information, not proof of application health.

**Expected behavior**

Users and agents can distinguish a launched process from a service that is accepting usable requests. Readiness failure should not silently trigger restarts or destructive recovery.

**Actual behavior**

I needed a separate HTTP request to verify the test service was ready. The README correctly documents this distinction; exposing it in the runtime would improve the development workflow.

### Provide a bounded log-retention option

- Type: Feature request
- Package version: 0.1.0
- OS and version: Ubuntu 24.04.4 LTS
- Node.js version: v22.23.3

**Suggested improvement**

Consider opt-in retention limits or a dry-run cleanup command for old, positively inactive launch logs. Preserve the current unique-per-launch filenames and never truncate or remove a file that might still be held by a managed or escaped process.

**Expected behavior**

Long-running development workspaces can manage disk usage without manual guesswork or weakening the existing ownership guarantees.

**Actual behavior**

The README states that logs are not rotated or pruned. I did not run a disk-growth stress test; this suggestion is based on the documented lifecycle, not an observed leak.

### Published README still describes the package as unpublished

- Type: Documentation
- Package version: Published npm package 0.1.0
- OS and version: Ubuntu 24.04.4 LTS
- Node.js version: v22.23.3

**Steps to reproduce**
1. Fetch/install `@comput/pi-servicehost@0.1.0` from npm.
2. Read the README included in that published tarball.

**Expected behavior**

The README describes the available npm installation path as current and clearly identifies the package as a standalone CLI, not a `pi install` extension.

**Actual behavior**

The published README says version 0.1.0 is “prepared but not published,” that repository/publisher setup is still needed, and introduces npm installation as a future workflow. Installation from npm succeeded, so this release-status wording is stale. The standalone-CLI distinction is already clear and should be retained.

