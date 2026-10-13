# Linux-first release checklist and status

## Current status

Version 0.1.0 was bootstrapped through local npm authentication. Version 0.2.0 passed GitHub Linux validation and Trusted Publishing with provenance in [run 38363375101](https://github.com/mbundgaard/pi-servicehost/actions/runs/38363375101). MIT licensing and package/repository names are confirmed.

This checkout prepares the owner-authorized **0.3.0** release with the legacy-style interactive panel. Verify its publishing workflow outcome before claiming publication. Published versions are immutable; never republish 0.1.0 or 0.2.0.

Standalone npm CLI, not a Pi extension. Linux cooperative foreground services and readable procfs remain the supported scope. Windows is experimental and native validation/ACL/console behavior/Job Objects are deferred; package OS metadata permitting installation does not certify it. macOS is unsupported.

## Next release gates

- Review the complete changes, safety contracts, package manifest and 0.3.0 changelog; choose a fresh version and update package.json/lockfile together only when preparing an authorized release.
- On that revision: `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run check:package`.
- Inspect the allowlisted artifact after an explicit build: `npm pack --ignore-scripts`, then `tar -tzf` on the generated tarball. Twelve built JS modules and selected docs/config/metadata/license ship; source, tests, feedback, references, state, logs and credentials do not.
- Install the actual tarball with scripts disabled into a disposable prefix. Tests invoke its installed bin outside the checkout and exercise lifecycle plus observability commands. See [validation.md](validation.md) for local evidence, not remote gate results.
- Review the checked-in workflow and inspect actual GitHub Linux Node 22.19/24 results. Do not infer passing CI from workflow files or local tests.
- Before future OIDC publication, verify npm Trusted Publisher settings match `mbundgaard/pi-servicehost`, workflow `publish.yml`, and the configured environment (currently none). Owner-reported setup is not a tested authentication result. No long-lived token fallback is intended.
- Obtain explicit publication authorization. The release-published event or manual dispatch with matching version tag and `publish` confirmation performs real npm publication, not a dry run. Use only one route per immutable version.
- Inspect publication results and npm provenance for the exact revision/workflow, then independently install the registry version. Investigate uncertainty before any retry.

No external account changes, commits, pushes, tags, releases or publication were performed for this feedback increment. Windows ownership, stronger Linux containment, stale recovery and safe destructive log retention remain deferred, not implicit release guarantees. Local dry-run inventory intentionally cannot certify inactivity.
