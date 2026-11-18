/*
 * Budget et épargne de précaution (Planifier › Investir) : ce que tu mets de côté chaque mois, combien de mois de
 * dépenses tes liquidités couvrent, et donc combien tu peux investir ce mois-ci sans entamer ta sécurité :
 * tant que l'épargne de précaution n'atteint pas son objectif (3 à 6 mois de dépenses, au choix), l'épargne du mois
 * la complète d'abord. Le montant investissable peut alimenter le plan du mois en un clic.
 * Revenus et dépenses : Store.state.budget (synchronisés entre appareils). Liquidités : compte courant et livrets
 * saisis dans Patrimoine (fonds euros en option).
 * Calculs purs (objet Budget) testés dans tests/budget.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const BUDGET_LIQUID_TYPES = ['courant', 'livretA', 'ldds', 'lep'];

const Budget = {
  /**
   * income, expenses : par mois ; months : objectif de précaution (mois de dépenses) ; liquid : liquidités disponibles ;
   * planned : versements programmés déjà prévus chaque mois.
   * → { saving, rate, covered, target, gap, toSafety, invest, extra, monthsToTarget }
   */
  compute({ income, expenses, months = 6, liquid = 0, planned = 0 }) {
    const saving = income - expenses;
    const target = Math.max(0, expenses * months);
    const gap = Math.max(0, target - liquid);
    const toSafety = saving > 0 ? Math.min(saving, gap) : 0;
    const invest = Math.max(0, saving - toSafety);
    return { saving, rate: income > 0 ? saving / income : NaN, covered: expenses > 0 ? liquid / expenses : Infinity, target, gap, toSafety, invest,
      extra: Math.max(0, invest - planned), monthsToTarget: gap > 0 && saving > 0 ? Math.ceil(gap / saving) : gap > 0 ? Infinity : 0 };
  },
};

Object.assign(App, {
  budgetLiquid(withEuro) {
    const assets = typeof Wealth !== 'undefined' ? Wealth.list() : [];
    return assets.filter(a => BUDGET_LIQUID_TYPES.includes(a.type) || (withEuro && a.type === 'fondsEuros')).reduce((s, a) => s + Wealth.valueOf(a), 0);
  },

  /** Versements programmés actifs, ramenés à un mois (devise de base) */
  budgetPlanned() {
    return (Store.state.plans || []).filter(p => p.active !== false).reduce((s, p) => s + (parseNum(p.amount) || 0), 0);
  },

  renderBudget() {
    const box = $('#budgetBody');
    if (!box) return;
    const b = Store.state.budget = Object.assign({ income: '', expenses: '', months: 6, euro: false }, Store.state.budget || {});
    if (!box.querySelector('#budgetForm')) {
      const cur = this.base();
      const num = (k, label, attrs = {}) => el('label', {}, label, el('input', Object.assign({ type: 'number', id: 'bud-' + k, min: 0, step: 50, inputmode: 'decimal', value: b[k],
        oninput: e => { b[k] = e.target.value; Store.save(); this.renderBudgetOut(); } }, attrs)));
      box.replaceChildren(
        el('form', { class: 'form-grid budget-form', id: 'budgetForm', onsubmit: e => e.preventDefault() },
          num('income', `Revenus nets par mois (${cur})`, { placeholder: '3 000' }),
          num('expenses', `Dépenses par mois (${cur})`, { placeholder: '2 200' }),
          el('label', {}, el('span', {}, 'Épargne de précaution visée', infoTip('Somme à garder disponible pour les coups durs (perte d\'emploi, réparation, santé) : 3 mois de dépenses au minimum, 6 mois pour un indépendant ou une famille.')),
            el('select', { id: 'bud-months', onchange: e => { b.months = parseNum(e.target.value); Store.save(); this.renderBudgetOut(); } },
              ...[3, 4, 6, 9, 12].map(n => el('option', { value: n, selected: +b.months === n || null }, `${n} mois de dépenses`)))),
          el('label', { class: 'check budget-euro' }, el('input', { type: 'checkbox', id: 'bud-euro', checked: b.euro || null, onchange: e => { b.euro = e.target.checked; Store.save(); this.renderBudgetOut(); } }),
            ' Compter le fonds euros comme disponible')),
        el('div', { id: 'budgetOut' }));
    }
    this.renderBudgetOut();
  },

  renderBudgetOut() {
    const out = $('#budgetOut'), b = Store.state.budget || {};
    if (!out) return;
    const income = parseNum(b.income), expenses = parseNum(b.expenses);
    if (!(income > 0) || !(expenses >= 0) || !isFinite(expenses)) {
      out.replaceChildren(el('p', { class: 'muted' }, 'Indique tes revenus et tes dépenses du mois : tes liquidités sont reprises de Patrimoine (compte courant, livrets).'));
      return;
    }
    const cur = this.base(), m = x => fmtMoney(x, cur, 0);
    const liquid = this.budgetLiquid(b.euro), planned = this.budgetPlanned();
    const R = Budget.compute({ income, expenses, months: parseNum(b.months) || 6, liquid, planned });
    const ok = R.gap <= 0;
    const verdict = R.saving <= 0
      ? ['Ce mois-ci, tes dépenses dépassent tes revenus : ', el('b', {}, 'rien à investir'), ', et ton épargne de précaution sert de tampon.']
      : ok
        ? ['Ton épargne de précaution est complète (', el('b', {}, `${fmtNum(R.covered, 1)} mois de dépenses`), `) : tu peux investir tes ${m(R.saving)} d'épargne du mois.`]
        : [`Ton épargne de précaution couvre ${fmtNum(R.covered, 1)} mois de dépenses sur ${b.months || 6} visés : mets d'abord `, el('b', {}, m(R.toSafety)), ' sur ton livret',
          R.invest > 0 ? [', puis investis ', el('b', {}, m(R.invest)), '.'] : `. Objectif atteint dans ${R.monthsToTarget} mois à ce rythme.`];
    out.replaceChildren(
      el('p', { class: 'etfcmp-verdict budget-verdict ' + (R.saving <= 0 ? 'down' : ok ? 'up' : 'warn') }, ...verdict),
      el('div', { class: 'kpis' },
        this.kpi('Épargne du mois', m(R.saving), isFinite(R.rate) ? `taux d'épargne ${fmtNum(R.rate * 100, 0)} %` : '', trendClass(R.saving), 'Revenus moins dépenses. Un taux d\'épargne de 15 à 20 % est un bon repère.'),
        this.kpi('Liquidités disponibles', m(liquid), `${fmtNum(R.covered, 1)} mois de dépenses · objectif ${m(R.target)}`, ok ? 'up' : ''),
        this.kpi('À investir ce mois-ci', m(R.invest), planned > 0 ? `dont ${m(Math.min(planned, R.invest))} déjà en versements programmés` : 'après ton épargne de précaution', R.invest > 0 ? 'up' : '')),
      R.extra > 0 && $('#planAmount') ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', id: 'budgetToPlan', onclick: () => {
        const p = Store.state.plan; p.amount = Math.floor(R.extra); $('#planAmount').value = p.amount; Store.save(); this.renderPlan();
        const card = $('#planAmount').closest('.card'); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast(`Plan du mois préparé pour ${m(p.amount)}.`, 'success');
      } }, `Préparer le plan du mois avec ${m(R.extra)}`)) : null,
      noteTip('Liquidités : compte courant et livrets réglementés saisis dans Portefeuille › Patrimoine' + (b.euro ? ', plus le fonds euros' : '') + ' (espèces des comptes-titres et du PEA non comptées : elles servent à investir).'
        + ' Tant que l\'objectif n\'est pas atteint, l\'épargne du mois va d\'abord au livret. Versements programmés actifs : ' + m(planned) + ' par mois, déjà compris dans le montant à investir.', 'Méthode'));
  },
});

App.on('view:shown', function (page) { if (page === 'plan/investir') this.renderBudget(); });
