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
 * Appels Yahoo autorisés, en lecture seule : graphique/cotation (avec dividendes et divisions), cotations groupées (type=quotes, 40 symboles par requête), dates de résultats des sociétés (type=calendar) et autres données publiques des sociétés et des ETF (type=summary), recherche, actualités en français (flux RSS Yahoo Finance France et Google Actualités) et image des articles.
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
 *   non chiffrées (le worker doit pouvoir les lire pour les vérifier) ; rien d'autre de ton portefeuille, sauf si tu
 *   actives le résumé de la semaine : la part (en %) de chaque ligne, sans aucun montant.
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
  if (type === 'search' || type === 'yahoo-news') {
    const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
    u.searchParams.set('q', (q.get('q') || '').slice(0, 60));
    u.searchParams.set('quotesCount', type === 'yahoo-news' ? '0' : '20');
    u.searchParams.set('newsCount', type === 'yahoo-news' ? '10' : '0');
    return u;
  }
  return null;
}

/*
 * Appel groupé : ?type=quotes&symbols=A,B,C (40 symboles au plus) → { results: { A: <réponse chart Yahoo>, B: null… } }
 * Le worker interroge Yahoo pour chaque symbole (cours du jour en 5 min, comme type=chart&range=1d&interval=5m)
 * mais ne compte qu'une requête sur le quota gratuit (100 000/jour) : de quoi tenir le rafraîchissement à la seconde.
 * Les réponses de Yahoo sont recopiées telles quelles (pas d'analyse JSON : peu de temps de calcul).
 */
const BATCH_MAX = 40; // plan gratuit Cloudflare : 50 sous-requêtes au plus par appel
async function handleQuotes(q, cors) {
  const syms = Array.from(new Set((q.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean)));
  if (!syms.length || syms.length > BATCH_MAX || !syms.every(s => SYMBOL_RE.test(s))) return json({ error: 'requête invalide' }, 400, cors);
  const parts = await Promise.all(syms.map(async s => {
    const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s));
    u.searchParams.set('range', '1d');
    u.searchParams.set('interval', '5m');
    u.searchParams.set('includePrePost', 'false');
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' }, cf: { cacheTtl: 1, cacheEverything: true } });
      const t = (await r.text()).trim();
      return t.startsWith('{') && t.endsWith('}') ? t : null;
    } catch (e) { return null; }
  }));
  const body = '{"results":{' + syms.map((s, i) => JSON.stringify(s) + ':' + (parts[i] || 'null')).join(',') + '}}';
  return new Response(body, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}

/*
 * Dates de résultats : ?type=calendar&symbols=A,B (20 symboles au plus) → { results: { A: { calendarEvents, earnings } | null } }
 * Plus général : ?type=summary&symbols=A,B&modules=topHoldings,… (modules de SUMMARY_MODULES, 6 au plus), par exemple
 * les principales lignes d'un ETF.
 * Prochaine publication trimestrielle (date, bénéfice par action et chiffre d'affaires attendus par les analystes)
 * et derniers trimestres publiés (bénéfice réel contre attendu). Données « quoteSummary » de Yahoo, qui exige
 * un cookie et un jeton (« crumb ») : le relais les obtient lui-même et les garde en mémoire quelques heures.
 */
const CAL_MAX = 20;
const UA = 'Mozilla/5.0 (compatible; APIstock/1.0)';
let yahooAuth = null; // { cookie, crumb, ts }
/*
 * Jeton partagé entre les instances du worker via le cache Cloudflare (sinon chaque instance redemande un jeton,
 * et Yahoo finit par répondre « Too Many Requests ») ; sur Vercel, simple mémoire de l'instance.
 */
const AUTH_TTL = 6 * 3600;
const authCache = () => (typeof globalThis.caches !== 'undefined' && globalThis.caches.default ? globalThis.caches.default : null);
const AUTH_KEY = 'https://apistock-cache/yahoo-auth-v1';
async function getYahooAuth(force) {
  if (!force && yahooAuth && Date.now() - yahooAuth.ts < AUTH_TTL * 1000) return yahooAuth;
  const cache = authCache();
  if (cache && !force) {
    try {
      const hit = await cache.match(AUTH_KEY);
      if (hit) { const a = await hit.json(); if (a && a.cookie && a.crumb) { yahooAuth = Object.assign(a, { ts: Date.now() }); return yahooAuth; } }
    } catch (e) { /* cache indisponible : on redemande un jeton */ }
  }
  const r = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join('; ') : (r.headers.get('set-cookie') || '');
  const cookie = (raw.match(/\bA3=[^;,\s]+/) || [])[0];
  if (!cookie) throw new Error('cookie Yahoo absent');
  let crumb = '';
  for (const host of ['query2', 'query1']) { // second serveur si le premier refuse (trop de demandes)
    const c = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie } });
    const t = (await c.text()).trim();
    if (c.ok && t && t.length <= 64 && !/[<{\s]/.test(t)) { crumb = t; break; }
  }
  if (!crumb) throw new Error('jeton Yahoo refusé');
  yahooAuth = { cookie, crumb, ts: Date.now() };
  if (cache) {
    try {
      await cache.put(AUTH_KEY, new Response(JSON.stringify({ cookie, crumb }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${AUTH_TTL}` } }));
    } catch (e) { /* tant pis : jeton gardé en mémoire */ }
  }
  return yahooAuth;
}
/* Modules « quoteSummary » autorisés (données publiques en lecture seule) pour ?type=summary&modules=… */
const SUMMARY_MODULES = new Set(['calendarEvents', 'earnings', 'earningsHistory', 'earningsTrend', 'topHoldings', 'fundProfile', 'price', 'insiderTransactions', 'netSharePurchaseActivity', 'insiderHolders',
  'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile', 'recommendationTrend', 'upgradeDowngradeHistory']);
async function summaryOne(sym, auth, modules) {
  const u = new URL('https://query2.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(sym));
  u.searchParams.set('modules', modules.join(','));
  u.searchParams.set('crumb', auth.crumb);
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: auth.cookie } });
  if (r.status === 401) return 'auth';
  const j = await r.json().catch(() => null);
  const res = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!res) return null; // ETF, indice… : pas de données pour ces modules
  if (res.earnings) delete res.earnings.financialsChart; // chiffres annuels : inutiles ici
  // listes très longues (près de 1 000 changements d'avis pour NVIDIA) : seulement les plus récents
  const recent = (list, n) => (Array.isArray(list) ? list.slice().sort((a, b) => (b.epochGradeDate || (b.startDate && b.startDate.raw) || 0) - (a.epochGradeDate || (a.startDate && a.startDate.raw) || 0)).slice(0, n) : list);
  if (res.upgradeDowngradeHistory) res.upgradeDowngradeHistory.history = recent(res.upgradeDowngradeHistory.history, 60);
  if (res.insiderTransactions) res.insiderTransactions.transactions = recent(res.insiderTransactions.transactions, 80);
  const out = {};
  for (const m of modules) out[m] = res[m] || null;
  return out;
}
async function summaryFor(symbols, modules = ['calendarEvents', 'earnings']) {
  let auth = await getYahooAuth();
  let out = await Promise.all(symbols.map(s => summaryOne(s, auth, modules).catch(() => null)));
  if (out.includes('auth')) { // jeton expiré : on en redemande un, une fois
    auth = await getYahooAuth(true);
    out = await Promise.all(symbols.map((s, i) => (out[i] === 'auth' ? summaryOne(s, auth, modules).catch(() => null) : out[i])));
  }
  const results = {};
  symbols.forEach((s, i) => { results[s] = out[i] === 'auth' ? null : out[i]; });
  return { results };
}
function summaryModules(raw) {
  const mods = Array.from(new Set(String(raw || '').split(',').map(s => s.trim()).filter(Boolean)));
  return mods.length && mods.length <= 6 && mods.every(m => SUMMARY_MODULES.has(m)) ? mods : null;
}
function calendarSymbols(raw) {
  const syms = Array.from(new Set(String(raw || '').split(',').map(s => s.trim()).filter(Boolean)));
  return syms.length && syms.length <= CAL_MAX && syms.every(s => SYMBOL_RE.test(s)) ? syms : null;
}

/* ---- Actualités en français : Yahoo Finance France et Google Actualités (RSS), Yahoo en anglais en secours ---- */
const decodeXml = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

const SITE_NAMES = { 'capital.fr': 'Capital', 'boursorama.com': 'Boursorama', 'zonebourse.com': 'Zonebourse', 'investing.com': 'Investing.com',
  'fr.investing.com': 'Investing.com France', 'lesechos.fr': 'Les Échos', 'investir.lesechos.fr': 'Investir', 'bfmtv.com': 'BFM Bourse', 'tradingsat.com': 'BFM Bourse',
  'lefigaro.fr': 'Le Figaro', 'lemonde.fr': 'Le Monde', 'latribune.fr': 'La Tribune', 'finance.yahoo.com': 'Yahoo Finance', 'fr.finance.yahoo.com': 'Yahoo Finance',
  'abcbourse.com': 'ABC Bourse', 'cercledelepargne.com': 'Cercle de l\'Épargne', 'journaldunet.com': 'Journal du Net', 'challenges.fr': 'Challenges', 'reuters.com': 'Reuters' };
function siteName(link) {
  try {
    const h = new URL(link).hostname.replace(/^www\./, '');
    return SITE_NAMES[h] || SITE_NAMES[h.split('.').slice(-2).join('.')] || h;
  } catch (e) { return ''; }
}

/** Articles d'un flux RSS (Google Actualités ou Yahoo Finance) */
function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = t => { const x = m[1].match(new RegExp('<' + t + '(?: [^>]*)?>([\\s\\S]*?)<\\/' + t + '>')); return x ? decodeXml(x[1]).trim() : ''; };
    const link = tag('link').replace(/\?\.tsrc=rss$/, '');
    const source = tag('source') || siteName(link);
    let title = tag('title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    if (!title || !/^https:\/\//.test(link)) continue;
    out.push({ uuid: tag('guid') || link, title, link, publisher: source, providerPublishTime: Math.floor(Date.parse(tag('pubDate')) / 1000) || 0 });
    if (out.length >= 15) break;
  }
  return out;
}

async function rss(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow' });
  return r.ok ? parseRss(await r.text()) : [];
}

/**
 * Actualités en français : flux RSS France de Yahoo Finance pour les symboles donnés (s), puis Google Actualités (q),
 * et en dernier recours la recherche Yahoo en anglais (en).
 */
async function newsFor(q) {
  const query = String(q.q || '').slice(0, 80).trim();
  const syms = String(q.s || '').split(',').map(x => x.trim()).filter(x => SYMBOL_RE.test(x)).slice(0, 5);
  const tried = [];
  if (syms.length) {
    try {
      const u = new URL('https://feeds.finance.yahoo.com/rss/2.0/headline');
      u.searchParams.set('s', syms.join(',')); u.searchParams.set('region', 'FR'); u.searchParams.set('lang', 'fr-FR');
      const items = await rss(u);
      if (items.length >= 3) return { lang: 'fr', source: 'yahoo-fr', news: items };
      tried.push('yahoo-fr:' + items.length);
    } catch (e) { tried.push('yahoo-fr:' + e.message); }
  }
  if (query) {
    try {
      const u = new URL('https://news.google.com/rss/search');
      u.searchParams.set('q', query + ' when:14d');
      u.searchParams.set('hl', 'fr'); u.searchParams.set('gl', 'FR'); u.searchParams.set('ceid', 'FR:fr');
      const items = await rss(u);
      if (items.length) return { lang: 'fr', source: 'google', news: items };
      tried.push('google:0');
    } catch (e) { tried.push('google:' + e.message); }
  }
  const y = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  y.searchParams.set('q', String(q.en || query || syms[0] || '').slice(0, 60)); y.searchParams.set('quotesCount', '0'); y.searchParams.set('newsCount', '10');
  const j = await (await fetch(y, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' } })).json();
  return { lang: 'en', source: 'yahoo-en', tried, news: j.news || [] };
}

async function handleNews(q, cors) {
  const params = { q: q.get('q') || '', s: q.get('s') || '', en: q.get('en') || '' };
  if (!params.q.trim() && !params.s.trim()) return json({ error: 'requête invalide' }, 400, cors);
  return json(await newsFor(params), 200, Object.assign({ 'Cache-Control': 'public, max-age=600' }, cors));
}

/* ---- Image d'un article (balise og:image de sa page), pour les vignettes des actualités ---- */
const GENERIC_IMG = /default[-_]?logo|yahoo_default|\/logo[^/]*\.(png|svg)|googleusercontent\.com\/[^/]*=s0|gstatic\.com|favicon/i;

async function articleImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow' });
  if (!r.ok || !r.body || !/html/i.test(r.headers.get('content-type') || '')) return null;
  // lecture progressive : on s'arrête dès que la balise est trouvée (au plus 400 Ko)
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let html = '', found = null;
  while (html.length < 400000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    const metas = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/gi) || [];
    for (const m of metas) {
      const c = (m.match(/content=["']([^"']+)["']/i) || [])[1];
      if (c && !GENERIC_IMG.test(c)) { found = c.replace(/&amp;/g, '&'); break; }
    }
    if (found || /<\/head>/i.test(html)) break;
  }
  try { reader.cancel(); } catch (e) { /* ignore */ }
  if (!found) return null;
  try { const u = new URL(found, url); return u.protocol === 'https:' ? u.toString() : null; } catch (e) { return null; }
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
  const digest = cleanDigest(body.digest);
  await env.SYNC.put(kvKey, JSON.stringify({ sub: { endpoint: body.sub.endpoint, keys: { p256dh: body.sub.keys.p256dh, auth: body.sub.keys.auth } }, alerts, fired: {},
    digest, digestSent: (cur && cur.digestSent) || '', updatedAt: Date.now() }), { expirationTtl: PUSH_TTL });
  return json({ configured: true, ok: true, fired, count: alerts.length, digest: !!digest }, 200, cors);
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

/*
 * ---- Résumé de la semaine (push, le vendredi soir) ----
 * L'appareil transmet seulement la part de chaque ligne (en %, sans aucun montant), son symbole Yahoo, sa devise
 * et un nom court ; le worker calcule la performance de la semaine (cours et devises) et la compare au MSCI World.
 */
const DIGEST_BENCH = { s: 'IWDA.AS', c: 'EUR', n: 'MSCI World' };
const CCY_RE = /^[A-Z]{3}$/;

/** Résumé demandé par l'appareil, nettoyé ; null si désactivé ou invalide */
function cleanDigest(d) {
  if (!d || d.on !== true || !CCY_RE.test(d.base || '') || !Array.isArray(d.lines)) return null;
  const lines = d.lines.slice(0, 40)
    .filter(l => l && SYMBOL_RE.test(l.s || '') && isFinite(l.w) && l.w > 0 && l.w <= 1 && CCY_RE.test(l.c || ''))
    .map(l => ({ s: l.s, w: Math.round(Number(l.w) * 10000) / 10000, c: l.c, n: String(l.n || l.s).slice(0, 30) }));
  return lines.length ? { on: true, base: d.base, lines } : null;
}

/** Heure de Paris : { day: 1 (lundi) … 7, hm: 'HH:MM', date: 'AAAA-MM-JJ' } */
function parisNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(x => [x.type, x.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { day, hm: p.hour + ':' + p.minute, date: `${p.year}-${p.month}-${p.day}` };
}

/** Semaine à résumer : le vendredi de 18 h 30 au dimanche (clé : date du vendredi), sinon null */
function digestWeek(now = new Date()) {
  const t = parisNow(now);
  if (!((t.day === 5 && t.hm >= '18:30') || t.day === 6 || t.day === 7)) return null;
  const d = new Date(t.date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - (t.day - 5));
  return d.toISOString().slice(0, 10);
}

/** Rendement sur 7 jours d'une série [[date, cours]] : dernier cours face au dernier cours d'au moins 7 jours avant */
function weekReturn(series) {
  if (!series || series.length < 2) return NaN;
  const [lastD, last] = series[series.length - 1];
  const limit = new Date(Date.parse(lastD + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
  let base = NaN;
  for (const [d, v] of series) if (d <= limit) base = v;
  return base > 0 && last > 0 ? last / base - 1 : NaN;
}

/** Résumé d'un appareil : rendements par symbole (`ret`, en devise de cotation) et par devise (`fx`, vers la devise de base) */
function digestSummary(digest, ret, fx) {
  let sum = 0, cover = 0;
  const lines = [];
  for (const l of digest.lines) {
    const r = ret[l.s], f = l.c === digest.base ? 0 : fx[l.c + digest.base];
    if (!isFinite(r) || !isFinite(f)) continue;
    const total = (1 + r) * (1 + f) - 1;
    sum += l.w * total; cover += l.w;
    lines.push({ n: l.n, r: total, contrib: l.w * total });
  }
  if (!(cover > 0)) return null;
  const perf = sum / cover;
  const br = ret[DIGEST_BENCH.s], bf = DIGEST_BENCH.c === digest.base ? 0 : fx[DIGEST_BENCH.c + digest.base];
  const bench = isFinite(br) && isFinite(bf) ? (1 + br) * (1 + bf) - 1 : NaN;
  lines.sort((a, b) => b.r - a.r); // ligne qui a le plus monté, et celle qui a le moins bien fait
  return { perf, bench, cover, best: lines[0], worst: lines.length > 1 ? lines[lines.length - 1] : null };
}

const pctFr = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(1).replace('.', ',') + ' %';

function digestText(s) {
  const parts = [`Portefeuille ${pctFr(s.perf)}`];
  if (isFinite(s.bench)) parts.push(`${DIGEST_BENCH.n} ${pctFr(s.bench)}`);
  const lines = [parts.join(' · ')];
  if (s.best) lines.push(`En tête : ${s.best.n} ${pctFr(s.best.r)}` + (s.worst ? ` · en retrait : ${s.worst.n} ${pctFr(s.worst.r)}` : ''));
  if (s.cover < 0.95) lines.push(`(sur ${Math.round(s.cover * 100)} % de tes lignes)`);
  return lines.join('\n');
}

async function dailyCloses(sym) {
  const u = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym));
  u.searchParams.set('range', '1mo'); u.searchParams.set('interval', '1d');
  const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' } })).json();
  const r = j.chart.result[0];
  const close = (r.indicators.quote[0] || {}).close || [];
  const off = (r.meta.gmtoffset || 0) * 1000;
  return (r.timestamp || []).map((t, i) => [new Date(t * 1000 + off).toISOString().slice(0, 10), close[i]]).filter(x => x[1] !== null && isFinite(x[1]));
}

/** Tâche planifiée : résumé de la semaine envoyé une fois, le vendredi soir (ou au plus tard le week-end) */
async function weeklyDigests(env, now = new Date()) {
  if (!pushReady(env)) return 0;
  const week = digestWeek(now);
  if (!week) return 0;
  // semaine déjà traitée : une seule lecture au lieu de parcourir la liste toutes les 5 minutes du week-end
  if (await env.SYNC.get('digest-done') === week) return 0;
  const names = [];
  let cursor;
  do {
    const page = await env.SYNC.list({ prefix: 'push:', cursor });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const recs = [];
  for (const name of names) {
    const r = await env.SYNC.get(name, 'json');
    if (r && r.digest && r.digestSent !== week) recs.push({ name, r });
  }
  if (!recs.length) { await env.SYNC.put('digest-done', week, { expirationTtl: 8 * 86400 }); return 0; }
  const syms = new Set([DIGEST_BENCH.s]), pairs = new Set();
  for (const { r } of recs) for (const l of r.digest.lines) { syms.add(l.s); if (l.c !== r.digest.base) pairs.add(l.c + r.digest.base); }
  for (const { r } of recs) if (DIGEST_BENCH.c !== r.digest.base) pairs.add(DIGEST_BENCH.c + r.digest.base);
  const ret = {}, fx = {};
  for (const s of syms) { try { ret[s] = weekReturn(await dailyCloses(s)); } catch (e) { /* indisponible */ } }
  for (const p of pairs) { try { fx[p] = weekReturn(await dailyCloses(p + '=X')); } catch (e) { /* indisponible */ } }
  let sent = 0;
  for (const { name, r } of recs) {
    const s = digestSummary(r.digest, ret, fx);
    r.digestSent = week;
    if (s) {
      const status = await sendPush(env, r.sub, { title: '📈 Ta semaine en bourse', body: digestText(s), tag: 'digest-' + week });
      if (status === 404 || status === 410) { await env.SYNC.delete(name); continue; }
      sent++;
    }
    await env.SYNC.put(name, JSON.stringify(r), { expirationTtl: PUSH_TTL });
  }
  await env.SYNC.put('digest-done', week, { expirationTtl: 8 * 86400 });
  return sent;
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
    if (q.get('type') === 'quotes') return handleQuotes(q, cors);
    if (q.get('type') === 'calendar' || q.get('type') === 'summary') {
      const syms = calendarSymbols(q.get('symbols'));
      const mods = q.get('type') === 'summary' ? summaryModules(q.get('modules')) : ['calendarEvents', 'earnings'];
      if (!syms || !mods) return json({ error: 'requête invalide' }, 400, cors);
      try { return json(await summaryFor(syms, mods), 200, Object.assign({ 'Cache-Control': 'public, max-age=3600' }, cors)); }
      catch (e) { return json({ error: 'données Yahoo indisponibles : ' + e.message }, 502, cors); }
    }
    if (q.get('type') === 'ogimage') {
      // redirige vers l'image de l'article (mise en cache une journée), 404 s'il n'en a pas
      let target;
      try { target = new URL(q.get('url') || ''); } catch (e) { return json({ error: 'requête invalide' }, 400, cors); }
      if (target.protocol !== 'https:') return json({ error: 'requête invalide' }, 400, cors);
      const cache = caches.default;
      const ck = new Request('https://apistock-cache/ogimage?u=' + encodeURIComponent(target.toString()));
      const hit = await cache.match(ck);
      if (hit) return hit;
      let img = null;
      try { img = await articleImage(target.toString()); } catch (e) { img = null; }
      const res = img ? new Response(null, { status: 302, headers: Object.assign({ Location: img, 'Cache-Control': 'public, max-age=86400' }, cors) })
        : new Response('', { status: 404, headers: Object.assign({ 'Cache-Control': 'public, max-age=86400' }, cors) });
      await cache.put(ck, res.clone());
      return res;
    }
    if (q.get('type') === 'news') {
      try { return await handleNews(q, cors); }
      catch (e) { return json({ error: 'actualités indisponibles : ' + e.message }, 502, cors); }
    }
    if (q.get('type') === 'stats') {
      try { return json(await dailyStats(env), 200, cors); }
      catch (e) { return json({ configured: true, error: 'statistiques indisponibles : ' + e.message }, 200, cors); }
    }
    const upstream = buildUpstream(q);
    if (!upstream) return json({ error: 'requête invalide' }, 400, cors);

    try {
      const r = await fetch(upstream, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; APIstock/1.0)', Accept: 'application/json' },
        cf: { cacheTtl: q.get('type') === 'search' ? 86400 : q.get('type') === 'yahoo-news' ? 600 : 1, cacheEverything: true }, // 1 s : compatible avec le rafraîchissement chaque seconde
      });
      return new Response(await r.text(), { status: r.status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
    } catch (e) {
      return json({ error: 'Yahoo injoignable : ' + e.message }, 502, cors);
    }
  },

  // Cron Trigger (toutes les 5 minutes) : alertes de prix push, et le vendredi soir le résumé de la semaine
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlerts(env).catch(() => {}).then(() => weeklyDigests(env)));
  },
};
