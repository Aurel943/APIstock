/*
 * Carte « Aujourd'hui » (Portefeuille › Vue d'ensemble) : en un coup d'œil, la variation du jour et ce qui l'explique,
 * le contexte des marchés, les événements d'aujourd'hui et de demain, les alertes déclenchées et les choses à faire.
 * Calculs purs (Today.drivers / Today.sentence / Today.upcoming) testés dans tests/today.test.mjs.
 */
'use strict';

/* Indices de contexte affichés dans la carte (cotations Yahoo, rechargées au plus toutes les 10 min) */
const TODAY_INDICES = [['^FCHI', 'CAC 40'], ['^GSPC', 'S&P 500'], ['^STOXX50E', 'Euro Stoxx 50']];

const Today = {
  /** Lignes qui ont le plus pesé sur la journée (en valeur absolue), les plus fortes d'abord */
  drivers(rows, n = 3) {
    return rows.filter(r => isFinite(r.dayBase) && Math.abs(r.dayBase) >= 0.005)
      .sort((a, b) => Math.abs(b.dayBase) - Math.abs(a.dayBase)).slice(0, n)
      .map(r => ({ key: r.key, day: r.dayBase, pct: r.quote ? r.quote.percentChange : NaN }));
  },

  /** « Hausse portée par CW8 (+15 €) et ESE (+12 €), freinée par SPY (−3 €). » */
  sentence(totals, drivers, label, cur) {
    if (!isFinite(totals.day) || !drivers.length) return '';
    if (Math.abs(totals.dayPct) < 0.05) return 'Journée calme : ton portefeuille bouge à peine.';
    const up = totals.day >= 0;
    const name = d => `${label(d.key)} (${fmtSignedMoney(d.day, cur)})`;
    const list = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1] : a[0]);
    const pushing = drivers.filter(d => (d.day >= 0) === up).map(name);
    const against = drivers.filter(d => (d.day >= 0) !== up).map(name);
    if (!pushing.length) return '';
    return `${up ? 'Hausse portée' : 'Baisse due surtout à'} ${up ? 'par ' : ''}${list(pushing)}` + (against.length ? `, ${up ? 'freinée' : 'amortie'} par ${list(against)}` : '') + '.';
  },

  /** Événements d'aujourd'hui et de demain, dans l'ordre de l'agenda */
  upcoming(events, today) {
    const tomorrow = addDaysISO(today, 1);
    return events.filter(e => e.date === today || e.date === tomorrow).map(e => Object.assign({ when: e.date === today ? 'Aujourd\'hui' : 'Demain' }, e));
  },
};

Object.assign(App, {
  /** Événements (calcul de l'agenda complet) gardés une minute : la carte est redessinée à chaque cotation */
  todayEvents() {
    const today = todayISO();
    if (this._todayEv && this._todayEv.date === today && Date.now() - this._todayEv.at < 60000) return this._todayEv.list;
    let list = [];
    try { list = Today.upcoming(Agenda.events(today, 2), today); } catch (e) { list = []; }
    this._todayEv = { date: today, at: Date.now(), list };
    return list;
  },

  /** Cotations des indices de contexte, rechargées en arrière-plan au plus toutes les 10 min */
  todayIndices() {
    const out = TODAY_INDICES.map(([y, name]) => { const c = Api.quotes['Y:' + y]; return c && c.data && isFinite(c.data.percentChange) ? { name, pct: c.data.percentChange } : null; }).filter(Boolean);
    const stale = TODAY_INDICES.some(([y]) => { const c = Api.quotes['Y:' + y]; return !c || Date.now() - c.ts > 600000; });
    if (stale && Api.hasProxy() && !this._todayIdx && Date.now() - (this._todayIdxAt || 0) > 600000) {
      this._todayIdxAt = Date.now();
      this._todayIdx = Api.yahooSymbols(TODAY_INDICES.map(x => x[0])).catch(() => {}).finally(() => { this._todayIdx = null; if (this.isPage('portfolio/synthese')) this.renderToday(); });
    }
    return out;
  },

  renderToday() {
    const card = $('#todayCard');
    if (!card) return;
    const { rows, totals } = Portfolio.snapshot();
    if (!rows.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const cur = this.base();
    const live = rows.some(r => r.quote && r.quote.isOpen);
    const drivers = Today.drivers(rows);
    const why = Today.sentence(totals, drivers, k => Store.label(k), cur);
    const idx = this.todayIndices();
    const events = this.todayEvents();
    const alerts = (Store.state.alerts || []).filter(a => a.triggeredAt && Date.now() - a.triggeredAt < 864e5);
    let todo = 0;
    try { todo = this.todoItems().filter(i => !i.group).length; } catch (e) { todo = 0; }
    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    const go = (view, sub, sel) => () => { if (sel) this.reveal(sel); else this.show(view, sub); };
    const block = (title, body, action) => el('div', { class: 'today-block' }, el('h3', {}, title), ...body, action || null);
    card.replaceChildren(
      el('div', { class: 'card-head' }, el('h2', {}, 'Aujourd\'hui', el('span', { class: 'muted small today-date' }, '· ' + date)),
        el('span', { class: 'muted small' }, live ? 'Marchés ouverts' : 'Variation de la dernière séance')),
      el('div', { class: 'today-grid' },
        block('Ton portefeuille', [
          el('div', { class: 'today-big ' + trendClass(totals.day) }, isFinite(totals.day) ? fmtSignedMoney(totals.day, cur) : '—',
            el('span', { class: 'chip ' + trendClass(totals.dayPct) }, fmtPct(totals.dayPct))),
          why ? el('p', { class: 'small' }, why) : null,
          idx.length ? el('p', { class: 'small muted' }, 'Marchés : ', ...idx.flatMap((x, i) => [i ? ' · ' : '', `${x.name} `, el('b', { class: trendClass(x.pct) }, fmtPct(x.pct))])) : null,
        ], drivers.length ? el('button', { class: 'link small', type: 'button', onclick: go('analysis', 'performance') }, 'Détail des variations →') : null),
        block('À venir', events.length ? [el('ul', { class: 'today-events' }, ...events.slice(0, 5).map(e =>
          el('li', {}, el('span', { class: 'today-when' }, e.when), el('span', { 'aria-hidden': 'true' }, (AGENDA_KINDS[e.kind] || {}).icon || '•'), el('span', { class: 'today-ev' }, e.title))))]
          : [el('p', { class: 'small muted' }, 'Rien de prévu aujourd\'hui ni demain pour tes placements.')],
        el('button', { class: 'link small', type: 'button', onclick: go('agenda', 'agenda') }, events.length > 5 ? `Les ${events.length} événements →` : 'Agenda complet →')),
        block('À surveiller', [
          el('p', { class: 'small' }, alerts.length
            ? [el('b', {}, `${alerts.length} alerte${alerts.length > 1 ? 's' : ''} déclenchée${alerts.length > 1 ? 's' : ''}`), ' : ', alerts.slice(0, 3).map(a => Store.label(a.key)).join(', ')]
            : el('span', { class: 'muted' }, 'Aucune alerte déclenchée depuis hier.')),
          el('p', { class: 'small' }, todo
            ? [el('b', {}, `${todo} chose${todo > 1 ? 's' : ''} à faire`), ' : ci-dessous']
            : el('span', { class: 'muted' }, 'Rien à faire pour l\'instant.')),
        ], el('button', { class: 'link small', type: 'button', onclick: go('agenda', 'alertes') }, 'Mes alertes →'))));
  },
});

App.on('rendered:portfolio', function () { if (this.isPage('portfolio/synthese')) this.renderToday(); });
App.on('rendered:all', function () { this.renderToday(); });
App.on('view:shown', function (page) { if (page === 'portfolio/synthese') this.renderToday(); });
