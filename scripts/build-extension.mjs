// Pi reloads TypeScript through Jiti, but native ESM .js imports can remain cached
// for the lifetime of the host process. Ship a separate, fully TypeScript import
// graph beside the compiled CLI. A thin TS wrapper around extension.js is not enough.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import ts from 'typescript';

const sourceRoot = resolve('src');
const outputRoot = resolve('dist');
const visited = new Set();
async function copyModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const name = relative(sourceRoot, file);
  if (name.startsWith(`..${sep}`) || name === '..') throw new Error(`Extension import outside src: ${name}`);
  let text = await readFile(file, 'utf8');
  const imports = ts.preProcessFile(text, true, true).importedFiles;
  // Positions start at the opening quote and end at the last specifier character. Replace only
  // module specifiers; new URL('./cli.js', import.meta.url) and the native process
  // helper paths must continue to point at standalone compiled JavaScript.
  for (const item of imports.sort((a, b) => b.pos - a.pos)) {
    if (!item.fileName.startsWith('.')) continue;
    if (!item.fileName.endsWith('.js')) throw new Error(`Expected local .js specifier: ${item.fileName}`);
    const specifier = item.fileName.slice(0, -3) + '.ts';
    text = text.slice(0, item.pos + 1) + specifier + text.slice(item.end + 1);
    await copyModule(resolve(dirname(file), specifier));
  }
  await writeFile(resolve(outputRoot, name), text);
}
await copyModule(resolve(sourceRoot, 'extension.ts'));
