/*
 * Obligations et taux (Analyse › Risque) : pour tes fonds obligataires, le rendement que tu peux attendre (rendement à
 * l'échéance, frais déduits), la sensibilité de leur valeur aux taux (« si les taux montent de 1 point, tu perds X € »)
 * et, pour un fonds à échéance (« daté »), ce qu'il devrait valoir à son terme face au fonds euros et au Livret A.
 * Rendement à l'échéance et sensibilité se lisent dans le reporting mensuel du fonds (« yield to maturity »,
 * « duration modifiée ») : Yahoo ne les publie pas de façon fiable, ils sont donc saisis ligne par ligne (gardés avec
 * l'instrument, synchronisés entre appareils).
 * Calculs purs (objet Bonds) testés dans tests/obligations.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const BOND_SHOCKS = [-1, 1, 2]; // variations de taux testées, en points
const BOND_CALC_STORE = 'apistock:bondCalc';

const Bonds = {
  /**
   * Variation de valeur (fraction) pour une variation de taux `dy` (en points), approximation de la duration modifiée
   * `dur` complétée de la convexité d'une obligation classique (≈ dur × (dur + 1)).
   */
  shock(dur, dy) {
    if (!isFinite(dur) || dur < 0) return NaN;
    const y = dy / 100, conv = dur * (dur + 1);
    return -dur * y + 0.5 * conv * y * y;
  },

  /** Moyennes pondérées par la valeur des lignes renseignées : { value, ytm, dur, known } (`known` : part de la valeur renseignée) */
  portfolio(lines) {
    const total = lines.reduce((s, l) => s + (l.value > 0 ? l.value : 0), 0);
    let wy = 0, vy = 0, wd = 0, vd = 0;
    for (const l of lines) {
      if (!(l.value > 0)) continue;
      if (isFinite(l.ytm)) { wy += l.value * l.ytm; vy += l.value; }
      if (isFinite(l.dur)) { wd += l.value * l.dur; vd += l.value; }
    }
    return { value: total, ytm: vy ? wy / vy : NaN, dur: vd ? wd / vd : NaN, known: total ? Math.min(vy, vd) / total : 0 };
  },

  /** Années (fraction) jusqu'à une date d'échéance */
  years(maturity, today = todayISO()) { return (Date.parse(maturity) - Date.parse(today)) / (365.25 * 864e5); },

  /**
   * Fonds à échéance gardé jusqu'au terme : valeur attendue d'après son rendement à l'échéance (frais `ter` déduits),
   * face au même montant placé au taux `euro` (fonds euros) et `livret` (Livret A, sans impôt). Taux en % par an.
   * `tax` : impôt sur les gains du fonds et du fonds euros (%), le Livret A n'en a pas.
   */
  dated({ amount, ytm, ter = 0, years, euro, livret, tax = 0 }) {
    const grow = (r, t) => amount * Math.pow(1 + r / 100, years) - Math.max(0, amount * Math.pow(1 + r / 100, years) - amount) * t / 100;
    const net = ytm - (ter || 0);
    return { years, rate: net, fund: grow(net, tax), euro: isFinite(euro) ? grow(euro, tax) : NaN, livret: isFinite(livret) ? grow(livret, 0) : NaN };
  },
};

Object.assign(App, {
  bondLines() {
    return Portfolio.snapshot().rows.filter(r => Expo.of(r.key).profile === 'bond' && r.valueBase > 0).map(r => {
      const inst = Store.instrument(r.key) || {}, b = inst.bond || {};
      return { key: r.key, value: r.valueBase, ytm: parseNum(b.ytm), dur: parseNum(b.dur), maturity: b.maturity || '', ter: Expo.of(r.key).ter };
    });
  },

  /** Taux du fonds euros (actif saisi dans Patrimoine) ou 2,5 % ; dernier taux du Livret A connu */
  bondRates() {
    const fe = (typeof Wealth !== 'undefined' ? Wealth.list() : []).find(a => a.type === 'fondsEuros' && parseNum(a.rate) > 0);
    const livret = typeof LIVRET_A_RATES !== 'undefined' ? LIVRET_A_RATES[LIVRET_A_RATES.length - 1][1] : 1.5;
    return { euro: fe ? parseNum(fe.rate) : 2.5, euroKnown: !!fe, livret };
  },

  saveBondField(key, field, value) {
    const inst = Store.instrument(key);
    if (!inst) return;
    inst.bond = Object.assign({}, inst.bond || {}, { [field]: value });
    Store.save();
    this.renderBonds();
  },

  renderBonds() {
    const box = $('#bondBody');
    if (!box) return;
    const lines = this.bondLines();
    const cur = this.base(), m = x => fmtMoney(x, cur, 0);
    const total = Portfolio.snapshot().totals.value || 0;
    const R = this.bondRates();
    const parts = [];
    if (lines.length) {
      const P = Bonds.portfolio(lines);
      const share = total > 0 ? P.value / total : 0;
      parts.push(el('p', { class: 'etfcmp-verdict bond-verdict' },
        `Tes obligations : ${m(P.value)}, soit ${fmtNum(share * 100, 0)} % de tes titres.`,
        isFinite(P.ytm) ? [' Rendement attendu si tu les gardes jusqu\'à l\'échéance : ', el('b', {}, fmtPct(P.ytm, 2, false) + ' par an'), ' (avant frais).'] : '',
        isFinite(P.dur) ? ` Si les taux montent de 1 point, leur valeur baisserait d'environ ${m(-P.value * Bonds.shock(P.dur, 1))}.` : '',
        P.known < 0.999 ? el('span', { class: 'muted' }, ' Renseigne le rendement à l\'échéance et la sensibilité de chaque ligne ci-dessous (reporting mensuel du fonds).') : null));
      const input = (l, field, attrs) => el('input', Object.assign({ class: 'bond-in', value: (Store.instrument(l.key).bond || {})[field] ?? '', 'aria-label': field + ' ' + Store.label(l.key),
        onchange: e => this.saveBondField(l.key, field, e.target.value) }, attrs));
      parts.push(el('div', { class: 'table-wrap' }, el('table', { class: 'q-table bond-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Ligne'), el('th', { class: 'num' }, 'Valeur'),
          el('th', { class: 'num' }, el('span', {}, 'Rdt à l\'échéance (%)', infoTip('« Yield to maturity » du reporting mensuel : rendement annuel si le fonds gardait ses obligations jusqu\'à leur échéance, avant frais.'))),
          el('th', { class: 'num' }, el('span', {}, 'Sensibilité', infoTip('« Duration modifiée » du reporting : baisse de valeur en % pour une hausse des taux de 1 point.'))),
          el('th', {}, el('span', {}, 'Échéance', infoTip('Seulement pour un fonds à échéance (« daté », iBonds, Fixed Maturity…) : date à laquelle il rembourse ses porteurs.'))),
          ...BOND_SHOCKS.map(d => el('th', { class: 'num' }, `Taux ${d > 0 ? '+' : '−'}${Math.abs(d)} pt`)))),
        el('tbody', {}, ...lines.map(l => el('tr', {},
          el('td', {}, Store.label(l.key)),
          el('td', { class: 'num mono' }, m(l.value)),
          el('td', { class: 'num' }, input(l, 'ytm', { type: 'number', step: '0.01', inputmode: 'decimal', placeholder: '3,1' })),
          el('td', { class: 'num' }, input(l, 'dur', { type: 'number', step: '0.1', inputmode: 'decimal', placeholder: '6,5' })),
          el('td', {}, input(l, 'maturity', { type: 'date' })),
          ...BOND_SHOCKS.map(d => { const x = Bonds.shock(l.dur, d); return el('td', { class: 'num mono ' + trendClass(x) }, isFinite(x) ? fmtSignedMoney(l.value * x, cur) : '—'); }))),
          isFinite(P.dur) && lines.length > 1 ? el('tr', { class: 'bond-total' }, el('td', {}, el('b', {}, 'Ensemble')), el('td', { class: 'num mono' }, m(P.value)),
            el('td', { class: 'num mono' }, isFinite(P.ytm) ? fmtNum(P.ytm, 2) : '—'), el('td', { class: 'num mono' }, fmtNum(P.dur, 1)), el('td', {}),
            ...BOND_SHOCKS.map(d => el('td', { class: 'num mono ' + trendClass(Bonds.shock(P.dur, d)) }, el('b', {}, fmtSignedMoney(P.value * Bonds.shock(P.dur, d), cur))))) : null))));
      // fonds à échéance renseignés : valeur au terme
      for (const l of lines.filter(x => x.maturity && isFinite(x.ytm) && Bonds.years(x.maturity) > 0)) {
        const D = Bonds.dated({ amount: l.value, ytm: l.ytm, ter: isFinite(l.ter) ? l.ter : 0, years: Bonds.years(l.maturity), euro: R.euro, livret: R.livret });
        parts.push(this.bondDatedText(Store.label(l.key), l.maturity, D, m, R));
      }
    } else {
      parts.push(el('p', { class: 'muted' }, 'Aucun fonds obligataire dans ton portefeuille (repérés d\'après leur nom : Bond, Govt, Aggregate, Treasury, obligations…, ou en choisissant « Obligations » comme indice suivi dans la fiche). Simule ci-dessous un fonds à échéance.'));
    }
    parts.push(this.bondCalculator(R, m));
    parts.push(noteTip('Sensibilité : variation de valeur ≈ − sensibilité × variation des taux, plus un terme de convexité (approximation d\'une obligation classique). Rendement à l\'échéance d\'un fonds : avant frais, sans défaut d\'émetteur ; un fonds non daté renouvelle ses obligations, son rendement futur suivra les taux. Fonds à échéance : valeur au terme d\'après son rendement à l\'échéance, frais courants déduits ; fonds euros au taux '
      + (R.euroKnown ? 'de ton actif saisi dans Patrimoine' : 'de 2,5 % (ajoute ton fonds euros dans Patrimoine pour utiliser son vrai taux)') + `, Livret A à ${fmtNum(R.livret, 2)} % sans impôt. Impôt sur les gains selon l'enveloppe, non déduit ici.`, 'Méthode et limites'));
    box.replaceChildren(...parts);
  },

  bondDatedText(name, maturity, D, m, R) {
    return el('p', { class: 'small bond-dated' }, el('b', {}, name), ` (échéance ${fmtDate(maturity)}, dans ${fmtNum(D.years, 1)} ans) : environ `, el('b', {}, m(D.fund)),
      ` au terme (${fmtPct(D.rate, 2, false)} par an frais déduits), contre ${m(D.euro)} sur un fonds euros à ${fmtNum(R.euro, 2)} % et ${m(D.livret)} sur un Livret A à ${fmtNum(R.livret, 2)} %.`);
  },

  /** Simulateur de fonds à échéance (montant, rendement à l'échéance, frais, date) */
  bondCalculator(R, m) {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(BOND_CALC_STORE) || 'null'); } catch (e) { c = null; }
    c = Object.assign({ amount: 10000, ytm: 3, ter: 0.12, maturity: (new Date().getFullYear() + 4) + '-12-31' }, c || {});
    const out = el('div', { class: 'bond-calc-out' });
    const draw = () => {
      try { localStorage.setItem(BOND_CALC_STORE, JSON.stringify(c)); } catch (e) { /* stockage indisponible */ }
      const yrs = Bonds.years(c.maturity);
      if (!(parseNum(c.amount) > 0) || !isFinite(parseNum(c.ytm)) || !(yrs > 0)) { out.replaceChildren(el('p', { class: 'muted small' }, 'Indique un montant, un rendement à l\'échéance et une date future.')); return; }
      out.replaceChildren(this.bondDatedText('Fonds simulé', c.maturity, Bonds.dated({ amount: parseNum(c.amount), ytm: parseNum(c.ytm), ter: parseNum(c.ter) || 0, years: yrs, euro: R.euro, livret: R.livret }), m, R));
    };
    const f = (k, label, attrs) => el('label', {}, label, el('input', Object.assign({ value: c[k], oninput: e => { c[k] = e.target.value; draw(); } }, attrs)));
    const box = el('details', { class: 'bond-calc' }, el('summary', {}, 'Simuler un fonds à échéance'),
      el('div', { class: 'form-grid bond-calc-form' },
        f('amount', `Montant (${this.base()})`, { type: 'number', min: 0, step: 500, inputmode: 'decimal' }),
        f('ytm', 'Rendement à l\'échéance (%)', { type: 'number', step: 0.05, inputmode: 'decimal' }),
        f('ter', 'Frais courants (%)', { type: 'number', step: 0.01, inputmode: 'decimal' }),
        f('maturity', 'Échéance', { type: 'date' })), out);
    draw();
    return box;
  },
});

App.on('view:shown', function (page) { if (page === 'analysis/risque') this.renderBonds(); });
