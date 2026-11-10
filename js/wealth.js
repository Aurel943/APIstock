/* Patrimoine global : autres actifs saisis à la main (livrets, fonds euros, compte courant, immobilier…) */
'use strict';

/* Types d'actifs : `rate` = rémunération annuelle saisie (valeur estimée à la date du jour), `debt` = crédit restant */
const ASSET_TYPES = {
  livretA: { label: 'Livret A', cat: 'savings', rate: true },
  ldds: { label: 'LDDS', cat: 'savings', rate: true },
  lep: { label: 'LEP', cat: 'savings', rate: true },
  fondsEuros: { label: 'Fonds euros (assurance-vie)', cat: 'savings', rate: true },
  courant: { label: 'Compte courant', cat: 'cash' },
  immo: { label: 'Immobilier', cat: 'realEstate', debt: true },
  autre: { label: 'Autre', cat: 'other' },
};
const WEALTH_CATS = { securities: 'Titres', cash: 'Espèces', savings: 'Épargne', realEstate: 'Immobilier net', other: 'Autres' };

const Wealth = {
  list() { return Store.state.assets || []; },

  /** Valeur estimée d'un actif à une date : intérêts composés depuis la date de mise à jour (livrets, fonds euros), crédit déduit (immobilier) */
  valueOf(a, today = todayISO()) {
    const t = ASSET_TYPES[a.type] || ASSET_TYPES.autre;
    let v = parseNum(a.value) || 0;
    const rate = parseNum(a.rate);
    if (t.rate && rate > 0 && a.date && a.date < today) v *= Math.pow(1 + rate / 100, (Date.parse(today) - Date.parse(a.date)) / (365.25 * 864e5));
    if (t.debt) v -= parseNum(a.debt) || 0;
    return v;
  },

  /** Répartition du patrimoine (devise de base), tous comptes confondus */
  summary(today = todayISO()) {
    const { totals } = Portfolio.snapshot('all');
    const out = { securities: totals.value || 0, cash: Portfolio.cashTotal('all').cash || 0, savings: 0, realEstate: 0, other: 0, missing: totals.missing };
    for (const a of this.list()) out[(ASSET_TYPES[a.type] || ASSET_TYPES.autre).cat] += this.valueOf(a, today);
    out.total = out.securities + out.cash + out.savings + out.realEstate + out.other;
    return out;
  },

  /** Total des autres actifs (hors titres et espèces des comptes-titres) */
  othersTotal() { return this.list().reduce((s, a) => s + this.valueOf(a), 0); },

  /** Mémorise le patrimoine du mois en cours (au plus une écriture par jour, seulement si tous les cours sont connus) */
  record(s) {
    if (!(s.total > 0) || s.missing) return false;
    const h = Store.state.wealthHistory = Store.state.wealthHistory || {};
    const today = todayISO(), m = today.slice(0, 7);
    if (h[m] && h[m].date === today) return false;
    h[m] = { date: today, total: Math.round(s.total), securities: Math.round(s.securities) };
    return true;
  },
};

Object.assign(App, {
  bindWealth() {
    const dlg = $('#assetDialog');
    if (!dlg) return;
    const syncType = () => {
      const t = ASSET_TYPES[$('#assetType').value] || ASSET_TYPES.autre;
      $('#assetRateWrap').classList.toggle('hidden', !t.rate);
      $('#assetDebtWrap').classList.toggle('hidden', !t.debt);
    };
    this.openAsset = (a = null) => {
      this.editingAsset = a;
      $('#assetDialogTitle').textContent = a ? 'Modifier l\'actif' : 'Ajouter un actif';
      $('#assetType').value = a ? a.type : 'livretA';
      $('#assetName').value = a ? a.name : '';
      $('#assetValue').value = a ? a.value : '';
      $('#assetDebt').value = a && a.debt ? a.debt : '';
      $('#assetRate').value = a && a.rate !== undefined ? a.rate : '';
      $('#assetDate').value = a ? a.date : todayISO();
      $('#assetDate').max = todayISO();
      syncType();
      dlg.showModal();
    };
    $('#assetType').addEventListener('change', syncType);
    $('#assetAdd').addEventListener('click', () => this.openAsset());
    $('#assetCancel').addEventListener('click', () => dlg.close());
    $('#assetForm').addEventListener('submit', e => {
      e.preventDefault();
      const type = $('#assetType').value, t = ASSET_TYPES[type] || ASSET_TYPES.autre;
      const a = { type, name: $('#assetName').value.trim() || t.label, value: parseNum($('#assetValue').value), date: $('#assetDate').value || todayISO() };
      if (!(a.value >= 0)) { toast('Indique la valeur de l\'actif', 'error'); return; }
      if (t.rate && isFinite(parseNum($('#assetRate').value))) a.rate = parseNum($('#assetRate').value);
      if (t.debt && parseNum($('#assetDebt').value) > 0) a.debt = parseNum($('#assetDebt').value);
      Store.state.assets = Store.state.assets || [];
      if (this.editingAsset) {
        for (const k of ['rate', 'debt']) delete this.editingAsset[k];
        Object.assign(this.editingAsset, a);
      } else Store.state.assets.push(Object.assign({ id: uid() }, a));
      Store.save();
      dlg.close();
      this.renderAll();
      toast('Actif enregistré', 'success', 2000);
    });
  },

  renderWealth() {
    const box = $('#wealthBody');
    if (!box) return;
    const cur = this.base();
    const s = Wealth.summary();
    if (Wealth.record(s)) Store.save();
    const assets = Wealth.list();
    const cats = Object.keys(WEALTH_CATS).filter(k => Math.abs(s[k]) > 0.005);
    const pos = cats.filter(k => s[k] > 0).reduce((a, k) => a + s[k], 0);
    const color = {};
    cats.filter(k => s[k] > 0).forEach((k, i) => { color[k] = PALETTE[i % PALETTE.length]; });
    const hist = Object.entries(Store.state.wealthHistory || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const prev = hist.filter(([m]) => m < todayISO().slice(0, 7)).pop();
    const first = hist[0];
    const evo = [];
    if (prev) evo.push(`${fmtSignedMoney(s.total - prev[1].total, cur)} depuis fin ${MONTHS_FR[+prev[0].slice(5) - 1].toLowerCase()} ${prev[0].slice(0, 4)}`);
    if (first && first !== prev && first[0] < todayISO().slice(0, 7)) evo.push(`${fmtSignedMoney(s.total - first[1].total, cur)} depuis ${MONTHS_FR[+first[0].slice(5) - 1].toLowerCase()} ${first[0].slice(0, 4)}`);
    const today = todayISO();
    box.replaceChildren(...[
      el('div', { class: 'wealth-top' },
        el('div', {}, el('div', { class: 'muted small' }, 'Total estimé'), el('div', { class: 'wealth-total mono' }, fmtMoney(s.total, cur, 0)),
          el('div', { class: 'muted small' }, evo.length ? evo.join(' · ') : 'L\'évolution apparaîtra d\'un mois sur l\'autre.' + (s.missing ? ' (cours manquants)' : ''))),
        hist.length >= 2 ? sparkline(hist.map(([, v]) => v.total).concat(s.missing ? [] : [s.total]), { w: 160, h: 40 }) : null),
      cats.length ? el('div', { class: 'wealth-bar', role: 'img', 'aria-label': 'Répartition du patrimoine' },
        ...cats.filter(k => s[k] > 0).map(k => el('span', { style: `width:${(s[k] / pos) * 100}%;background:${color[k]}`, title: WEALTH_CATS[k] }))) : null,
      el('ul', { class: 'wealth-legend' }, ...cats.map(k => el('li', {},
        el('span', { class: 'dot', style: 'background:' + (color[k] || 'var(--muted)') }),
        el('span', {}, WEALTH_CATS[k]), el('b', { class: 'mono' }, fmtMoney(s[k], cur, 0)),
        el('span', { class: 'muted small' }, s[k] > 0 && pos > 0 ? fmtPct((s[k] / pos) * 100, 1, false) : '')))),
      assets.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Actif'), el('th', { class: 'num' }, 'Valeur estimée'), el('th', {}, 'Mise à jour'), el('th'))),
        el('tbody', {}, ...assets.map(a => {
          const t = ASSET_TYPES[a.type] || ASSET_TYPES.autre;
          const v = Wealth.valueOf(a, today);
          return el('tr', {},
            el('td', {}, el('span', { class: 'sym' }, a.name), el('span', { class: 'name' }, t.label + (t.rate && parseNum(a.rate) > 0 ? ' · ' + fmtNum(parseNum(a.rate), 2) + ' %/an' : ''))),
            el('td', { class: 'num' }, fmtMoney(v, cur, 0),
              t.debt && parseNum(a.debt) > 0 ? el('div', { class: 'small muted' }, fmtMoney(parseNum(a.value), cur, 0) + ' − crédit ' + fmtMoney(parseNum(a.debt), cur, 0)) : null),
            el('td', { class: 'muted small' }, fmtDate(a.date)),
            el('td', { class: 'num' },
              el('button', { class: 'iconbtn', title: 'Modifier', onclick: () => this.openAsset(a) }, '✎'),
              el('button', { class: 'iconbtn', title: 'Supprimer', onclick: () => {
                const idx = Store.state.assets.indexOf(a);
                Store.state.assets.splice(idx, 1); Store.markDeleted(a.id); Store.save(); this.renderAll();
                undoToast('Actif supprimé', () => { Store.state.assets.splice(Math.max(0, idx), 0, a); Store.unmarkDeleted(a.id); Store.save(); this.renderAll(); });
              } }, '🗑')));
        })))) : el('p', { class: 'muted small' }, 'Ajoute tes livrets, ton fonds euros, ton compte courant ou ton logement pour voir l\'ensemble de ton patrimoine.'),
      el('p', { class: 'muted small' }, 'Titres et espèces : tous tes comptes suivis ici. Livrets et fonds euros : valeur saisie, augmentée des intérêts depuis la date de mise à jour (estimation). Immobilier : valeur moins le crédit restant.'),
    ].filter(Boolean));
  },
});

// rendu avec le reste de l'écran et à chaque mise à jour des cours du portefeuille
(() => {
  const origAll = App.renderAll;
  App.renderAll = function () { origAll.apply(this, arguments); this.renderWealth(); };
  const origPf = App.renderPortfolio;
  App.renderPortfolio = function () { origPf.apply(this, arguments); this.renderWealth(); };
})();

document.addEventListener('DOMContentLoaded', () => { App.bindWealth(); App.renderWealth(); });
