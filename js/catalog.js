/*
 * Catalogue d'ETF et portefeuilles types : parcourir les ETF connus du site par zone (frais, éligibilité PEA)
 * et partir d'une allocation type, appliquée comme allocation cible (les lignes sont créées au passage).
 * Exemples pédagogiques, pas des conseils d'investissement.
 */
'use strict';

/* Zones proposées, dans l'ordre d'affichage (profils d'exposition de features.js) */
const CATALOG_ZONES = ['world', 'allworld', 'sp500', 'ndx', 'europe', 'es50', 'cac', 'em', 'japan', 'gold'];

/* Portefeuilles types : répartition par zone, en % */
const MODEL_PORTFOLIOS = [
  { id: 'world', name: 'Monde, un seul ETF', desc: 'Le plus simple : environ 1 400 entreprises de 23 pays développés, rééquilibrées par l\'indice lui-même.', mix: { world: 100 } },
  { id: 'world-em', name: 'Monde + émergents', desc: 'Les pays développés complétés par les émergents (Chine, Inde, Taïwan…), à peu près dans leur poids mondial.', mix: { world: 88, em: 12 } },
  { id: 'us-eu-em', name: 'États-Unis, Europe, émergents', desc: 'Trois blocs dont tu choisis le dosage : ici moins d\'États-Unis que dans un ETF monde.', mix: { sp500: 60, europe: 30, em: 10 } },
  { id: 'world-tech', name: 'Monde + technologie', desc: 'Une base monde et une poche Nasdaq-100 : plus de croissance attendue, plus de variations aussi.', mix: { world: 80, ndx: 20 } },
  { id: 'world-gold', name: 'Monde + or', desc: 'Une petite part d\'or, qui a souvent moins baissé que les actions pendant les crises.', mix: { world: 90, gold: 10 } },
];

const Catalog = {
  /** ETF connus d'une zone (hors fonds américains, non accessibles aux particuliers européens), du moins cher au plus cher */
  list(zone, { pea = false } = {}) {
    return Object.entries(ETF_DB)
      .filter(([s, [p]]) => (!zone || p === zone) && !US_FUNDS.has(s) && (!pea || PEA_ELIGIBLE.has(s)))
      .map(([s, [p, ter]]) => ({ symbol: s, zone: p, ter, pea: PEA_ELIGIBLE.has(s) }))
      .sort((a, b) => a.ter - b.ter || a.symbol.localeCompare(b.symbol));
  },

  /** Zone remplaçante sur PEA quand aucun ETF de la zone n'y est éligible */
  peaFallback: { allworld: 'world', gold: null, japan: 'japan' },

  /**
   * Portefeuille type → lignes concrètes : l'ETF le moins cher de chaque zone (éligible PEA si demandé).
   * Les zones sans ETF éligible sont reportées sur une zone proche, ou réparties sur les autres lignes.
   */
  build(model, { pea = false } = {}) {
    const lines = [];
    let dropped = 0;
    for (const [zone, w] of Object.entries(model.mix)) {
      let z = zone, pick = this.list(z, { pea })[0];
      if (!pick && pea && this.peaFallback[zone]) { z = this.peaFallback[zone]; pick = this.list(z, { pea })[0]; }
      if (!pick) { dropped += w; continue; }
      const same = lines.find(l => l.symbol === pick.symbol);
      if (same) same.weight += w; else lines.push(Object.assign({}, pick, { weight: w }));
    }
    if (dropped && lines.length) {
      const sum = lines.reduce((s, l) => s + l.weight, 0);
      for (const l of lines) l.weight = Math.round(l.weight / sum * 1000) / 10;
    }
    const ter = lines.reduce((s, l) => s + l.weight * l.ter, 0) / (lines.reduce((s, l) => s + l.weight, 0) || 1);
    return { lines, ter, dropped };
  },
};

Object.assign(App, {
  catalogState: null,

  /** Ajoute une ligne à partir de son symbole (recherche), en préférant les places indiquées ; renvoie sa clé */
  async addBySymbol(symbol, mics = ['XPAR', 'XETR', 'XAMS', 'XMIL', 'XLON']) {
    const known = Object.keys(Store.state.instruments).find(k => Store.instrument(k).symbol === symbol && (!mics.length || mics.includes(Store.instrument(k).mic)));
    if (known) return known;
    const res = (await Api.search(symbol)).filter(d => (d.symbol || '').toUpperCase() === symbol.toUpperCase());
    if (!res.length) throw new Error(symbol + ' introuvable');
    res.sort((a, b) => ((mics.indexOf(a.mic) + 1 || 99) - (mics.indexOf(b.mic) + 1 || 99)));
    const d = res[0];
    const key = Store.upsertInstrument({ symbol: d.symbol, mic: d.mic, exchange: d.exchange, name: d.name, currency: d.currency, type: d.type,
      provider: d.provider, ysymbol: d.ysymbol, short: d.short, isin: d.isin });
    const inst = Store.instrument(key);
    inst.provider = d.provider; inst.ysymbol = d.ysymbol || inst.ysymbol || ''; Store.save();
    return key;
  },

  /** Applique un portefeuille type comme allocation cible */
  async applyModel(model, pea) {
    const { lines } = Catalog.build(model, { pea });
    if (Object.values(Store.state.targets).some(v => parseNum(v) > 0)
      && !confirm(`Remplacer ton allocation cible actuelle par « ${model.name} » ?`)) return;
    const keys = [];
    for (const l of lines) {
      try { keys.push([await this.addBySymbol(l.symbol, pea ? ['XPAR'] : undefined), l.weight]); }
      catch (e) { toast(`${l.symbol} : ${e.message}`, 'error', 5000); return; }
    }
    for (const k of Object.keys(Store.state.targets)) Store.state.targets[k] = 0;
    for (const [k, w] of keys) Store.state.targets[k] = w;
    Store.save();
    this.renderAll();
    this.refresh();
    this.show('invest');
    toast(`Allocation « ${model.name} » appliquée : indique le montant à investir pour obtenir ton plan d'achat.`, 'success', 6000);
  },

  renderCatalog() {
    const box = $('#catalogBody');
    if (!box) return;
    const st = this.catalogState = this.catalogState || { zone: 'world', pea: Store.state.accounts.some(a => a.type === 'pea') };
    const peaBox = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: st.pea, onchange: e => { st.pea = e.target.checked; this.renderCatalog(); } }), 'Éligibles PEA uniquement');

    // portefeuilles types
    const models = MODEL_PORTFOLIOS.map(m => {
      const b = Catalog.build(m, { pea: st.pea });
      return el('div', { class: 'model-card' },
        el('div', { class: 'model-head' }, el('b', {}, m.name), el('span', { class: 'mono small muted' }, `frais ${fmtNum(b.ter, 2)} %/an`)),
        el('p', { class: 'muted small' }, m.desc),
        el('div', { class: 'model-bar' }, ...b.lines.map((l, i) => el('span', { style: `width:${l.weight}%;background:${PALETTE[i % PALETTE.length]}`, title: `${l.symbol} : ${fmtNum(l.weight, 1)} %` }))),
        el('ul', { class: 'model-lines' }, ...b.lines.map((l, i) => el('li', {},
          el('span', { class: 'dot', style: 'background:' + PALETTE[i % PALETTE.length] }),
          el('b', {}, l.symbol), el('span', { class: 'muted small' }, ' ' + EXPO_PROFILES[l.zone].label.split(' (')[0] + (l.pea ? ' · PEA' : '')),
          el('span', { class: 'mono' }, fmtNum(l.weight, l.weight % 1 ? 1 : 0) + ' %')))),
        b.dropped ? el('p', { class: 'small muted' }, `Pas d'équivalent éligible PEA pour ${fmtNum(b.dropped, 0)} % : réparti sur les autres lignes.`) : null,
        el('button', { type: 'button', class: 'btn small', disabled: Api.ready() ? null : true, onclick: async ev => {
          ev.target.disabled = true; ev.target.textContent = 'Ajout des lignes…';
          try { await this.applyModel(m, st.pea); } finally { ev.target.disabled = false; ev.target.textContent = 'Utiliser comme cible'; }
        } }, 'Utiliser comme cible'));
    });

    // catalogue par zone
    const zones = CATALOG_ZONES.filter(z => Catalog.list(z, { pea: st.pea }).length);
    if (!zones.includes(st.zone)) st.zone = zones[0];
    const list = Catalog.list(st.zone, { pea: st.pea });
    const held = new Set(Object.values(Store.state.instruments).map(i => (i.symbol || '').toUpperCase()));
    box.replaceChildren(
      el('div', { class: 'catalog-opts' }, peaBox),
      el('h3', {}, 'Portefeuilles types', infoTip('Des points de départ courants, avec l\'ETF le moins cher connu du site pour chaque zone. Exemples pédagogiques, pas des conseils : adapte-les à ton horizon et à ta tolérance aux baisses. « Utiliser comme cible » remplace ton allocation cible (onglet Investir), sans rien acheter.')),
      el('div', { class: 'model-grid' }, ...models),
      el('h3', {}, 'Catalogue', infoTip('ETF connus du site, du moins cher au plus cher (frais courants annuels, TER). Vérifie toujours le document d\'informations clés (DIC) avant d\'acheter : réplication, distribution, encours.')),
      el('div', { class: 'seg catalog-zones' }, ...zones.map(z => el('button', { class: z === st.zone ? 'active' : '', onclick: () => { st.zone = z; this.renderCatalog(); } }, EXPO_PROFILES[z].label.split(' (')[0]))),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'ETF'), el('th', {}, 'Indice suivi'), el('th', { class: 'num' }, 'Frais / an'), el('th', {}, 'PEA'), el('th'))),
        el('tbody', {}, ...list.map(e => el('tr', {},
          el('td', {}, el('span', { class: 'sym' }, e.symbol), held.has(e.symbol) ? el('span', { class: 'tag' }, 'suivi') : null),
          el('td', { class: 'muted' }, EXPO_PROFILES[e.zone].label),
          el('td', { class: 'num mono' }, fmtNum(e.ter, 2) + ' %'),
          el('td', {}, e.pea ? '✔' : ''),
          el('td', { class: 'num' }, el('button', { type: 'button', class: 'btn small', onclick: async ev => {
            ev.target.disabled = true;
            try { const k = await this.addBySymbol(e.symbol); if (!Store.state.watchlist.includes(k) && !Portfolio.positions('all').some(p => p.key === k)) { Store.state.watchlist.push(k); Store.save(); } this.show('markets'); this.selectDetail(k); }
            catch (err) { toast(err.message, 'error'); } finally { ev.target.disabled = false; }
          } }, 'Voir'))))))));
  },
});
