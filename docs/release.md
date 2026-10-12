# Linux-first release checklist and status

## Current status

**Prepared, not published.** Candidate: `@comput/pi-servicehost@0.1.0`. The owner confirmed GitHub repository `mbundgaard/pi-servicehost` and npm name `@comput/pi-servicehost`. The public GitHub repository has been created with owner authorization and the local Git repository initialized. npm scope access/name availability and npm setup remain unverified. No tag, GitHub release or npm publication has been performed.

MIT with copyright 2026 Martin Bundgaard was selected to match sibling `pi-background`/`pi-telegram`. The owner confirmed MIT licensing and package/repository names. No reference clone is redistributed. Standalone npm CLI: do not register it as a Pi extension or use `pi install` instructions.

Linux with cooperative foreground services and readable procfs is the only initial supported release target. Windows remains experimental; native execution, ACL/console behavior and Job Object work are **deferred**, not blockers for this Linux-only claim. `os: [linux, win32]` permits experimental Windows installation; it does not certify it. macOS is not supported.

## Local gates

- [ ] On the final release revision: `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run check:package`.
- [ ] Review README safety scope: group escape, SIGTERM-only stop, stale leases/manual recovery, raw secret-bearing logs, trusted local writers, prompt-only panel.
- [ ] Inspect `npm pack --dry-run --ignore-scripts --json` after the explicit build. Exact manifest assertions reject unreviewed files. Only eight built JS modules, selected docs, example config, metadata, changelog and license ship.
- [ ] Inspect the actual tarball: `npm pack --ignore-scripts`; `tar -tzf comput-pi-servicehost-0.1.0.tgz`. Never pack an unbuilt checkout with scripts disabled.
- [ ] Package tests must install that locally generated tarball into a temporary prefix with `--ignore-scripts`, invoke the installed bin outside this checkout, and on Linux exercise up/status/start/logs/reconnect/stop/shutdown. No source imports or runtime dependencies in that installed CLI.
- [ ] Record actual validation in [validation.md](validation.md). Local results do not prove remote CI or Windows behavior.

## Owner setup (remaining; no external changes performed)

1. Confirm `@comput` npm scope access and `pi-servicehost` availability, final version, MIT authorship and GitHub owner/repository. Update package metadata, package manifest assertions, workflow checks, docs and lockfile together if names change.
2. Create the **public** GitHub repository `mbundgaard/pi-servicehost` for public provenance. Initialize Git locally only when authorized. Before the first commit, review staged files: exclude `.pi/`, references, credentials, `.env*`, runtime state/logs, node_modules, dist and tarballs. Commit source, lockfile, docs, tests and both workflows. Push a reviewed main branch; no automatic initialization is supplied here.
3. Enable GitHub Actions; configure the `npm` deployment environment with required reviewer approval and tag deployment rules for `v*`. Grant workflow OIDC (`id-token: write` is scoped to the publishing job); normal validation only gets read permission. Protect main and require both Linux CI jobs (`Linux / Node 22.19.0`, `Linux / Node 24`). Run and inspect both on GitHub before releasing.
4. In npm package settings, configure **Trusted Publishing → GitHub Actions**: organization/user `mbundgaard`, repository `pi-servicehost`, workflow filename **`publish.yml`**, environment **`npm`**. Values must exactly match the workflow. Use GitHub-hosted Ubuntu runners; Node 24/npm 11 provides OIDC support (npm >=11.5.1). No `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret is used or required by this workflow.
5. **First-publication bootstrap is unresolved until checked in npm.** Trusted Publisher setup normally requires an existing package/settings page. If npm cannot preconfigure this unpublished name, an owner must decide and explicitly authorize a one-time interactive first publication (with normal npm account/2FA controls), then configure Trusted Publishing for subsequent versions. Do not assume OIDC can create a new package without setup, add a token fallback, or publish a placeholder automatically. A bootstrap publication consumes 0.1.0; do not rerun the workflow for that version—prepare the next version instead. This preparation does not perform any bootstrap.
6. Once setup and gates pass, explicitly authorize publication. Create a reviewed commit/tag **`v0.1.0`** matching package.json/lockfile and publish its GitHub release. The `release: published` event **publishes to npm**, not a draft/dry-run. Alternatively, manual dispatch must select the matching **tag**, not main, and enter `publish`; it also **really publishes**. Both routes validate Linux Node 22.19/24 and require the environment approval. Do not use both for the same immutable npm version.
7. The publishing job explicitly rebuilds/checks the package, prints a final artifact manifest and publishes the tarball with scripts disabled, public access and provenance. It clears token environment variables and uses an empty user npm config; authentication failures stop publication, with no token fallback. Inspect the run and npm provenance linking the exact public repo/revision/workflow. Publication or network uncertainty must be investigated in npm before retrying; never blindly replay.
8. After confirmed publication, independently install the registry version into a disposable directory, verify CLI/lifecycle, package contents and provenance, and update the release status/changelog (remove “not published” only after confirmation).

## Release blockers vs deferred work

**Publication blockers:** reviewed release revision; actual GitHub Linux gate results; npm scope/name and first-publish bootstrap decision; Trusted Publisher/environment configuration; final explicit publication authorization. Local validation is recorded separately, not a waiver of these gates.

**Not blockers for Linux-only 0.1.0:** Windows native validation/Job Objects, stronger cgroup containment, automatic stale recovery, production supervision, dashboard UI. These remain explicit limitations, not implemented features. No runtime lifecycle/UI expansion was made for release preparation.

Workflow conventions follow the sibling packages: public scoped ESM package, allowlisted distribution, MIT metadata, Linux hosted GitHub OIDC with provenance and no long-lived npm tokens. Unlike the extension siblings, this CLI ships compiled dist and has no Pi extension metadata. Windows gating is intentionally omitted for this release scope.
