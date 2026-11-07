# Extension upgrades and reloads

The standalone executable remains compiled JavaScript (`dist/cli.js`), with no Pi
runtime dependencies. Pi's package manifest instead loads `dist/extension.ts`.
The build copies the extension's transitive TypeScript source graph alongside the
compiled files and rewrites its local **module imports** to explicit `.ts` paths.
It does not rewrite executable paths: the runtime and panel still launch compiled
`cli.js`, and the Linux process helper still uses compiled JavaScript.

## Why not the compiled extension?

Pi's Node extension loader constructs Jiti with `moduleCache: false`. That option
does not evict Node's native ESM module cache. In a single process, loading an ESM
`.js` extension, overwriting its files during an upgrade, then loading it again can
still run the original factory and transitive modules. A new Jiti instance does
not guarantee fresh code. A TypeScript wrapper that imports that same compiled
JavaScript graph does not solve the problem either.

The package now gives Jiti a complete explicit TypeScript graph, rather than a
wrapper or ambiguous `.js` imports beside `.ts` sources. Reload tests use Pi's
actual `loadExtensions` implementation, including a negative control for native
ESM caching, repeated same-process TS upgrades, and the real ServiceHost tool and
transitive configuration-validation implementation. All fixture changes are in
temporary directories; the reload tests start no services or panels.

## Upgrading an already-running older installation

After upgrading from the older compiled-entry releases (including 0.4.0 and
0.5.0), **fully exit and restart Pi once**. This is the reliable recovery procedure
for a host that has already loaded the old code or retained old resource paths.
The new packaging does not attempt to delete Node's ESM cache, force host resource
rediscovery, or replace code already executing in an old extension runtime.

For subsequent upgrades using the TS manifest entry, Pi's normal resource
rediscovery and `/reload` can load fresh extension and transitive implementation
files. A session explicitly configured to load `dist/extension.js` must switch to
the package manifest/`dist/extension.ts`; compiled compatibility files are not the
reload-safe entry. Other extensions and host-level resource caches are outside
this package's control.

The package version on disk alone is not proof of what an existing Pi process
has loaded. A stale error after an upgrade should first be checked against the
loaded extension path, duplicate installations or explicit resource selections,
and whether Pi was fully restarted. This issue is distinct from the separately
running ServiceHost runtime; an extension reload does not migrate or restart it.

## Maintenance

Run `npm run build` before packing. `scripts/build-extension.mjs` follows only the
extension's local import graph; it leaves standalone CLI/panel-only files out of
the TS graph and fails on unexpected local module specifiers. No build script or
TypeScript compiler is required on the user's machine: generated `.ts` files are
already in the package, and Pi supplies Jiti.

Run the focused regression with:

```sh
npm run build
node --test tests/extension-reload.test.mjs
```
