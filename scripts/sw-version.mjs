#!/usr/bin/env node
/*
 * Version du cache de l'application installée (sw.js), calculée automatiquement à partir du contenu des fichiers du site.
 *   node scripts/sw-version.mjs          → met à jour CACHE dans sw.js
 *   node scripts/sw-version.mjs --check  → échoue si sw.js n'est pas à jour (utilisé par l'intégration continue)
 * Ainsi, toute modification d'un fichier change le nom du cache : les téléphones récupèrent la nouvelle version
 * sans qu'il faille penser à incrémenter un numéro à la main.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');

export function assetsOf(src) {
  const m = src.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('liste ASSETS introuvable dans sw.js');
  return Array.from(m[1].matchAll(/'([^']+)'/g), x => x[1]).filter(a => a !== './');
}

export function versionOf(src) {
  const h = createHash('sha256');
  for (const a of assetsOf(src).sort()) { h.update(a + '\0'); h.update(readFileSync(join(root, a))); }
  return 'apistock-' + h.digest('hex').slice(0, 10);
}

const want = versionOf(sw);
const cur = (sw.match(/const CACHE = '([^']+)';/) || [])[1];
if (process.argv.includes('--check')) {
  if (cur !== want) {
    console.error(`sw.js n'est pas à jour (CACHE = '${cur}', attendu '${want}'). Lance : node scripts/sw-version.mjs`);
    process.exit(1);
  }
  console.log('sw.js à jour :', cur);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (cur === want) console.log('Déjà à jour :', cur);
  else { writeFileSync(swPath, sw.replace(/const CACHE = '[^']+';/, `const CACHE = '${want}';`)); console.log('CACHE :', cur, '→', want); }
}
