/*
 * Comparateur d'ETF côte à côte (Marchés › Comparer) : frais, performances, encours, éligibilité PEA, répartition par
 * secteur et surtout le recouvrement — la part du portefeuille de l'un qui est déjà dans l'autre.
 * Recouvrement : sur l'indice entier (table OVERLAP de features.js, en poids) et sur les principales lignes réelles
 * (Yahoo, ou celles de l'indice suivi via l'ETF américain de référence). Calcul pur (EtfCompare.overlap) testé.
 */
'use strict';

const EtfCompare = {
  /**
   * Recouvrement de deux listes de lignes [{ name, pct }] : sociétés communes (avec leurs deux poids), propres à chacun,
   * et somme des plus petits poids communs (part du portefeuille détenue des deux côtés, sur les lignes connues).
   */
  overlap(a, b) {
    const key = h => String(h.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const mb = new Map(b.map(h => [key(h), h]));
    const common = [], onlyA = [];
    for (const h of a) {
      const o = mb.get(key(h));
      if (o) { common.push({ name: h.name, a: h.pct, b: o.pct }); mb.delete(key(h)); } else onlyA.push(h);
    }
    return { common: common.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b)), onlyA, onlyB: Array.from(mb.values()),
      shared: common.reduce((s, c) => s + Math.min(c.a, c.b), 0) };
  },

  /** Recouvrement des deux indices suivis (en % du poids), d'après leur profil ; null si inconnu */
  indexOverlap(pa, pb) {
    if (!pa || !pb || pa === 'none' || pb === 'none' || pa === 'stock' || pb === 'stock') return null;
    if (pa === pb) return 100;
    const v = typeof OVERLAP !== 'undefined' ? OVERLAP[[pa, pb].sort().join('|')] : undefined;
    return isFinite(v) ? v : 0;
  },
};

Object.assign(App, {
  /** ETF suivis (portefeuille et liste de suivi) comparables */
  etfChoices() {
    return Store.trackedKeys().filter(k => { const f = Fundamentals.kindOf(k); return f && f.kind === 'etf'; });
  },

  renderEtfCompareForm() {
    const box = $('#etfCmpBody');
    if (!box) return;
    const keys = this.etfChoices();
    if (keys.length < 2) {
      box.replaceChildren(el('p', { class: 'muted' }, 'Il faut au moins deux ETF dans ton portefeuille ou ta liste de suivi pour les comparer. Ajoute un ETF à ta liste de suivi (Marchés › Suivi & fiches, ★) pour le comparer à ceux que tu détiens.'));
      return;
    }
    const st = this._etfCmp = this._etfCmp && keys.includes(this._etfCmp.a) && keys.includes(this._etfCmp.b) ? this._etfCmp : { a: keys[0], b: keys[1] };
    const sel = (side) => el('select', { 'aria-label': side === 'a' ? 'Premier ETF' : 'Second ETF', onchange: e => { st[side] = e.target.value; this.runEtfCompare(); } },
      ...keys.map(k => el('option', { value: k, selected: st[side] === k || null }, Store.label(k))));
    if (!$('#etfCmpForm')) {
      box.replaceChildren(el('div', { class: 'etfcmp-form', id: 'etfCmpForm' }, sel('a'), el('span', { class: 'muted' }, 'contre'), sel('b')), el('div', { id: 'etfCmpOut' }));
    }
    this.runEtfCompare();
  },

  async runEtfCompare() {
    const out = $('#etfCmpOut');
    if (!out || !this._etfCmp) return;
    const { a, b } = this._etfCmp;
    if (a === b) { out.replaceChildren(el('p', { class: 'muted' }, 'Choisis deux ETF différents.')); return; }
    const fa = Fundamentals.kindOf(a), fb = Fundamentals.kindOf(b);
    const token = this._etfCmpToken = {};
    out.replaceChildren(el('p', { class: 'muted small' }, 'Chargement des données des deux ETF…'));
    let da = null, db = null, err = '';
    try {
      try { await Holdings.refresh(); } catch (e) { /* lignes de l'indice indisponibles */ }
      [da, db] = await Promise.all([Fundamentals.get(fa.sym, 'etf'), Fundamentals.get(fb.sym, 'etf')]);
    } catch (e) { err = e.message || ''; }
    if (token !== this._etfCmpToken) return; // une autre comparaison a été demandée entre-temps
    if (err && !da && !db) {
      out.replaceChildren(el('p', { class: 'muted' }, /requête invalide/i.test(err)
        ? 'Comparaison indisponible : ton relais Yahoo doit être mis à jour (copie à nouveau proxy/cloudflare-worker.js dans ton worker Cloudflare, puis Deploy).'
        : 'Données indisponibles pour l\'instant (' + err + ').'));
      return;
    }
    out.replaceChildren(this.etfComparePanel(a, b, fa, fb, da, db));
    this.etfCompareTracking(a, b, token);
  },

  /** Ligne « Écart de suivi » du comparateur, remplie quand les historiques des deux ETF sont chargés */
  async etfCompareTracking(a, b, token) {
    if (typeof TrackDiff === 'undefined' || !Api.hasProxy()) return;
    const res = await Promise.all([a, b].map(k => this.trackingFor(k).catch(() => null)));
    if (token !== this._etfCmpToken) return;
    const vals = res.map(r => (r && r.S && isFinite(r.S.avg) ? r.S.avg : r && r.S ? r.S.ann : NaN));
    const best = isFinite(vals[0]) && isFinite(vals[1]) && vals[0] !== vals[1] ? (vals[0] > vals[1] ? 0 : 1) : -1;
    ['#etfCmpTdA', '#etfCmpTdB'].forEach((sel, i) => {
      const cell = $(sel);
      if (!cell) return;
      const v = vals[i];
      cell.textContent = isFinite(v) ? (v >= 0 ? '+' : '−') + fmtNum(Math.abs(v * 100), 2) + ' pt' + (best === i ? ' ✓' : '') : '—';
      cell.title = res[i] && res[i].reason ? res[i].reason : '';
      const td = cell.closest('td');
      if (td) { td.className = 'num' + (best === i ? ' up' : ''); }
    });
  },

  etfComparePanel(a, b, fa, fb, da, db) {
    const proxy = p => (ETF_PROXY[p] ? Object.assign({ sym: ETF_PROXY[p] }, Holdings.load()[ETF_PROXY[p]] || {}) : null);
    const va = Fundamentals.etfView(da, proxy(fa.profile)), vb = Fundamentals.etfView(db, proxy(fb.profile));
    const ea = Expo.of(a), eb = Expo.of(b);
    const la = Store.label(a), lb = Store.label(b);
    const ix = EtfCompare.indexOverlap(ea.profile, eb.profile);
    const ov = EtfCompare.overlap(va.holdings, vb.holdings);
    const profileLabel = e => (EXPO_PROFILES[e.profile] ? EXPO_PROFILES[e.profile].label : 'indice inconnu');
    const ter = (v, e) => (v.ter !== null ? v.ter : isFinite(e.ter) ? e.ter : null);
    const pea = k => { const s = Expo.dbSymbol(Store.instrument(k)); return PEA_ELIGIBLE.has(s) ? 'oui' : (US_FUNDS.has(s) ? 'non (fonds américain)' : 'à vérifier'); };
    const num = (x, f) => (x === null || x === undefined || !isFinite(x) ? '—' : f(x));

    // verdict de recouvrement
    let verdict;
    if (ix === 100) verdict = { tone: 'down', text: `Doublon : ${la} et ${lb} suivent le même indice (${profileLabel(ea)}). Les détenir tous les deux n'apporte aucune diversification ; seuls les frais, l'encours ou l'éligibilité au PEA les départagent.` };
    else if (ix !== null && ix >= 50) verdict = { tone: 'warn', text: `Fort recouvrement : environ ${fmtNum(ix, 0)} % du poids de ces deux indices porte sur les mêmes sociétés. Les combiner surpondère surtout ce qu'ils ont en commun.` };
    else if (ix !== null && ix >= 20) verdict = { tone: '', text: `Recouvrement partiel : environ ${fmtNum(ix, 0)} % du poids en commun. Ils se complètent en partie.` };
    else if (ix !== null) verdict = { tone: 'up', text: `Peu de recouvrement (environ ${fmtNum(ix, 0)} % du poids en commun) : ces deux ETF se complètent bien.` };
    else verdict = { tone: '', text: 'Indice suivi inconnu pour l\'un des deux ETF : recouvrement estimé seulement sur leurs principales lignes ci-dessous.' };

    /** Ligne du tableau ; `best` : 'low' ou 'high' met en avant la meilleure des deux valeurs numériques */
    const row = (label, x, y, raw, best) => {
      const [rx, ry] = raw || [NaN, NaN];
      const win = best && isFinite(rx) && isFinite(ry) && rx !== ry ? ((best === 'low') === (rx < ry) ? 0 : 1) : -1;
      const cls = raw ? 'num' : 'txt'; // texte (indice, société de gestion) dans la police courante
      return el('tr', {}, el('th', { scope: 'row' }, label),
        el('td', { class: cls + (win === 0 ? ' up' : '') }, x, win === 0 ? ' ✓' : ''), el('td', { class: cls + (win === 1 ? ' up' : '') }, y, win === 1 ? ' ✓' : ''));
    };
    const ta = ter(va, ea), tb = ter(vb, eb);
    const table = el('div', { class: 'table-wrap' }, el('table', { class: 'data etfcmp-table' },
      el('thead', {}, el('tr', {}, el('th', {}), el('th', { class: 'num' }, el('span', { class: 'etfcmp-dot a' }), la), el('th', { class: 'num' }, el('span', { class: 'etfcmp-dot b' }), lb))),
      el('tbody', {},
        row('Indice suivi', profileLabel(ea), profileLabel(eb)),
        row('Frais courants', num(ta, x => fmtNum(x, 2) + ' %'), num(tb, x => fmtNum(x, 2) + ' %'), [ta, tb], 'low'),
        el('tr', {}, el('th', { scope: 'row' }, 'Écart de suivi par an', infoTip('Performance de l\'ETF moins celle de son indice (dividendes nets réinvestis), en moyenne sur les années complètes des 6 dernières années. Plus il est proche de zéro (ou positif), mieux l\'ETF suit son indice, frais compris. Détail dans la fiche de chaque ETF.')),
          el('td', { class: 'num' }, el('span', { id: 'etfCmpTdA' }, '…')), el('td', { class: 'num' }, el('span', { id: 'etfCmpTdB' }, '…'))),
        row('Perf. annualisée 3 ans', num(va.r3, x => fmtPct(x, 1)), num(vb.r3, x => fmtPct(x, 1)), [va.r3, vb.r3], 'high'),
        row('Perf. annualisée 5 ans', num(va.r5, x => fmtPct(x, 1)), num(vb.r5, x => fmtPct(x, 1)), [va.r5, vb.r5], 'high'),
        row('Depuis le 1er janvier', num(va.ytd, x => fmtPct(x, 1)), num(vb.ytd, x => fmtPct(x, 1)), [va.ytd, vb.ytd]),
        row('Encours', num(va.totalAssets, x => fmtBigMoney(x, (Store.instrument(a) || {}).currency)), num(vb.totalAssets, x => fmtBigMoney(x, (Store.instrument(b) || {}).currency)), [va.totalAssets, vb.totalAssets], 'high'),
        row('Éligible au PEA', pea(a), pea(b)),
        row('Société de gestion', va.family || '—', vb.family || '—'))));

    // secteurs côte à côte
    const names = Array.from(new Set([...va.sectors.map(s => s.name), ...vb.sectors.map(s => s.name)]));
    const sa = new Map(va.sectors.map(s => [s.name, s.pct])), sb = new Map(vb.sectors.map(s => [s.name, s.pct]));
    // côté sans données de secteurs chez Yahoo : « — » plutôt qu'un 0 % trompeur
    const hasA = va.sectors.length > 0, hasB = vb.sectors.length > 0;
    const rows = names.map(n => ({ n, a: sa.get(n) || 0, b: sb.get(n) || 0 })).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)).slice(0, 8);
    const maxS = Math.max(1, ...rows.flatMap(r => [r.a, r.b]));
    const pv = (has, v) => (has ? fmtNum(v, 0) : '—');
    const sectors = rows.length ? el('div', { class: 'fund-box' },
      el('h4', {}, 'Répartition par secteur'),
      el('div', { class: 'etfcmp-legend small muted' }, el('span', { class: 'etfcmp-dot a' }), la, el('span', { class: 'etfcmp-dot b' }), lb),
      el('ol', { class: 'etfcmp-bars' }, ...rows.map(r => el('li', { title: `${r.n} : ${la} ${fmtNum(r.a, 1)} %, ${lb} ${fmtNum(r.b, 1)} %` },
        el('span', { class: 'fb-name' }, r.n),
        el('span', { class: 'etfcmp-pair' },
          el('span', { class: 'fb-bar' }, el('span', { class: 'a', style: `width:${Math.max(r.a ? 1 : 0, r.a / maxS * 100)}%` })),
          el('span', { class: 'fb-bar' }, el('span', { class: 'b', style: `width:${Math.max(r.b ? 1 : 0, r.b / maxS * 100)}%` }))),
        el('span', { class: 'fb-val mono' }, pv(hasA, r.a) + ' / ' + pv(hasB, r.b) + ' %')))),
      !hasA || !hasB ? el('p', { class: 'small muted' }, `Yahoo ne publie pas la répartition par secteur de ${!hasA ? la : lb}.`) : null) : null;

    // principales lignes en commun
    const src = v => (v.source === 'own' ? 'publiées par l\'ETF' : `de l'indice suivi (via ${v.source})`);
    const lines = va.holdings.length && vb.holdings.length ? el('div', { class: 'fund-box' },
      el('h4', {}, 'Principales lignes', infoTip(`Les ${va.holdings.length} et ${vb.holdings.length} premières lignes connues (${la} : ${src(va)} ; ${lb} : ${src(vb)}). « En commun » : part du poids détenue des deux côtés (le plus petit des deux poids, ligne par ligne).`)),
      el('p', { class: 'small' }, ov.common.length
        ? [el('b', {}, `${ov.common.length} société${ov.common.length > 1 ? 's' : ''} en commun`), ` parmi les premières lignes, soit ${fmtNum(ov.shared, 1)} % du poids des deux côtés.`]
        : 'Aucune société en commun parmi les premières lignes.'),
      ov.common.length ? el('ul', { class: 'etfcmp-common' }, ...ov.common.slice(0, 8).map(c => el('li', {}, el('span', {}, c.name), el('span', { class: 'mono small' }, `${fmtNum(c.a, 1)} % / ${fmtNum(c.b, 1)} %`)))) : null,
      ov.onlyA.length || ov.onlyB.length ? el('p', { class: 'small muted' },
        ov.onlyA.length ? `Seulement dans ${la} : ${ov.onlyA.slice(0, 4).map(h => h.name).join(', ')}. ` : '',
        ov.onlyB.length ? `Seulement dans ${lb} : ${ov.onlyB.slice(0, 4).map(h => h.name).join(', ')}.` : '') : null) : null;

    return el('div', { class: 'etfcmp' },
      el('p', { class: 'etfcmp-verdict ' + verdict.tone }, verdict.text),
      table,
      sectors || lines ? el('div', { class: 'fund-grid' }, sectors, lines) : null,
      noteTip('Frais, performances, encours et secteurs : Yahoo Finance (mis à jour chaque jour) ; frais du catalogue de l\'appli quand Yahoo ne les publie pas. Recouvrement des indices : ordres de grandeur en poids. Performances passées : elles ne préjugent pas des performances futures. Éligibilité au PEA : indicative, à vérifier sur le DIC.', 'Sources'));
  },
});

App.on('view:shown', function (page) { if (page === 'markets/comparer') this.renderEtfCompareForm(); });
