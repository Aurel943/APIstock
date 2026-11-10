#!/usr/bin/env node
/*
 * Version du cache de l'application installée (sw.js), calculée automatiquement à partir du contenu des fichiers du site.
 *   node scripts/sw-version.mjs          → met à jour CACHE dans sw.js
 *   node scripts/sw-version.mjs --check  → échoue si sw.js n'est pas à jour (utilisé par l'intégration continue)
 * Ainsi, toute modification d'un fichier change le nom du cache : les téléphones récupèrent la nouvelle version
 * sans qu'il faille penser à incrémenter un numéro à la main.
 * La même version est ajoutée aux feuilles de style et scripts de index.html (« ?v=… ») : un navigateur ne peut plus
 * combiner un ancien fichier gardé en cache avec les nouveaux.
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

const VERSIONED = /((?:src|href)="(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g;
const stripVersions = html => html.replace(VERSIONED, '$1"');
const withVersions = (html, v) => html.replace(VERSIONED, `$1?v=${v}"`);

export function versionOf(src) {
  const h = createHash('sha256');
  for (const a of assetsOf(src).sort()) {
    h.update(a + '\0');
    const buf = readFileSync(join(root, a));
    h.update(a === 'index.html' ? stripVersions(buf.toString('utf8')) : buf); // les « ?v= » ne comptent pas
  }
  return 'apistock-' + h.digest('hex').slice(0, 10);
}

const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const want = versionOf(sw);
const cur = (sw.match(/const CACHE = '([^']+)';/) || [])[1];
const wantHtml = withVersions(html, want.replace('apistock-', ''));
if (process.argv.includes('--check')) {
  if (cur !== want || html !== wantHtml) {
    console.error(`sw.js ou index.html n'est pas à jour (CACHE = '${cur}', attendu '${want}'). Lance : node scripts/sw-version.mjs`);
    process.exit(1);
  }
  console.log('sw.js et index.html à jour :', cur);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (cur === want && html === wantHtml) console.log('Déjà à jour :', cur);
  else {
    writeFileSync(swPath, sw.replace(/const CACHE = '[^']+';/, `const CACHE = '${want}';`));
    writeFileSync(htmlPath, wantHtml);
    console.log('CACHE :', cur, '→', want);
  }
}
