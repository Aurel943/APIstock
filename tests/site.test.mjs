import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './harness.mjs';

test('chaque script de index.html est mis en cache par le service worker', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const scripts = Array.from(html.matchAll(/<script src="(js\/[^"?]+)/g), m => m[1]);
  assert.ok(scripts.length > 10);
  for (const s of scripts) assert.ok(sw.includes(`'${s}'`), s + ' absent de sw.js');
});

test('la version du cache (sw.js et « ?v= » de index.html) correspond au contenu des fichiers', () => {
  execFileSync(process.execPath, [join(root, 'scripts/sw-version.mjs'), '--check'], { stdio: 'pipe' });
});
