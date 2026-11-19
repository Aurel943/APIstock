/*
 * « Où placer mon prochain euro ? » (Planifier › Investir) : l'ordre de remplissage des enveloppes selon ta situation,
 * et la répartition d'un montant à placer.
 *
 *  1. Épargne de précaution (livrets réglementés), tant que l'objectif du budget n'est pas atteint ;
 *  2. PEA, jusqu'au plafond des versements : gains exonérés d'impôt sur le revenu après 5 ans ;
 *  3. PER, seulement si ta tranche marginale d'imposition (TMI) est d'au moins 30 % : versements déduits du revenu,
 *     argent bloqué jusqu'à la retraite (sauf achat de la résidence principale) ;
 *  4. Assurance-vie : ce que le PEA ne peut pas accueillir (ETF non éligibles, obligations, fonds euros), abattement
 *     annuel sur les gains après 8 ans ;
 *  5. Compte-titres en dernier : prélèvement forfaitaire unique, aucun avantage.
 *
 * Calculs purs dans Envelopes (tests/enveloppes.test.mjs) ; chargé à la demande avec la page Planifier › Investir.
 */
'use strict';

const LIVRET_CAPS = { livretA: 22950, ldds: 12000, lep: 10000 };
const ENV_TMI = [0, 11, 30, 41, 45];

const Envelopes = {
  /**
   * s : { amount, tmi, precautionGap (NaN si budget non renseigné), livretRoom, pea: { exists, deposits, cap, five },
   *       av: { exists, eight }, per: { exists }, today }
   * → { steps: [{ id, title, put, why, status: 'go'|'ok'|'skip'|'info', note }], left }
   */
  plan(s) {
    const today = s.today || todayISO();
    let left = Math.max(0, s.amount || 0);
    const steps = [];
    const take = max => { const x = Math.max(0, Math.min(left, max)); left -= x; return x; };

    // 1. précaution
    if (!isFinite(s.precautionGap)) {
      steps.push({ id: 'safety', status: 'info', put: 0, title: 'Épargne de précaution',
        why: 'Renseigne ton budget (ci-dessus) pour savoir si ton épargne de précaution est complète : 3 à 6 mois de dépenses disponibles à tout moment, avant d\'investir en bourse.' });
    } else if (s.precautionGap > 0) {
      const room = isFinite(s.livretRoom) ? s.livretRoom : Infinity;
      const put = take(Math.min(s.precautionGap, room));
      steps.push({ id: 'safety', status: 'go', put, title: 'Épargne de précaution (Livret A, LDDS, LEP)',
        why: `Il manque ${fmtMoney(s.precautionGap, 'EUR', 0)} pour couvrir tes dépenses en cas de coup dur. Disponible à tout moment, sans risque, sans impôt.`
          + (isFinite(room) && room < s.precautionGap ? ` Tes livrets ne peuvent plus recevoir que ${fmtMoney(room, 'EUR', 0)} : le reste peut aller sur un fonds euros.` : '') });
    } else {
      steps.push({ id: 'safety', status: 'ok', put: 0, title: 'Épargne de précaution', why: 'Complète : tout le montant peut être investi.' });
    }

    // 2. PEA
    const cap = s.pea.cap || 150000;
    if (s.pea.exists) {
      const room = Math.max(0, cap - (s.pea.deposits || 0));
      if (room <= 0) steps.push({ id: 'pea', status: 'skip', put: 0, title: 'PEA', why: `Plafond de ${fmtMoney(cap, 'EUR', 0)} de versements atteint : passe à l'enveloppe suivante.` });
      else {
        const put = take(room);
        const five = s.pea.five && s.pea.five > today ? ` Le cap des 5 ans sera atteint le ${fmtDate(s.pea.five)} : n'y retire rien avant.` : s.pea.five ? ' Plus de 5 ans : gains exonérés d\'impôt sur le revenu (prélèvements sociaux seulement).' : '';
        steps.push({ id: 'pea', status: put > 0 ? 'go' : 'ok', put, title: 'PEA, en ETF éligibles (MSCI World, S&P 500…)',
          why: `Encore ${fmtMoney(room, 'EUR', 0)} de versements possibles. Meilleure enveloppe pour les actions européennes et les ETF éligibles.` + five });
      }
    } else {
      const put = take(cap);
      steps.push({ id: 'pea', status: 'go', put, title: 'Ouvrir un PEA', note: 'à ouvrir',
        why: 'Même avec quelques euros : le délai de 5 ans court dès le premier versement. Gains exonérés d\'impôt sur le revenu ensuite, ETF « monde » éligibles disponibles (versions synthétiques).' });
    }

    // 3. PER
    const tmi = parseNum(s.tmi);
    if (tmi >= 30) {
      steps.push({ id: 'per', status: 'info', put: 0, title: s.per.exists ? 'PER : en complément, pour la retraite' : 'PER : à envisager pour la retraite',
        why: `Avec une tranche à ${tmi} %, chaque 1 000 € versé réduit ton impôt d'environ ${fmtMoney(1000 * tmi / 100, 'EUR', 0)} (plafond : 10 % de tes revenus professionnels). L'argent est bloqué jusqu'à la retraite, et la sortie est imposée : intéressant si ta tranche baisse à la retraite.` });
    } else if (isFinite(tmi) && s.tmi !== '') {
      steps.push({ id: 'per', status: 'skip', put: 0, title: 'PER', why: `Avec une tranche à ${tmi} %, la déduction rapporte peu face au blocage jusqu'à la retraite : le PEA et l'assurance-vie sont plus souples.` });
    }

    // 4. assurance-vie
    const avPut = take(Infinity);
    if (s.av.exists) {
      const eight = s.av.eight && s.av.eight > today ? ` Les 8 ans seront atteints le ${fmtDate(s.av.eight)}.` : s.av.eight ? ' Plus de 8 ans : abattement annuel de 4 600 € de gains (9 200 € pour un couple).' : '';
      steps.push({ id: 'av', status: avPut > 0 ? 'go' : 'info', put: avPut, title: 'Assurance-vie',
        why: (avPut > 0 ? 'Pour ce que le PEA ne peut plus accueillir. ' : 'Pour ce que le PEA ne peut pas accueillir : ETF non éligibles, obligations, fonds euros. ') + 'Transmission avantageuse.' + eight });
    } else {
      steps.push({ id: 'av', status: avPut > 0 ? 'go' : 'info', put: avPut, title: 'Assurance-vie (à ouvrir)', note: avPut > 0 ? 'à ouvrir' : '',
        why: 'Pour les placements que le PEA n\'accepte pas. Ouvre-la tôt, même avec un petit versement : l\'avantage fiscal des 8 ans compte à partir de l\'ouverture. Choisis un contrat en ligne sans frais sur versements.' });
    }

    // 5. compte-titres
    steps.push({ id: 'cto', status: 'skip', put: 0, title: 'Compte-titres en dernier',
      why: 'Aucun avantage fiscal (prélèvement forfaitaire unique sur chaque gain et chaque dividende) : à réserver aux titres qu\'aucune autre enveloppe n\'accepte.' });
    return { steps, left };
  },
};

Object.assign(App, {
  /** Situation actuelle des enveloppes, tirée des comptes, du patrimoine et du budget */
  envelopeState() {
    const accs = Store.state.accounts || [];
    const T = taxConf();
    const today = todayISO();
    const peas = accs.filter(a => a.type === 'pea');
    const avs = accs.filter(a => a.type === 'av');
    const pea = peas.length ? peas.map(a => Tax.pea(a)).sort((a, b) => a.deposits - b.deposits)[0] : null; // le PEA qui a le plus de place
    const av = avs.map(a => Tax.av(a, today)).filter(v => v.open).sort((a, b) => (a.open < b.open ? -1 : 1))[0];
    // livrets : place restante sous les plafonds
    const assets = typeof Wealth !== 'undefined' ? Wealth.list() : [];
    let room = 0, anyLivret = false;
    for (const [type, cap] of Object.entries(LIVRET_CAPS)) {
      const held = assets.filter(a => a.type === type);
      if (type === 'lep' && !held.length) continue; // le LEP dépend des revenus : compté seulement s'il est détenu
      anyLivret = anyLivret || held.length > 0;
      room += Math.max(0, cap - held.reduce((s, a) => s + Wealth.valueOf(a), 0));
    }
    let gap = NaN;
    const b = Store.state.budget || {};
    const expenses = parseNum(b.expenses);
    if (isFinite(expenses) && expenses >= 0 && parseNum(b.income) > 0 && typeof Budget !== 'undefined') {
      gap = Budget.compute({ income: parseNum(b.income), expenses, months: parseNum(b.months) || 6, liquid: this.budgetLiquid(b.euro) }).gap;
    }
    return {
      precautionGap: gap, livretRoom: anyLivret || assets.length ? room : Infinity,
      pea: { exists: !!pea, deposits: pea ? pea.deposits : 0, cap: T.peaCap, five: pea ? pea.five : '' },
      av: { exists: avs.length > 0, eight: av ? av.eight : '' },
      per: { exists: accs.some(a => a.type === 'per') },
    };
  },

  renderEnvelopes() {
    const box = $('#envBody');
    if (!box) return;
    const st = Store.state.envelope = Object.assign({ amount: '', tmi: '' }, Store.state.envelope || {});
    const cur = this.base();
    if (!box.querySelector('#envForm')) {
      box.replaceChildren(
        el('form', { class: 'form-grid env-form', id: 'envForm', onsubmit: e => e.preventDefault() },
          el('label', {}, `Montant à placer (${cur})`, el('input', { type: 'number', id: 'envAmount', min: 0, step: 100, inputmode: 'decimal', placeholder: '1 000', value: st.amount,
            oninput: e => { st.amount = e.target.value; Store.save(); this.renderEnvelopesOut(); } })),
          el('label', {}, el('span', {}, 'Ta tranche d\'imposition (TMI)', infoTip('Taux marginal : celui qui s\'applique à ton dernier euro de revenu (avis d\'impôt, rubrique « taux marginal »). Sert à juger l\'intérêt du PER.')),
            el('select', { id: 'envTmi', onchange: e => { st.tmi = e.target.value; Store.save(); this.renderEnvelopesOut(); } },
              el('option', { value: '' }, 'Je ne sais pas'), ...ENV_TMI.map(t => el('option', { value: t, selected: String(st.tmi) === String(t) || null }, t + ' %'))))),
        el('div', { id: 'envOut' }));
    }
    this.renderEnvelopesOut();
  },

  renderEnvelopesOut() {
    const out = $('#envOut');
    if (!out) return;
    const st = Store.state.envelope || {};
    const cur = this.base(), m = x => fmtMoney(x, cur, 0);
    const amount = parseNum(st.amount);
    const R = Envelopes.plan(Object.assign(this.envelopeState(), { amount: amount > 0 ? amount : 0, tmi: st.tmi }));
    const icon = { go: '➜', ok: '✔', skip: '–', info: 'ℹ' };
    out.replaceChildren(...[
      el('ol', { class: 'env-steps' }, ...R.steps.map(s => el('li', { class: 'env-step env-' + s.status },
        el('span', { class: 'env-icon', 'aria-hidden': 'true' }, icon[s.status]),
        el('div', {},
          el('div', { class: 'env-head' }, el('b', {}, s.title), s.put > 0 ? el('span', { class: 'env-put mono' }, m(s.put)) : null),
          el('p', { class: 'muted small' }, s.why))))),
      amount > 0 && R.steps.some(s => s.id === 'pea' && s.put > 0) && $('#planAmount') ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: () => {
        const pea = R.steps.find(s => s.id === 'pea');
        const p = Store.state.plan; p.amount = Math.floor(pea.put); $('#planAmount').value = p.amount; Store.save(); this.renderPlan();
        const card = $('#planAmount').closest('.card'); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast(`Plan du mois préparé pour ${m(p.amount)} (part du PEA).`, 'success');
      } }, `Préparer le plan du mois avec la part du PEA`)) : null,
      noteTip('Ordre général, à adapter à ta situation : il ne remplace pas un conseil personnalisé. Plafonds : Livret A 22 950 €, LDDS 12 000 €, LEP 10 000 €, PEA ' + m(taxConf().peaCap)
        + ' de versements. Versements du PEA repris de la Fiscalité (Portefeuille › Revenus & impôts), livrets de Patrimoine, précaution du budget ci-dessus. Le PER n\'est jamais réparti automatiquement : sa déduction dépend de tes revenus et l\'argent est bloqué.', 'Méthode')].filter(Boolean));
  },
});

App.on('view:shown', function (page) { if (page === 'plan/investir') this.renderEnvelopes(); });
App.on('data:saved', function () { if (this.page === 'plan/investir' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#envForm'))) this.renderEnvelopesOut(); });
