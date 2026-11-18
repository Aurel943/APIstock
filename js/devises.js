/*
 * Devises et couverture de change (Analyse › Composition) : à quelles devises ton portefeuille est vraiment exposé
 * (en regardant dans tes ETF ; un ETF couvert contre le change compte dans sa devise de couverture), ce que te
 * coûterait une baisse de chaque devise face à l'euro, et pour tes ETF couverts ce que la couverture a réellement
 * coûté ou rapporté face à la même exposition non couverte.
 * ETF couverts repérés d'après leur nom (« EUR Hedged », « couvert », « (H) ») ou cochés à la main ligne par ligne.
 * Calculs purs (objet Fx) testés dans tests/devises.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const Fx = {
  /** Exposition par devise : rows [{ key, value }] et split(clé) → { ccy } → [{ ccy, pct, value }] du plus gros au plus petit */
  exposure(rows, split) {
    const total = rows.reduce((s, r) => s + (r.value > 0 ? r.value : 0), 0);
    const out = {};
    if (!(total > 0)) return [];
    for (const r of rows) {
      if (!(r.value > 0)) continue;
      const c = split(r.key).ccy || {};
      const sum = Object.values(c).reduce((a, b) => a + b, 0) || 1;
      for (const [k, v] of Object.entries(c)) out[k] = (out[k] || 0) + r.value * v / sum;
    }
    return Object.entries(out).map(([ccy, value]) => ({ ccy, value, pct: value / total * 100 })).sort((a, b) => b.value - a.value);
  },

  /** Effet en devise de base d'une variation `pct` (%) d'une devise face à la devise de base */
  shock(exposure, ccy, pct) {
    const e = exposure.find(x => x.ccy === ccy);
    return e ? e.value * pct / 100 : 0;
  },
};

Object.assign(App, {
  fxRows() {
    return Portfolio.snapshot().rows.filter(r => isFinite(r.valueBase) && r.valueBase > 0).map(r => ({ key: r.key, value: r.valueBase }));
  },

  renderFx() {
    const box = $('#fxBody');
    if (!box) return;
    const rows = this.fxRows();
    if (!rows.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des positions pour voir ton exposition aux devises.')); return; }
    const base = this.base(), m = x => fmtMoney(x, base, 0);
    const exp = Fx.exposure(rows, k => Expo.split(k)).filter(e => e.pct >= 0.5);
    const foreign = exp.filter(e => e.ccy !== base && !/^(\?|other|Crypto)$/.test(e.ccy));
    const st = this._fxShock = this._fxShock || { pct: -10 };
    const tbody = el('tbody');
    const draw = () => tbody.replaceChildren(...exp.map(e => {
      const isBase = e.ccy === base, hit = isBase || !foreign.includes(e) ? null : Fx.shock(exp, e.ccy, st.pct);
      return el('tr', {}, el('td', {}, e.ccy === 'other' ? 'Autres devises' : e.ccy === 'Crypto' ? 'Crypto-monnaies' : e.ccy),
        el('td', { class: 'num mono' }, fmtNum(e.pct, 1) + ' %'), el('td', { class: 'num mono' }, m(e.value)),
        el('td', { class: 'num mono ' + (hit === null ? 'muted' : trendClass(hit)) }, hit === null ? (isBase ? 'ta devise' : '—') : fmtSignedMoney(hit, base)));
    }));
    draw();
    const usd = foreign.find(e => e.ccy === 'USD') || foreign[0];
    const hedged = rows.filter(r => Expo.split(r.key).hedged);
    const lines = rows.filter(r => { const p = Expo.of(r.key).profile; return !['stock', 'crypto', 'none'].includes(p); });
    box.replaceChildren(
      el('p', { class: 'etfcmp-verdict fx-verdict' },
        foreign.length ? [`${fmtNum(foreign.reduce((s, e) => s + e.pct, 0), 0)} % de ton portefeuille dépend d'autres devises que l'${base === 'EUR' ? 'euro' : base}`,
          usd ? [', dont ', el('b', {}, `${fmtNum(usd.pct, 0)} % en ${usd.ccy}`), ` : une baisse de 10 % du ${usd.ccy === 'USD' ? 'dollar' : usd.ccy} face à l'euro te coûterait environ ${m(usd.value * 0.1)}.`] : '.']
          : 'Ton portefeuille est entièrement exposé à ta devise de référence (ou couvert vers elle).'),
      el('div', { class: 'fx-shock small' }, el('label', {}, 'Variation de chaque devise face à l\'euro ',
        el('input', { type: 'number', step: 1, min: -50, max: 50, value: st.pct, inputmode: 'decimal', 'aria-label': 'Variation des devises en %', oninput: e => { st.pct = parseNum(e.target.value) || 0; draw(); } }), ' %')),
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table fx-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Devise'), el('th', { class: 'num' }, 'Part'), el('th', { class: 'num' }, 'Montant'), el('th', { class: 'num' }, 'Effet de la variation'))), tbody)),
      lines.length ? el('details', { class: 'fx-hedge' }, el('summary', {}, `ETF couverts contre le change (${hedged.length})`),
        el('p', { class: 'small muted' }, 'Coche un ETF couvert que le site n\'a pas reconnu d\'après son nom : son exposition compte alors dans ta devise.'),
        el('ul', { class: 'fx-hedge-list' }, ...lines.map(r => {
          const inst = Store.instrument(r.key), h = Expo.split(r.key).hedged;
          return el('li', {}, el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: h || null, onchange: e => { inst.hedged = e.target.checked; inst.hedgeCcy = base; Store.save(); this.renderFx(); this.renderAll(); } }),
            ' ', Store.label(r.key), h ? el('small', { class: 'muted' }, ` couvert en ${h}`) : null),
            h && TD_REF[Expo.of(r.key).profile] ? el('button', { type: 'button', class: 'btn small', onclick: e => this.measureHedge(r.key, e.currentTarget) }, 'Coût de la couverture') : null,
            el('span', { class: 'fx-hedge-out small', id: 'fxh-' + r.key.replace(/[^A-Za-z0-9]/g, '_') }));
        }))) : null,
      noteTip('Exposition : répartition par devise des sociétés détenues par chaque ETF (profils d\'indice de l\'onglet Exposition), et non devise de cotation : un ETF MSCI World coté en euros reste exposé à 73 % au dollar. Un ETF couvert est compté dans sa devise de couverture. Coût de la couverture : performance de l\'ETF couvert, dividendes réinvestis, face au même indice non couvert converti en euros chaque jour (mêmes références que l\'écart de suivi) ; il reflète surtout l\'écart de taux d\'intérêt entre les deux devises et les mouvements de change évités.', 'Méthode'));
  },

  /** Coût (ou gain) annuel de la couverture d'un ETF couvert : pente du rapport ETF couvert / indice non couvert en euros */
  async measureHedge(key, btn) {
    const out = $('#fxh-' + key.replace(/[^A-Za-z0-9]/g, '_'));
    if (btn) btn.disabled = true;
    try {
      const ref = TD_REF[Expo.of(key).profile];
      const start = addDaysISO(todayISO(), -3 * 365);
      const inst = Store.instrument(key);
      const [px, ev, fx, refPx, refFx] = await Promise.all([Api.daily(key, start), Api.events(key, start), Api.fxSeries(inst.currency || this.base(), start),
        Api.daily('Y:' + ref.sym, start), Api.fxSeries(ref.ccy, start)]);
      const refDivs = ref.divs ? await this.tdRefDivs(ref.sym, start) : [];
      const a = TrackDiff.convert(TrackDiff.totalReturn(px, ev.divs), fx);
      const b = TrackDiff.convert(TrackDiff.grossUp(TrackDiff.totalReturn(refPx, refDivs), ref.adj), refFx);
      const common = TrackDiff.common(a, b);
      if (common.length < 60) throw new Error('pas assez d\'historique commun');
      const s = TrackDiff.slope(common), ra = common[common.length - 1][1] / common[0][1] - 1, rb = common[common.length - 1][2] / common[0][2] - 1;
      if (out) out.textContent = ` Depuis le ${fmtDate(common[0][0])} : ${fmtPct(ra * 100, 1)} couvert contre ${fmtPct(rb * 100, 1)} sans couverture, soit ${s.rate >= 0 ? '+' : '−'}${fmtNum(Math.abs(s.rate * 100), 2)} point par an ${s.rate >= 0 ? 'gagné' : 'perdu'} grâce à la couverture (frais compris).`;
    } catch (e) {
      if (out) out.textContent = ' Mesure indisponible (' + (e.message || e) + ').';
    } finally { if (btn) btn.disabled = false; }
  },
});

App.on('view:shown', function (page) { if (page === 'analysis/composition') this.renderFx(); });
