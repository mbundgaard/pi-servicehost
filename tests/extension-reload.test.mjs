import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadExtensions } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';

async function load(entry, cwd) {
  // This is Pi's real non-cached reload loader, not a native import with a test-only
  // cache-busting query. Each call constructs the same Jiti instance Pi uses.
  const result = await loadExtensions([entry], cwd);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  return result.extensions[0];
}
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'servicehost-reload-'));
  try {
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function graph(dir, ext, marker) {
  await writeFile(join(dir, `entry.${ext}`), `import {value} from './middle.${ext}';
export default function(pi) { pi.registerCommand('probe', {description: '${marker}:' + value, handler: async () => {}}); }`);
  await writeFile(join(dir, `middle.${ext}`), `export {value} from './leaf.${ext}';`);
  await writeFile(join(dir, `leaf.${ext}`), `export const value = '${marker}';`);
}
const marker = extension => extension.commands.get('probe').description;

test('native ESM stays stale across Pi reloads; a thin TS wrapper cannot refresh its JS graph', async () => {
  await fixture(async dir => {
    await graph(dir, 'js', 'old');
    assert.equal(marker(await load(join(dir, 'entry.js'), dir)), 'old:old');
    await graph(dir, 'js', 'new');
    assert.equal(marker(await load(join(dir, 'entry.js'), dir)), 'old:old');
    await writeFile(join(dir, 'wrapper.ts'), "export {default} from './entry.js';");
    assert.equal(marker(await load(join(dir, 'wrapper.ts'), dir)), 'old:old');
  });
});

test('a full explicit TS graph refreshes entry and transitive modules in the same Pi process', async () => {
  await fixture(async dir => {
    // Seed native caches first, exactly as an older compiled package would.
    await graph(dir, 'js', 'old');
    assert.equal(marker(await load(join(dir, 'entry.js'), dir)), 'old:old');
    for (const revision of ['one', 'two', 'three']) {
      await graph(dir, 'ts', revision);
      assert.equal(marker(await load(join(dir, 'entry.ts'), dir)), `${revision}:${revision}`);
    }
  });
});

test('actual distributed ServiceHost TS graph refreshes tools and deep config behavior without starting services', async () => {
  await fixture(async dir => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
    assert.deepEqual(manifest.pi.extensions, ['./dist/extension.ts']);
    await cp(resolve('dist'), join(dir, 'dist'), { recursive: true });
    // Deliberately invalid, non-secret local config: validation cannot launch anything.
    await writeFile(join(dir, 'ServiceHost.json'), '{}');
    const entry = join(dir, manifest.pi.extensions[0]);
    const config = join(dir, 'dist/config.ts');
    const originalEntry = await readFile(entry, 'utf8');
    const originalConfig = await readFile(config, 'utf8');
    assert.match(originalEntry, /from '\.\/integration\.ts'/);
    for (const revision of ['old', 'new', 'newer']) {
      await writeFile(entry, originalEntry.replace('Validate existing configuration', `${revision}: Validate existing configuration`));
      await writeFile(config, originalConfig.replace("'Invalid configuration'", `'${revision}: Invalid configuration'`));
      const extension = await load(entry, dir);
      assert.equal(extension.tools.size, 16);
      const tool = extension.tools.get('servicehost_config_validate');
      const definition = tool.definition ?? tool;
      assert.match(definition.description, new RegExp(`^${revision}:`));
      const result = await definition.execute('test', {}, undefined, undefined, { cwd: dir });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, `${revision}: Invalid configuration`);
    }
    // Native child-process targets must remain JS, not Jiti-only TS paths.
    assert.match(await readFile(join(dir, 'dist/client.ts'), 'utf8'), /new URL\('\.\/cli\.js',import\.meta\.url\)/);
    assert.match(await readFile(join(dir, 'dist/herdr.ts'), 'utf8'), /new URL\('\.\/cli\.js',moduleURL\)/);
  });
});
