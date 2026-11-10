/* Application : navigation, rendu des vues, rafraîchissement temps réel */
'use strict';

const App = {
  view: 'portfolio',
  allocMode: 'value',
  detailKey: null,
  range: '1A',
  refreshing: false,
  timer: null,
  editingTx: null,
  txInstrument: null,
  lastRefresh: 0,

  base() { return Store.state.settings.baseCurrency; },

  init() {
    Store.load();
    Api.init();
    this.applyTheme(localStorage.getItem('apistock:theme'));
    this.bindNav();
    this.bindPortfolio();
    this.bindMarkets();
    this.bindSimulation();
    this.bindSettings();
    this.bindDialog();
    this.bindWorld();
    this.bindInvest();
    this.bindCompare();
    this.bindAccounts();
    this.renderAccountsSettings();
    this.bindGoal();
    this.bindPrivacy();
    this.bindCsv();
    this.bindMobile();
    this.bindInteractionGuard();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    Api.onUsage((used, limit) => {
      const c = $('#credits');
      c.textContent = used + '/' + limit;
      c.classList.toggle('warn', used >= limit);
    });
    Api.emitUsage();
    Api.onDaily(d => this.renderDailyCount(d));
    Api.emitDaily();
    // toutes les 5 s : crédits de la minute, et compteur du jour (autres onglets, passage à minuit)
    setInterval(() => { Api.emitUsage(); Api.emitDaily(); }, 5000);

    const hash = location.hash.replace('#', '');
    this.show(['portfolio', 'markets', 'compare', 'world', 'invest', 'simulation', 'settings'].includes(hash) ? hash : (Api.ready() ? 'portfolio' : 'settings'));
    this.renderAll();
    Api.detectProxy().finally(() => { this.renderAll(); this.refresh(); });
    if (sessionStorage.getItem('apistock:reloaded')) {
      sessionStorage.removeItem('apistock:reloaded');
      setTimeout(() => toast('Site rechargé et à jour ✔', 'success', 3000), 300);
    }
    this.schedule();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - this.lastRefresh > Store.state.settings.refreshSec * 1000) this.refresh();
    });
  },

  /* ------------------------------------------------------------------ */
  /* Navigation & thème                                                   */
  /* ------------------------------------------------------------------ */
  bindNav() {
    $$('.tab').forEach(b => b.addEventListener('click', () => this.show(b.dataset.view)));
    $$('[data-goto]').forEach(b => b.addEventListener('click', () => this.show(b.dataset.goto)));
    $('#refreshBtn').addEventListener('click', () => this.refresh(true));
    $('#themeBtn').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      this.applyTheme(dark ? 'light' : 'dark');
      localStorage.setItem('apistock:theme', dark ? 'light' : 'dark');
      this.renderAll();
    });
  },

  applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  },

  show(view) {
    this.view = view;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    history.replaceState(null, '', '#' + view);
    clearInterval(this._globalTimer);
    if (view === 'settings') {
      this.loadGlobalCount();
      this._globalTimer = setInterval(() => { if (!document.hidden) this.loadGlobalCount(); }, 60000);
    }
    if (view === 'portfolio' && this._portfolioStale) { this._portfolioStale = false; this.renderPortfolio(); }
    if (view === 'markets' && !this.detailKey && Store.state.watchlist.length) this.selectDetail(Store.state.watchlist[0]);
    if (view === 'simulation') this.renderProjection();
    if (view === 'world') { this.renderWorld(); this.loadWorldQuotes(); }
    if (view === 'compare') this.showCompare();
    if (view === 'invest') { this.renderInvest(); this.renderAlerts(); }
    // les graphiques créés pendant que l'onglet était caché doivent être redimensionnés
    requestAnimationFrame(() => Object.values(Charts.instances).forEach(c => c.resize()));
  },

  schedule() {
    clearTimeout(this.timer);
    const sec = parseInt(Store.state.settings.refreshSec, 10);
    if (!(sec > 0)) return;
    // on attend la fin d'un rafraîchissement avant de programmer le suivant (pas d'empilement)
    const tick = async () => {
      if (!document.hidden) { try { await this.refresh(); } catch (e) { /* déjà signalé */ } }
      if (parseInt(Store.state.settings.refreshSec, 10) === sec) this.timer = setTimeout(tick, sec * 1000);
    };
    this.timer = setTimeout(tick, sec * 1000);
  },

  /** Rafraîchissement rapide (< 30 s) : seul Yahoo suit ce rythme, Twelve Data reste limité par ses crédits */
  fastMode() { const s = parseInt(Store.state.settings.refreshSec, 10); return s > 0 && s < 30; },

  /** Faut-il interroger cet instrument à ce tour-ci ? */
  dueForRefresh(key, manual) {
    if (manual || !this.fastMode()) return true;
    const age = Api.quoteAge(key);
    // Twelve Data : 8 crédits/min sur le forfait gratuit → au plus une fois par minute
    if (Api.provider(key) !== 'yahoo') return age >= 60000;
    // marché fermé : le cours ne bouge plus, inutile de l'interroger chaque seconde
    const inst = Store.instrument(key);
    const ex = inst && inst.mic ? Markets.forMic(inst.mic) : null;
    if (ex && Markets.status(ex).state !== 'open') return age >= 120000;
    return true;
  },

  /** Rendu des cotations groupé sur une image, et reporté si l'utilisateur est en train de cliquer ou sélectionner */
  renderQuotes() {
    if (this._rq) return;
    this._rq = requestAnimationFrame(() => {
      this._rq = 0;
      const sel = window.getSelection && window.getSelection();
      if (this.pointerDown || (sel && !sel.isCollapsed && sel.toString())) { this._rqPending = true; return; }
      this._rqPending = false;
      if (this.view === 'portfolio') this.renderPortfolio();
      else this._portfolioStale = true;
      this.renderWatchlist();
      this.renderDetailHeader();
      this.renderMarketState();
      if (this.view === 'invest') { this.renderInvest(); this.renderAlerts(); }
    });
  },

  renderDailyCount(d) {
    const nf = new Intl.NumberFormat('fr-FR');
    const total = (d.yahoo || 0) + (d.twelve || 0);
    const QUOTA = 100000; // forfait gratuit Cloudflare Workers, partagé par tous les visiteurs du relais
    const pct = Math.min(100, ((d.yahoo || 0) / QUOTA) * 100);
    const pill = $('#reqToday');
    pill.textContent = nf.format(total) + ' req.';
    pill.title = `Requêtes envoyées aujourd'hui depuis ce navigateur — relais Yahoo : ${nf.format(d.yahoo || 0)} · Twelve Data : ${nf.format(d.twelve || 0)}`;
    pill.classList.toggle('warn', pct >= 80);
    if (!$('#reqTotal')) return;
    $('#reqTotal').textContent = nf.format(total);
    $('#reqBar').style.width = pct + '%';
    $('#reqBar').classList.toggle('warn', pct >= 80);
    $('#reqDetail').textContent = `Relais Yahoo : ${nf.format(d.yahoo || 0)} (${fmtNum(pct, pct < 1 ? 2 : 1)} % du quota gratuit de 100 000/jour du worker, partagé avec tous les visiteurs)`
      + ` · Twelve Data : ${nf.format(d.twelve || 0)}${Api.hasKey() ? ' (800/jour sur le forfait gratuit)' : ''}. Remis à zéro à minuit.`;
  },

  /** Total des requêtes reçues aujourd'hui par le worker Cloudflare (tous visiteurs), via son point « stats » */
  async loadGlobalCount() {
    if (!$('#reqGlobal') || !Api.hasProxy()) return;
    const nf = new Intl.NumberFormat('fr-FR');
    const show = (val, pct, detail) => {
      $('#reqGlobal').textContent = val;
      $('#reqGlobalBar').style.width = (pct || 0) + '%';
      $('#reqGlobalBar').classList.toggle('warn', pct >= 80);
      $('#reqGlobalDetail').textContent = detail;
    };
    let s;
    try { s = await Api.yahoo({ type: 'stats' }); }
    catch (e) {
      show('—', 0, /invalide/.test(e.message)
        ? 'Le worker en ligne ne connaît pas encore ce compteur : redéploie-le avec le nouveau proxy/cloudflare-worker.js (voir le README).'
        : 'Total indisponible : ' + e.message);
      return;
    }
    if (s.unsupported) { show('—', 0, 'Compteur global disponible uniquement avec le relais Cloudflare.'); return; }
    if (!s.configured) { show('—', 0, 'Pour l\'activer, ajoute CF_ACCOUNT_ID et CF_API_TOKEN dans les réglages du worker Cloudflare (voir le README).'); return; }
    if (s.error) { show('—', 0, 'Total indisponible : ' + s.error); return; }
    const pct = Math.min(100, (s.account / s.quota) * 100);
    show(nf.format(s.worker), pct,
      `${fmtNum(pct, pct < 1 ? 2 : 1)} % du quota de ${nf.format(s.quota)}/jour`
      + (s.account !== s.worker ? ` (${nf.format(s.account)} pour l'ensemble de tes workers, quota commun)` : '')
      + ` · remis à zéro à minuit UTC (${new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} heure locale)`
      + ` · statistiques Cloudflare, avec ~1 min de décalage.`);
  },

  bindInteractionGuard() {
    // un tableau reconstruit entre l'appui et le relâchement ferait perdre le clic
    document.addEventListener('pointerdown', () => { this.pointerDown = true; }, true);
    const up = () => { this.pointerDown = false; if (this._rqPending) setTimeout(() => this.renderQuotes(), 50); };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (this._rqPending && sel && sel.isCollapsed) this.renderQuotes();
    });
  },

  renderAll() {
    $('#noKeyBanner').classList.toggle('hidden', Api.ready());
    $('#proxyStatus').textContent = Store.state.settings.yahooProxy ? ''
      : Api.autoProxy ? 'Relais détecté automatiquement sur ce site ✔' : 'Relais par défaut utilisé ✔';
    $$('.ccy').forEach(s => (s.textContent = this.base()));
    this.renderPortfolio();
    this.renderTransactions();
    this.renderWatchlist();
    this.renderDetailHeader();
    this.renderSimRows();
    this.renderProjection();
    this.renderInvest();
    this.renderAlerts();
    this.renderMarketState();
    if (this.view === 'world') this.renderWorld();
  },

  /* ------------------------------------------------------------------ */
  /* Rafraîchissement des cotations                                       */
  /* ------------------------------------------------------------------ */
  async refresh(manual = false) {
    if (!Api.ready()) { if (manual) toast('Configure d\'abord ta clé Twelve Data ou le relais Yahoo dans Réglages.', 'error'); return; }
    if (this.refreshing) return;
    const keys = Store.trackedKeys();
    if (!keys.length) { if (manual) toast('Rien à rafraîchir : ajoute un ETF à ton portefeuille ou à ta liste de suivi.'); return; }
    const fast = !manual && this.fastMode();
    this.refreshing = true;
    if (!fast) $('#refreshBtn').classList.add('spin'); // pas d'icône qui tourne en permanence en mode rapide
    // les positions d'abord, puis la watchlist ; les plus anciennes en premier
    const pf = new Set(Store.state.transactions.map(t => t.key));
    keys.sort((a, b) => (pf.has(b) - pf.has(a)) || (Api.quoteAge(b) - Api.quoteAge(a)));
    const due = keys.filter(k => this.dueForRefresh(k, manual));
    let errors = 0, lastErr = null, changed = !fast;
    try {
      const currencies = new Set();
      // Yahoo en parallèle (par petits groupes) pour tenir la seconde ; Twelve Data reste séquentiel (file de crédits)
      const yahoo = due.filter(k => Api.provider(k) === 'yahoo');
      let twelve = due.filter(k => Api.provider(k) !== 'yahoo');
      // en mode rapide, jamais d'attente de crédits : au plus un appel Twelve Data par tour, et seulement s'il en reste
      if (fast) twelve = Api.freeSlots() > 1 ? twelve.slice(0, 1) : [];
      const one = async k => {
        try {
          const prev = Api.cachedQuote(k);
          const q = await Api.quote(k);
          if (q.currency) currencies.add(q.currency);
          this.checkAlerts(k, q);
          // on ne redessine que si le cours a réellement bougé (évite de reconstruire l'écran pour rien chaque seconde)
          if (!prev || prev.price !== q.price || prev.percentChange !== q.percentChange || prev.isOpen !== q.isOpen || prev.datetime !== q.datetime) {
            changed = true;
            this.renderQuotes();
          }
        } catch (e) {
          errors++; lastErr = e;
          if (e.code === 401) throw e; // clé invalide : inutile d'insister
        }
      };
      try { for (let i = 0; i < yahoo.length; i += 4) await Promise.all(yahoo.slice(i, i + 4).map(one)); } catch (e) { /* déjà compté */ }
      try { for (const k of twelve) await one(k); } catch (e) { /* clé invalide */ }
      for (const k of keys) { const i = Store.instrument(k); if (i && i.currency) currencies.add(i.currency); }
      for (const c of currencies) { try { await Api.fxRate(c); } catch (e) { errors++; lastErr = e; } }
      this.lastRefresh = Date.now();
      if (due.length) $('#lastUpdate').textContent = 'Mis à jour à ' + fmtTime(this.lastRefresh);
    } finally {
      this.refreshing = false;
      $('#refreshBtn').classList.remove('spin');
      if (changed) this.renderQuotes();
    }
    if (errors && lastErr) {
      // pas de pluie de messages : en automatique, une même erreur n'est signalée qu'une fois par minute
      const now = Date.now();
      if (manual || lastErr.message !== this._lastErrMsg || now - (this._lastErrAt || 0) > 60000) {
        this._lastErrMsg = lastErr.message; this._lastErrAt = now;
        toast(lastErr.message, 'error', 6000);
      }
    } else {
      this._lastErrMsg = '';
      if (manual) toast('Cours mis à jour', 'success', 2000);
    }
  },

  /* ------------------------------------------------------------------ */
  /* PORTEFEUILLE                                                         */
  /* ------------------------------------------------------------------ */
  bindPortfolio() {
    $('#addTxBtn').addEventListener('click', () => this.openTx());
    $$('#allocMode button').forEach(b => b.addEventListener('click', () => {
      this.allocMode = b.dataset.mode;
      $$('#allocMode button').forEach(x => x.classList.toggle('active', x === b));
      this.renderPortfolio();
    }));
    $('#loadHistoryBtn').addEventListener('click', () => this.loadHistory());
  },

  kpi(label, value, sub, cls = '') {
    return el('div', { class: 'kpi' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value ' + cls }, value),
      sub ? el('div', { class: 'sub ' + cls }, sub) : null);
  },

  renderPortfolio() {
    const cur = this.base();
    const { rows, totals } = Portfolio.snapshot();

    this.renderAccountFilter();
    const net = Portfolio.netPnl();
    const kpis = $('#kpis');
    const cash = Portfolio.cashTotal();
    kpis.replaceChildren(...[
      this.kpi('Valeur actuelle', fmtMoney(totals.value, cur), totals.missing ? totals.missing + ' cours manquant(s)' : rows.length + ' ligne(s)'),
      cash.tracked ? this.kpi('Liquidités', fmtMoney(cash.cash, cur), 'Total avec espèces : ' + fmtMoney(totals.value + cash.cash, cur), cash.cash < -0.005 ? 'down' : '') : null,
      this.kpi('Montant investi', fmtMoney(totals.cost, cur), 'Frais inclus'),
      this.kpi('Plus-value latente', fmtSignedMoney(totals.pnl, cur),
        fmtPct(totals.pnlPct) + (net.taxed && totals.pnl > 0 ? ' · net d\'impôt ≈ ' + fmtSignedMoney(net.net, cur) : ''), trendClass(totals.pnl)),
      (() => {
        const x = rows.length ? Portfolio.portfolioXirr(totals.value) : NaN;
        const first = Portfolio.txs().reduce((m, t) => (t.date < m ? t.date : m), todayISO());
        return this.kpi('Rendement annualisé', isFinite(x) ? fmtPct(x) : '—', isFinite(x) ? 'XIRR depuis le ' + fmtDate(first) : 'Pas assez d\'historique', trendClass(x));
      })(),
      this.kpi('Variation du jour', fmtSignedMoney(totals.day, cur), fmtPct(totals.dayPct), trendClass(totals.day)),
      totals.dividends > 0.005 ? this.kpi('Dividendes reçus', fmtMoney(totals.dividends, cur),
        'Rendement sur investi : ' + fmtPct(totals.cost > 0 ? (totals.dividends / totals.cost) * 100 : NaN, 2, false), 'up') : null,
      Math.abs(totals.realized) > 0.005 || totals.dividends > 0.005 ? this.kpi('Gain total', fmtSignedMoney(totals.totalGain, cur),
        ['Latent', Math.abs(totals.realized) > 0.005 ? 'réalisé (' + fmtSignedMoney(totals.realized, cur) + ')' : '', totals.dividends > 0.005 ? 'dividendes' : ''].filter(Boolean).join(' + '), trendClass(totals.totalGain)) : null,
    ].filter(Boolean));
    this.renderAccountsSummary();
    this.renderGoal();

    const tbody = $('#positionsTable tbody');
    const tfoot = $('#positionsTable tfoot');
    $('#positionsEmpty').classList.toggle('hidden', rows.length > 0);
    $('#positionsTable').classList.toggle('hidden', rows.length === 0);
    rows.sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0));
    tbody.replaceChildren(...rows.map((r, i) => {
      const q = r.quote;
      const sameCcy = r.currency === cur;
      return el('tr', { onclick: () => { this.show('markets'); this.selectDetail(r.key); } },
        el('td', {},
          el('span', { class: 'sym' }, el('span', { class: 'dot', style: `display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${PALETTE[i % PALETTE.length]}` }), Store.label(r.key)),
          el('span', { class: 'name', title: r.inst ? r.inst.name : '' }, r.inst ? r.inst.name : ''),
          this.marketBadge(r.key)),
        el('td', { class: 'num' }, fmtQty(r.qty)),
        el('td', { class: 'num' }, fmtMoney(r.pru, r.currency, 3)),
        el('td', { class: 'num' }, fmtMoney(r.costBase, cur), sameCcy ? null : el('div', { class: 'muted small' }, fmtMoney(r.cost, r.currency))),
        el('td', { class: 'num' }, fmtPct(r.weightCost, 1, false), el('div', { class: 'bar' }, el('span', { style: `width:${Math.min(100, r.weightCost || 0)}%` }))),
        el('td', { class: 'num' }, q ? el('span', this.flashAttrs('pf:' + r.key, r.price), fmtMoney(r.price, r.currency, 3)) : el('span', { class: 'muted' }, '—')),
        el('td', { class: 'num' }, q ? el('span', { class: 'chip ' + trendClass(q.percentChange) }, fmtPct(q.percentChange)) : '—', this.daySpark(q, 64, 18)),
        el('td', { class: 'num' }, fmtMoney(r.valueBase, cur)),
        el('td', { class: 'num' }, fmtPct(r.weightValue, 1, false), el('div', { class: 'bar' }, el('span', { style: `width:${Math.min(100, r.weightValue || 0)}%` }))),
        el('td', { class: 'num ' + trendClass(r.pnl) }, fmtSignedMoney(r.pnlBase, cur), el('div', { class: 'small' }, fmtPct(r.pnlPct))),
      );
    }));
    this.renderPositionCards(rows);
    tfoot.replaceChildren(rows.length ? el('tr', {},
      el('td', {}, 'Total'), el('td'), el('td'),
      el('td', { class: 'num' }, fmtMoney(totals.cost, cur)),
      el('td', { class: 'num' }, '100 %'), el('td'),
      el('td', { class: 'num ' + trendClass(totals.day) }, fmtSignedMoney(totals.day, cur)),
      el('td', { class: 'num' }, fmtMoney(totals.value, cur)),
      el('td', { class: 'num' }, '100 %'),
      el('td', { class: 'num ' + trendClass(totals.pnl) }, fmtSignedMoney(totals.pnl, cur), el('div', { class: 'small' }, fmtPct(totals.pnlPct))),
    ) : '');

    // Répartition
    const useValue = this.allocMode === 'value';
    const items = rows.map((r, i) => ({
      label: Store.label(r.key), name: r.inst ? r.inst.name : '',
      v: useValue ? (isFinite(r.valueBase) ? r.valueBase : r.costBase) : r.costBase,
      color: PALETTE[i % PALETTE.length],
    })).filter(x => x.v > 0);
    const sum = items.reduce((a, b) => a + b.v, 0);
    Charts.doughnut('allocChart', items.map(x => x.label), items.map(x => x.v), items.map(x => x.color), cur);
    $('#allocLegend').replaceChildren(...items.map(x => el('li', {},
      el('span', { class: 'dot', style: 'background:' + x.color }),
      el('span', { class: 'lname', title: x.name }, x.label, el('span', { class: 'muted' }, ' ' + x.name)),
      el('b', { class: 'mono' }, fmtNum((x.v / sum) * 100, 1) + ' %'))));
  },

  renderTransactions() {
    const txs = Portfolio.txs().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const multi = Store.state.accounts.length > 1;
    $('#txCount').textContent = txs.length + ' opération(s)';
    $('#txAccountCol').classList.toggle('hidden', !multi);
    $('#txTable tbody').replaceChildren(...txs.map(t => {
      const inst = Store.instrument(t.key);
      const ccy = inst ? inst.currency : this.base();
      const isDiv = t.type === 'div', isSplit = t.type === 'split';
      const amount = t.qty * t.price + (t.type === 'sell' || isDiv ? -1 : 1) * (t.fees || 0);
      return el('tr', {},
        el('td', {}, fmtDate(t.date)),
        el('td', {}, el('span', { class: 'chip ' + t.type }, { sell: 'Vente', div: 'Dividende', split: parseNum(t.qty) >= 1 ? 'Division' : 'Regroupement' }[t.type] || 'Achat')),
        el('td', {}, el('span', { class: 'sym' }, Store.label(t.key)),
          t.note ? el('div', { class: 'tx-note', title: t.note }, '📝 ' + t.note) : null),
        multi ? el('td', { class: 'muted' }, Store.account(t.account || Store.defaultAccount()).name) : null,
        el('td', { class: 'num' }, isDiv ? '—' : isSplit ? fmtSplit(t.qty) : fmtQty(t.qty)),
        el('td', { class: 'num' }, isDiv || isSplit ? '—' : fmtMoney(t.price, ccy, 3)),
        el('td', { class: 'num' }, isSplit ? '—' : fmtMoney(t.fees || 0, ccy)),
        el('td', { class: 'num' }, isSplit ? '—' : fmtMoney(amount, ccy)),
        el('td', { class: 'num' },
          el('button', { class: 'iconbtn', title: 'Modifier', onclick: () => this.openTx(t) }, '✎'),
          el('button', { class: 'iconbtn', title: 'Supprimer', onclick: () => {
            const idx = Store.state.transactions.indexOf(t);
            Store.removeTransaction(t.id);
            this.renderAll();
            undoToast('Opération supprimée', () => { Store.state.transactions.splice(Math.max(0, idx), 0, t); Store.save(); this.renderAll(); });
          } }, '🗑')),
      );
    }));
    if (!txs.length) $('#txTable tbody').append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'Aucune opération enregistrée.')));
  },

  async loadHistory() {
    const txs = Portfolio.txs();
    if (!txs.length) { toast('Ajoute d\'abord des opérations.'); return; }
    const btn = $('#loadHistoryBtn');
    btn.disabled = true; btn.textContent = 'Chargement…';
    try {
      const start = txs.reduce((m, t) => (t.date < m ? t.date : m), todayISO());
      const keys = Array.from(new Set(txs.map(t => t.key)));
      const series = {}, fx = {};
      for (const k of keys) {
        series[k] = await Api.daily(k, start);
        const inst = Store.instrument(k);
        fx[k] = await Api.fxRate(inst ? inst.currency : this.base());
      }
      const { points } = Portfolio.replay(series, fx, Portfolio.historyEvents(txs));
      if (!points.length) throw new Error('Pas de données historiques disponibles.');
      this.historyPoints = points;
      Charts.investedVsValue('historyChart', points.map(p => fmtDate(p.date)), points.map(p => p.invested), points.map(p => p.value), this.base(), { stepped: true });
      $('#historyChart').parentElement.classList.add('ready');
      this.renderCalendar(Portfolio.twr(points));
      if (this.renderRisk) this.renderRisk(Portfolio.twr(points), start);
      const lastP = points[points.length - 1];
      $('#historyInfo').textContent = `Depuis le ${fmtDate(start)} · dernier point : ${fmtMoney(lastP.value, this.base())}`;
      return points;
    } catch (e) {
      toast(e.message, 'error', 6000);
      return null;
    } finally {
      btn.disabled = false; btn.textContent = 'Recharger';
    }
  },

  /* ------------------------------------------------------------------ */
  /* Sélecteur d'instrument (recherche Twelve Data)                       */
  /* ------------------------------------------------------------------ */
  picker(container, { onPick, placeholder = 'Ex : CW8, IWDA, VWCE, ESE ou un ISIN (FR0010315770)…', showKnown = true, actionLabel, etfDefault = true }) {
    const input = el('input', { type: 'search', placeholder, autocomplete: 'off', spellcheck: 'false' });
    const etfOnly = el('input', { type: 'checkbox', checked: etfDefault });
    const btn = el('button', { type: 'button', class: 'btn' }, 'Rechercher');
    const results = el('div', { class: 'picker-results' });
    const known = el('div', { class: 'actions' });

    const renderKnown = () => {
      const keys = Object.keys(Store.state.instruments);
      known.replaceChildren(...(showKnown && keys.length ? [el('span', { class: 'muted small' }, 'Déjà suivis :'),
        ...keys.map(k => el('button', { type: 'button', class: 'btn small', onclick: () => onPick(k) }, Store.label(k)))] : []));
    };

    const run = async () => {
      const q = input.value.trim();
      if (!q) return;
      btn.disabled = true; btn.textContent = '…';
      try {
        let data = await Api.search(q);
        if (etfOnly.checked) {
          const etfs = data.filter(d => /etf|fund/i.test(d.type || ''));
          if (etfs.length) data = etfs;
        }
        const prio = { XPAR: 0, XETR: 1, XAMS: 2, XMIL: 3, XLON: 4, XNYS: 5, ARCX: 5, XNAS: 6, XNGS: 6 };
        data.sort((a, b) => ((b.short ? 1 : 0) - (a.short ? 1 : 0)) || ((prio[a.mic] ?? 9) - (prio[b.mic] ?? 9)));
        results.replaceChildren(...(data.length ? data.map(d => el('div', {
          class: 'picker-item',
          onclick: () => {
            const key = Store.upsertInstrument({
              symbol: d.symbol, mic: d.mic, exchange: d.exchange, name: d.name, currency: d.currency, type: d.type,
              provider: d.provider, ysymbol: d.ysymbol, short: d.short, isin: d.isin,
            });
            // on force la source choisie (l'instrument a pu être ajouté avant via l'autre source)
            const inst = Store.instrument(key);
            inst.provider = d.provider; inst.ysymbol = d.ysymbol || inst.ysymbol || ''; Store.save();
            results.replaceChildren();
            input.value = '';
            renderKnown();
            onPick(key);
          },
        },
        el('div', {},
          el('span', { class: 'sym' }, d.symbol), el('span', { class: 'tag' }, d.type || ''),
          el('span', { class: 'tag src-' + d.source }, d.source === 'yahoo' ? 'Yahoo' : 'Twelve Data'),
          el('div', { class: 'meta' }, d.name)),
        el('div', { class: 'meta', style: 'text-align:right' }, d.mic ? `${d.exchange} (${d.mic})` : d.exchange, el('br'), [d.isin, d.country, d.currency].filter(Boolean).join(' · ')),
        )) : [el('div', { class: 'empty' }, 'Aucun résultat')]));
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = actionLabel || 'Rechercher';
      }
    };
    btn.addEventListener('click', run);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    renderKnown();
    container.replaceChildren(el('div', { class: 'picker' },
      el('div', { class: 'inline' }, input, btn),
      el('label', { class: 'check', style: 'align-self:start;padding:0' }, etfOnly, 'ETF uniquement'),
      known, results));
    return { input, refresh: renderKnown };
  },

  /* ------------------------------------------------------------------ */
  /* Fenêtre d'opération                                                  */
  /* ------------------------------------------------------------------ */
  bindDialog() {
    const dlg = $('#txDialog');
    $('#txCancel').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { this.txPlanRef = null; });
    ['#txQty', '#txPrice', '#txFees', '#txType', '#txAccount'].forEach(s => $(s).addEventListener('input', () => this.updateTxTotal()));
    $('#txType').addEventListener('change', () => this.syncTxType());
    $('#txForm').addEventListener('submit', e => {
      e.preventDefault();
      if (!this.txInstrument) { toast('Choisis un ETF', 'error'); return; }
      const type = $('#txType').value;
      const tx = {
        key: this.txInstrument,
        type,
        date: $('#txDate').value,
        account: $('#txAccount').value || Store.defaultAccount(),
        qty: type === 'div' ? 1 : type === 'split' ? parseSplit($('#txQty').value) : parseNum($('#txQty').value),
        price: type === 'split' ? 0 : parseNum($('#txPrice').value),
        fees: type === 'split' ? 0 : parseNum($('#txFees').value) || 0,
        note: $('#txNote').value.trim(),
      };
      if (!tx.note) delete tx.note;
      if (type === 'split') {
        if (!(tx.qty > 0) || tx.qty === 1 || !tx.date) { toast('Indique la parité (ex. 10 pour 1 part qui devient 10, ou 1:10) et la date', 'error'); return; }
      } else if (!(tx.qty > 0) || !(tx.price > 0) || !tx.date) { toast(type === 'div' ? 'Montant et date sont obligatoires' : 'Quantité, prix et date sont obligatoires', 'error'); return; }
      if (this.editingTx) {
        if (!tx.note) delete this.editingTx.note;
        Store.updateTransaction(this.editingTx.id, tx);
      } else Store.addTransaction(tx);
      if (this.txPlanRef) {
        const plan = Store.state.plans.find(p => p.id === this.txPlanRef.planId);
        if (plan) { plan.done = plan.done || {}; plan.done[this.txPlanRef.month] = tx.id || (this.editingTx && this.editingTx.id); Store.save(); }
        this.txPlanRef = null;
      }
      dlg.close();
      this.renderAll();
      if (!Api.cachedQuote(tx.key)) Api.quote(tx.key).then(() => Api.fxRate(Store.instrument(tx.key).currency)).then(() => this.renderPortfolio()).catch(err => toast(err.message, 'error'));
      toast('Opération enregistrée', 'success', 2000);
    });
  },

  openTx(tx = null) {
    this.editingTx = tx;
    $('#txDialogTitle').textContent = tx ? 'Modifier l\'opération' : 'Nouvelle opération';
    $('#txType').value = tx ? tx.type : 'buy';
    $('#txDate').value = tx ? tx.date : todayISO();
    $('#txQty').value = tx ? tx.qty : '';
    $('#txPrice').value = tx ? tx.price : '';
    $('#txFees').value = tx ? (tx.fees || 0) : 0;
    $('#txNote').value = tx ? (tx.note || '') : '';
    const accs = Store.state.accounts;
    $('#txAccount').replaceChildren(...accs.map(a => el('option', { value: a.id }, a.name)));
    const filter = Store.state.accountFilter;
    $('#txAccount').value = tx ? (tx.account || Store.defaultAccount()) : (filter && filter !== 'all' ? filter : Store.defaultAccount());
    $('#txAccountWrap').classList.toggle('hidden', accs.length < 2);
    this.syncTxType();
    this.setTxInstrument(tx ? tx.key : null);
    $('#txDialog').showModal();
  },

  setTxInstrument(key) {
    this.txInstrument = key;
    const box = $('#txInstrument');
    if (!key) {
      this.picker(box, { onPick: k => this.setTxInstrument(k) });
      setTimeout(() => { const i = box.querySelector('input'); if (i) i.focus(); }, 50);
    } else {
      const inst = Store.instrument(key);
      box.replaceChildren(el('div', { class: 'picker-selected' },
        el('div', { class: 'grow' }, el('div', { class: 'sym' }, Store.label(key)), el('div', { class: 'name' }, inst.name + ' · ' + inst.currency)),
        el('button', { type: 'button', class: 'btn small', onclick: () => this.setTxInstrument(null) }, 'Changer')));
      const q = Api.cachedQuote(key);
      if (q && !$('#txPrice').value && $('#txType').value !== 'div' && $('#txType').value !== 'split') $('#txPrice').value = q.price;
    }
    this.updateTxTotal();
  },

  syncTxType() {
    const div = $('#txType').value === 'div', split = $('#txType').value === 'split';
    $('#txQtyWrap').classList.toggle('hidden', div);
    $('#txQty').required = !div;
    $('#txQty').type = split ? 'text' : 'number';
    $('#txQty').placeholder = split ? 'ex. 10 ou 1:10' : '';
    $('#txQtyLabel').textContent = split ? 'Parité (nouvelles parts pour 1 ancienne)' : 'Quantité (parts)';
    $('#txPrice').closest('label').classList.toggle('hidden', split);
    $('#txFees').closest('label').classList.toggle('hidden', split);
    $('#txPrice').required = !split;
    $('#txPriceLabel').textContent = div ? 'Montant brut reçu' : 'Prix unitaire';
    $('#txFeesLabel').textContent = div ? 'Retenue / prélèvements' : 'Frais';
    this.updateTxTotal();
  },

  updateTxTotal() {
    if ($('#txType').value === 'split') {
      const r = parseSplit($('#txQty').value);
      const pos = this.txInstrument ? Portfolio.positions($('#txAccount').value || Store.defaultAccount()).find(p => p.key === this.txInstrument) : null;
      $('#txTotalLabel').textContent = 'Effet sur la position';
      $('#txTotal').value = r > 0 && pos && pos.qty > 0 ? `${fmtQty(pos.qty)} → ${fmtQty(pos.qty * r)} parts` : r > 0 ? '× ' + fmtNum(r, r < 1 ? 4 : 0) : '';
      return;
    }
    $('#txTotalLabel').textContent = 'Montant total';
    const div = $('#txType').value === 'div';
    const qty = div ? 1 : parseNum($('#txQty').value), price = parseNum($('#txPrice').value), fees = parseNum($('#txFees').value) || 0;
    const inst = this.txInstrument ? Store.instrument(this.txInstrument) : null;
    const total = qty * price + ($('#txType').value === 'sell' || div ? -fees : fees);
    $('#txTotal').value = isFinite(total) ? fmtMoney(total, inst ? inst.currency : this.base()) : '';
  },

  /* ------------------------------------------------------------------ */
  /* MARCHÉS                                                              */
  /* ------------------------------------------------------------------ */
  bindMarkets() {
    this.marketPicker = this.picker($('#marketSearch'), {
      showKnown: false, etfDefault: false,
      placeholder: 'Ex : CW8, Brent, or, CAC 40, Apple, Bitcoin, ISIN…',
      onPick: key => this.watchAndShow(key),
    });
    // raccourcis : matières premières, crypto, devises, indices
    $('#marketSearch').append(el('div', { class: 'quick-assets' },
      el('span', { class: 'muted small' }, 'Accès rapide :'),
      ...QUICK_ASSETS.map(a => el('button', { type: 'button', class: 'btn small', title: a.name, onclick: () => {
        if (!Api.hasProxy()) { toast('Configure d\'abord le relais Yahoo dans Réglages.', 'error'); return; }
        const key = Store.upsertInstrument({ symbol: a.y, mic: '', name: a.name, currency: a.ccy, type: a.type, provider: 'yahoo', ysymbol: a.y, short: a.short });
        this.watchAndShow(key);
        if (window.matchMedia('(max-width: 760px)').matches) setTimeout(() => $('#detailCard').scrollIntoView({ behavior: 'smooth' }), 100);
      } }, a.short))));
    $$('#rangeSel button').forEach(b => b.addEventListener('click', () => {
      this.range = b.dataset.range;
      $$('#rangeSel button').forEach(x => x.classList.toggle('active', x === b));
      this.loadDetailChart();
    }));
  },

  async watchAndShow(key) {
    Store.toggleWatch(key, true);
    this.renderWatchlist();
    this.selectDetail(key);
    try { await Api.quote(key); this.renderWatchlist(); this.renderDetailHeader(); this.renderMarketState(); }
    catch (e) { toast(e.message, 'error', 6000); }
  },

  renderWatchlist() {
    const keys = Store.state.watchlist.filter(k => Store.instrument(k));
    $('#watchEmpty').classList.toggle('hidden', keys.length > 0);
    $('#watchTable').classList.toggle('hidden', keys.length === 0);
    $('#watchTable tbody').replaceChildren(...keys.map(k => {
      const inst = Store.instrument(k);
      const q = Api.cachedQuote(k);
      return el('tr', { class: k === this.detailKey ? 'selected' : '', onclick: () => this.selectDetail(k) },
        el('td', {}, el('span', { class: 'sym' }, Store.label(k)), el('span', { class: 'name', title: inst.name }, inst.name)),
        el('td', { class: 'num' }, q ? el('span', this.flashAttrs('wl:' + k, q.price), fmtMoney(q.price, inst.currency, 3)) : '—'),
        el('td', { class: 'num ' + (q ? trendClass(q.change) : '') }, q ? (q.change > 0 ? '+' : '') + fmtNum(q.change, 3) : '—'),
        el('td', { class: 'num' }, q ? el('span', { class: 'chip ' + trendClass(q.percentChange) }, fmtPct(q.percentChange)) : '—', this.daySpark(q, 64, 18)),
        el('td', { class: 'num muted' }, q ? fmtNum(q.low, 2) + ' – ' + fmtNum(q.high, 2) : '—'),
        el('td', { class: 'num' },
          el('button', { class: 'iconbtn', title: 'Ajouter un achat', onclick: e => { e.stopPropagation(); this.openTx(); this.setTxInstrument(k); } }, '+'),
          el('button', { class: 'iconbtn on', title: 'Retirer de la liste', onclick: e => {
            e.stopPropagation(); Store.toggleWatch(k, false);
            if (this.detailKey === k) this.detailKey = null;
            this.renderWatchlist();
          } }, '★')),
      );
    }));
  },

  selectDetail(key) {
    this.detailKey = key;
    this.renderWatchlist();
    this.renderDetailHeader();
    this.loadDetailChart();
  },

  renderDetailHeader() {
    const k = this.detailKey;
    if (!k || !Store.instrument(k)) {
      $('#detailTitle').textContent = 'Graphique';
      $('#detailSub').textContent = 'Sélectionne un instrument';
      $('#detailPrice').replaceChildren();
      $('#detailStats').replaceChildren();
      return;
    }
    const inst = Store.instrument(k);
    const q = Api.cachedQuote(k);
    $('#detailTitle').textContent = Store.label(k);
    $('#detailSub').textContent = `${inst.name} · ${inst.exchange || inst.mic} · ${inst.currency}`;
    $('#detailPrice').replaceChildren(...(q ? [
      el('span', this.flashAttrs('dt:' + k, q.price, 'big'), fmtMoney(q.price, inst.currency, 3)),
      el('span', { class: 'chip ' + trendClass(q.change) }, (q.change > 0 ? '+' : '') + fmtNum(q.change, 3) + ' (' + fmtPct(q.percentChange) + ')'),
      el('span', { class: 'muted small' }, (q.isOpen ? 'En direct · ' : 'Clôture · ') + q.datetime),
    ] : [el('span', { class: 'muted' }, 'Pas encore de cotation')]));
    const perf = this.detailPerf && this.detailPerf.key === k ? this.detailPerf : null;
    $('#detailStats').replaceChildren(...(perf ? [el('div', {}, el('span', {}, 'Perf. ' + perf.range), el('b', { class: trendClass(perf.value) }, fmtPct(perf.value)))] : []), ...(q ? [
      ['Ouverture', fmtNum(q.open, 3)], ['Plus haut', fmtNum(q.high, 3)], ['Plus bas', fmtNum(q.low, 3)],
      ['Clôture veille', fmtNum(q.previousClose, 3)], ['52 sem. bas', fmtNum(q.low52, 2)], ['52 sem. haut', fmtNum(q.high52, 2)],
      ['Volume', isFinite(q.volume) ? new Intl.NumberFormat('fr-FR').format(q.volume) : '—'],
    ].map(([a, b]) => el('div', {}, el('span', {}, a), el('b', {}, b))) : []));
  },

  async loadDetailChart() {
    const k = this.detailKey;
    if (!k) return;
    if (!Api.ready()) return;
    const range = this.range;
    try {
      const values = await Api.chartSeries(k, range);
      if (k !== this.detailKey || range !== this.range) return;
      const inst = Store.instrument(k);
      const intraday = range === '1J' || range === '5J';
      Charts.line('detailChart', values.map(v => (intraday ? v[0] : fmtDate(v[0]))), values.map(v => v[1]), { currency: inst.currency });
      if (values.length > 1) {
        this.detailPerf = { key: k, range, value: (values[values.length - 1][1] / values[0][1] - 1) * 100 };
        this.renderDetailHeader();
      }
    } catch (e) {
      toast(e.message, 'error', 6000);
    }
  },

  /* ------------------------------------------------------------------ */
  /* SIMULATION                                                           */
  /* ------------------------------------------------------------------ */
  simState() {
    if (!Store.state.sim) {
      Store.state.sim = { initial: 10000, monthly: 200, start: addMonthsISO(todayISO(), -36), fractional: true, rows: [] };
    }
    return Store.state.sim;
  },

  bindSimulation() {
    const s = this.simState();
    $('#simInitial').value = s.initial;
    $('#simMonthly').value = s.monthly;
    $('#simStart').value = s.start;
    $('#simStart').max = todayISO();
    $('#simFractional').checked = s.fractional !== false;
    const sync = () => {
      s.initial = parseNum($('#simInitial').value) || 0;
      s.monthly = parseNum($('#simMonthly').value) || 0;
      s.start = $('#simStart').value;
      s.fractional = $('#simFractional').checked;
      Store.save();
      this.renderSimRows(false);
    };
    ['#simInitial', '#simMonthly', '#simStart', '#simFractional'].forEach(id => $(id).addEventListener('input', sync));

    this.simPicker = this.picker($('#simPicker'), {
      placeholder: 'Ajouter un ETF à la simulation…',
      onPick: key => {
        if (s.rows.some(r => r.key === key)) { toast('Déjà dans la simulation'); return; }
        const used = s.rows.reduce((a, r) => a + (r.pct || 0), 0);
        s.rows.push({ key, pct: Math.max(0, Math.round((100 - used) * 100) / 100) });
        Store.save();
        this.renderSimRows();
      },
    });

    $('#simEqual').addEventListener('click', () => {
      if (!s.rows.length) return;
      const each = Math.floor((100 / s.rows.length) * 100) / 100;
      s.rows.forEach(r => (r.pct = each));
      s.rows[0].pct = Math.round((100 - each * (s.rows.length - 1)) * 100) / 100;
      Store.save();
      this.renderSimRows();
    });

    $('#simFromPortfolio').addEventListener('click', () => {
      const { rows, totals } = Portfolio.snapshot();
      if (!rows.length) { toast('Ton portefeuille est vide.'); return; }
      const useValue = totals.missing === 0 && totals.value > 0;
      const tot = useValue ? totals.value : totals.cost;
      s.rows = rows.map(r => ({ key: r.key, pct: Math.round(((useValue ? r.valueBase : r.costBase) / tot) * 10000) / 100 }));
      const diff = Math.round((100 - s.rows.reduce((a, r) => a + r.pct, 0)) * 100) / 100;
      s.rows[0].pct = Math.round((s.rows[0].pct + diff) * 100) / 100;
      if (!s.initial) s.initial = Math.round(totals.cost);
      Store.save();
      this.renderSimRows();
      toast('Répartition reprise de ton portefeuille (' + (useValue ? 'valeur actuelle' : 'montants investis') + ')', 'success');
    });

    $('#simRun').addEventListener('click', () => this.runSimulation());
  },

  renderSimRows(full = true) {
    const s = this.simState();
    const box = $('#simRows');
    const total = s.rows.reduce((a, r) => a + (parseNum(r.pct) || 0), 0);
    const totalEl = $('#simTotal');
    const months = s.start ? Math.max(0, this.monthsBetween(s.start, todayISO())) : 0;
    const totalInvest = (s.initial || 0) + (s.monthly || 0) * months;
    totalEl.textContent = `Total : ${fmtNum(total, 2)} %` + (Math.abs(total - 100) > 0.01 ? ' (doit faire 100 %)' : '') +
      ` · ${fmtMoney(totalInvest, this.base(), 0)} investis sur ${months} mois`;
    totalEl.className = 'alloc-total ' + (Math.abs(total - 100) > 0.01 ? 'bad' : 'ok');
    $('#simCost').textContent = s.rows.length ? `Coût : ~${s.rows.length} crédit(s) API (historique mis en cache 6 h)` : '';

    const amountFor = pct => fmtMoney((s.initial || 0) * pct / 100, this.base(), 0) + (s.monthly ? ' + ' + fmtMoney(s.monthly * pct / 100, this.base(), 0) + '/mois' : '');

    if (!full && box.children.length === s.rows.length) {
      $$('.alloc-row', box).forEach((row, i) => { row.querySelector('.amt').textContent = amountFor(s.rows[i].pct || 0); });
      return;
    }
    box.replaceChildren(...s.rows.map((r, i) => {
      const inst = Store.instrument(r.key);
      const amt = el('div', { class: 'amt' }, amountFor(r.pct || 0));
      const input = el('input', { type: 'number', min: 0, max: 100, step: 0.5, value: r.pct });
      input.addEventListener('input', () => {
        r.pct = parseNum(input.value) || 0;
        Store.save();
        this.renderSimRows(false);
      });
      return el('div', { class: 'alloc-row' },
        el('div', {}, el('span', { class: 'sym' }, Store.label(r.key)), el('span', { class: 'name' }, inst ? inst.name : '')),
        el('div', { class: 'pct' }, input),
        amt,
        el('button', { class: 'iconbtn', title: 'Retirer', onclick: () => { s.rows.splice(i, 1); Store.save(); this.renderSimRows(); } }, '✕'));
    }));
    if (!s.rows.length) box.append(el('p', { class: 'muted' }, 'Ajoute des ETF ci-dessous (ou reprends ton portefeuille), puis indique le pourcentage de chaque ligne.'));
  },

  monthsBetween(a, b) {
    const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
    let m = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
    if (db.getDate() < da.getDate()) m--;
    return m;
  },

  async runSimulation() {
    const s = this.simState();
    const cur = this.base();
    const total = s.rows.reduce((a, r) => a + (r.pct || 0), 0);
    if (!s.rows.length) { toast('Ajoute au moins un ETF', 'error'); return; }
    if (Math.abs(total - 100) > 0.01) { toast('La répartition doit totaliser 100 %', 'error'); return; }
    if (!s.start || s.start >= todayISO()) { toast('Choisis une date de départ dans le passé', 'error'); return; }
    if (!(s.initial > 0) && !(s.monthly > 0)) { toast('Indique un montant initial ou mensuel', 'error'); return; }

    const btn = $('#simRun');
    btn.disabled = true; btn.textContent = 'Simulation en cours…';
    try {
      const series = {}, fx = {};
      const notes = [];
      for (const r of s.rows) {
        series[r.key] = await Api.daily(r.key, s.start);
        const inst = Store.instrument(r.key);
        fx[r.key] = await Api.fxRate(inst.currency);
        if (!series[r.key].length) throw new Error('Aucun historique pour ' + Store.label(r.key));
        if (series[r.key][0][0] > addDaysISO(s.start, 7)) notes.push(`${Store.label(r.key)} : données disponibles à partir du ${fmtDate(series[r.key][0][0])}, l'argent reste en attente jusque-là.`);
        if (inst.currency !== cur) notes.push(`${Store.label(r.key)} est coté en ${inst.currency} : conversion au taux actuel (${fmtNum(fx[r.key], 4)}).`);
      }

      const events = [];
      const today = todayISO();
      for (let m = 0; ; m++) {
        const d = addMonthsISO(s.start, m);
        if (d > today) break;
        const amount = m === 0 ? (s.initial || 0) : (s.monthly || 0);
        if (amount <= 0) continue;
        for (const r of s.rows) if (r.pct > 0) events.push({ date: d, key: r.key, amount: amount * r.pct / 100 });
      }
      const { points, lines } = Portfolio.replay(series, fx, events, { fractional: s.fractional });
      if (!points.length) throw new Error('Pas assez de données pour simuler.');
      const lastP = points[points.length - 1];
      const pnl = lastP.value - lastP.invested;
      const pnlPct = lastP.invested > 0 ? (pnl / lastP.invested) * 100 : NaN;
      const nbVersements = new Set(events.map(e => e.date)).size;
      const years = (new Date(lastP.date) - new Date(s.start)) / (365.25 * 864e5);
      const maxDD = this.maxDrawdown(points);

      $('#simResults').classList.remove('hidden');
      $('#simKpis').replaceChildren(
        this.kpi('Total investi', fmtMoney(lastP.invested, cur), `${nbVersements} versement(s) · ${fmtNum(years, 1)} an(s)`),
        this.kpi('Valeur aujourd\'hui', fmtMoney(lastP.value, cur), 'au ' + fmtDate(lastP.date)),
        this.kpi('Plus-value latente', fmtSignedMoney(pnl, cur), fmtPct(pnlPct), trendClass(pnl)),
        (() => {
          const x = Portfolio.xirr([...events.map(e => ({ date: e.date, amount: -e.amount })), { date: lastP.date, amount: lastP.value }]);
          return this.kpi('Rendement annualisé', fmtPct(x), 'XIRR (tient compte des versements)', trendClass(x));
        })(),
        this.kpi('Pire baisse', fmtPct(-maxDD * 100), 'Max drawdown de la valeur', maxDD > 0 ? 'down' : ''),
      );

      const tbody = $('#simTable tbody');
      const linesArr = s.rows.map(r => Object.assign({ pct: r.pct }, lines[r.key] || { key: r.key, invested: 0, value: 0, qty: 0 }));
      const totVal = linesArr.reduce((a, l) => a + (isFinite(l.value) ? l.value : 0), 0);
      tbody.replaceChildren(...linesArr.map(l => {
        const inst = Store.instrument(l.key);
        return el('tr', {},
          el('td', {}, el('span', { class: 'sym' }, Store.label(l.key)), el('span', { class: 'name' }, inst.name)),
          el('td', { class: 'num' }, fmtPct(l.pct, 1, false)),
          el('td', { class: 'num' }, fmtMoney(l.invested, cur)),
          el('td', { class: 'num' }, fmtQty(l.qty)),
          el('td', { class: 'num' }, fmtMoney(l.pru, cur, 3)),
          el('td', { class: 'num' }, fmtMoney(l.lastPrice, inst.currency, 3)),
          el('td', { class: 'num' }, fmtMoney(l.value, cur)),
          el('td', { class: 'num' }, fmtPct(totVal ? (l.value / totVal) * 100 : NaN, 1, false)),
          el('td', { class: 'num ' + trendClass(l.pnl) }, fmtSignedMoney(l.pnl, cur), el('div', { class: 'small' }, fmtPct(l.pnlPct))),
        );
      }));
      $('#simTable tfoot').replaceChildren(el('tr', {},
        el('td', {}, 'Total'), el('td', { class: 'num' }, '100 %'),
        el('td', { class: 'num' }, fmtMoney(lastP.invested, cur)), el('td'), el('td'), el('td'),
        el('td', { class: 'num' }, fmtMoney(lastP.value, cur)), el('td', { class: 'num' }, '100 %'),
        el('td', { class: 'num ' + trendClass(pnl) }, fmtSignedMoney(pnl, cur), el('div', { class: 'small' }, fmtPct(pnlPct)))));

      Charts.investedVsValue('simChart', points.map(p => fmtDate(p.date)), points.map(p => p.invested), points.map(p => p.value), cur, { stepped: true });
      const cash = Object.values(lines).reduce((a, l) => a + (l.cash || 0), 0);
      if (!s.fractional && cash > 0.01) notes.push(`Parts entières : ${fmtMoney(cash, cur)} de liquidités non investies (comptées dans la valeur).`);
      notes.push('Simulation sans frais de courtage ni fiscalité. Les performances passées ne préjugent pas des performances futures.');
      $('#simNote').innerHTML = notes.map(n => '• ' + n.replace(/</g, '&lt;')).join('<br>');
      $('#simResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      btn.disabled = false; btn.textContent = 'Lancer la simulation';
    }
  },

  maxDrawdown(points) {
    // drawdown d'un portefeuille avec apports : on mesure sur la valeur / montant investi
    let peak = -Infinity, dd = 0;
    for (const p of points) {
      const ratio = p.invested > 0 ? p.value / p.invested : 1;
      peak = Math.max(peak, ratio);
      if (peak > 0) dd = Math.max(dd, 1 - ratio / peak);
    }
    return dd;
  },

  /* Projection */
  renderProjection() {
    const p = Store.state.projection || {};
    const ids = { initial: '#projInitial', monthly: '#projMonthly', rate: '#projRate', fees: '#projFees', years: '#projYears', vol: '#projVol' };
    if (!this.projBound) {
      this.projBound = true;
      for (const [k, id] of Object.entries(ids)) {
        if (p[k] !== undefined) $(id).value = p[k];
        $(id).addEventListener('input', () => {
          Store.state.projection = Object.fromEntries(Object.entries(ids).map(([kk, ii]) => [kk, parseNum($(ii).value) || 0]));
          Store.save();
          this.renderProjection();
        });
      }
      $('#projFromPf').addEventListener('click', () => {
        const { totals } = Portfolio.snapshot();
        if (!(totals.value > 0)) { toast('Portefeuille vide ou sans cotation'); return; }
        $('#projInitial').value = Math.round(totals.value);
        $('#projInitial').dispatchEvent(new Event('input'));
      });
    }
    const v = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, parseNum($(id).value) || 0]));
    const years = Math.min(60, Math.max(1, v.years));
    const pts = Portfolio.project({ initial: v.initial, monthly: v.monthly, rate: v.rate, fees: v.fees, years });
    const last = pts[pts.length - 1];
    const cur = this.base();
    const gain = last.value - last.invested;
    $('#projKpis').replaceChildren(
      this.kpi('Total versé', fmtMoney(last.invested, cur, 0), `${fmtMoney(v.initial, cur, 0)} + ${Math.round(years * 12)} × ${fmtMoney(v.monthly, cur, 0)}`),
      this.kpi('Capital final', fmtMoney(last.value, cur, 0), `dans ${years} an(s)`),
      this.kpi('Plus-value', fmtSignedMoney(gain, cur), fmtPct(last.invested ? (gain / last.invested) * 100 : NaN), trendClass(gain)),
      this.kpi('Revenu annuel à 4 %', fmtMoney(last.value * 0.04, cur, 0), 'Règle des 4 % (retrait)'),
    );
    const yearly = pts.filter(x => x.month % 12 === 0);
    // scénarios aléatoires autour de l'hypothèse de rendement
    const goal = Store.state.goal && Store.state.goal.target;
    const mc = Portfolio.monteCarlo({ initial: v.initial, monthly: v.monthly, rate: v.rate, fees: v.fees, vol: Math.max(0, v.vol), years, target: goal || 0 });
    const end = mc.years[mc.years.length - 1];
    $('#projMcKpis').replaceChildren(...[
      this.kpi('Scénario défavorable', fmtMoney(end.p10, cur, 0), '1 chance sur 10 de faire moins bien', 'down'),
      this.kpi('Scénario médian', fmtMoney(end.p50, cur, 0), '1 chance sur 2 de faire mieux'),
      this.kpi('Scénario favorable', fmtMoney(end.p90, cur, 0), '1 chance sur 10 de faire mieux', 'up'),
      this.kpi('Risque de perte', fmtPct(mc.probLoss * 100, 0, false), 'Capital final inférieur au total versé', mc.probLoss > 0.1 ? 'down' : ''),
      goal > 0 ? this.kpi('Objectif atteint', fmtPct(mc.probTarget * 100, 0, false), 'Chance d\'avoir ' + fmtMoney(goal, cur, 0) + ' (onglet Investir) dans ' + years + ' an(s)', mc.probTarget >= 0.5 ? 'up' : 'down') : null,
    ].filter(Boolean));
    if (this.view === 'simulation') {
      Charts.fan('projChart', yearly.map(x => 'An ' + x.month / 12), {
        invested: yearly.map(x => x.invested), expected: yearly.map(x => x.value),
        p10: mc.years.map(y => y.p10), p50: mc.years.map(y => y.p50), p90: mc.years.map(y => y.p90),
      }, cur);
    }
  },

  /* ------------------------------------------------------------------ */
  /* RÉGLAGES                                                             */
  /* ------------------------------------------------------------------ */
  bindSettings() {
    const st = Store.state.settings;
    $('#setApiKey').value = st.apiKey;
    $('#setProxy').value = st.yahooProxy || '';
    $('#testProxy').addEventListener('click', async () => {
      const url = $('#setProxy').value.trim() || Api.autoProxy || Api.defaultProxy;
      if (!url) { toast('Saisis l\'URL de ton relais', 'error'); return; }
      try {
        const j = await Api.yahoo({ type: 'chart', symbol: 'CW8.PA', range: '1d', interval: '1d' }, url);
        const m = j.chart.result[0].meta;
        toast(`Relais OK ✔ CW8 (Paris) : ${fmtMoney(m.regularMarketPrice, m.currency)}`, 'success', 6000);
      } catch (e) {
        toast('Relais injoignable : ' + e.message, 'error', 8000);
      }
    });
    $('#setCurrency').value = st.baseCurrency;
    $('#setRefresh').value = String(st.refreshSec);
    $('#setCredits').value = st.creditsPerMin;
    $('#setRiskFree').value = st.riskFree ?? 2;

    $('#toggleKey').addEventListener('click', () => {
      const i = $('#setApiKey');
      i.type = i.type === 'password' ? 'text' : 'password';
      $('#toggleKey').textContent = i.type === 'password' ? 'Afficher' : 'Masquer';
    });

    $('#settingsForm').addEventListener('submit', e => {
      e.preventDefault();
      const prevCcy = st.baseCurrency;
      const prevKey = st.apiKey;
      st.apiKey = $('#setApiKey').value.trim();
      const prevProxy = st.yahooProxy;
      st.yahooProxy = $('#setProxy').value.trim().replace(/\/+$/, '');
      st.baseCurrency = $('#setCurrency').value;
      st.refreshSec = parseInt($('#setRefresh').value, 10);
      st.creditsPerMin = parseInt($('#setCredits').value, 10) || 8;
      st.riskFree = isFinite(parseNum($('#setRiskFree').value)) ? parseNum($('#setRiskFree').value) : 2;
      Store.save();
      this.schedule();
      Api.emitUsage();
      this.renderAll();
      toast('Réglages enregistrés', 'success', 2000);
      if (Api.ready() && (prevKey !== st.apiKey || prevCcy !== st.baseCurrency || prevProxy !== st.yahooProxy)) this.refresh();
    });

    $('#testKey').addEventListener('click', async () => {
      const key = $('#setApiKey').value.trim();
      if (!key) { toast('Saisis une clé', 'error'); return; }
      try {
        const res = await fetch('https://api.twelvedata.com/api_usage?apikey=' + encodeURIComponent(key));
        const j = await res.json();
        if (j.status === 'error') throw new Error(j.message);
        toast(`Clé valide ✔ Forfait ${j.plan_category || ''} · ${j.daily_usage}/${j.plan_daily_limit} crédits utilisés aujourd'hui`, 'success', 6000);
        if (j.plan_limit) $('#setCredits').value = j.plan_limit;
      } catch (e) {
        toast('Clé refusée : ' + e.message, 'error', 6000);
      }
    });

    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'apistock-' + todayISO() + '.json' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $('#importFile').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        Store.importJSON(await file.text());
        toast('Données importées', 'success');
        this.bindSettingsValues();
        this.renderAll();
        this.refresh();
      } catch (err) {
        toast('Import impossible : ' + err.message, 'error');
      }
      e.target.value = '';
    });

    $('#clearCache').addEventListener('click', () => {
      Api.pruneSeriesCache();
      Api.quotes = {}; Api.fx = {}; Api.intraday = {};
      localStorage.removeItem('apistock:quotes');
      localStorage.removeItem('apistock:fx');
      this.renderAll();
      toast('Cache vidé');
    });

    $('#resetAll').addEventListener('click', () => {
      if (!confirm('Effacer toutes tes opérations, ta liste de suivi et tes réglages ? (pense à exporter avant)')) return;
      Object.keys(localStorage).filter(k => k.startsWith('apistock:')).forEach(k => localStorage.removeItem(k));
      location.reload();
    });

    $('#hardReload').addEventListener('click', () => this.hardReload());
  },

  /** Rechargement complet : service worker, caches, fichiers du site et cache des cours (données perso conservées) */
  async hardReload() {
    const btn = $('#hardReload');
    btn.disabled = true;
    btn.classList.add('spin');
    btn.querySelector('span').textContent = 'Rechargement…';
    // 1. service worker (application installée) et ses caches
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    } catch (e) { /* ignore */ }
    // 2. retéléchargement de chaque fichier du site, en contournant le cache HTTP du navigateur
    const urls = new Set([location.pathname, 'index.html', 'manifest.webmanifest', 'sw.js']);
    $$('script[src], link[rel=stylesheet][href], link[rel=manifest][href]').forEach(n => {
      const u = new URL(n.getAttribute('src') || n.getAttribute('href'), location.href);
      if (u.origin === location.origin) urls.add(u.pathname);
    });
    await Promise.all(Array.from(urls).map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
    // 3. cache des cours (opérations, comptes, réglages et clé API ne sont pas touchés)
    Api.pruneSeriesCache();
    localStorage.removeItem('apistock:quotes');
    localStorage.removeItem('apistock:fx');
    // 4. rechargement
    sessionStorage.setItem('apistock:reloaded', '1');
    location.reload();
  },

  bindSettingsValues() {
    const st = Store.state.settings;
    $('#setCurrency').value = st.baseCurrency;
    $('#setRefresh').value = String(st.refreshSec);
    $('#setCredits').value = st.creditsPerMin;
    $('#setRiskFree').value = st.riskFree ?? 2;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
