/* Analyses : risque du portefeuille, rééquilibrage, dividendes à venir, actualités, rapport annuel, alertes push */
'use strict';

const RISK_BENCH = { ysym: 'IWDA.AS', name: 'MSCI World (iShares IWDA, en €)' };
/* Sujets d'actualité par type d'ETF : recherche en français (Google Actualités) et en anglais (Yahoo, en secours) */
const NEWS_TOPIC = { // [recherche en français, recherche en anglais, symboles Yahoo pour le flux d'actualités France]
  world: ['MSCI World', 'MSCI World', '^GSPC,^STOXX,^N225'], allworld: ['ETF monde bourse', 'FTSE All-World', '^GSPC,^STOXX,^N225,EEM'],
  sp500: ['S&P 500', 'S&P 500', '^GSPC'], ndx: ['Nasdaq', 'Nasdaq 100', '^IXIC,^NDX'], em: ['marchés émergents bourse', 'emerging markets stocks', 'EEM,^HSI'],
  europe: ['bourses européennes', 'Stoxx 600', '^STOXX'], es50: ['Euro Stoxx 50', 'Euro Stoxx 50', '^STOXX50E'], cac: ['CAC 40', 'CAC 40', '^FCHI'],
  japan: ['bourse de Tokyo Nikkei', 'Nikkei', '^N225'], gold: ['cours de l\'or', 'gold price', 'GC=F'], crypto: ['Bitcoin', 'Bitcoin', 'BTC-EUR'],
};
/* Repli quand aucune source française ne parle d'une valeur : actualité générale de Paris et Wall Street */
const NEWS_GENERAL = { fr: 'Bourse de Paris CAC 40', en: 'stock market', s: '^FCHI,^GSPC', label: 'Marchés', theme: 'markets' };

Object.assign(Api, {
  newsCache: {},
  /** Actualités (en français via Google Actualités, sinon Yahoo en anglais), mises en cache 15 min */
  async news(topic) {
    const q = topic.fr, ck = q + '|' + topic.en + '|' + (topic.s || '');
    const c = this.newsCache[ck];
    if (c && Date.now() - c.ts < 15 * 60000) return c.items;
    let json;
    try { json = await this.yahoo({ type: 'news', q, en: topic.en, s: topic.s }); }
    catch (e) {
      if (/invalide/.test(e.message)) throw new ApiError('Le relais en ligne ne gère pas encore les actualités : redéploie le worker Cloudflare (voir le README).', 0);
      throw e;
    }
    // ancien relais : réponse Yahoo brute, sans champ « lang »
    const lang = json.lang || 'en';
    // certaines sources n'ont qu'une adresse comme nom : « https://www.exemple.fr/ » ou « fr.beincrypto.com » → nom lisible
    const SITES = { 'beincrypto.com': 'BeInCrypto', 'cointribune.com': 'Cointribune', 'zonebourse.com': 'Zonebourse', 'boursorama.com': 'Boursorama',
      'lesechos.fr': 'Les Échos', 'capital.fr': 'Capital', 'investing.com': 'Investing.com', 'boursier.com': 'Boursier.com' };
    const pubName = p => {
      p = (p || '').trim();
      if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(p)) return p;
      const host = p.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^(www|fr)\./, '');
      return SITES[host] || host;
    };
    const items = (json.news || []).filter(n => n.title && /^https:\/\//.test(n.link || '')).map(n => ({
      id: n.uuid || n.link, title: n.title, publisher: pubName(n.publisher), link: n.link, time: (n.providerPublishTime || 0) * 1000, lang,
    }));
    this.newsCache[ck] = { ts: Date.now(), items };
    return items;
  },
});

/** « il y a 3 h », « hier », « 12 nov. » */
function fmtAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return 'il y a ' + Math.max(1, Math.round(s / 60)) + ' min';
  if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
  if (s < 2 * 86400) return 'hier';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

Object.assign(App, {
  /* ================================================================== */
  /* RISQUE DU PORTEFEUILLE                                               */
  /* ================================================================== */
  renderRiskCard() {
    const card = $('#riskCard');
    if (!card) return;
    const has = Portfolio.txs().some(t => t.type === 'buy');
    card.classList.toggle('hidden', !has);
    if (!has || this._riskShown === (Store.state.accountFilter || 'all')) return;
    $('#riskBody').replaceChildren(el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => this.loadHistory() }, 'Calculer le risque')));
  },

  async renderRisk(twr, start) {
    const box = $('#riskBody');
    if (!box) return;
    this._riskShown = Store.state.accountFilter || 'all';
    const st = Portfolio.riskStats(twr, Store.state.settings.riskFree ?? 2);
    if (!st || st.years < 1 / 12) {
      box.replaceChildren(el('p', { class: 'muted' }, 'Pas assez de recul (moins d\'un mois d\'historique) pour mesurer le risque.'));
      return;
    }
    let bench = null;
    if (Api.hasProxy()) {
      try { bench = Portfolio.beta(twr, await Api.daily('Y:' + RISK_BENCH.ysym, start)); } catch (e) { bench = null; }
    }
    const volTxt = st.vol < 0.08 ? 'faible' : st.vol < 0.15 ? 'modérée' : st.vol < 0.22 ? 'celle des actions' : 'élevée';
    const sharpeTxt = !isFinite(st.sharpe) ? 'au moins 6 mois d\'historique requis' : st.sharpe < 0 ? 'moins bien qu\'un placement sans risque' : st.sharpe < 0.5 ? 'rémunération du risque faible' : st.sharpe < 1 ? 'correcte' : 'très bonne';
    const betaTxt = !bench || !isFinite(bench.beta) ? '' : bench.beta > 1.1 ? 'amplifie les mouvements du marché' : bench.beta < 0.9 ? 'amortit les mouvements du marché' : 'suit le marché';
    box.replaceChildren(
      el('div', { class: 'kpis' },
        this.kpi('Volatilité annuelle', fmtPct(st.vol * 100, 1, false), 'Variabilité ' + volTxt + (st.vol >= 0.15 ? ' (MSCI World ≈ 15 %)' : '')),
        this.kpi('Pire baisse', fmtPct(st.mdd * 100, 1), st.mdd < 0 ? `du ${fmtDate(st.mddPeak)} au ${fmtDate(st.mddTrough)}` : 'aucune baisse', st.mdd < -0.005 ? 'down' : ''),
        this.kpi('Performance annualisée', isFinite(st.cagr) ? fmtPct(st.cagr * 100) : fmtPct(st.perf * 100), isFinite(st.cagr) ? 'pondérée dans le temps (TWR)' : 'sur la période (moins de 6 mois)', trendClass(isFinite(st.cagr) ? st.cagr : st.perf)),
        this.kpi('Ratio de Sharpe', fmtNum(st.sharpe, 2), sharpeTxt, isFinite(st.sharpe) ? (st.sharpe >= 0.5 ? 'up' : st.sharpe < 0 ? 'down' : '') : ''),
        this.kpi('Ratio de Sortino', fmtNum(st.sortino, 2), 'comme Sharpe, mais ne compte que les baisses'),
        bench && isFinite(bench.beta) ? this.kpi('Bêta vs MSCI World', fmtNum(bench.beta, 2), betaTxt + ' · corrélation ' + fmtNum(bench.corr, 2)) : null),
      noteTip(`Sur ${fmtSpan(twr[0][0], twr[twr.length - 1][0])} · ${fmtPct(st.positiveDays * 100, 0, false)} de jours en hausse · taux sans risque ${fmtNum(Store.state.settings.riskFree ?? 2, 1)} % (Réglages)`
        + (bench && isFinite(bench.beta) ? ` · indice de référence : ${RISK_BENCH.name}` : '') + '. Les mesures passées ne prédisent pas les variations futures.', 'Période et méthode'));
  },

  /* ================================================================== */
  /* RÉÉQUILIBRAGE                                                        */
  /* ================================================================== */
  rebalState() {
    Store.state.rebalance = Store.state.rebalance || { threshold: 5 };
    return Store.state.rebalance;
  },

  /** Analyse de l'écart à la cible : null si l'allocation cible n'est pas exploitable */
  rebalanceInfo() {
    const lines = this.investLines();
    const tgtSum = lines.reduce((a, l) => a + l.target, 0);
    if (!lines.length || Math.abs(tgtSum - 100) > 0.05) return null;
    const total = lines.reduce((a, l) => a + l.value, 0);
    if (!(total > 0)) return null;
    const drift = Portfolio.drift(lines);
    const amount = Portfolio.rebalanceAmount(lines);
    const priced = lines.every(l => !(l.target > 0) || l.unitPrice > 0);
    const plan = amount > 0.5 && priced ? Portfolio.plan(lines, amount, { fractional: true }) : null;
    const orphans = lines.filter(l => !(l.target > 0) && l.value > 0);
    return { lines, drift, amount, plan, orphans, total };
  },

  renderRebalance() {
    const box = $('#rebalBox');
    if (!box) return;
    const r = this.rebalState();
    const info = this.rebalanceInfo();
    const cur = this.base();
    const input = el('input', { type: 'number', min: 0, max: 50, step: 0.5, value: r.threshold, class: 'pct-input' });
    input.addEventListener('change', () => { r.threshold = Math.max(0, parseNum(input.value) || 0); Store.save(); this.renderRebalance(); this.renderTodo(true); });
    const head = el('div', { class: 'rebal-head' },
      el('h3', {}, 'Rééquilibrage sans vente', infoTip('Comment revenir à ta cible en achetant seulement : pas de vente, donc pas d\'impôt sur un compte-titres. L\'alerte apparaît dans « À faire » quand une ligne s\'écarte de sa cible de plus du seuil (0 = jamais).')),
      el('label', { class: 'inline small' }, 'Alerte à', input, 'pt d\'écart'));
    if (!info) { box.replaceChildren(head, el('p', { class: 'muted small' }, 'Disponible dès que ta cible fait 100 %.')); return; }
    const worst = info.drift.lines.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
    const off = r.threshold > 0 && info.drift.max >= r.threshold;
    const buys = info.plan ? info.plan.lines.filter(o => o.trade > 0.5) : [];
    box.replaceChildren(...[head,
      el('p', { class: off ? 'down' : 'muted' }, off
        ? `⚠ ${Store.label(worst.key)} s'écarte de ${fmtNum(Math.abs(worst.gap), 1)} pt de sa cible (${fmtPct(worst.weight, 1, false)} au lieu de ${fmtPct(worst.target, 1, false)}).`
        : `Écart maximal actuel : ${fmtNum(info.drift.max, 1)} pt` + (worst ? ` (${Store.label(worst.key)})` : '') + (r.threshold > 0 ? ' — sous ton seuil.' : '.')),
      info.amount > 0.5 ? el('div', {},
        el('p', {}, 'Pour revenir exactement à la cible sans rien vendre, il faudrait investir ', el('b', { class: 'mono' }, fmtMoney(info.amount, cur, 0)), ' :'),
        buys.length ? el('ul', { class: 'rebal-list' }, ...buys.map(o => el('li', {}, el('span', { class: 'sym' }, Store.label(o.key)), ' ', el('b', { class: 'mono' }, fmtMoney(o.trade, cur, 0)),
          el('span', { class: 'muted small' }, ` ≈ ${fmtNum(o.trade / o.unitPrice, o.trade / o.unitPrice < 10 ? 2 : 0)} part(s)`)))) : el('p', { class: 'muted small' }, 'Cours manquants : clique sur ↻ pour les charger.'),
        el('div', { class: 'actions' },
          el('button', { class: 'btn small', onclick: () => {
            const p = Store.state.plan; p.amount = Math.ceil(info.amount); $('#planAmount').value = p.amount; Store.save(); this.renderPlan();
            $('#planResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
          } }, 'Utiliser ce montant dans le plan ci-dessous'),
          Store.state.plan && Store.state.plan.amount > 0 ? el('span', { class: 'muted small' }, `Avec ${fmtMoney(Store.state.plan.amount, cur, 0)} par mois, il faut ≈ ${Math.ceil(info.amount / Store.state.plan.amount)} mois de versements orientés vers les lignes en retard.`) : null))
        : el('p', { class: 'up small' }, '✔ Aucune ligne au-dessus de sa cible.'),
      info.orphans.length ? el('p', { class: 'muted small' }, `Sans cible : ${info.orphans.map(l => Store.label(l.key)).join(', ')} (non pris en compte ; donne-leur une cible ou vends-les pour respecter l'allocation).`) : null].filter(Boolean));
  },

  rebalanceTodo() {
    const r = this.rebalState();
    if (!(r.threshold > 0)) return null;
    const info = this.rebalanceInfo();
    if (!info || info.drift.max < r.threshold) return null;
    const id = 'rebal:' + todayISO().slice(0, 7);
    if ((Store.state.dismissed || {})[id]) return null;
    const worst = info.drift.lines.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
    return { id, icon: '⚖️', cls: 'rebal', title: `Allocation déséquilibrée · ${Store.label(worst.key)} ${worst.gap > 0 ? '+' : ''}${fmtNum(worst.gap, 1)} pt par rapport à sa cible`,
      sub: info.amount > 0.5 ? `Pour revenir à la cible sans vendre : investir ≈ ${fmtMoney(info.amount, this.base(), 0)} sur les lignes en retard.` : 'Seule une vente permettrait de revenir à la cible.',
      actions: [{ label: 'Voir le plan', primary: true, fn: () => { this.show('invest'); setTimeout(() => $('#rebalBox').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); } },
        { label: 'Pas ce mois-ci', fn: () => this.dismiss(id) }] };
  },

  /* ================================================================== */
  /* DIVIDENDES À VENIR                                                   */
  /* ================================================================== */
  renderDividends() {
    const card = $('#divCard');
    if (!card) return;
    const cur = this.base();
    const { rows, totals } = Portfolio.snapshot();
    const today = todayISO(), limit = addDaysISO(today, 366);
    const items = [];
    for (const r of rows) {
      const ev = (this.eventsData || {})[r.key];
      if (!ev) continue;
      const fx = Api.fxCached(ev.currency || r.currency);
      for (const d of ev.divs || []) {
        if (d.date <= addDaysISO(today, -366)) continue;
        let next = addYearsISO(d.date, 1);
        if (next <= today) continue;
        if (next > limit) continue;
        items.push({ key: r.key, date: next, last: d.date, perShare: d.amount, qty: r.qty, currency: ev.currency || r.currency, amount: d.amount * r.qty * (isFinite(fx) ? fx : NaN) });
      }
    }
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
    card.classList.toggle('hidden', !items.length);
    if (!items.length) return;
    const total = items.reduce((s, i) => s + (isFinite(i.amount) ? i.amount : 0), 0);
    const byMonth = {};
    for (const i of items) byMonth[i.date.slice(0, 7)] = (byMonth[i.date.slice(0, 7)] || 0) + (isFinite(i.amount) ? i.amount : 0);
    const months = Array.from({ length: 12 }, (_, k) => addMonthsISO(today.slice(0, 7) + '-01', k + 1).slice(0, 7));
    const maxM = Math.max(...Object.values(byMonth), 1);
    $('#divBody').replaceChildren(
      el('div', { class: 'kpis' },
        this.kpi('Sur 12 mois (estimé)', fmtMoney(total, cur), 'brut, avant impôts et prélèvements', 'up'),
        this.kpi('Rendement sur la valeur', fmtPct(totals.value > 0 ? (total / totals.value) * 100 : NaN, 2, false), 'dividendes / valeur actuelle'),
        this.kpi('Prochain versement', fmtDate(items[0].date), Store.label(items[0].key) + ' · ≈ ' + fmtMoney(items[0].amount, cur))),
      el('div', { class: 'div-months' }, ...months.map(m => {
        const v = byMonth[m] || 0;
        return el('div', { class: 'div-month', title: fmtMoney(v, cur) },
          el('div', { class: 'div-bar' }, el('span', { style: `height:${(v / maxM) * 100}%` })),
          el('span', { class: 'small muted' }, MONTHS_FR[+m.slice(5) - 1]));
      })),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Vers le'), el('th', {}, 'ETF'), el('th', { class: 'num' }, 'Par part'), el('th', { class: 'num' }, 'Parts'), el('th', { class: 'num' }, 'Montant estimé'), el('th', {}, 'Dernier détachement'))),
        el('tbody', {}, ...items.map(i => el('tr', {},
          el('td', {}, fmtDate(i.date)), el('td', {}, el('span', { class: 'sym' }, Store.label(i.key))),
          el('td', { class: 'num' }, fmtMoney(i.perShare, i.currency, 3)), el('td', { class: 'num' }, fmtQty(i.qty)),
          el('td', { class: 'num up' }, fmtMoney(i.amount, cur)), el('td', { class: 'muted' }, fmtDate(i.last))))))));
  },

  /* ================================================================== */
  /* ACTUALITÉS                                                           */
  /* ================================================================== */
  /** Sujet de recherche d'actualités d'un instrument : { fr, en, label } */
  newsQuery(key) {
    const inst = Store.instrument(key);
    if (!inst || inst.provider === 'manual') return null;
    const clean = n => (n || '').replace(/\(.*?\)/g, '').replace(/\b(UCITS|ETF|Acc|Dist|EUR|USD|Inc|Corp|Corporation|Ltd|plc|S\.?A|SE|N\.?V|AG|Class [A-C])\b\.?/gi, '').replace(/[,.]+$/, '').replace(/\s+/g, ' ').trim();
    const prof = typeof Expo !== 'undefined' ? Expo.of(key).profile : 'none';
    const theme = NEWS_THEME_BY_PROFILE[prof] || newsTheme(inst.name, 'markets');
    if (!inst.mic && inst.ysymbol) { const n = clean(inst.name) || inst.ysymbol; return { fr: n, en: inst.ysymbol, s: inst.ysymbol, label: n, theme }; } // indices, matières premières, crypto
    if (NEWS_TOPIC[prof]) return { fr: NEWS_TOPIC[prof][0], en: NEWS_TOPIC[prof][1], s: NEWS_TOPIC[prof][2], label: NEWS_TOPIC[prof][0], theme };
    const n = clean(inst.name) || inst.symbol;
    const ysym = yahooSymbolFor(inst) || '';
    return { fr: n, en: prof === 'stock' ? (ysym || inst.symbol) : n, s: ysym, label: n, theme };
  },

  /** Actualités en français d'un sujet ; à défaut, actualité générale des marchés en français */
  async newsFr(topic) {
    const items = await Api.news(topic);
    if (items.some(n => n.lang === 'fr') || topic === NEWS_GENERAL) return { items, general: false };
    try {
      const gen = await Api.news(NEWS_GENERAL);
      if (gen.some(n => n.lang === 'fr')) return { items: gen, general: true };
    } catch (e) { /* on garde les articles en anglais */ }
    return { items, general: false };
  },

  newsItem(n, tag, theme) {
    // vignette : image de l'article (via le relais) posée sur une illustration du thème, qui reste visible s'il n'y en a pas
    let img = null;
    const base = Api.proxyUrl();
    if (base && !/news\.google\./.test(n.link)) {
      const u = new URL(base, location.href);
      u.searchParams.set('type', 'ogimage');
      u.searchParams.set('url', n.link);
      img = el('img', { src: u.toString(), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', width: 96, height: 64 });
      img.addEventListener('error', () => img.remove());
      img.addEventListener('load', () => { if (img.naturalWidth < 40) img.remove(); });
    }
    return el('li', { class: 'news-item' },
      el('a', { class: 'news-thumb', href: n.link, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true',
        style: `background-image:url("${NEWS_ART[newsTheme(n.title, n.theme || theme)]}")` }, img),
      el('div', { class: 'news-body' },
        el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title),
        el('div', { class: 'news-meta' }, [n.publisher, n.time ? fmtAgo(n.time) : '', tag].filter(Boolean).join(' · '))));
  },

  newsList(items, theme) {
    // styles de base en ligne : lisible même si l'ancienne feuille de style est encore en cache
    return el('ul', { class: 'news-list', style: 'list-style:none;margin:0;padding:0' }, ...items.map(n => this.newsItem(n, null, theme)));
  },

  async loadNews(force = false) {
    if (!Api.hasProxy() || this._newsLoading) return;
    if (!force && this.newsAt && Date.now() - this.newsAt < 15 * 60000) return;
    const { rows } = Portfolio.snapshot();
    const queries = new Map();
    for (const r of rows.slice().sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0))) {
      const q = this.newsQuery(r.key);
      if (q && !queries.has(q.fr)) queries.set(q.fr, { q, tag: q.label });
      if (queries.size >= 4) break;
    }
    if (!queries.size) { $('#newsCard').classList.add('hidden'); return; }
    this._newsLoading = true;
    const all = new Map();
    let err = null;
    try {
      for (const { q, tag } of queries.values()) {
        try {
          const res = await this.newsFr(q);
          for (const n of res.items) {
            const k = n.title.toLowerCase().slice(0, 60); // même article repris par plusieurs recherches
            if (!all.has(k)) all.set(k, Object.assign({ tag: res.general ? NEWS_GENERAL.label : tag, theme: res.general ? NEWS_GENERAL.theme : q.theme }, n));
          }
        } catch (e) { err = e; }
      }
    } finally { this._newsLoading = false; this.newsAt = Date.now(); }
    const list = Array.from(all.values()).sort((a, b) => b.time - a.time).slice(0, 10);
    $('#newsCard').classList.toggle('hidden', !list.length && !err);
    $('#newsSource').textContent = !list.length || list.some(n => n.lang === 'fr') ? 'Presse financière française' : 'En anglais : redéploie le worker Cloudflare pour les avoir en français';
    $('#newsList').replaceChildren(...(list.length ? list.map(n => this.newsItem(n, queries.size > 1 ? n.tag : null)) : [el('li', { class: 'muted small' }, err ? err.message : 'Aucune actualité.')]));
  },

  async loadDetailNews(key) {
    const box = $('#detailNews');
    if (!box) return;
    box.replaceChildren();
    const q = this.newsQuery(key);
    if (!q || !Api.hasProxy()) return;
    try {
      const res = await this.newsFr(q);
      const items = res.items.slice().sort((a, b) => b.time - a.time).slice(0, 6);
      if (key !== this.detailKey) return;
      const title = res.general ? 'Actualités des marchés' : 'Actualités · ' + q.label + (items.length && items[0].lang === 'en' ? ' (en anglais)' : '');
      box.replaceChildren(...(items.length ? [el('h3', {}, title),
        res.general ? el('p', { class: 'muted small' }, `Rien en français sur ${q.label} pour l'instant : voici l'actualité générale de la Bourse de Paris et de Wall Street.`) : null,
        this.newsList(items, res.general ? NEWS_GENERAL.theme : q.theme)].filter(Boolean) : []));
    } catch (e) {
      if (key === this.detailKey) box.replaceChildren(el('p', { class: 'muted small' }, e.message));
    }
  },

  /* ================================================================== */
  /* RAPPORT ANNUEL (impression / PDF)                                    */
  /* ================================================================== */
  bindReport() {
    const dlg = $('#reportDialog');
    $('#reportBtn').addEventListener('click', () => {
      const years = Array.from(new Set([...Store.state.transactions, ...Store.state.cashMoves].map(t => +t.date.slice(0, 4)))).sort((a, b) => b - a);
      if (!years.length) { toast('Aucune opération enregistrée.'); return; }
      const thisYear = new Date().getFullYear();
      if (!years.includes(thisYear)) years.unshift(thisYear);
      $('#reportYear').replaceChildren(...years.map(y => el('option', { value: y }, y + (y === thisYear ? ' (en cours)' : ''))));
      $('#reportYear').value = String(new Date().getMonth() < 3 && years.includes(thisYear - 1) ? thisYear - 1 : thisYear);
      $('#reportAcc').replaceChildren(el('option', { value: 'all' }, 'Tous les comptes'), ...Store.state.accounts.map(a => el('option', { value: a.id }, a.name)));
      $('#reportAcc').value = Store.state.accountFilter || 'all';
      dlg.showModal();
    });
    $('#reportCancel').addEventListener('click', () => dlg.close());
    $('#reportForm').addEventListener('submit', e => {
      e.preventDefault();
      // fenêtre ouverte tout de suite (dans le clic), sinon le navigateur la bloque
      const w = window.open('', '_blank');
      if (!w) { toast('Autorise les fenêtres surgissantes pour ce site afin de générer le rapport.', 'error', 6000); return; }
      w.document.write('<!doctype html><meta charset="utf-8"><title>Rapport…</title><p style="font:16px system-ui;padding:24px">Préparation du rapport…</p>');
      dlg.close();
      this.buildReport(+$('#reportYear').value, $('#reportAcc').value).then(html => {
        w.document.open(); w.document.write(html); w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (err) { /* l'utilisateur imprimera via le bouton */ } }, 500);
      }).catch(err => { w.close(); toast('Rapport impossible : ' + err.message, 'error', 6000); });
    });
  },

  /** Historique (valeur / investi) d'un ensemble d'opérations, en devise de base */
  async historyFor(txs) {
    if (!txs.length) return [];
    const start = txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
    const series = {}, fx = {};
    for (const k of new Set(txs.map(t => t.key))) {
      series[k] = await Api.daily(k, start);
      fx[k] = await Api.fxSeries((Store.instrument(k) || {}).currency || this.base(), start);
    }
    return Portfolio.replay(series, fx, Portfolio.historyEvents(txs)).points;
  },

  async buildReport(year, accId) {
    const wasPrivate = document.documentElement.classList.contains('privacy');
    document.documentElement.classList.remove('privacy'); // le rapport affiche les vrais montants
    try { return await this._buildReport(year, accId); }
    finally { if (wasPrivate) document.documentElement.classList.add('privacy'); }
  },

  async _buildReport(year, accId) {
    const cur = this.base();
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const accs = Store.state.accounts.filter(a => accId === 'all' || a.id === accId);
    const inAcc = t => accs.some(a => a.id === (t.account || Store.defaultAccount()));
    const y0 = year + '-01-01', y1 = year + '-12-31';
    const allTx = Store.state.transactions.filter(inAcc);
    const txs = allTx.filter(t => t.date >= y0 && t.date <= y1).sort((a, b) => (a.date < b.date ? -1 : 1));
    try { await Api.preloadFxHistory(); } catch (e) { /* repli : taux du jour */ }
    const fxOf = (k, d) => { const i = Store.instrument(k); return Api.fxAt((i && i.currency) || cur, d); };
    const sum = (list, f) => list.reduce((s, t) => s + (isFinite(f(t)) ? f(t) : 0), 0);
    const buys = txs.filter(t => t.type === 'buy'), sells = txs.filter(t => t.type === 'sell'), divs = txs.filter(t => t.type === 'div');
    const bought = sum(buys, t => (t.qty * t.price + (t.fees || 0)) * fxOf(t.key, t.date));
    const sold = sum(sells, t => (t.qty * t.price - (t.fees || 0)) * fxOf(t.key, t.date));
    const divNet = sum(divs, t => (t.qty * t.price - (t.fees || 0)) * fxOf(t.key, t.date));
    const fees = sum(txs.filter(t => t.type !== 'div'), t => (t.fees || 0) * fxOf(t.key, t.date));
    const moves = Store.state.cashMoves.filter(m => inAcc(m) && m.date >= y0 && m.date <= y1);
    const deposits = sum(moves.filter(m => m.type !== 'withdraw'), m => m.amount), withdrawals = sum(moves.filter(m => m.type === 'withdraw'), m => m.amount);
    let realized = 0;
    const sales = [];
    for (const a of accs) for (const s of Tax.events(a).sales) if (s.date >= y0 && s.date <= y1) { realized += s.gain; sales.push(s); }

    // valeur en début et fin d'année, performance mois par mois (TWR)
    let points = [];
    try { points = await this.historyFor(allTx.filter(t => t.date <= y1)); } catch (e) { points = []; }
    const at = d => { let p = null; for (const x of points) { if (x.date <= d) p = x; else break; } return p; };
    const pStart = at(addDaysISO(y0, -1)), pEnd = at(y1);
    const twr = Portfolio.twr(points);
    const monthly = Portfolio.monthlyReturns(twr)[year];
    const ctos = accs.filter(a => a.type === 'cto' || a.type === 'autre');
    const taxY = ctos.length ? Tax.yearly(ctos).out[year] : null;
    const peas = accs.filter(a => a.type === 'pea');
    const snap = Portfolio.snapshot(accId);
    const T = taxConf();
    const m = (v, d = 2) => esc(fmtMoney(v, cur, d));
    const sm = v => esc(fmtSignedMoney(v, cur));
    const cls = v => (v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');
    const row = (...c) => '<tr>' + c.map((x, i) => `<td${i ? ' class="num"' : ''}>${x}</td>`).join('') + '</tr>';
    const kpi = (l, v, sub = '', c = '') => `<div class="k"><span>${esc(l)}</span><b class="${c}">${v}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    const partial = year === new Date().getFullYear();

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>APIstock — Rapport ${year}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; margin: 0 auto; max-width: 900px; padding: 20px; }
  h1 { font-size: 22px; margin: 0; } h2 { font-size: 14px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #10b981; }
  .sub { color: #6b7280; margin: 2px 0 14px; } .muted { color: #6b7280; } small { color: #6b7280; display: block; }
  .ks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; } .k { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .k span { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; display: block; } .k b { font-size: 15px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; } th, td { padding: 4px 6px; border-bottom: 1px solid #f0f0f0; text-align: left; }
  th { color: #6b7280; font-weight: 600; } .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .up { color: #047857; } .down { color: #b91c1c; } .tot td { font-weight: 700; border-top: 1px solid #d1d5db; }
  .bar { position: fixed; top: 12px; right: 12px; } .bar button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 0; background: #10b981; color: #fff; cursor: pointer; }
  .note { font-size: 10px; color: #6b7280; margin-top: 18px; } section { break-inside: avoid; }
  @media print { .bar { display: none; } body { padding: 0; } }
  @media (max-width: 640px) { .ks { grid-template-columns: repeat(2, 1fr); } }
</style></head><body>
<div class="bar"><button onclick="print()">Imprimer / PDF</button></div>
<h1>Rapport annuel ${year}${partial ? ' <span class="muted">(année en cours)</span>' : ''}</h1>
<p class="sub">${esc(accId === 'all' ? 'Tous les comptes' : accs[0].name)} · édité le ${esc(fmtDate(todayISO()))} avec APIstock · montants en ${esc(cur)}</p>

<section><h2>Synthèse</h2><div class="ks">
${kpi('Valeur au 1er janvier', pStart ? m(pStart.value, 0) : '—')}
${kpi(partial ? 'Valeur actuelle' : 'Valeur au 31 décembre', pEnd ? m(pEnd.value, 0) : '—')}
${kpi('Performance de l\'année', monthly && isFinite(monthly.year) ? esc(fmtPct(monthly.year)) : '—', 'pondérée dans le temps (TWR)', monthly ? cls(monthly.year) : '')}
${kpi('Plus-values réalisées', sm(realized), sales.length + ' vente(s)', cls(realized))}
${kpi('Achats', m(bought, 0), buys.length + ' opération(s), frais inclus')}
${kpi('Ventes', m(sold, 0), 'net de frais')}
${kpi('Dividendes nets', m(divNet), divs.length + ' versement(s)', divNet > 0 ? 'up' : '')}
${kpi('Frais de courtage', m(fees), '')}
${moves.length ? kpi('Versements', m(deposits, 0)) + kpi('Retraits', m(withdrawals, 0)) : ''}
</div></section>

${monthly ? `<section><h2>Performance mois par mois</h2><table><tr>${MONTHS_FR.map(x => `<th class="num">${x}</th>`).join('')}<th class="num">Année</th></tr><tr>${MONTHS_FR.map((_, i) => {
      const v = monthly.months[i + 1]; return `<td class="num ${isFinite(v) ? cls(v) : ''}">${isFinite(v) ? esc(fmtNum(v, 1)) : ''}</td>`;
    }).join('')}<td class="num ${cls(monthly.year)}"><b>${esc(fmtPct(monthly.year, 1))}</b></td></tr></table></section>` : ''}

${taxY ? `<section><h2>Compte-titres : éléments de déclaration</h2><table>
${row('Plus-values de cession de l\'année', sm(taxY.gross))}
${taxY.used > 0.005 ? row('Moins-values antérieures imputées', '−' + m(taxY.used)) : ''}
${row(taxY.loss ? 'Moins-value (case 3VH de la 2042 C)' : 'Plus-value imposable (case 3VG de la 2042 C)', m(taxY.loss || taxY.taxable))}
${row('Dividendes bruts (case 2DC ou 2TR)', m(taxY.dividends))}
${row(`Impôt estimé au prélèvement forfaitaire unique de ${fmtNum(T.pfu, 1)} % (${fmtNum(T.ir, 1)} % + ${fmtNum(T.social, 1)} % de prélèvements sociaux)`, m((taxY.taxable + taxY.dividends) * T.pfu / 100))}
${taxY.carryLeft > 0.005 ? row('Moins-values reportables (10 ans)', m(taxY.carryLeft)) : ''}
</table></section>` : ''}

${peas.map(a => { const p = Tax.pea(a); return `<section><h2>${esc(a.name)} (PEA)</h2><table>
${row('Date d\'ouverture', esc(fmtDate(p.open)))}${row('Versements ' + (p.manual ? '(saisis)' : p.tracked ? '(enregistrés)' : '(estimés)'), m(p.deposits, 0) + ' / ' + m(T.peaCap, 0))}
${row('Cap des 5 ans', esc(p.five ? fmtDate(p.five) + (p.five <= todayISO() ? ' (atteint)' : '') : '—'))}</table></section>`; }).join('')}

${sales.length ? `<section><h2>Cessions</h2><table><tr><th>Date</th><th>Valeur</th><th class="num">Quantité</th><th class="num">Prix de cession net</th><th class="num">Prix de revient (PMP)</th><th class="num">+/- value</th></tr>
${sales.map(s => row(esc(fmtDate(s.date)), esc(Store.label(s.key)), esc(fmtQty(s.qty)), m(s.proceeds), m(s.cost), `<span class="${cls(s.gain)}">${sm(s.gain)}</span>`)).join('')}
<tr class="tot"><td colspan="5">Total</td><td class="num ${cls(realized)}">${sm(realized)}</td></tr></table></section>` : ''}

<section><h2>Opérations de l'année (${txs.length})</h2>${txs.length ? `<table><tr><th>Date</th><th>Type</th><th>Valeur</th><th class="num">Quantité</th><th class="num">Prix</th><th class="num">Frais</th><th class="num">Montant</th><th>Note</th></tr>
${txs.map(t => { const i = Store.instrument(t.key) || {}; const c = i.currency || cur; const split = t.type === 'split';
      return `<tr><td>${esc(fmtDate(t.date))}</td><td>${esc({ buy: 'Achat', sell: 'Vente', div: 'Dividende', split: 'Division' }[t.type])}</td><td>${esc(Store.label(t.key))}</td>
<td class="num">${esc(t.type === 'div' ? '—' : split ? fmtSplit(t.qty) : fmtQty(t.qty))}</td><td class="num">${esc(t.type === 'div' || split ? '—' : fmtMoney(t.price, c, 3))}</td>
<td class="num">${esc(split ? '—' : fmtMoney(t.fees || 0, c))}</td><td class="num">${esc(split ? '—' : fmtMoney(t.qty * t.price + (t.type === 'buy' ? 1 : -1) * (t.fees || 0), c))}</td><td class="muted">${esc(t.note || '')}</td></tr>`; }).join('')}</table>` : '<p class="muted">Aucune opération.</p>'}</section>

<section><h2>Positions au ${esc(fmtDate(todayISO()))}</h2><table><tr><th>Valeur</th><th class="num">Parts</th><th class="num">PRU</th><th class="num">Investi</th><th class="num">Valeur</th><th class="num">+/- latente</th></tr>
${snap.rows.map(r => row(esc(Store.label(r.key)) + `<small>${esc(Store.code(r.key))}</small>`, esc(fmtQty(r.qty)), esc(fmtMoney(r.pru, r.currency, 3)), m(r.costBase), m(r.valueBase), `<span class="${cls(r.pnlBase)}">${sm(r.pnlBase)}</span>`)).join('')}
<tr class="tot"><td colspan="3">Total</td><td class="num">${m(snap.totals.cost)}</td><td class="num">${m(snap.totals.value)}</td><td class="num ${cls(snap.totals.pnl)}">${sm(snap.totals.pnl)}</td></tr></table></section>

<p class="note">Document indicatif établi à partir des opérations saisies dans APIstock. Montants en devises convertis au taux de change du jour de chaque opération ; positions et valeur actuelle au taux du jour d'édition. Les plus-values sont calculées au prix moyen pondéré d'acquisition, frais inclus. Taux fiscaux : ${esc(T.custom ? 'personnalisés (Réglages)' : 'revenus ' + T.year + ' — ' + T.source)}. L'imprimé fiscal unique (IFU) de ton courtier et ta déclaration pré-remplie font foi.</p>
</body></html>`;
  },

  /* ================================================================== */
  /* ALERTES PUSH (même site fermé) via le worker Cloudflare              */
  /* ================================================================== */
  pushConf() { try { return JSON.parse(localStorage.getItem('apistock:push') || 'null'); } catch (e) { return null; } },
  setPushConf(c) { try { if (c) localStorage.setItem('apistock:push', JSON.stringify(c)); else localStorage.removeItem('apistock:push'); } catch (e) { /* ignore */ } },

  async pushCall(type, body) {
    const base = Api.proxyUrl();
    if (!base) throw new Error('aucun relais configuré');
    const u = new URL(base, location.href);
    u.searchParams.set('type', type);
    Api.countRequest('yahoo');
    const res = await fetch(u.toString(), body ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (j.unsupported) throw new Error('les alertes push nécessitent le relais Cloudflare (voir le README)');
    if (j.configured === false) throw new Error(j.reason || 'le worker n\'est pas configuré pour les notifications push (voir le README : clés VAPID et espace KV)');
    if (j.error) throw new Error(/invalide/.test(j.error) && !res.ok ? 'le worker en ligne ne gère pas encore les alertes push : redéploie-le (voir le README)' : j.error);
    return j;
  },

  /** Alertes actives transmises au worker (seulement celles qui ont un symbole Yahoo) */
  pushAlerts() {
    return Store.state.alerts.filter(a => a.active).map(a => {
      const inst = Store.instrument(a.key);
      const s = inst && yahooSymbolFor(inst);
      return s ? { id: a.id, s, k: a.kind, v: a.value, t: Store.label(a.key) + ' : ' + this.alertText(a) } : null;
    }).filter(Boolean);
  },

  async pushSync(manual = false) {
    const c = this.pushConf();
    if (!c) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { this.setPushConf(null); this.renderPush(); if (manual) toast('Abonnement perdu : réactive les alertes push.', 'error'); return; }
      const alerts = this.pushAlerts();
      const res = await this.pushCall('push-sync', { id: c.id, sub: sub.toJSON(), alerts });
      this._pushSig = JSON.stringify(alerts);
      let fired = 0;
      for (const [id, f] of Object.entries(res.fired || {})) {
        const a = Store.state.alerts.find(x => x.id === id);
        if (a && a.active) { a.active = false; a.triggeredAt = f.at || Date.now(); fired++; }
      }
      if (fired) { Store.save(); this.renderAlerts(); this.pushSync(); }
      c.syncedAt = Date.now(); c.count = alerts.length; this.setPushConf(c);
      this.renderPush();
      if (manual) toast('Alertes push à jour ✔', 'success', 2000);
    } catch (e) {
      this.renderPush(e.message);
      if (manual) toast('Alertes push : ' + e.message, 'error', 7000);
    }
  },

  schedulePushSync() {
    if (!this.pushConf()) return;
    const sig = JSON.stringify(this.pushAlerts());
    if (sig === this._pushSig) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.pushSync(), 1500);
  },

  renderPush(err) {
    if (!$('#pushBox')) return;
    const c = this.pushConf();
    $('#pushOn').classList.toggle('hidden', !!c);
    $('#pushOff').classList.toggle('hidden', !c);
    $('#pushTest').classList.toggle('hidden', !c);
    const base = '';
    $('#pushInfo').textContent = err ? '⚠ ' + err : c ? `✔ Activées sur cet appareil · ${c.count ?? 0} alerte(s) surveillée(s) par le worker` + (c.syncedAt ? ' · synchronisé ' + fmtAgo(c.syncedAt) : '') + '.' : base;
    $('#pushInfo').className = 'small ' + (err ? 'down' : c ? 'up' : 'muted');
  },

  bindPush() {
    if (!$('#pushBox')) return;
    $('#pushOn').addEventListener('click', async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast(/iPhone|iPad/.test(navigator.userAgent) ? 'Sur iPhone, ajoute d\'abord le site à l\'écran d\'accueil (Partager → Sur l\'écran d\'accueil) puis ouvre-le depuis l\'icône.' : 'Notifications push non prises en charge par ce navigateur.', 'error', 8000);
        return;
      }
      const btn = $('#pushOn');
      btn.disabled = true;
      try {
        const k = await this.pushCall('pushkey');
        if (!k.publicKey) throw new Error('clé publique absente');
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications refusées dans le navigateur');
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (sub) { try { await sub.unsubscribe(); } catch (e) { /* ancienne clé */ } }
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(k.publicKey) });
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        this.setPushConf({ id });
        await this.pushSync();
        if (this.pushConf()) toast('Alertes push activées ✔ Tu seras prévenu même site fermé.', 'success', 5000);
      } catch (e) {
        this.renderPush(e.message);
        toast('Activation impossible : ' + e.message, 'error', 8000);
      } finally { btn.disabled = false; }
    });
    $('#pushOff').addEventListener('click', async () => {
      const c = this.pushConf();
      try { if (c) await this.pushCall('push-delete', { id: c.id }); } catch (e) { /* le worker oubliera l'abonnement de lui-même */ }
      try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignore */ }
      this.setPushConf(null); this._pushSig = null;
      this.renderPush();
      toast('Alertes push désactivées sur cet appareil');
    });
    $('#pushTest').addEventListener('click', async () => {
      const c = this.pushConf();
      if (!c) return;
      try { await this.pushSync(); await this.pushCall('push-test', { id: c.id }); toast('Notification de test envoyée : elle doit arriver dans quelques secondes.', 'success', 5000); }
      catch (e) { toast('Test impossible : ' + e.message, 'error', 7000); }
    });
    $('#vapidGen').addEventListener('click', async () => {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
      const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
      const out = $('#vapidOut');
      out.textContent = `À ajouter dans Cloudflare → ton worker → Settings → Variables and Secrets (type « Secret ») :\n\nVAPID_PUBLIC  = ${pub}\nVAPID_PRIVATE = ${priv}\n\nPuis, dans Settings → Triggers → Cron Triggers, ajoute « */5 * * * * » (toutes les 5 minutes).\nCes clés ne sont pas enregistrées ici : copie-les maintenant. Ne les régénère pas ensuite, sinon il faudra réactiver chaque appareil.`;
      out.classList.remove('hidden');
    });
    this.renderPush();
    if (this.pushConf()) setTimeout(() => this.pushSync(), 3000);
  },
});

/* ==================================================================== */
/* Branchements                                                           */
/* ==================================================================== */
App.on('rendered:all', function () {
  this.renderRiskCard();
  this.renderDividends();
  this.renderRebalance();
});
App.on('rendered:invest', function () { if (!$('#rebalBox').contains(document.activeElement)) this.renderRebalance(); });
App.on('rendered:alerts', function () { this.schedulePushSync(); });
// actualités de l'instrument affiché (la liste est vide tant qu'elles n'ont pas été chargées)
App.on('detail:selected', function (key, previous) { if (key !== previous || !$('#detailNews').childElementCount) this.loadDetailNews(key); });
App.on('refreshed', function () { if (this.view === 'portfolio') this.loadNews().catch(() => {}); });
App.on('view:shown', function (view) { if (view === 'portfolio') this.loadNews().catch(() => {}); });
// un changement de compte invalide le calcul de risque
App.on('rendered:accountFilter', function () {
  if (this._riskShown && this._riskShown !== (Store.state.accountFilter || 'all')) { this._riskShown = null; this.renderRiskCard(); }
});

document.addEventListener('DOMContentLoaded', () => {
  App.bindReport();
  App.bindPush();
});
