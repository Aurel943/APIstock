/*
 * « Rembourser mon crédit ou investir ? » (Planifier › Simuler) : une somme disponible sert soit à un remboursement
 * anticipé (indemnités comprises), soit à un placement. Les deux scénarios sont menés mois par mois jusqu'à la fin
 * prévue du crédit, avec les mêmes sorties d'argent chaque mois : ce que le remboursement libère (mensualités
 * disparues ou allégées) est placé au même rendement. On compare le patrimoine final, impôt sur les gains déduit,
 * et on cherche le rendement à partir duquel investir devient plus intéressant.
 * Indemnités de remboursement anticipé d'un crédit immobilier : au plus 6 mois d'intérêts sur la somme remboursée,
 * dans la limite de 3 % du capital remboursé (article R313-25 du code de la consommation).
 * Calculs purs (objet Credit) testés dans tests/credit.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const CREDIT_STORE = 'apistock:credit';

const Credit = {
  /** Mensualité d'un prêt amortissable (capital, taux annuel en %, durée en mois) */
  payment(capital, ratePct, months) {
    if (!(capital > 0) || !(months > 0)) return 0;
    const i = ratePct / 1200;
    return i > 0 ? capital * i / (1 - Math.pow(1 + i, -months)) : capital / months;
  },

  /** Indemnités de remboursement anticipé (fraction du capital remboursé) : min(6 mois d'intérêts, 3 %) */
  iraRate(ratePct) { return Math.max(0, Math.min(0.03, ratePct / 200)); },

  /**
   * Les deux scénarios, mois par mois jusqu'à la fin prévue du crédit.
   * capital, rate (%, hors assurance), months (restants), insurance (% par an), insOnRemaining (assurance sur le capital
   * restant dû : elle baisse aussi), amount (somme disponible), ret (rendement annuel du placement, %), tax (impôt sur
   * les gains, %), mode : 'duration' (mensualité gardée, durée raccourcie) ou 'payment' (durée gardée, mensualité allégée).
   */
  simulate({ capital, rate, months, insurance = 0, insOnRemaining = false, amount, ret, tax = 0, mode = 'duration' }) {
    const r = rate + (insOnRemaining ? insurance : 0); // coût annuel qui disparaît avec le capital remboursé
    const i = r / 1200, g = Math.pow(1 + ret / 100, 1 / 12) - 1;
    const m0 = this.payment(capital, r, months);
    const ira = this.iraRate(rate);
    // remboursement : la somme couvre le capital remboursé et ses indemnités ; l'éventuel surplus est placé
    const repaid = Math.min(capital, amount / (1 + ira));
    const fees = repaid * ira, rest = amount - repaid - fees;
    const after = capital - repaid;
    const m1 = mode === 'payment' ? this.payment(after, r, months) : m0;
    let bal = after, potA = rest, inA = rest, interestA = 0, paidMonths = 0;
    for (let k = 0; k < months; k++) {
      const interest = bal * i;
      const pay = bal > 1e-9 ? Math.min(m1, bal + interest) : 0;
      if (pay > 0) paidMonths = k + 1;
      bal = bal + interest - pay;
      interestA += interest;
      const freed = m0 - pay;
      potA = potA * (1 + g) + freed;
      inA += freed;
    }
    const potB = amount * Math.pow(1 + g, months);
    const net = (pot, paidIn) => pot - Math.max(0, pot - paidIn) * tax / 100;
    const interest0 = m0 * months - capital;
    const wealthA = net(potA, inA), wealthB = net(potB, amount);
    return { m0, m1, ira, repaid, fees, rest, newMonths: mode === 'payment' ? months : paidMonths, interest0, interestA,
      saved: interest0 - interestA, wealthA, wealthB, diff: wealthB - wealthA };
  },

  /** Rendement annuel (%) du placement à partir duquel investir rapporte plus que rembourser ; NaN si introuvable */
  breakEven(p) {
    const f = ret => this.simulate(Object.assign({}, p, { ret })).diff;
    let lo = -5, hi = 30, flo = f(lo), fhi = f(hi);
    if (!(flo < 0 && fhi > 0)) return NaN;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (fm > 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  },
};

/* Enveloppes du placement : taux d'imposition des gains */
const CREDIT_WRAPPERS = [
  { id: 'pea', label: 'PEA (plus de 5 ans)', rate: c => c.social },
  { id: 'av', label: 'Assurance-vie (plus de 8 ans)', rate: c => Math.round((c.avIr8 + c.socialAv) * 100) / 100 },
  { id: 'cto', label: 'Compte-titres', rate: c => c.pfu },
  { id: 'none', label: 'Livret réglementé', rate: () => 0 },
];

Object.assign(App, {
  creditInputs() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CREDIT_STORE) || 'null'); } catch (e) { saved = null; }
    const debts = (typeof Wealth !== 'undefined' ? Wealth.list() : []).filter(a => a.type === 'immo' && parseNum(a.debt) > 0);
    const capital = debts.reduce((s, a) => s + parseNum(a.debt), 0);
    return Object.assign({ capital: capital > 0 ? Math.round(capital) : 150000, rate: 3.5, years: 15, insurance: 0.3, insOnRemaining: false,
      amount: 20000, ret: 6, wrapper: 'pea', mode: 'duration' }, saved || {}, saved && saved.capital ? {} : capital > 0 ? { capital: Math.round(capital) } : {});
  },

  renderCredit() {
    const box = $('#creditBody');
    if (!box || box.querySelector('#creditForm')) return;
    const v = this.creditInputs();
    const cur = this.base();
    const num = (id, label, value, attrs = {}) => el('label', {}, label, el('input', Object.assign({ type: 'number', id, value, inputmode: 'decimal', oninput: () => this.runCredit() }, attrs)));
    box.replaceChildren(
      el('form', { class: 'form-grid credit-form', id: 'creditForm', onsubmit: e => e.preventDefault() },
        num('crCapital', `Capital restant dû (${cur})`, v.capital, { min: 0, step: 1000 }),
        num('crRate', 'Taux du crédit (%, hors assurance)', v.rate, { min: 0, max: 20, step: 0.05 }),
        num('crYears', 'Durée restante (années)', v.years, { min: 0.5, max: 35, step: 0.5 }),
        el('label', {}, 'Assurance emprunteur (% par an)',
          el('input', { type: 'number', id: 'crIns', value: v.insurance, min: 0, max: 3, step: 0.01, inputmode: 'decimal', oninput: () => this.runCredit() }),
          el('span', { class: 'check small' }, el('input', { type: 'checkbox', id: 'crInsRem', checked: v.insOnRemaining || null, onchange: () => this.runCredit() }),
            ' calculée sur le capital restant dû', infoTip('Si l\'assurance est calculée sur le capital emprunté au départ (cas le plus courant), elle ne baisse pas quand tu rembourses en avance : elle n\'entre pas dans la comparaison.'))),
        num('crAmount', `Somme disponible (${cur})`, v.amount, { min: 0, step: 1000 }),
        num('crRet', 'Rendement espéré du placement (% par an, net de frais)', v.ret, { min: -5, max: 20, step: 0.5 }),
        el('label', {}, el('span', {}, 'Placement sur', infoTip('Le pourcentage est l\'impôt prélevé sur les gains du placement (Réglages › Fiscalité).')),
          el('select', { id: 'crWrap', onchange: () => this.runCredit() }, ...CREDIT_WRAPPERS.map(w => el('option', { value: w.id, selected: w.id === v.wrapper || null }, `${w.label} · ${fmtNum(w.rate(taxConf()), 1)} %`)))),
        el('label', {}, el('span', {}, 'Si tu rembourses', infoTip('Durée raccourcie : tu gardes la même mensualité et le crédit se termine plus tôt (le plus courant, et ce qui économise le plus d\'intérêts). Mensualité allégée : le crédit garde sa date de fin.')),
          el('select', { id: 'crMode', onchange: () => this.runCredit() },
            el('option', { value: 'duration', selected: v.mode === 'duration' || null }, 'durée raccourcie'),
            el('option', { value: 'payment', selected: v.mode === 'payment' || null }, 'mensualité allégée')))),
      el('div', { id: 'creditOut' }));
    this.runCredit();
  },

  runCredit() {
    const out = $('#creditOut');
    if (!out) return;
    const val = id => parseNum($(id).value);
    const wrapper = $('#crWrap').value;
    const p = { capital: val('#crCapital'), rate: val('#crRate'), months: Math.round(val('#crYears') * 12), insurance: val('#crIns') || 0,
      insOnRemaining: $('#crInsRem').checked, amount: val('#crAmount'), ret: val('#crRet'), mode: $('#crMode').value,
      tax: (CREDIT_WRAPPERS.find(w => w.id === wrapper) || CREDIT_WRAPPERS[0]).rate(taxConf()) };
    try {
      localStorage.setItem(CREDIT_STORE, JSON.stringify({ capital: p.capital, rate: p.rate, years: val('#crYears'), insurance: p.insurance, insOnRemaining: p.insOnRemaining,
        amount: p.amount, ret: p.ret, wrapper, mode: p.mode }));
    } catch (e) { /* stockage indisponible */ }
    if (!(p.capital > 0 && p.amount > 0 && p.months > 0 && isFinite(p.rate) && isFinite(p.ret))) {
      out.replaceChildren(el('p', { class: 'muted' }, 'Renseigne le capital restant dû, le taux, la durée restante et la somme disponible.'));
      return;
    }
    const cur = this.base(), m = x => fmtMoney(x, cur, 0);
    const S = Credit.simulate(p);
    const be = Credit.breakEven(p);
    const invest = S.diff > 0;
    const costRate = p.rate + (p.insOnRemaining ? p.insurance : 0);
    const dur = n => (n >= 12 ? `${Math.floor(n / 12)} an${n >= 24 ? 's' : ''}` + (n % 12 ? ` ${n % 12} mois` : '') : `${n} mois`);
    out.replaceChildren(
      el('p', { class: 'etfcmp-verdict credit-verdict ' + (invest ? 'up' : 'warn') },
        invest ? 'À ' + fmtNum(p.ret, 1) + ' % par an, investir rapporte plus : ' : 'À ' + fmtNum(p.ret, 1) + ' % par an, rembourser est plus intéressant : ',
        el('b', {}, `${m(Math.abs(S.diff))} de plus`), ` à la fin du crédit (dans ${dur(p.months)}), impôt sur les gains déduit.`,
        isFinite(be) ? ` Point d'équilibre : investir l'emporte si ton placement rapporte plus de ${fmtNum(be, 2)} % par an, net de frais et avant impôt (ton crédit coûte ${fmtNum(costRate, 2)} % par an).` : ''),
      el('div', { class: 'kpis' },
        this.kpi('Si tu rembourses', m(S.wealthA), p.mode === 'payment'
          ? `mensualité ${m(S.m0)} → ${m(S.m1)} · l'écart est placé chaque mois`
          : `crédit fini ${S.newMonths < p.months ? dur(p.months - S.newMonths) + ' plus tôt' : 'à la même date'} · puis ${m(S.m0)}/mois placés`, ''),
        this.kpi('Si tu investis', m(S.wealthB), `${m(p.amount)} placés ${dur(p.months)} à ${fmtNum(p.ret, 1)} %/an`, ''),
        this.kpi('Intérêts économisés', m(S.saved), `indemnités de remboursement : ${m(S.fees)}`, 'up',
          'Intérêts' + (p.insOnRemaining ? ' et assurance' : '') + ' que tu ne paieras pas en remboursant. Les indemnités (au plus 6 mois d\'intérêts, dans la limite de 3 % du capital remboursé) sont prises sur la somme disponible.'),
        this.kpi('Mensualité actuelle', m(S.m0), `${dur(p.months)} restants · intérêts à venir ${m(S.interest0)}`, '')),
      el('ul', { class: 'credit-notes small' },
        el('li', {}, 'Rembourser, c\'est un rendement garanti égal au coût de ton crédit, sans risque et sans impôt. Investir, c\'est un rendement espéré : en bourse, il peut être nettement plus bas sur 5 ou 10 ans (voir la projection et le planificateur probabiliste).'),
        el('li', {}, 'Garde d\'abord une épargne de précaution (3 à 6 mois de dépenses) : une somme remboursée ne se récupère pas.'),
        el('li', {}, 'Crédit d\'un bien mis en location : les intérêts réduisent souvent tes revenus imposables, ce qui rend le remboursement moins intéressant que ce calcul ne l\'indique.'),
        el('li', {}, 'Vérifie ton contrat : certains prêts (prêt à taux zéro, prêt d\'accession sociale, prêts récents sans indemnités) ont des conditions particulières.')),
      noteTip('Les deux scénarios sortent exactement le même argent chaque mois jusqu\'à la fin prévue du crédit : le placement reçoit soit la somme tout de suite, soit, en cas de remboursement, ce que celui-ci libère (et le reste de la somme s\'il dépasse le capital dû). Rendement constant, intérêts composés chaque mois ; impôt sur les gains au taux de l\'enveloppe choisie (Réglages › Fiscalité), appliqué à la fin. Assurance sur le capital initial : identique dans les deux cas, donc ignorée.', 'Méthode'));
  },
});

App.on('view:shown', function (page) { if (page === 'plan/simuler') this.renderCredit(); });
