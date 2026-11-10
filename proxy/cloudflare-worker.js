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
 * Seuls deux appels en lecture sont autorisés : graphique/cotation et recherche.
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
    return u;
  }
  if (type === 'search') {
    const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
    u.searchParams.set('q', (q.get('q') || '').slice(0, 40));
    u.searchParams.set('quotesCount', '20');
    u.searchParams.set('newsCount', '0');
    return u;
  }
  return null;
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
        cf: { cacheTtl: q.get('type') === 'search' ? 86400 : 1, cacheEverything: true }, // 1 s : compatible avec le rafraîchissement chaque seconde
      });
      return new Response(await r.text(), { status: r.status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
    } catch (e) {
      return json({ error: 'Yahoo injoignable : ' + e.message }, 502, cors);
    }
  },
};
