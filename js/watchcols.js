/*
 * Liste de suivi enrichie (Marchés › Suivi & fiches) : colonnes à choisir (prochaine publication, potentiel selon les
 * analystes, avis, PER, rendement du dividende) et tri par colonne. Données Yahoo lues par le relais (type=summary,
 * modules financialData + summaryDetail), gardées 24 h ; dates de résultats : cache de l'agenda (Earnings).
 * Choix des colonnes et tri mémorisés dans ce navigateur.
 */
'use strict';

const WATCH_VIEW_STORE = 'apistock:watchView';
const WATCH_QUICK_MODULES = 'financialData,summaryDetail';

/* Colonnes en option : libellé, explication, valeur (pour le tri) et affichage */
const WATCH_COLS = {
  earn: { label: 'Résultats', tip: 'Date de la prochaine publication de résultats (actions).' },
  upside: { label: 'Potentiel', tip: 'Écart entre l\'objectif de cours moyen des analystes à 12 mois et le cours actuel.' },
  reco: { label: 'Avis', tip: 'Consensus des analystes (achat fort, achat, conserver, vente).' },
  pe: { label: 'PER', tip: 'Cours divisé par le bénéfice des 12 derniers mois.' },
  yield: { label: 'Rendement', tip: 'Dividendes (ou distributions d\'un ETF) sur un an, divisés par le cours.' },
};

const WatchCols = {
  /** Valeurs d'une ligne pour les colonnes en option (null si inconnues) */
  values(quick, earnData, price) {
    const r = Fundamentals.raw;
    const fd = (quick && quick.financialData) || {}, sd = (quick && quick.summaryDetail) || {};
    const cur = isFinite(price) && price > 0 ? price : r(fd.currentPrice);
    const target = r(fd.targetMeanPrice);
    const n = earnData && typeof Earnings !== 'undefined' ? Earnings.next(earnData) : null;
    const dy = r(sd.dividendYield) !== null ? r(sd.dividendYield) : r(sd.yield);
    return {
      earn: n && n.day >= todayISO() ? n.day : null,
      upside: target !== null && cur ? (target / cur - 1) * 100 : null,
      reco: r(fd.recommendationMean),
      pe: r(sd.trailingPE) !== null && r(sd.trailingPE) > 0 ? r(sd.trailingPE) : null,
      yield: dy !== null ? dy * 100 : null,
    };
  },

  /** Tri : les valeurs inconnues toujours à la fin, quel que soit le sens */
  sort(list, get, dir) {
    return list.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      const nx = x === null || x === undefined || (typeof x === 'number' && !isFinite(x));
      const ny = y === null || y === undefined || (typeof y === 'number' && !isFinite(y));
      if (nx || ny) return nx - ny;
      const c = typeof x === 'string' ? x.localeCompare(y, 'fr') : x - y;
      return dir === 'desc' ? -c : c;
    });
  },
};

Object.assign(App, {
  watchView() {
    if (!this._watchView) {
      let v = null;
      try { v = JSON.parse(localStorage.getItem(WATCH_VIEW_STORE) || 'null'); } catch (e) { v = null; }
      this._watchView = { cols: (v && Array.isArray(v.cols) ? v.cols : []).filter(c => WATCH_COLS[c]), sort: v && v.sort ? v.sort : null };
    }
    return this._watchView;
  },
  saveWatchView() { try { localStorage.setItem(WATCH_VIEW_STORE, JSON.stringify(this.watchView())); } catch (e) { /* stockage indisponible */ } },

  /** Données des colonnes en option : chargées en arrière-plan pour les lignes qui n'en ont pas (ou trop anciennes) */
  loadWatchData() {
    const cols = this.watchView().cols;
    if (!cols.length || !Api.hasProxy() || this._watchLoading) return;
    if (cols.includes('earn') && typeof Earnings !== 'undefined') {
      Earnings.refresh().then(ch => { if (ch) this.renderWatchlist(); }).catch(() => {});
    }
    if (!cols.some(c => c !== 'earn')) return;
    const c = Fundamentals.load(), now = Date.now();
    const syms = Store.state.watchlist.map(k => this.watchSym(k)).filter(Boolean)
      .filter(s => !c[s + '|quick'] || now - c[s + '|quick'].ts > Fundamentals.TTL);
    if (!syms.length || now - (this._watchFailAt || 0) < 10 * 60000) return;
    this._watchLoading = (async () => {
      try {
        for (let i = 0; i < syms.length; i += 20) {
          const chunk = syms.slice(i, i + 20);
          const json = await Api.yahoo({ type: 'summary', symbols: chunk.join(','), modules: WATCH_QUICK_MODULES });
          for (const s of chunk) c[s + '|quick'] = { ts: Date.now(), kind: 'quick', data: (json && json.results && json.results[s]) || null };
        }
        Fundamentals.save();
      } catch (e) { this._watchFailAt = Date.now(); }
      this._watchLoading = null;
      this.renderWatchlist();
    })();
  },

  /** Symbole Yahoo d'une ligne de la liste (actions et ETF ; ni indices, ni devises, ni crypto) */
  watchSym(k) {
    const f = typeof Fundamentals !== 'undefined' ? Fundamentals.kindOf(k) : null;
    return f ? f.sym : null;
  },

  watchCellValues(k) {
    const sym = this.watchSym(k);
    const c = Fundamentals.load();
    const quick = sym && c[sym + '|quick'] ? c[sym + '|quick'].data : null;
    const ec = typeof Earnings !== 'undefined' ? Earnings.load() : {};
    const ed = sym && ec[sym] ? ec[sym].data : null;
    const q = Api.cachedQuote(k);
    return WatchCols.values(quick, ed, q && q.price);
  },

  /** En-tête : colonnes de base et colonnes choisies, cliquables pour trier */
  watchHead() {
    const V = this.watchView();
    const th = (id, label, num, tip) => {
      const on = V.sort && V.sort.col === id;
      return el('th', { class: (num ? 'num ' : '') + 'sortable' + (on ? ' sorted' : ''), title: tip || 'Trier', 'aria-sort': on ? (V.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
        onclick: () => {
          // 1er clic : ordre le plus utile (texte et dates croissants, nombres décroissants), 2e : inverse, 3e : ordre de la liste
          const first = id === 'sym' || id === 'earn' ? 'asc' : 'desc', other = first === 'asc' ? 'desc' : 'asc';
          V.sort = !on ? { col: id, dir: first } : V.sort.dir === first ? { col: id, dir: other } : null;
          this.saveWatchView(); this.renderWatchlist();
        } }, label, on ? (V.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    };
    return el('tr', {}, th('sym', 'Symbole'), th('price', 'Cours', true), th('chg', 'Var.', true), th('pct', 'Var. %', true),
      ...V.cols.map(cid => th(cid, WATCH_COLS[cid].label, true, WATCH_COLS[cid].tip)),
      el('th', { class: 'num' }, 'Plus bas / haut'), el('th', {}));
  },

  /** Ordre d'affichage selon le tri choisi (sinon l'ordre de la liste) */
  watchOrder(keys) {
    const V = this.watchView();
    if (!V.sort) return keys;
    const q = k => Api.cachedQuote(k);
    const get = {
      sym: k => Store.label(k), price: k => (q(k) ? q(k).price : null), chg: k => (q(k) ? q(k).change : null), pct: k => (q(k) ? q(k).percentChange : null),
    }[V.sort.col] || (k => this.watchCellValues(k)[V.sort.col]);
    return WatchCols.sort(keys, get, V.sort.dir);
  },

  /** Cellules des colonnes choisies pour une ligne */
  watchCells(k) {
    const v = this.watchCellValues(k);
    const dash = () => el('span', { class: 'muted' }, '—'); // un élément par case (un nœud ne peut être affiché qu'à un endroit)
    return this.watchView().cols.map(cid => {
      if (cid === 'earn') return el('td', { class: 'num' }, v.earn ? fmtDate(v.earn).replace(/ \d{4}$/, '') : dash());
      if (cid === 'upside') return el('td', { class: 'num' }, v.upside !== null ? el('span', { class: trendClass(v.upside) }, fmtPct(v.upside, 0)) : dash());
      if (cid === 'reco') { const c = Fundamentals.consensus(v.reco); return el('td', { class: 'num' }, c ? el('span', { class: c.tone }, c.label) : dash()); }
      if (cid === 'pe') return el('td', { class: 'num' }, v.pe !== null ? fmtNum(v.pe, 1) : dash());
      return el('td', { class: 'num' }, v.yield !== null && v.yield > 0 ? fmtNum(v.yield, 2) + ' %' : dash());
    });
  },

  /** Menu « Colonnes » de la liste de suivi */
  renderWatchCols() {
    const box = $('#watchCols');
    if (!box) return;
    const V = this.watchView();
    box.replaceChildren(
      el('summary', { class: 'btn small' }, 'Colonnes' + (V.cols.length ? ` (${V.cols.length})` : '')),
      el('div', { class: 'watch-cols-menu' },
        el('p', { class: 'small muted' }, 'Colonnes en plus (données Yahoo, mises à jour chaque jour) :'),
        ...Object.entries(WATCH_COLS).map(([id, c]) => el('label', { class: 'check small' },
          el('input', { type: 'checkbox', checked: V.cols.includes(id) || null, onchange: e => {
            V.cols = e.target.checked ? Object.keys(WATCH_COLS).filter(x => x === id || V.cols.includes(x)) : V.cols.filter(x => x !== id);
            if (!e.target.checked && V.sort && V.sort.col === id) V.sort = null;
            this.saveWatchView(); this.renderWatchCols(); this.renderWatchlist(); this.loadWatchData();
          } }), c.label, el('span', { class: 'muted' }, ' · ' + c.tip)))));
    // liste élargie (pleine largeur, fiche en dessous) dès qu'une colonne est ajoutée
    const grid = box.closest('.grid-2');
    if (grid) grid.classList.toggle('watch-wide', V.cols.length > 0);
  },
});

App.on('view:shown', function (page) { if (page === 'markets/suivi') { this.renderWatchCols(); this.loadWatchData(); } });
