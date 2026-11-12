/*
 * Vérification du code (npm run lint). Le site n'utilise pas de modules : ses scripts (js/*.js), chargés dans
 * l'ordre d'index.html, partagent leurs déclarations de premier niveau. On les relève ici pour que ESLint
 * connaisse ces noms communs et signale les vraies variables inconnues (fautes de frappe, oublis).
 */
import js from '@eslint/js';
import globals from 'globals';
import { readFileSync, readdirSync } from 'node:fs';

const siteFiles = readdirSync('js').filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const shared = {};
for (const f of siteFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(/^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm)) shared[m[1]] = 'writable';
}

export default [
  { ignores: ['node_modules/**', 'tests/fixtures/**'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser, ...shared, Chart: 'readonly', pdfjsLib: 'readonly' },
    },
    rules: {
      // les déclarations partagées sont utilisées par d'autres fichiers : seules les variables locales sont vérifiées
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.serviceworker },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }] },
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] },
  },
  {
    files: ['tests/e2e/**/*.mjs'],
    // fonctions passées à page.evaluate : elles s'exécutent dans la page, avec les noms du site
    languageOptions: { globals: { ...globals.browser, ...shared, Chart: 'readonly' } },
  },
  {
    files: ['proxy/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.serviceworker } },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }] },
  },
];
