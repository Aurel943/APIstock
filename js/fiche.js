/*
 * Fiche enrichie (onglet Marchés) :
 * - action : avis des analystes, objectif de cours, valorisation, santé financière, profil de la société ;
 * - ETF : frais réels, société de gestion, performances annualisées, répartition par secteur, principales lignes.
 * Données « quoteSummary » de Yahoo lues par le relais (type=summary), gardées 24 h dans le navigateur.
 * Calculs purs (Fundamentals.stockView / etfView) testés dans tests/fiche.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const FUND_STORE = 'apistock:fundamentals';
const FUND_MODULES = {
  stock: 'financialData,defaultKeyStatistics,summaryDetail,recommendationTrend,assetProfile',
  etf: 'fundProfile,topHoldings,defaultKeyStatistics,summaryDetail',
};

/* Secteurs (profil des sociétés et répartition des ETF chez Yahoo) */
const SECTORS_FR = {
  technology: 'Technologie', financial_services: 'Finance', financialservices: 'Finance', healthcare: 'Santé',
  consumer_cyclical: 'Conso. cyclique', consumercyclical: 'Conso. cyclique', consumer_defensive: 'Conso. de base',
  consumerdefensive: 'Conso. de base', communication_services: 'Communication', communicationservices: 'Communication',
  industrials: 'Industrie', energy: 'Énergie', basic_materials: 'Matériaux', basicmaterials: 'Matériaux', utilities: 'Services publics',
  realestate: 'Immobilier', real_estate: 'Immobilier',
};
const COUNTRIES_FR = {
  'United States': 'États-Unis', France: 'France', Germany: 'Allemagne', Netherlands: 'Pays-Bas', 'United Kingdom': 'Royaume-Uni',
  Switzerland: 'Suisse', Japan: 'Japon', Taiwan: 'Taïwan', China: 'Chine', 'Hong Kong': 'Hong Kong', Ireland: 'Irlande', Spain: 'Espagne',
  Italy: 'Italie', Canada: 'Canada', Denmark: 'Danemark', 'South Korea': 'Corée du Sud', Belgium: 'Belgique', Sweden: 'Suède',
  Norway: 'Norvège', Finland: 'Finlande', Luxembourg: 'Luxembourg', India: 'Inde', Australia: 'Australie', Brazil: 'Brésil',
};

/** Grand montant lisible : « 3 770 Md $US », « 108,7 Md € », « 850 M € » (pas de « Bn » : en français, un billion vaut mille milliards) */
function fmtBigMoney(x, ccy) {
  if (x === null || x === undefined || !isFinite(x)) return null;
  const sym = (fmtMoney(0, ccy || 'EUR', 0, true).replace(/[\d\s\u202f\u00a0,.-]/g, '') || ccy || '').trim();
  const a = Math.abs(x);
  if (a >= 1e9) return `${fmtNum(x / 1e9, a >= 1e11 ? 0 : 1)} Md ${sym}`;
  if (a >= 1e6) return `${fmtNum(x / 1e6, a >= 1e8 ? 0 : 1)} M ${sym}`;
  return fmtMoney(x, ccy || 'EUR', 0, true);
}

const Fundamentals = {
  TTL: 24 * 3600000,
  cache: null, // symbole -> { ts, kind, data }

  load() {
    if (!this.cache) {
      try { this.cache = JSON.parse(localStorage.getItem(FUND_STORE) || '{}') || {}; } catch (e) { this.cache = {}; }
    }
    return this.cache;
  },
  save() {
    const now = Date.now();
    for (const [s, v] of Object.entries(this.cache || {})) if (now - v.ts > 14 * 86400000) delete this.cache[s];
    try { localStorage.setItem(FUND_STORE, JSON.stringify(this.cache || {})); } catch (e) { /* stockage indisponible */ }
  },

  /** { kind: 'stock' | 'etf', sym } pour une ligne de la fiche, ou null (indice, devise, crypto, saisie manuelle…) */
  kindOf(key) {
    const inst = Store.instrument(key);
    if (!inst || inst.provider === 'manual') return null;
    const stock = typeof Earnings !== 'undefined' ? Earnings.stockSymbol(key) : null;
    if (stock) return { kind: 'stock', sym: stock };
    const sym = yahooSymbolFor(inst);
    if (!sym || !SYMBOL_OK.test(sym) || /^\^|=|-(EUR|USD)$/.test(sym)) return null;
    const prof = typeof Expo !== 'undefined' ? Expo.of(key).profile : 'none';
    const isEtf = /etf|fund|fonds|tracker|ucits/i.test((inst.type || '') + ' ' + (inst.name || '')) || (prof && !['none', 'stock', 'gold', 'crypto'].includes(prof));
    return isEtf ? { kind: 'etf', sym, profile: prof } : null;
  },

  async get(sym, kind, force = false) {
    const c = this.load();
    if (!force && c[sym] && c[sym].kind === kind && Date.now() - c[sym].ts < this.TTL) return c[sym].data;
    const json = await Api.yahoo({ type: 'summary', symbols: sym, modules: FUND_MODULES[kind] });
    if (!json || typeof json.results !== 'object' || !json.results) throw new ApiError('requête invalide', 0);
    c[sym] = { ts: Date.now(), kind, data: json.results[sym] || null };
    this.save();
    return c[sym].data;
  },

  raw: x => (x && typeof x === 'object' ? (isFinite(x.raw) ? x.raw : null) : (isFinite(x) && x !== null && x !== '' ? +x : null)),

  /** Libellé du consensus d'après la note moyenne Yahoo (1 = achat fort … 5 = vente forte) */
  consensus(mean) {
    if (!isFinite(mean) || mean === null) return null;
    return mean <= 1.5 ? { label: 'Achat fort', tone: 'up' } : mean <= 2.5 ? { label: 'Achat', tone: 'up' }
      : mean <= 3.5 ? { label: 'Conserver', tone: '' } : mean <= 4.5 ? { label: 'Vente', tone: 'down' } : { label: 'Vente forte', tone: 'down' };
  },

  sectorFr(s) {
    const k = String(s || '').toLowerCase().replace(/[\s-]+/g, '_');
    return SECTORS_FR[k] || SECTORS_FR[k.replace(/_/g, '')] || s;
  },

  /** Données d'une action, prêtes à afficher (nombres bruts, null si absents) */
  stockView(d, price) {
    const r = this.raw;
    const fd = (d && d.financialData) || {}, ks = (d && d.defaultKeyStatistics) || {}, sd = (d && d.summaryDetail) || {}, ap = (d && d.assetProfile) || {};
    const trend = ((d && d.recommendationTrend && d.recommendationTrend.trend) || []);
    const counts = t => (t ? { strongBuy: +t.strongBuy || 0, buy: +t.buy || 0, hold: +t.hold || 0, sell: +t.sell || 0, strongSell: +t.strongSell || 0 } : null);
    const now = counts(trend.find(t => t.period === '0m')), prev = counts(trend.find(t => t.period === '-1m'));
    const total = c => (c ? c.strongBuy + c.buy + c.hold + c.sell + c.strongSell : 0);
    const cur = isFinite(price) && price > 0 ? price : r(fd.currentPrice);
    const mean = r(fd.targetMeanPrice);
    return {
      ccy: sd.currency || fd.financialCurrency || '',
      price: cur,
      analysts: {
        n: r(fd.numberOfAnalystOpinions) || total(now) || 0,
        mean: r(fd.recommendationMean),
        consensus: this.consensus(r(fd.recommendationMean)),
        counts: total(now) ? now : null,
        prev: total(prev) ? prev : null,
        buyShare: total(now) ? (now.strongBuy + now.buy) / total(now) * 100 : null,
        prevBuyShare: total(prev) ? (prev.strongBuy + prev.buy) / total(prev) * 100 : null,
      },
      target: mean !== null ? { mean, low: r(fd.targetLowPrice), high: r(fd.targetHighPrice), upside: cur ? (mean / cur - 1) * 100 : null } : null,
      valuation: {
        pe: r(sd.trailingPE), forwardPe: r(ks.forwardPE) !== null ? r(ks.forwardPE) : r(sd.forwardPE), peg: r(ks.pegRatio),
        marketCap: r(sd.marketCap), dividendYield: r(sd.dividendYield), payout: r(sd.payoutRatio), beta: r(sd.beta) !== null ? r(sd.beta) : r(ks.beta),
        priceToBook: r(ks.priceToBook),
      },
      health: {
        margin: r(fd.profitMargins), grossMargin: r(fd.grossMargins), revenueGrowth: r(fd.revenueGrowth), earningsGrowth: r(fd.earningsGrowth),
        roe: r(fd.returnOnEquity), debtToEquity: r(fd.debtToEquity), revenue: r(fd.totalRevenue), financialCcy: fd.financialCurrency || '',
      },
      profile: {
        sector: ap.sector ? this.sectorFr(ap.sector) : '', industry: ap.industry || '', country: COUNTRIES_FR[ap.country] || ap.country || '',
        employees: r(ap.fullTimeEmployees), website: /^https:\/\//.test(ap.website || '') ? ap.website : '', summary: ap.longBusinessSummary || '',
      },
    };
  },

  /**
   * Données d'un ETF : frais, performances, secteurs et principales lignes. Sans lignes publiées pour l'ETF lui-même,
   * `proxy` ({ sym, list }) fournit celles de l'indice suivi (ETF américain de référence, voir Holdings dans agenda.js).
   */
  etfView(d, proxy) {
    const r = this.raw;
    const fp = (d && d.fundProfile) || {}, th = (d && d.topHoldings) || {}, ks = (d && d.defaultKeyStatistics) || {}, sd = (d && d.summaryDetail) || {};
    const fees = fp.feesExpensesInvestment || {};
    const sectors = (th.sectorWeightings || []).map(o => { const k = Object.keys(o)[0]; return { name: this.sectorFr(k), pct: (r(o[k]) || 0) * 100 }; })
      .filter(x => x.pct > 0.05).sort((a, b) => b.pct - a.pct);
    let holdings = typeof Holdings !== 'undefined' ? Holdings.parse(th) : [];
    let source = 'own';
    if (!holdings.length && proxy && proxy.list && proxy.list.length) { holdings = proxy.list.slice(); source = proxy.sym; }
    const stocks = r(th.stockPosition), bonds = r(th.bondPosition), cash = r(th.cashPosition);
    return {
      ter: r(fees.annualReportExpenseRatio) !== null ? r(fees.annualReportExpenseRatio) * 100 : null,
      family: fp.family || '', legalType: fp.legalType || '',
      inception: (ks.fundInceptionDate && ks.fundInceptionDate.fmt) || '',
      ytd: r(ks.ytdReturn) !== null ? r(ks.ytdReturn) * 100 : null,
      r3: r(ks.threeYearAverageReturn) !== null ? r(ks.threeYearAverageReturn) * 100 : null,
      r5: r(ks.fiveYearAverageReturn) !== null ? r(ks.fiveYearAverageReturn) * 100 : null,
      totalAssets: r(ks.totalAssets) !== null ? r(ks.totalAssets) : r(sd.totalAssets),
      yield: r(sd.yield) ? r(sd.yield) * 100 : null,
      mix: stocks !== null && stocks + (bonds || 0) + (cash || 0) > 0 ? { stocks: stocks * 100, bonds: (bonds || 0) * 100, cash: (cash || 0) * 100 } : null,
      sectors, holdings, source,
    };
  },
};

/* ==================== Affichage ==================== */

Object.assign(App, {
  async loadDetailFund(key) {
    const box = $('#detailFund');
    if (!box) return;
    const k = key && Fundamentals.kindOf(key);
    if (!k) { box.replaceChildren(); return; }
    const c = Fundamentals.load();
    const cached = c[k.sym] && c[k.sym].kind === k.kind ? c[k.sym].data : null;
    if (cached) this.renderDetailFund(key, k, cached); else box.replaceChildren();
    try {
      if (k.kind === 'etf' && ETF_PROXY[k.profile] && typeof Holdings !== 'undefined') {
        const h = Holdings.load()[ETF_PROXY[k.profile]];
        if (!h || Date.now() - h.ts > Holdings.TTL) { try { await Holdings.refresh(); } catch (e) { /* lignes de l'indice indisponibles */ } }
      }
      const d = await Fundamentals.get(k.sym, k.kind);
      if (this.detailKey === key) this.renderDetailFund(key, k, d);
    } catch (e) {
      if (this.detailKey !== key || cached) return;
      box.replaceChildren(/requête invalide/i.test(e.message || '')
        ? el('p', { class: 'muted small fund-note' }, 'Analyse fondamentale indisponible : ton relais Yahoo doit être mis à jour (copie à nouveau proxy/cloudflare-worker.js dans ton worker Cloudflare, puis Deploy).')
        : null);
    }
  },

  renderDetailFund(key, k, d) {
    const box = $('#detailFund');
    if (!box) return;
    if (!d) { box.replaceChildren(); return; }
    const panel = k.kind === 'stock' ? this.fundStockPanel(key, d) : this.fundEtfPanel(key, k, d);
    box.replaceChildren(...(panel ? [panel] : []));
  },

  /** Tuile « libellé / valeur » avec explication */
  fundTile(label, value, tip, cls = '') {
    if (value === null || value === undefined || value === '—') return null;
    return el('div', {}, el('span', {}, label, tip ? infoTip(tip) : null), el('b', { class: cls }, value));
  },

  fundStockPanel(key, d) {
    const q = Api.cachedQuote(key);
    const v = Fundamentals.stockView(d, q && q.price);
    const ccy = v.ccy || (Store.instrument(key) || {}).currency || 'USD';
    const money = (x, dg = 2) => (x === null ? null : fmtMoney(x, ccy, dg, true));
    const pct = (x, dg = 1, signed = false) => (x === null ? null : fmtPct(x * 100, dg, signed));
    const num = (x, dg = 1) => (x === null || !isFinite(x) || x <= 0 ? null : fmtNum(x, dg));
    const big = (x, c = ccy) => fmtBigMoney(x, c);
    const A = v.analysts, T = v.target;
    const hasAnalysts = A.counts || A.consensus;
    const parts = [];

    // avis des analystes : répartition achat → vente (barre empilée) et évolution sur un mois
    if (hasAnalysts) {
      const order = [['strongBuy', 'Achat fort'], ['buy', 'Achat'], ['hold', 'Conserver'], ['sell', 'Vente'], ['strongSell', 'Vente forte']];
      const tot = A.counts ? order.reduce((s, [c]) => s + A.counts[c], 0) : 0;
      const delta = A.buyShare !== null && A.prevBuyShare !== null ? A.buyShare - A.prevBuyShare : null;
      parts.push(el('div', { class: 'fund-box' },
        el('h4', {}, 'Avis des analystes', infoTip('Recommandations des analystes financiers qui suivent la société, compilées par Yahoo Finance. Elles se trompent souvent et changent vite : un repère, pas un conseil.')),
        el('div', { class: 'fund-cons' },
          A.consensus ? el('b', { class: 'fund-cons-label ' + A.consensus.tone }, A.consensus.label) : null,
          el('span', { class: 'muted small' }, `${A.n} analyste${A.n > 1 ? 's' : ''}` + (A.mean !== null ? ` · note moyenne ${fmtNum(A.mean, 1)} sur 5 (1 = achat fort)` : ''))),
        tot ? el('div', { class: 'fund-split', role: 'img', 'aria-label': order.map(([c, l]) => `${A.counts[c]} ${l}`).join(', ') },
          ...order.filter(([c]) => A.counts[c] > 0).map(([c, l]) => el('span', { class: 'seg ' + c, style: `flex:${A.counts[c]}`, title: `${A.counts[c]} ${l}` }))) : null,
        tot ? el('div', { class: 'fund-split-legend small' }, ...order.filter(([c]) => A.counts[c] > 0).map(([c, l]) =>
          el('span', {}, el('i', { class: 'dot ' + c }), `${A.counts[c]} ${l}`))) : null,
        delta !== null && Math.abs(delta) >= 1 ? el('p', { class: 'small muted' }, `Il y a un mois : ${fmtNum(A.prevBuyShare, 0)} % d'avis à l'achat, contre ${fmtNum(A.buyShare, 0)} % aujourd'hui (`,
          el('b', { class: delta > 0 ? 'up' : 'down' }, delta > 0 ? 'plus optimistes' : 'moins optimistes'), ').') : null));
    }

    // objectif de cours moyen : fourchette des analystes, objectif moyen et cours actuel
    if (T) {
      const lo = Math.min(...[T.low, T.mean, v.price].filter(x => x > 0)), hi = Math.max(...[T.high, T.mean, v.price].filter(x => x > 0));
      const pos = x => `${hi > lo ? ((x - lo) / (hi - lo)) * 100 : 50}%`;
      parts.push(el('div', { class: 'fund-box' },
        el('h4', {}, 'Objectif de cours à 12 mois', infoTip('Cours que les analystes attendent dans un an, en moyenne, avec le plus bas et le plus haut des objectifs. Le potentiel compare l\'objectif moyen au cours actuel.')),
        el('div', { class: 'fund-cons' },
          el('b', { class: 'mono' }, money(T.mean)),
          T.upside !== null ? el('span', { class: 'chip ' + trendClass(T.upside) }, `${T.upside >= 0 ? 'potentiel ' : ''}${fmtPct(T.upside, 1)}`) : null),
        T.low !== null && T.high !== null ? el('div', { class: 'fund-range', role: 'img', 'aria-label': `Objectifs de ${money(T.low)} à ${money(T.high)}, moyenne ${money(T.mean)}, cours actuel ${money(v.price)}` },
          el('span', { class: 'fund-range-line', style: `left:${pos(T.low)};right:calc(100% - ${pos(T.high)})` }),
          el('span', { class: 'fund-range-mean', style: `left:${pos(T.mean)}`, title: 'Objectif moyen ' + money(T.mean) }),
          v.price ? el('span', { class: 'fund-range-now', style: `left:${pos(v.price)}`, title: 'Cours actuel ' + money(v.price) }) : null) : null,
        T.low !== null && T.high !== null ? el('div', { class: 'fund-range-ends small muted' },
          el('span', {}, `plus bas ${money(T.low)}`), el('span', {}, `plus haut ${money(T.high)}`)) : null,
        T.low !== null && T.high !== null ? el('div', { class: 'fund-range-legend small muted' },
          el('i', { class: 'mk-mean' }), 'objectif moyen', el('i', { class: 'mk-now' }), `cours actuel ${money(v.price)}`) : null));
    }

    const V = v.valuation, H = v.health;
    const tiles = [
      this.fundTile('PER', num(V.pe), 'Cours divisé par le bénéfice des 12 derniers mois : le nombre d\'années de bénéfices que tu paies. Autour de 15 à 20 pour une grande entreprise ; bien plus pour une société en forte croissance.'),
      this.fundTile('PER attendu', num(V.forwardPe), 'Même calcul avec le bénéfice attendu par les analystes pour les 12 prochains mois. Plus bas que le PER : les bénéfices doivent augmenter.'),
      this.fundTile('PEG', num(V.peg, 2), 'PER divisé par la croissance attendue des bénéfices. Sous 1 : la croissance paraît bon marché ; au-dessus de 2 : chère.'),
      this.fundTile('Capitalisation', big(V.marketCap), 'Valeur totale de la société en bourse (cours × nombre d\'actions).'),
      this.fundTile('Rendement du dividende', V.dividendYield ? pct(V.dividendYield, 2) : null, 'Dividendes versés sur un an divisés par le cours.'),
      this.fundTile('Bêta', num(V.beta, 2), 'Sensibilité au marché : 1 = bouge comme le marché, 2 = deux fois plus fort à la hausse comme à la baisse.'),
      this.fundTile('Marge nette', pct(H.margin), 'Part du chiffre d\'affaires qui reste en bénéfice net.'),
      this.fundTile('Croissance du CA', H.revenueGrowth !== null ? pct(H.revenueGrowth, 1, true) : null, 'Évolution du chiffre d\'affaires du dernier trimestre par rapport au même trimestre de l\'an dernier.', trendClass(H.revenueGrowth)),
      this.fundTile('Croissance des bénéfices', H.earningsGrowth !== null ? pct(H.earningsGrowth, 1, true) : null, 'Évolution du bénéfice du dernier trimestre sur un an.', trendClass(H.earningsGrowth)),
      this.fundTile('Rentabilité des capitaux (ROE)', pct(H.roe, 0), 'Bénéfice divisé par les capitaux propres : ce que la société gagne avec l\'argent de ses actionnaires.'),
      this.fundTile('Dette / capitaux propres', H.debtToEquity !== null ? fmtNum(H.debtToEquity, 0) + ' %' : null, 'Dette financière comparée aux capitaux propres. Au-delà de 100 % : la société doit plus que ce qu\'elle possède en propre.', H.debtToEquity > 150 ? 'down' : ''),
      this.fundTile('Chiffre d\'affaires (12 mois)', big(H.revenue, H.financialCcy || ccy)),
    ].filter(Boolean);

    const P = v.profile;
    if (!parts.length && !tiles.length && !P.sector) return null;
    return el('section', { class: 'fund-panel' },
      el('h3', {}, 'Analyse fondamentale'),
      parts.length ? el('div', { class: 'fund-grid' }, ...parts) : null,
      tiles.length ? el('div', { class: 'stats fund-stats' }, ...tiles) : null,
      P.sector || P.summary ? el('details', { class: 'fund-profile' },
        el('summary', {}, 'Profil de la société', P.sector ? el('span', { class: 'muted small' }, ` · ${P.sector}${P.country ? ', ' + P.country : ''}`) : null),
        el('p', { class: 'small' }, [P.industry ? `Activité : ${P.industry}` : '', P.employees ? `${new Intl.NumberFormat('fr-FR').format(P.employees)} salariés` : '', P.country ? `siège : ${P.country}` : ''].filter(Boolean).join(' · '),
          P.website ? [' · ', el('a', { href: P.website, target: '_blank', rel: 'noopener noreferrer' }, P.website.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, ''))] : null),
        P.summary ? el('p', { class: 'small muted', lang: 'en' }, P.summary) : null,
        P.summary ? el('p', { class: 'small muted' }, 'Description fournie en anglais par Yahoo Finance.') : null) : null,
      noteTip('Données Yahoo Finance (analystes, comptes publiés), mises à jour une fois par jour. Les avis et objectifs des analystes ne sont pas des conseils d\'investissement.', 'Sources'));
  },

  fundEtfPanel(key, k, d) {
    const proxySym = ETF_PROXY[k.profile];
    const proxy = proxySym && typeof Holdings !== 'undefined' ? Object.assign({ sym: proxySym }, Holdings.load()[proxySym] || {}) : null;
    const v = Fundamentals.etfView(d, proxy);
    const cur = (Store.instrument(key) || {}).currency || 'EUR';
    const exp = typeof Expo !== 'undefined' ? Expo.of(key) : null;
    const ter = v.ter !== null ? v.ter : exp && isFinite(exp.ter) ? exp.ter : null;
    const big = x => fmtBigMoney(x, cur);
    const tiles = [
      this.fundTile('Frais courants', ter !== null ? fmtNum(ter, 2) + ' % par an' : null, 'Frais de gestion prélevés chaque année sur la valeur de l\'ETF (TER), déjà inclus dans son cours.' + (v.ter === null && ter !== null ? ' Valeur du catalogue de l\'appli : Yahoo ne la publie pas pour cet ETF.' : '')),
      this.fundTile('Performance annualisée 3 ans', v.r3 !== null ? fmtPct(v.r3, 1) + ' par an' : null, 'Rendement moyen par an sur les 3 dernières années, frais déduits.', trendClass(v.r3)),
      this.fundTile('Performance annualisée 5 ans', v.r5 !== null ? fmtPct(v.r5, 1) + ' par an' : null, 'Rendement moyen par an sur les 5 dernières années, frais déduits.', trendClass(v.r5)),
      this.fundTile('Depuis le 1er janvier', v.ytd !== null ? fmtPct(v.ytd, 1) : null, null, trendClass(v.ytd)),
      this.fundTile('Encours', big(v.totalAssets), 'Somme gérée par l\'ETF. Plus elle est élevée, plus l\'ETF est liquide et a peu de risque d\'être fermé.'),
      this.fundTile('Distribution', v.yield !== null ? fmtPct(v.yield, 2, false) + ' par an' : (v.yield === null && d && d.summaryDetail && Fundamentals.raw(d.summaryDetail.yield) === 0 ? 'capitalisant' : null),
        'Capitalisant : les dividendes des sociétés sont réinvestis dans l\'ETF (pratique dans un PEA). Sinon : rendement versé chaque année.'),
      this.fundTile('Société de gestion', v.family ? v.family.replace(/\s+(S\.A\.|SA|Ltd|Limited|AG|GmbH)\.?$/i, '') : null),
      this.fundTile('Création', v.inception ? fmtDate(v.inception) : null, 'Date de lancement de cette part de l\'ETF selon Yahoo. Une fusion ou un changement de domiciliation du fonds peut la rendre plus récente que l\'historique réel de l\'ETF.'),
    ].filter(Boolean);
    const maxS = Math.max(...v.sectors.map(s => s.pct), 1), maxH = Math.max(...v.holdings.map(h => h.pct), 1);
    const bars = (list, max, label) => el('ol', { class: 'fund-bars', 'aria-label': label }, ...list.map(x =>
      el('li', { title: `${x.name} : ${fmtNum(x.pct, 1)} %` },
        el('span', { class: 'fb-name' }, x.name),
        el('span', { class: 'fb-bar' }, el('span', { style: `width:${Math.max(1, (x.pct / max) * 100)}%` })),
        el('span', { class: 'fb-val mono' }, fmtNum(x.pct, 1) + ' %'))));
    if (!tiles.length && !v.sectors.length && !v.holdings.length) return null;
    return el('section', { class: 'fund-panel' },
      el('h3', {}, 'Composition & frais'),
      tiles.length ? el('div', { class: 'stats fund-stats' }, ...tiles) : null,
      v.sectors.length || v.holdings.length ? el('div', { class: 'fund-grid' },
        v.sectors.length ? el('div', { class: 'fund-box' }, el('h4', {}, 'Répartition par secteur'), bars(v.sectors, maxS, 'Répartition par secteur')) : null,
        v.holdings.length ? el('div', { class: 'fund-box' },
          el('h4', {}, `${v.holdings.length} premières lignes`, infoTip(v.source === 'own'
            ? 'Principales sociétés détenues par cet ETF et leur poids.'
            : `Yahoo ne publie pas la composition de cet ETF : ce sont les principales lignes de l'indice qu'il suit, d'après l'ETF américain ${v.source} (mêmes sociétés, poids très proches).`)),
          bars(v.holdings, maxH, 'Principales lignes'),
          v.source !== 'own' ? el('p', { class: 'small muted' }, `D'après l'indice suivi (ETF de référence ${v.source}).`) : null) : null) : null,
      noteTip('Données Yahoo Finance et des sociétés de gestion, mises à jour une fois par jour (composition : une fois par semaine). Performances passées : elles ne préjugent pas des performances futures.', 'Sources'));
  },
});

App.on('detail:selected', function (key) { this.loadDetailFund(key); });
