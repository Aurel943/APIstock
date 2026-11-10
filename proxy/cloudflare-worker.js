/*
 * Relais Yahoo Finance pour Cloudflare Workers (gratuit : 100 000 requêtes/jour).
 *
 * Installation :
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
 *   2. Donne-lui un nom (ex. "apistock-yahoo") → Deploy → Edit code
 *   3. Remplace tout le code par ce fichier → Deploy
 *   4. Copie l'URL du worker (https://apistock-yahoo.<ton-compte>.workers.dev)
 *      dans APIstock → Réglages → « Relais Yahoo Finance »
 *
 * Appels Yahoo autorisés, en lecture seule : graphique/cotation (avec dividendes et divisions), recherche et actualités.
 * Pour réserver le relais à ton site, liste ses adresses ci-dessous.
 *
 * Compteur global (optionnel) : nombre de requêtes reçues aujourd'hui par le worker,
 * tous visiteurs confondus, affiché dans APIstock → Réglages.
 *   a. Cloudflare → My Profile → API Tokens → Create Token → Create Custom Token
 *      Permissions : Account · Account Analytics · Read → Continue → Create Token (copie-le)
 *   b. Worker → Settings → Variables and Secrets → Add :
 *        CF_ACCOUNT_ID  (Text)   = l'identifiant du compte (Workers & Pages → Account ID, colonne de droite)
 *        CF_API_TOKEN   (Secret) = le jeton créé ci-dessus
 *      → Deploy
 * Le jeton ne quitte jamais le worker : le site ne reçoit que les totaux.
 *
 * Synchronisation entre appareils (optionnel) : tes données, chiffrées dans le navigateur
 * avec ton code de synchronisation, sont stockées ici sans que le worker puisse les lire.
 *   a. Workers & Pages → KV → Create a namespace (ex. « apistock-sync »)
 *   b. Worker → Settings → Bindings → Add binding → KV namespace :
 *        Variable name = SYNC, namespace = celui créé ci-dessus → Deploy
 *
 * Alertes de prix même site fermé (optionnel, nécessite l'espace KV « SYNC » ci-dessus) :
 *   a. APIstock → Investir → Alertes → « Générer les clés du worker… » : copie les deux clés affichées
 *   b. Worker → Settings → Variables and Secrets → Add (type Secret) :
 *        VAPID_PUBLIC  = la clé publique
 *        VAPID_PRIVATE = la clé privée
 *        (facultatif) VAPID_SUBJECT = mailto:ton-adresse ou l'URL de ton site, transmis aux services push
 *   c. Worker → Settings → Triggers → Cron Triggers → Add : « toutes les 5 minutes » (expression exacte dans le README) → Deploy
 *   Les alertes (symbole, seuil) et l'adresse d'abonnement push de chaque appareil sont stockées dans KV,
 *   non chiffrées (le worker doit pouvoir les lire pour les vérifier) ; rien d'autre de ton portefeuille.
 */
const ALLOWED_ORIGINS = [
  'https://aurel943.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];
const SYMBOL_RE = /^[A-Za-z0-9.\-=^&]{1,25}$/;

function buildUpstream(q) {
  const type = q.get('type');
  if (type === 'chart') {
    const symbol = q.get('symbol') || '';
    if (!SYMBOL_RE.test(symbol)) return null;
    const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol));
    for (const k of ['range', 'interval', 'period1', 'period2']) if (q.get(k)) u.searchParams.set(k, q.get(k).slice(0, 20));
    u.searchParams.set('includePrePost', 'false');
    // dividendes et divisions (pour le calendrier des dividendes et la détection des divisions)
    const ev = q.get('events');
    if (ev && /^(div|split)(,(div|split))?$/.test(ev)) u.searchParams.set('events', ev);
    return u;
  }
  if (type === 'search' || type === 'news') {
    const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
    u.searchParams.set('q', (q.get('q') || '').slice(0, 60));
    u.searchParams.set('quotesCount', type === 'news' ? '0' : '20');
    u.searchParams.set('newsCount', type === 'news' ? '10' : '0');
    return u;
  }
  return null;
}

/* ---- Alertes push (Web Push chiffré, RFC 8291 + VAPID RFC 8292) ---- */
const PUSH_ID_RE = /^[a-f0-9]{32}$/;
const PUSH_KINDS = new Set(['above', 'below', 'dayUp', 'dayDown']);
const PUSH_TTL = 90 * 86400; // un abonnement non resynchronisé pendant 90 jours est oublié
const te = new TextEncoder();

function b64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** En-tête Authorization VAPID (jeton JWT ES256 signé avec la clé privée du worker) */
async function vapidAuth(endpoint, env) {
  const pub = unb64u(env.VAPID_PUBLIC);
  const header = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:apistock@example.com' })));
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(header + '.' + claims));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

/** Chiffrement du message pour l'abonnement (aes128gcm, RFC 8188 / 8291) */
async function encryptPayload(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(te.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return concat(head, asPub, ct);
}

/** Envoie une notification ; renvoie le statut HTTP du service push (404/410 : abonnement expiré) */
async function sendPush(env, sub, message) {
  const body = await encryptPayload(sub, JSON.stringify(message));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, env), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body,
  });
  return r.status;
}

function pushReady(env) { return !!(env && env.SYNC && env.VAPID_PUBLIC && env.VAPID_PRIVATE); }

function validSub(sub) {
  try {
    return sub && typeof sub.endpoint === 'string' && new URL(sub.endpoint).protocol === 'https:' && sub.endpoint.length < 1000
      && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string' && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100;
  } catch (e) { return false; }
}

async function handlePush(request, q, env, cors) {
  const type = q.get('type');
  if (!pushReady(env)) return json({ configured: false, reason: !env || !env.SYNC ? 'espace KV « SYNC » manquant sur le worker' : 'clés VAPID_PUBLIC / VAPID_PRIVATE manquantes sur le worker' }, 200, cors);
  if (type === 'pushkey') return json({ configured: true, publicKey: env.VAPID_PUBLIC }, 200, cors);
  if (request.method !== 'POST') return json({ error: 'méthode non autorisée' }, 405, cors);
  const text = await request.text();
  if (text.length > 64 * 1024) return json({ error: 'données trop volumineuses' }, 413, cors);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'JSON invalide' }, 400, cors); }
  if (!PUSH_ID_RE.test(body.id || '')) return json({ error: 'identifiant invalide' }, 400, cors);
  const kvKey = 'push:' + body.id;
  if (type === 'push-delete') { await env.SYNC.delete(kvKey); return json({ configured: true, ok: true }, 200, cors); }
  const cur = await env.SYNC.get(kvKey, 'json');
  if (type === 'push-test') {
    if (!cur) return json({ error: 'abonnement inconnu : réactive les alertes push' }, 404, cors);
    const status = await sendPush(env, cur.sub, { title: 'APIstock', body: 'Notification de test ✔ Les alertes de prix t\'arriveront ainsi, même site fermé.', tag: 'test' });
    if (status === 404 || status === 410) { await env.SYNC.delete(kvKey); return json({ error: 'abonnement expiré : réactive les alertes push' }, 410, cors); }
    return json({ configured: true, ok: status < 300, status }, 200, cors);
  }
  if (type !== 'push-sync') return json({ error: 'requête invalide' }, 400, cors);
  if (!validSub(body.sub)) return json({ error: 'abonnement push invalide' }, 400, cors);
  const fired = (cur && cur.fired) || {};
  const alerts = (Array.isArray(body.alerts) ? body.alerts : []).slice(0, 50)
    .filter(a => a && typeof a.id === 'string' && a.id.length <= 40 && SYMBOL_RE.test(a.s || '') && PUSH_KINDS.has(a.k) && isFinite(a.v))
    .filter(a => !fired[a.id]) // déjà déclenchée : l'appareil va la marquer comme telle
    .map(a => ({ id: a.id, s: a.s, k: a.k, v: Number(a.v), t: String(a.t || a.s).slice(0, 120) }));
  await env.SYNC.put(kvKey, JSON.stringify({ sub: { endpoint: body.sub.endpoint, keys: { p256dh: body.sub.keys.p256dh, auth: body.sub.keys.auth } }, alerts, fired: {}, updatedAt: Date.now() }), { expirationTtl: PUSH_TTL });
  return json({ configured: true, ok: true, fired, count: alerts.length }, 200, cors);
}

/** Tâche planifiée (Cron Trigger) : vérifie toutes les alertes et envoie les notifications */
async function checkAlerts(env) {
  if (!pushReady(env)) return;
  const records = [];
  let cursor;
  do {
    const page = await env.SYNC.list({ prefix: 'push:', cursor });
    for (const k of page.keys) records.push(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const recs = [];
  for (const name of records) {
    const r = await env.SYNC.get(name, 'json');
    if (r && r.alerts && r.alerts.length) recs.push({ name, r });
  }
  const symbols = new Set(recs.flatMap(x => x.r.alerts.map(a => a.s)));
  const quotes = {};
  for (const s of symbols) {
    try {
      const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s));
      u.searchParams.set('range', '1d'); u.searchParams.set('interval', '1d');
      const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' } })).json();
      const m = j.chart.result[0].meta;
      const prev = m.chartPreviousClose ?? m.previousClose;
      quotes[s] = { price: m.regularMarketPrice, pct: prev ? (m.regularMarketPrice / prev - 1) * 100 : NaN, ccy: m.currency };
    } catch (e) { /* symbole indisponible : réessayé au prochain passage */ }
  }
  for (const { name, r } of recs) {
    const keep = [], hits = [];
    for (const a of r.alerts) {
      const q = quotes[a.s];
      const hit = q && isFinite(q.price) && ((a.k === 'above' && q.price >= a.v) || (a.k === 'below' && q.price <= a.v)
        || (a.k === 'dayUp' && q.pct >= a.v) || (a.k === 'dayDown' && q.pct <= -a.v));
      if (hit) hits.push({ a, q }); else keep.push(a);
    }
    if (!hits.length) continue;
    let gone = false;
    for (const { a, q } of hits) {
      const sign = q.pct > 0 ? '+' : '';
      const status = await sendPush(env, r.sub, { title: '🔔 Alerte APIstock', body: `${a.t} — cours ${q.price.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${q.ccy || ''} (${sign}${q.pct.toFixed(2).replace('.', ',')} %)`, tag: 'alert-' + a.id });
      if (status === 404 || status === 410) { gone = true; break; }
      r.fired = r.fired || {};
      r.fired[a.id] = { at: Date.now(), price: q.price };
    }
    if (gone) { await env.SYNC.delete(name); continue; }
    r.alerts = keep;
    await env.SYNC.put(name, JSON.stringify(r), { expirationTtl: PUSH_TTL });
  }
}

/* ---- Statistiques du jour via l'API GraphQL Analytics de Cloudflare ---- */
const STATS_TTL = 60000; // une interrogation par minute au plus (par instance du worker)
let statsCache = null;

async function dailyStats(env) {
  if (!env || !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false };
  if (statsCache && Date.now() - statsCache.at < STATS_TTL) return statsCache.data;
  const now = new Date();
  // le quota gratuit (100 000 requêtes/jour) est remis à zéro à minuit UTC
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const query = `query ($account: string!, $start: Time!, $end: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum { requests errors }
        dimensions { scriptName }
      }
    } }
  }`;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, start: start.toISOString(), end: now.toISOString() } }),
  });
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
  const acc = j.data && j.data.viewer && j.data.viewer.accounts && j.data.viewer.accounts[0];
  const rows = (acc && acc.workersInvocationsAdaptive) || [];
  const script = env.SCRIPT_NAME || 'apistock-yahoo';
  let worker = 0, account = 0, errors = 0;
  for (const row of rows) {
    account += row.sum.requests;
    if (row.dimensions.scriptName === script) { worker += row.sum.requests; errors += row.sum.errors; }
  }
  const data = { configured: true, date: start.toISOString().slice(0, 10), worker, account, errors, quota: 100000, at: now.toISOString() };
  statsCache = { at: Date.now(), data };
  return data;
}

/* ---- Synchronisation chiffrée (Workers KV, binding « SYNC ») ---- */
const SYNC_ID_RE = /^[a-f0-9]{64}$/;
const SYNC_MAX = 512 * 1024; // 512 Ko de données chiffrées au maximum

async function handleSync(request, q, env, cors) {
  if (!env || !env.SYNC) return json({ configured: false }, 200, cors);
  const id = q.get('id') || '';
  if (!SYNC_ID_RE.test(id)) return json({ error: 'identifiant invalide' }, 400, cors);
  const kvKey = 'sync:' + id;
  if (request.method === 'GET') {
    const cur = await env.SYNC.get(kvKey, 'json');
    return json(cur ? Object.assign({ configured: true }, cur) : { configured: true, empty: true }, 200, cors);
  }
  const text = await request.text();
  if (text.length > SYNC_MAX) return json({ error: 'données trop volumineuses' }, 413, cors);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'JSON invalide' }, 400, cors); }
  if (typeof body.data !== 'string' || typeof body.iv !== 'string' || !isFinite(body.updatedAt)) return json({ error: 'requête invalide' }, 400, cors);
  const cur = await env.SYNC.get(kvKey, 'json');
  // contrôle de version : on refuse d'écraser une version plus récente que celle connue de l'appareil
  if (cur && !body.force && cur.updatedAt !== body.base) return json({ configured: true, conflict: true, updatedAt: cur.updatedAt }, 409, cors);
  const rec = { data: body.data, iv: body.iv, updatedAt: Number(body.updatedAt), device: String(body.device || '').slice(0, 60) };
  await env.SYNC.put(kvKey, JSON.stringify(rec));
  return json({ configured: true, ok: true, updatedAt: rec.updatedAt }, 200, cors);
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, {});
    const cors = { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: Object.assign({
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, cors) });
    const q = new URL(request.url).searchParams;
    if (['pushkey', 'push-sync', 'push-delete', 'push-test'].includes(q.get('type'))) {
      try { return await handlePush(request, q, env, cors); }
      catch (e) { return json({ error: 'notifications push indisponibles : ' + e.message }, 500, cors); }
    }
    if (q.get('type') === 'sync' && (request.method === 'GET' || request.method === 'POST')) {
      try { return await handleSync(request, q, env, cors); }
      catch (e) { return json({ error: 'synchronisation indisponible : ' + e.message }, 500, cors); }
    }
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);

    if (q.get('type') === 'ping') return json({ ok: true }, 200, cors);
    if (q.get('type') === 'stats') {
      try { return json(await dailyStats(env), 200, cors); }
      catch (e) { return json({ configured: true, error: 'statistiques indisponibles : ' + e.message }, 200, cors); }
    }
    const upstream = buildUpstream(q);
    if (!upstream) return json({ error: 'requête invalide' }, 400, cors);

    try {
      const r = await fetch(upstream, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' },
        cf: { cacheTtl: q.get('type') === 'search' ? 86400 : q.get('type') === 'news' ? 600 : 1, cacheEverything: true }, // 1 s : compatible avec le rafraîchissement chaque seconde
      });
      return new Response(await r.text(), { status: r.status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
    } catch (e) {
      return json({ error: 'Yahoo injoignable : ' + e.message }, 502, cors);
    }
  },

  // Cron Trigger (toutes les 5 minutes) : alertes de prix push
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlerts(env));
  },
};
