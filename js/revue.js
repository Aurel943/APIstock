/*
 * Revue du mois (Analyse › Performance) : le mois écoulé (ou en cours) en une page — performance face au MSCI World,
 * gain ou perte et ce qui l'explique (cours, devises, dividendes, frais), lignes qui ont le plus compté, opérations,
 * versements, et ce qui arrive le mois suivant (agenda). Imprimable / enregistrable en PDF.
 * Calculs : P&L explain (Desk.explain) sur le mois, du dernier cours du mois précédent au dernier cours du mois.
 * Synthèse pure (objet Review) testée dans tests/revue.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const Review = {
  /** Bornes d'un mois « AAAA-MM » : clôture de la veille du 1er, et dernier jour (ou aujourd'hui pour le mois en cours) */
  bounds(ym, today = todayISO()) {
    const [y, m] = ym.split('-').map(Number);
    const first = `${ym}-01`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { start: addDaysISO(first, -1), first, end: last < today ? last : today, partial: last >= today, next: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
  },

  /** Les 12 derniers mois (le plus récent d'abord), sans remonter avant `first` */
  months(today = todayISO(), first = '1990-01-01') {
    const out = [];
    let [y, m] = today.split('-').map(Number);
    for (let i = 0; i < 12; i++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      if (`${ym}-31` < first) break;
      out.push(ym);
      m--; if (m < 1) { m = 12; y--; }
    }
    return out;
  },

  /**
   * Synthèse d'un P&L explain sur le mois : `E` (Desk.explain), `bench` (rendement du MSCI World), `txs` (opérations du mois).
   * → { pnl, twr, bench, vsBench, start, end, inflow, outflow, net, parts, top, flop, ops, divs, fees }
   */
  summary(E, bench, txs) {
    const lines = E.lines.slice().sort((a, b) => b.total - a.total);
    return {
      pnl: E.total, twr: E.twr, bench, vsBench: isFinite(bench) ? E.twr - bench : NaN,
      start: E.startValue, end: E.endValue, inflow: E.inflow, outflow: E.outflow, net: E.inflow - E.outflow,
      parts: { price: E.price, fx: E.fx, exec: E.exec, div: E.div, fees: -E.fees },
      top: lines.filter(l => l.total > 0).slice(0, 3), flop: lines.filter(l => l.total < 0).slice(-3).reverse(),
      ops: txs.filter(t => t.type === 'buy' || t.type === 'sell').length,
      divs: txs.filter(t => t.type === 'div').length, fees: E.fees,
    };
  },
};

Object.assign(App, {
  renderReviewForm() {
    const box = $('#revBody');
    if (!box || box.querySelector('#revMonth')) return;
    const txs = Portfolio.txs();
    if (!txs.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des opérations pour préparer la revue de ton mois.')); return; }
    const first = txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
    const months = Review.months(todayISO(), first);
    const fmtM = ym => new Date(ym + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    // par défaut : le mois précédent dès le 1er du mois, le mois en cours à partir du 20
    this._revMonth = this._revMonth || (new Date().getDate() >= 20 || months.length < 2 ? months[0] : months[1]);
    box.replaceChildren(
      el('div', { class: 'rev-form' },
        el('select', { id: 'revMonth', 'aria-label': 'Mois', onchange: e => { this._revMonth = e.target.value; this.runReview(); } },
          ...months.map((ym, i) => el('option', { value: ym, selected: ym === this._revMonth || null }, fmtM(ym) + (i === 0 ? ' (en cours)' : '')))),
        el('button', { type: 'button', class: 'btn small', id: 'revPrint', onclick: () => this.printReview() }, '🖨 Imprimer / PDF')),
      el('div', { id: 'revOut' }, el('p', { class: 'muted' }, 'Chargement…')));
    this.runReview();
  },

  async runReview() {
    const out = $('#revOut');
    if (!out) return;
    const ym = this._revMonth, B = Review.bounds(ym);
    const token = this._revToken = {};
    out.replaceChildren(el('p', { class: 'muted small' }, 'Chargement des cours du mois…'));
    try {
      const raw = Portfolio.txs();
      const txs = Portfolio.historyEvents(raw);
      const keys = Array.from(new Set(txs.map(t => t.key))).filter(k => Store.instrument(k));
      const from = addDaysISO(B.start, -10), prices = {}, fx = {}, missing = [];
      for (const k of keys) {
        try { prices[k] = await Api.daily(k, from); fx[k] = await Api.fxSeries((Store.instrument(k) || {}).currency || this.base(), from); }
        catch (e) { missing.push(Store.label(k)); }
      }
      let bench = NaN;
      try {
        const b = await this.quantSeries('Y:' + HIST_BENCH.ysym, from, HIST_BENCH.ccy);
        const b0 = Quant.at(b, B.start), b1 = Quant.at(b, B.end);
        if (b0 > 0 && b1 > 0) bench = b1 / b0 - 1;
      } catch (e) { /* indice indisponible */ }
      if (token !== this._revToken) return;
      const E = Desk.explain({ txs: txs.filter(t => prices[t.key]), prices, fx, start: B.start, end: B.end });
      const monthTx = raw.filter(t => t.date >= B.first && t.date <= B.end);
      const next = typeof Agenda !== 'undefined' ? Agenda.events(B.partial ? todayISO() : B.next, 31).filter(e => e.date < addMonthsISO(B.next, 1)) : [];
      this._revResult = { ym, B, S: Review.summary(E, bench, monthTx), E, monthTx, next, missing };
      out.replaceChildren(this.reviewPanel(this._revResult));
    } catch (e) {
      out.replaceChildren(el('p', { class: 'muted' }, 'Revue indisponible pour l\'instant (' + (e.message || e) + ').'));
    }
  },

  reviewPanel(R) {
    const S = R.S, cur = this.base(), m = x => fmtMoney(x, cur, 0), sm = x => fmtSignedMoney(x, cur), pct = x => (isFinite(x) ? fmtPct(x * 100, 1) : '—');
    const monthName = new Date(R.ym + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
    const TYPES = { buy: 'Achat', sell: 'Vente', div: 'Dividende', split: 'Division' };
    const partRow = (label, v) => (Math.abs(v) >= 0.5 ? el('li', {}, el('span', {}, label), el('b', { class: 'mono ' + trendClass(v) }, sm(v))) : null);
    const lineRow = L => el('li', {}, el('span', {}, Store.label(L.key)), el('b', { class: 'mono ' + trendClass(L.total) }, sm(L.total)));
    return el('div', { class: 'rev' },
      el('p', { class: 'etfcmp-verdict rev-verdict ' + (S.pnl >= 0 ? 'up' : 'down') },
        `En ${monthName}${R.B.partial ? ' (jusqu\'à aujourd\'hui)' : ''}, ton portefeuille a ${S.pnl >= 0 ? 'gagné' : 'perdu'} `, el('b', {}, m(Math.abs(S.pnl))),
        ` (${pct(S.twr)})`, isFinite(S.bench) ? [`, contre ${pct(S.bench)} pour le ${HIST_BENCH.name} : `, el('b', {}, (S.vsBench >= 0 ? '+' : '−') + fmtNum(Math.abs(S.vsBench * 100), 1) + ' pt'), S.vsBench >= 0 ? ' d\'avance.' : ' de retard.'] : '.'),
      el('div', { class: 'kpis' },
        this.kpi('Valeur en fin de mois', m(S.end), `début de mois ${m(S.start)}`),
        this.kpi('Gain ou perte', sm(S.pnl), pct(S.twr) + ' hors versements', trendClass(S.pnl)),
        this.kpi('Versements nets', sm(S.net), `${S.ops} achat${S.ops > 1 ? 's' : ''} ou vente${S.ops > 1 ? 's' : ''}`),
        this.kpi('Frais payés', m(S.fees), S.divs ? `${S.divs} dividende${S.divs > 1 ? 's' : ''} reçu${S.divs > 1 ? 's' : ''}` : 'aucun dividende')),
      el('div', { class: 'rev-grid' },
        el('div', { class: 'fund-box' }, el('h4', {}, 'Ce qui explique le mois'), el('ul', { class: 'rev-list' },
          partRow('Cours des titres', S.parts.price), partRow('Devises', S.parts.fx), partRow('Prix obtenus à l\'achat et à la vente', S.parts.exec),
          partRow('Dividendes', S.parts.div), partRow('Frais', S.parts.fees))),
        el('div', { class: 'fund-box' }, el('h4', {}, 'Lignes qui ont le plus compté'), el('ul', { class: 'rev-list' }, ...S.top.map(lineRow), ...S.flop.map(lineRow)),
          !S.top.length && !S.flop.length ? el('p', { class: 'small muted' }, 'Aucune variation notable.') : null)),
      R.monthTx.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'q-table rev-ops' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Opération'), el('th', {}, 'Ligne'), el('th', { class: 'num' }, 'Montant'))),
        el('tbody', {}, ...R.monthTx.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map(t => {
          const inst = Store.instrument(t.key) || {};
          return el('tr', {}, el('td', {}, fmtDate(t.date)), el('td', {}, TYPES[t.type] || t.type), el('td', {}, Store.label(t.key)),
            el('td', { class: 'num mono' }, t.type === 'split' ? '—' : fmtMoney(parseNum(t.qty) * parseNum(t.price), inst.currency || cur, 0)));
        })))) : el('p', { class: 'small muted' }, 'Aucune opération ce mois-ci.'),
      R.next.length ? el('div', { class: 'fund-box rev-next' }, el('h4', {}, R.B.partial ? 'D\'ici la fin du mois prochain' : 'Le mois suivant'),
        el('ul', { class: 'rev-list' }, ...R.next.slice(0, 8).map(e => el('li', {}, el('span', {}, `${fmtDate(e.date)} · ${e.title}`), e.amount ? el('b', { class: 'mono' }, m(e.amount)) : el('span'))))) : null,
      R.missing.length ? el('p', { class: 'small muted' }, 'Cours indisponibles, lignes ignorées : ' + R.missing.join(', ') + '.') : null);
  },

  printReview() {
    const R = this._revResult;
    if (!R) { toast('Choisis un mois et attends la fin du chargement.', 'info'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast('Autorise les fenêtres surgissantes pour imprimer la revue.', 'error'); return; }
    const wasPrivate = document.documentElement.classList.contains('privacy');
    document.documentElement.classList.remove('privacy');
    const panel = this.reviewPanel(R).outerHTML;
    if (wasPrivate) document.documentElement.classList.add('privacy');
    const title = 'Revue de ' + new Date(R.ym + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    w.document.open();
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>
      body{font:14px/1.5 system-ui,sans-serif;color:#121826;margin:32px;max-width:900px}h1{font-size:22px;margin:0 0 4px}.muted,small{color:#5b6477}
      .etfcmp-verdict{padding:10px 14px;border-left:3px solid #10b981;background:#f3f5f9;border-radius:8px}.etfcmp-verdict.down{border-left-color:#dc2626}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.kpi{border:1px solid #e3e7ee;border-radius:8px;padding:8px 10px}
      .kpi .label{font-size:11px;text-transform:uppercase;color:#5b6477}.kpi .value{font-size:18px;font-weight:600}.kpi .sub{font-size:12px}
      .rev-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.rev-list{list-style:none;padding:0;margin:0}.rev-list li{display:flex;justify-content:space-between;border-bottom:1px solid #eef1f5;padding:4px 0}
      table{width:100%;border-collapse:collapse;margin:12px 0}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e3e7ee}.num{text-align:right}.up{color:#059669}.down{color:#dc2626}
      .info{display:none}button{display:none}</style></head><body><h1>${title}</h1><p class="muted">APIstock · ${fmtDate(todayISO())}</p>${panel}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* impression depuis la fenêtre */ } }, 400);
  },
});

App.on('view:shown', function (page) { if (page === 'analysis/performance') this.renderReviewForm(); });
