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

test('aucun fichier du site ne porte un nom bloqué par les bloqueurs de pub et de pisteurs', () => {
  // motifs de fichiers des listes EasyList / EasyPrivacy (ex. « /quant.js » : le script de Quantcast)
  const BLOCKED = /\/(quant|analytics|tracking|tracker|track|pixel|beacon|ads?|adserver|advert\w*|banner\w*|sponsor\w*|social|gtag|ga|fbevents|hotjar|matomo|piwik|stats?)\.js$/i;
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const files = Array.from(html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)/g), m => '/' + m[1]);
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(!BLOCKED.test(f), f + ' serait bloqué par les bloqueurs de pub (renomme-le)');
});

test('pas de syntaxe non comprise par Safari avant 16.4 (« lookbehind » dans les expressions régulières)', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const [, f] of html.matchAll(/<script src="(js\/[^"?]+)/g)) {
    const code = readFileSync(join(root, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(!/\(\?<[!=]/.test(code), f + ' utilise un lookbehind');
  }
});
