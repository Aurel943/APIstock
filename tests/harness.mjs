/* Charge les scripts du site (prévus pour le navigateur) dans un contexte Node isolé, avec un DOM minimal simulé */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = ['js/utils.js', 'js/store.js', 'js/api.js', 'js/markets.js', 'js/portfolio.js', 'js/charts.js', 'js/app.js', 'js/views.js', 'js/compare.js', 'js/extras.js', 'js/mobile.js', 'js/features.js', 'js/money.js', 'js/newsart.js', 'js/insights.js', 'js/wealth.js', 'js/avis.js', 'js/manual.js', 'js/health.js', 'js/agenda.js', 'js/catalog.js', 'js/goals.js', 'js/optimizer.js', 'js/treemap.js', 'js/wrapped.js', 'js/lab.js', 'js/share.js', 'js/labo-quant.js', 'js/fisc.js', 'js/copilot.js'];

export function loadApp(state = {}) {
  const mem = new Map();
  const localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
    key: i => Array.from(mem.keys())[i], get length() { return mem.size; },
  };
  const noop = () => {};
  const ctx = {
    console, Intl, Date, Math, JSON, Promise, Map, Set, structuredClone, TextEncoder, TextDecoder, btoa, atob, crypto: globalThis.crypto, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage, sessionStorage: localStorage, navigator: { userAgent: 'node' }, location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', hash: '' },
    document: { addEventListener: noop, documentElement: { classList: { contains: () => false, add: noop, remove: noop, toggle: noop }, dataset: {} }, querySelector: () => null, querySelectorAll: () => [] },
    matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: noop, history: { replaceState: noop },
    fetch: () => Promise.reject(new Error('réseau désactivé dans les tests')),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of SCRIPTS) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
  // globals déclarés avec const/let dans les scripts : exposés via une évaluation dans le contexte
  const get = name => vm.runInContext(name, ctx);
  localStorage.setItem('apistock:v1', JSON.stringify(state));
  get('Store').load();
  const Api = get('Api');
  Api.fxCached = () => 1; // pas de conversion de devises dans les tests
  Api.cachedQuote = () => null;
  return { ctx, get, Store: get('Store'), Portfolio: get('Portfolio'), Tax: get('Tax'), App: get('App'), Api };
}
