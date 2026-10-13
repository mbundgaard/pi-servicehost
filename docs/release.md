# Linux-first release checklist and status

## Current status

`@comput/pi-servicehost@0.1.0` is published on npm. The owner verified registry installation with scripts disabled and a disposable Ubuntu lifecycle smoke test (see the feedback record). The repository is https://github.com/mbundgaard/pi-servicehost. MIT licensing and package/repository names are confirmed. The owner reports npm Trusted Publisher is configured. These facts do not establish the mechanism of the first publication, a successful OIDC/provenance run, a GitHub release/tag, or remote CI results; none were independently inspected in this increment.

The published tarball is immutable and contains stale unpublished wording. This checkout corrects that wording and prepares the owner-authorized **0.2.0** release with readiness, live views and log inventory. Publication must be verified after the workflow completes; never retry publication of 0.1.0.

Standalone npm CLI, not a Pi extension. Linux cooperative foreground services and readable procfs remain the supported scope. Windows is experimental and native validation/ACL/console behavior/Job Objects are deferred; package OS metadata permitting installation does not certify it. macOS is unsupported.

## Next release gates

- Review the complete changes, safety contracts, package manifest and 0.2.0 changelog; choose a fresh version and update package.json/lockfile together only when preparing an authorized release.
- On that revision: `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run check:package`.
- Inspect the allowlisted artifact after an explicit build: `npm pack --ignore-scripts`, then `tar -tzf` on the generated tarball. Eleven built JS modules and selected docs/config/metadata/license ship; source, tests, feedback, references, state, logs and credentials do not.
- Install the actual tarball with scripts disabled into a disposable prefix. Tests invoke its installed bin outside the checkout and exercise lifecycle plus observability commands. See [validation.md](validation.md) for local evidence, not remote gate results.
- Review the checked-in workflow and inspect actual GitHub Linux Node 22.19/24 results. Do not infer passing CI from workflow files or local tests.
- Before future OIDC publication, verify npm Trusted Publisher settings match `mbundgaard/pi-servicehost`, workflow `publish.yml`, and the configured environment (currently none). Owner-reported setup is not a tested authentication result. No long-lived token fallback is intended.
- Obtain explicit publication authorization. The release-published event or manual dispatch with matching version tag and `publish` confirmation performs real npm publication, not a dry run. Use only one route per immutable version.
- Inspect publication results and npm provenance for the exact revision/workflow, then independently install the registry version. Investigate uncertainty before any retry.

No external account changes, commits, pushes, tags, releases or publication were performed for this feedback increment. Windows ownership, stronger Linux containment, stale recovery and safe destructive log retention remain deferred, not implicit release guarantees. Local dry-run inventory intentionally cannot certify inactivity.
