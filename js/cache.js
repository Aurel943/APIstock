/*
 * Stockage durable et caches volumineux.
 *
 * - Cache : historiques de cours (« apistock:daily:… ») et dividendes (« apistock:events:… ») gardés dans IndexedDB
 *   plutôt que dans le localStorage (limité à ~5 Mo et partagé avec tes données). Même interface que localStorage
 *   (getItem / setItem / removeItem), lecture synchrone depuis une copie en mémoire chargée au démarrage.
 *   Sans IndexedDB (navigation privée ancienne, tests) : tout reste dans le localStorage, comme avant.
 * - lsSet : écriture dans le localStorage qui libère les caches et réessaie quand le stockage est plein.
 * - Durable : demande au navigateur de ne pas effacer les données du site (navigator.storage.persist).
 */
'use strict';

const CACHE_PREFIXES = ['apistock:daily:', 'apistock:events:'];
const CACHE_DB = 'apistock-cache';

const Cache = {
  mem: null,        // Map clé -> texte, une fois IndexedDB chargé
  db: null,
  settled: false,   // chargement terminé (réussi ou non)
  ready: null,      // promesse résolue quand la copie en mémoire est prête (ou IndexedDB indisponible)

  handles(k) { return typeof k === 'string' && CACHE_PREFIXES.some(p => k.startsWith(p)); },

  open() {
    if (this.ready) return this.ready;
    this.ready = new Promise(resolve => {
      let idb = null;
      try { idb = typeof indexedDB !== 'undefined' ? indexedDB : null; } catch (e) { idb = null; }
      if (!idb) { resolve(false); return; }
      let done = false;
      const fail = () => { if (done) return; done = true; this.db = null; this.mem = null; resolve(false); };
      const t = setTimeout(fail, 3000); // IndexedDB bloqué : on reste sur le localStorage
      let req;
      try { req = idb.open(CACHE_DB, 1); } catch (e) { clearTimeout(t); fail(); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => { clearTimeout(t); fail(); };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readonly');
          const store = tx.objectStore('kv');
          const keysReq = store.getAllKeys(), valsReq = store.getAll();
          tx.oncomplete = () => {
            clearTimeout(t);
            if (done) { db.close(); return; }
            done = true;
            this.db = db;
            this.mem = new Map(keysReq.result.map((k, i) => [k, valsReq.result[i]]));
            this.migrate();
            resolve(true);
          };
          tx.onerror = () => { clearTimeout(t); fail(); };
        } catch (e) { clearTimeout(t); fail(); }
      };
    }).then(ok => { this.settled = true; return ok; });
    return this.ready;
  },

  /** Déplace les anciens caches du localStorage vers IndexedDB (une fois) */
  migrate() {
    const moved = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (this.handles(k)) moved.push(k);
      }
    } catch (e) { return; }
    for (const k of moved) {
      let v = null;
      try { v = localStorage.getItem(k); } catch (e) { v = null; }
      if (v !== null) this.put(k, v); // la copie du localStorage est la plus récente (écrite avant le chargement)
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    }
  },

  put(k, v) {
    this.mem.set(k, v);
    try { this.db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { /* écrit en mémoire seulement */ }
  },

  getItem(k) {
    if (this.mem) return this.mem.has(k) ? this.mem.get(k) : null;
    try { return localStorage.getItem(k); } catch (e) { return null; }
  },

  setItem(k, v) {
    v = String(v);
    if (this.mem) { this.put(k, v); return; }
    lsSet(k, v);
  },

  removeItem(k) {
    if (this.mem) {
      this.mem.delete(k);
      try { this.db.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch (e) { /* ignore */ }
      return;
    }
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  },

  /** Clés du cache qui commencent par un préfixe */
  keys(prefix = '') {
    if (this.mem) return Array.from(this.mem.keys()).filter(k => k.startsWith(prefix));
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.push(k); } } catch (e) { /* ignore */ }
    return out;
  },

  /** Vide les caches (historiques, dividendes) ; renvoie le nombre d'entrées supprimées */
  clear() {
    let n = 0;
    for (const p of CACHE_PREFIXES) for (const k of this.keys(p)) { this.removeItem(k); n++; }
    // restes éventuels dans le localStorage (avant migration)
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (this.handles(k)) { localStorage.removeItem(k); n++; } }
    } catch (e) { /* ignore */ }
    return n;
  },

  /** Taille approximative (octets) des caches en mémoire */
  size() {
    let n = 0;
    for (const p of CACHE_PREFIXES) for (const k of this.keys(p)) n += (this.getItem(k) || '').length * 2;
    return n;
  },
};

/* Caches du localStorage qu'on peut effacer sans rien perdre (ils se rechargent) quand le stockage est plein */
const LS_EVICTABLE = ['apistock:daily:', 'apistock:events:', 'apistock:fundamentals', 'apistock:holdings', 'apistock:earnings',
  'apistock:reactions', 'apistock:tdiff', 'apistock:quotes'];

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

/** Efface les caches du localStorage ; renvoie le nombre de clés supprimées */
function evictLocalCaches() {
  let n = 0;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && LS_EVICTABLE.some(p => k.startsWith(p))) { localStorage.removeItem(k); n++; }
    }
  } catch (e) { /* ignore */ }
  return n;
}

/**
 * Écrit dans le localStorage ; si le stockage est plein, efface les caches puis réessaie.
 * Renvoie true si l'écriture a réussi. Les autres erreurs (stockage désactivé) renvoient false.
 */
function lsSet(k, v) {
  try { localStorage.setItem(k, v); return true; }
  catch (e) {
    if (!isQuotaError(e)) return false;
    if (!evictLocalCaches()) return false;
    try { localStorage.setItem(k, v); return true; } catch (e2) { return false; }
  }
}

/* Stockage durable : le navigateur s'engage à ne pas effacer les données du site pour faire de la place */
const Durable = {
  state: 'unknown', // 'persisted' | 'best-effort' | 'unsupported' | 'unknown'

  supported() { return typeof navigator !== 'undefined' && !!(navigator.storage && navigator.storage.persist); },
  /** Firefox demande la permission par une fenêtre : on ne la déclenche que sur un clic */
  asksPermission() { return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent || ''); },

  async check() {
    if (!this.supported()) { this.state = 'unsupported'; return this.state; }
    try { this.state = (await navigator.storage.persisted()) ? 'persisted' : 'best-effort'; } catch (e) { this.state = 'unsupported'; }
    return this.state;
  },

  /** Demande le stockage durable ; renvoie true s'il est accordé */
  async request() {
    if (!this.supported()) return false;
    try { const ok = await navigator.storage.persist(); this.state = ok ? 'persisted' : 'best-effort'; return ok; } catch (e) { return false; }
  },

  /** Au démarrage : demande sans fenêtre (Chrome, Edge, Safari décident seuls), seulement s'il y a des données à protéger */
  async auto(hasData) {
    const st = await this.check();
    if (st === 'best-effort' && hasData && !this.asksPermission()) await this.request();
    return this.state;
  },

  /** Espace utilisé et disponible (octets), si le navigateur le donne */
  async estimate() {
    try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { return null; }
  },
};

Cache.open();
