/* Interface mobile : barre de navigation basse (les 5 espaces), bouton flottant, cartes de positions */
'use strict';

const isMobile = () => matchMedia('(max-width: 760px)').matches;

Object.assign(App, {
  bindMobile() {
    $$('#bottomNav button').forEach(b => b.addEventListener('click', () => {
      this.show(b.dataset.view);
      window.scrollTo({ top: 0 });
    }));
    $('#fabAdd').addEventListener('click', () => this.openTx());

    // sur mobile, toucher une ligne de la liste de suivi fait défiler jusqu'au graphique
    $('#watchTable tbody').addEventListener('click', () => {
      if (isMobile()) setTimeout(() => $('#detailCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    });
    this.syncMobileNav();
  },

  syncMobileNav() {
    const v = this.view;
    $$('#bottomNav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    document.body.dataset.view = v;
    document.body.dataset.page = this.page || v;
  },

  /** Positions sous forme de cartes (affichées à la place du tableau sur petit écran) */
  renderPositionCards(rows) {
    const box = $('#positionsCards');
    if (!box) return;
    const cur = this.base();
    box.replaceChildren(...rows.map((r, i) => {
      const q = r.quote;
      return el('div', { class: 'pos-card', onclick: () => { this.show('markets'); this.selectDetail(r.key); window.scrollTo({ top: 0 }); } },
        el('div', { class: 'pos-top' },
          el('div', { class: 'pos-id' },
            el('span', { class: 'pos-dot', style: 'background:' + PALETTE[i % PALETTE.length] }),
            el('div', {}, el('div', { class: 'sym' }, Store.label(r.key), this.marketBadge(r.key)), el('div', { class: 'name' }, Store.code(r.key)))),
          el('div', { class: 'pos-val' },
            el('div', { class: 'mono' }, fmtMoney(r.valueBase, cur)),
            el('div', { class: 'small mono ' + trendClass(r.pnl) }, fmtSignedMoney(r.pnlBase, cur) + ' · ' + fmtPct(r.pnlPct)))),
        el('div', { class: 'pos-stats' },
          el('div', {}, el('span', {}, 'Cours'), el('b', {}, q ? el('span', this.flashAttrs('cd:' + r.key, r.price), fmtMoney(r.price, r.currency, 3)) : '—')),
          el('div', {}, el('span', {}, 'Jour'), el('b', { class: 'pos-day ' + (q ? trendClass(q.percentChange) : '') }, q ? fmtPct(q.percentChange) : '—', this.daySpark(q, 56, 16))),
          el('div', {}, el('span', {}, 'Parts · PRU'), el('b', {}, fmtQty(r.qty) + ' · ' + fmtMoney(r.pru, r.currency, 2, true))),
          el('div', {}, el('span', {}, 'Investi'), el('b', {}, fmtMoney(r.costBase, cur, 0))),
          el('div', {}, el('span', {}, '% actuel'), el('b', {}, fmtPct(r.weightValue, 1, false))),
          el('div', {}, el('span', {}, '% investi'), el('b', {}, fmtPct(r.weightCost, 1, false)))));
    }));
  },
});

// la barre du bas suit l'onglet affiché
App.on('view:shown', function () { this.syncMobileNav(); });
