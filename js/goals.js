/*
 * Objectifs : l'objectif principal (Store.state.goal, aussi utilisé par la simulation) et des objectifs
 * supplémentaires (Store.state.goals), chacun financé par tous les comptes ou par certains d'entre eux.
 */
'use strict';

const Goals = {
  /** Tous les objectifs, le principal en premier */
  all() {
    const main = Store.state.goal;
    return [...(main ? [Object.assign(main, { id: main.id || 'main', main: true })] : []), ...(Store.state.goals || [])];
  },

  /** Montant aujourd'hui consacré à l'objectif : titres + espèces suivies des comptes choisis (+ autres actifs si demandé) */
  current(g) {
    const accs = g.accounts && g.accounts.length ? g.accounts.filter(id => Store.state.accounts.some(a => a.id === id)) : null;
    let v = 0;
    for (const id of accs || ['all']) v += (Portfolio.snapshot(id).totals.value || 0) + Portfolio.cashTotal(id).cash;
    const others = g.includeAssets && typeof Wealth !== 'undefined' ? Wealth.othersTotal() : 0;
    return { value: v + others, others };
  },

  /**
   * Projection à versement mensuel constant et rendement annuel supposé :
   * valeur à la date cible, mois pour atteindre la cible, versement mensuel nécessaire.
   */
  project(g, V, today = todayISO()) {
    const T = parseNum(g.target) || 0, m = parseNum(g.monthly) || 0;
    const r = Math.pow(1 + (parseNum(g.rate) || 0) / 100, 1 / 12) - 1;
    const n = Math.max(0, App.monthsBetween(today, g.date || today));
    const fv = r ? V * Math.pow(1 + r, n) + m * (Math.pow(1 + r, n) - 1) / r : V + m * n;
    let reach = null;
    if (V >= T) reach = 0;
    else { let v = V; for (let k = 1; k <= 1200; k++) { v = v * (1 + r) + m; if (v >= T) { reach = k; break; } } }
    const need = n > 0 ? (r ? (T - V * Math.pow(1 + r, n)) * r / (Math.pow(1 + r, n) - 1) : (T - V) / n) : NaN;
    return { T, m, n, fv, reach, need: isFinite(need) ? Math.max(0, need) : NaN, pct: T > 0 ? Math.min(100, (V / T) * 100) : 0, onTrack: fv >= T };
  },
};

Object.assign(App, {
  bindGoal() {
    Store.state.goal = Store.state.goal || { target: 100000, date: addMonthsISO(todayISO(), 120), monthly: 300, rate: 6 };
    Store.state.goals = Store.state.goals || [];
    const add = $('#goalAdd');
    if (add) add.addEventListener('click', () => {
      const g = { id: uid(), name: 'Nouvel objectif', target: 20000, date: addMonthsISO(todayISO(), 36), monthly: 200, rate: 4, accounts: [] };
      Store.state.goals.push(g);
      Store.save();
      this._goalEdit = g.id;
      this.renderGoal();
    });
  },

  renderGoal() {
    const box = $('#goalList');
    if (!box || !Store.state.goal) return;
    const cur = this.base(), today = todayISO();
    const multi = Store.state.accounts.length > 1;
    box.replaceChildren(...Goals.all().map(g => {
      const { value: V, others } = Goals.current(g);
      const p = Goals.project(g, V, today);
      const editing = this._goalEdit === g.id;
      const reachDate = p.reach === null ? null : addMonthsISO(today, p.reach);
      const status = p.reach === 0 ? ['up', 'Atteint ✔'] : p.onTrack ? ['up', 'En bonne voie'] : ['down', 'En retard'];
      const save = patch => { Object.assign(g, patch); Store.save(); this.renderGoal(); };
      const accNames = g.accounts && g.accounts.length ? g.accounts.map(id => (Store.state.accounts.find(a => a.id === id) || {}).name).filter(Boolean).join(', ') : 'tous les comptes';
      const head = el('div', { class: 'goal-head' },
        el('div', {}, el('b', { class: 'goal-name' }, g.name || 'Mon objectif'),
          el('span', { class: 'muted small' }, ` ${fmtMoney(p.T, cur, 0)} pour le ${fmtDate(g.date)}` + (multi ? ' · ' + accNames : ''))),
        el('span', { class: 'chip ' + status[0] }, status[1]),
        el('button', { type: 'button', class: 'link small', onclick: () => { this._goalEdit = editing ? null : g.id; this.renderGoal(); } }, editing ? 'Fermer' : 'Modifier'));
      const body = el('div', {},
        el('div', { class: 'goal-bar' }, el('span', { style: `width:${p.pct}%` }), el('b', {}, fmtNum(p.pct, 1) + ' %')),
        el('div', { class: 'goal-legend' }, el('span', {}, fmtMoney(V, cur, 0) + ' aujourd\'hui' + (others ? ` (dont ${fmtMoney(others, cur, 0)} d'autres actifs)` : '')), el('span', {}, 'objectif ' + fmtMoney(p.T, cur, 0))),
        el('div', { class: 'goal-stats' },
          el('div', {}, el('span', {}, 'À la date cible'), el('b', { class: p.onTrack ? 'up' : 'down' }, fmtMoney(p.fv, cur, 0)),
            el('small', { class: 'muted' }, p.onTrack ? 'objectif atteint' : 'il manquera ' + fmtMoney(p.T - p.fv, cur, 0))),
          el('div', {}, el('span', {}, 'Atteint le'), el('b', {}, p.reach === null ? 'jamais' : p.reach === 0 ? 'déjà !' : fmtDate(reachDate)),
            el('small', { class: 'muted' }, p.reach ? `dans ${Math.floor(p.reach / 12)} an(s) et ${p.reach % 12} mois` : `à ${fmtMoney(p.m, cur, 0)}/mois`)),
          el('div', {}, el('span', {}, 'Versement nécessaire'), el('b', { class: isFinite(p.need) && p.need <= p.m ? 'up' : 'down' }, isFinite(p.need) ? fmtMoney(p.need, cur, 0) + '/mois' : '—'),
            el('small', { class: 'muted' }, `tu prévois ${fmtMoney(p.m, cur, 0)}/mois`))));
      const form = editing ? el('div', { class: 'goal-form form-grid' },
        el('label', {}, 'Nom', el('input', { type: 'text', value: g.name || 'Mon objectif', onchange: e => save({ name: e.target.value.trim() || 'Objectif' }) })),
        el('label', {}, `Montant visé (${cur})`, el('input', { type: 'number', min: 0, step: 1000, value: g.target, onchange: e => save({ target: parseNum(e.target.value) || 0 }) })),
        el('label', {}, 'Date cible', el('input', { type: 'date', value: g.date, onchange: e => save({ date: e.target.value }) })),
        el('label', {}, `Versement mensuel (${cur})`, el('input', { type: 'number', min: 0, step: 50, value: g.monthly, onchange: e => save({ monthly: parseNum(e.target.value) || 0 }) })),
        el('label', {}, 'Rendement annuel supposé (%)', el('input', { type: 'number', step: 0.5, value: g.rate, onchange: e => save({ rate: parseNum(e.target.value) || 0 }) })),
        multi ? el('fieldset', { class: 'goal-accs' }, el('legend', {}, 'Financé par'),
          ...Store.state.accounts.map(a => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !(g.accounts && g.accounts.length) || g.accounts.includes(a.id),
            onchange: e => {
              const set = new Set(g.accounts && g.accounts.length ? g.accounts : Store.state.accounts.map(x => x.id));
              if (e.target.checked) set.add(a.id); else set.delete(a.id);
              save({ accounts: set.size === Store.state.accounts.length ? [] : Array.from(set) });
            } }), a.name))) : null,
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!g.includeAssets, onchange: e => save({ includeAssets: e.target.checked }) }), 'Inclure mes autres actifs',
          infoTip('Livrets, fonds euros, compte courant, immobilier net : ce que tu as saisi dans Portefeuille → Synthèse → Patrimoine global.')),
        g.main ? null : el('button', { type: 'button', class: 'btn small danger', onclick: () => {
          const idx = Store.state.goals.indexOf(g);
          Store.state.goals.splice(idx, 1); Store.markDeleted(g.id); Store.save(); this._goalEdit = null; this.renderGoal();
          undoToast('Objectif supprimé', () => { Store.state.goals.splice(idx, 0, g); Store.unmarkDeleted(g.id); Store.save(); this.renderGoal(); });
        } }, 'Supprimer cet objectif')) : null;
      return el('div', { class: 'goal-item' + (editing ? ' editing' : '') }, head, body, form);
    }));
  },
});
