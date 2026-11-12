/* Versements programmés, liquidités, divisions détectées, recherche par ISIN et carte « À faire » */
'use strict';

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/* ==================================================================== */
/* API : événements Yahoo (dividendes, divisions) et recherche par ISIN   */
/* ==================================================================== */
Object.assign(Api, {
  /**
   * Dividendes et divisions d'un instrument depuis `startISO` (au moins 13 mois), via le graphique mensuel Yahoo.
   * Mis en cache 12 h. Renvoie { divs: [{date, amount}], splits: [{date, ratio}], currency }.
   */
  async events(key, startISO) {
    if (Manual.is(key)) return { divs: [], splits: [], currency: (Store.instrument(key) || {}).currency };
    const ck = 'apistock:events:' + key;
    const from = [startISO || todayISO(), addDaysISO(todayISO(), -400)].sort()[0];
    let c = null;
    try { c = JSON.parse(localStorage.getItem(ck) || 'null'); } catch (e) { c = null; }
    if (c && Date.now() - c.ts < 12 * 3600 * 1000 && c.from <= from) return c.data;
    const inst = Store.instrument(key);
    const ysym = inst && yahooSymbolFor(inst);
    if (!ysym || !this.hasProxy()) return { divs: [], splits: [], currency: inst ? inst.currency : '' };
    const json = await this.yahoo({
      type: 'chart', symbol: ysym, interval: '1mo', events: 'div,split',
      period1: Math.floor(Date.parse(addDaysISO(from, -40) + 'T00:00:00Z') / 1000), period2: Math.floor(Date.now() / 1000) + 86400,
    });
    const r = json.chart && json.chart.result && json.chart.result[0];
    const ev = (r && r.events) || {};
    const off = ((r && r.meta && r.meta.gmtoffset) || 0) * 1000;
    const iso = t => new Date(t * 1000 + off).toISOString().slice(0, 10);
    const data = {
      divs: Object.values(ev.dividends || {}).map(d => ({ date: iso(d.date), amount: d.amount })).filter(d => d.amount > 0).sort((a, b) => (a.date < b.date ? -1 : 1)),
      splits: Object.values(ev.splits || {}).map(s => ({ date: iso(s.date), ratio: s.numerator / s.denominator }))
        .filter(s => s.ratio > 0 && s.ratio !== 1).sort((a, b) => (a.date < b.date ? -1 : 1)),
      currency: (r && r.meta && r.meta.currency) || (inst && inst.currency) || '',
    };
    try { localStorage.setItem(ck, JSON.stringify({ ts: Date.now(), from, data })); } catch (e) { /* ignore */ }
    return data;
  },
});

// Recherche par code ISIN : Yahoo ne renvoie souvent qu'une cotation, on complète avec les autres places du même fonds
(() => {
  const orig = Api.search;
  Api.search = async function (query) {
    const q = String(query || '').trim().toUpperCase().replace(/\s/g, '');
    if (!ISIN_RE.test(q)) return orig.call(this, query);
    const first = await orig.call(this, q);
    const named = first.find(d => d.source === 'yahoo' && d.name && d.name !== d.symbol);
    let more = [];
    if (named) {
      try {
        const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        more = (await orig.call(this, named.name)).filter(d => norm(d.name) === norm(named.name));
      } catch (e) { /* on garde le premier résultat */ }
    }
    const seen = new Set();
    const out = [];
    for (const d of [...first, ...more]) {
      const k = (d.ysymbol || '') + '|' + Store.key(d.symbol, d.mic);
      if (seen.has(k) || /\.(SG|DU|MU|BE|HM|F)$/.test(d.ysymbol || '') && d.symbol === q) continue; // codes ISIN bruts des places allemandes secondaires
      seen.add(k);
      out.push(Object.assign({}, d, { isin: q }));
    }
    if (!out.length) throw new Error('Aucun ETF trouvé pour l\'ISIN ' + q);
    return out;
  };
})();

Object.assign(App, {
  /* ================================================================== */
  /* OUVERTURE PRÉ-REMPLIE DE LA FENÊTRE D'OPÉRATION                      */
  /* ================================================================== */
  openTxPreset(p) {
    this.openTx();
    $('#txType').value = p.type || 'buy';
    this.syncTxType();
    if (p.account && Store.state.accounts.some(a => a.id === p.account)) $('#txAccount').value = p.account;
    $('#txDate').value = p.date || todayISO();
    $('#txQty').value = p.qty !== undefined && isFinite(p.qty) ? String(p.qty) : '';
    $('#txPrice').value = p.price !== undefined && isFinite(p.price) ? String(Math.round(p.price * 10000) / 10000) : '';
    $('#txNote').value = p.note || '';
    this.setTxInstrument(p.key);
    this.txPlanRef = p.planRef || null;
    this.updateTxTotal();
  },

  /** Cours de clôture d'un instrument à une date passée (ou cours actuel pour aujourd'hui) */
  async priceAt(key, date) {
    const q = Api.cachedQuote(key);
    if (date >= todayISO()) return q ? q.price : (await Api.quote(key)).price;
    try {
      const values = await Api.daily(key, addDaysISO(date, -10));
      let px = NaN;
      for (const [d, v] of values) { if (d <= date) px = v; else break; }
      if (isFinite(px)) return px;
    } catch (e) { /* repli sur le cours actuel */ }
    return q ? q.price : NaN;
  },

  /* ================================================================== */
  /* VERSEMENTS PROGRAMMÉS                                                */
  /* ================================================================== */
  bindPlans() {
    $('#planStart').value = todayISO();
    $('#planForm').addEventListener('submit', e => {
      e.preventDefault();
      const amount = parseNum($('#planAmt').value);
      const day = Math.min(31, Math.max(1, parseInt($('#planDay').value, 10) || 1));
      if (!$('#planKey').value || !(amount > 0) || !$('#planStart').value) { toast('Choisis un ETF, un montant et une date de départ', 'error'); return; }
      Store.state.plans.push({ id: uid(), key: $('#planKey').value, account: $('#planAcc').value || Store.defaultAccount(), amount, day,
        start: $('#planStart').value, fractional: $('#planFrac').checked, active: true, done: {} });
      Store.save();
      $('#planAmt').value = '';
      this.renderPlans();
      this.renderTodo(true);
      toast('Versement programmé ajouté', 'success', 2000);
    });
  },

  renderPlans() {
    if (!$('#plansTable')) return;
    const cur = this.base();
    const sel = $('#planKey');
    const prev = sel.value;
    const keys = Object.keys(Store.state.instruments);
    sel.replaceChildren(...keys.map(k => el('option', { value: k }, Store.label(k) + ' — ' + Store.code(k))));
    if (keys.includes(prev)) sel.value = prev;
    const accs = Store.state.accounts;
    const accSel = $('#planAcc');
    const prevAcc = accSel.value;
    accSel.replaceChildren(...accs.map(a => el('option', { value: a.id }, a.name)));
    accSel.value = accs.some(a => a.id === prevAcc) ? prevAcc : (Store.state.accountFilter !== 'all' ? Store.state.accountFilter : Store.defaultAccount());
    $('#planAccWrap').classList.toggle('hidden', accs.length < 2);

    const list = Store.state.plans;
    $('#plansTable tbody').replaceChildren(...list.map(p => {
      const due = Portfolio.planDue(p).length;
      const next = Portfolio.planNext(p);
      const active = p.active !== false;
      return el('tr', {},
        el('td', {}, el('span', { class: 'sym' }, Store.label(p.key)), el('span', { class: 'name', title: (Store.instrument(p.key) || {}).name || '' }, Store.code(p.key))),
        el('td', { class: 'muted' }, Store.account(p.account).name),
        el('td', { class: 'num' }, fmtMoney(p.amount, cur), p.fractional ? el('div', { class: 'small muted' }, 'parts fractionnées') : null),
        el('td', { class: 'num' }, 'le ' + p.day),
        el('td', {}, active ? (next ? fmtDate(next) : '—') : el('span', { class: 'muted' }, '—'),
          due ? el('div', { class: 'small down' }, due + ' échéance(s) à confirmer') : null),
        el('td', {}, el('button', { class: 'chip ' + (active ? 'buy' : 'sell') + ' chip-btn', title: active ? 'Mettre en pause' : 'Reprendre',
          onclick: () => { p.active = !active; Store.save(); this.renderPlans(); this.renderTodo(true); } }, active ? 'Actif' : 'En pause')),
        el('td', { class: 'num' }, el('button', { class: 'iconbtn', title: 'Supprimer', onclick: () => {
          const idx = Store.state.plans.indexOf(p);
          Store.state.plans.splice(idx, 1); Store.markDeleted(p.id); Store.save(); this.renderPlans(); this.renderTodo(true);
          undoToast('Versement programmé supprimé', () => { Store.state.plans.splice(idx, 0, p); Store.unmarkDeleted(p.id); Store.save(); this.renderPlans(); this.renderTodo(true); });
        } }, '🗑')));
    }));
    if (!list.length) $('#plansTable tbody').append(el('tr', {}, el('td', { colspan: 7, class: 'empty' }, 'Aucun versement programmé. Exemple : 200 € sur CW8 le 5 de chaque mois.')));
  },

  /** Ouvre la fenêtre d'achat pré-remplie pour une échéance */
  async confirmPlan(item) {
    const { plan, month, date } = item;
    const inst = Store.instrument(plan.key);
    let price = NaN;
    try { price = await this.priceAt(plan.key, date); } catch (e) { /* saisie manuelle */ }
    let fx = Api.fxCached(inst.currency);
    if (!isFinite(fx)) { try { fx = await Api.fxRate(inst.currency); } catch (e) { fx = NaN; } }
    const qty = Portfolio.planShares(plan.amount, price, fx, plan.fractional);
    this.openTxPreset({ key: plan.key, type: 'buy', date, account: plan.account, qty: qty || '', price,
      note: 'Versement programmé ' + fmtMoney(plan.amount, this.base(), 0, true), planRef: { planId: plan.id, month } });
    if (isFinite(price) && !qty) toast(`${fmtMoney(plan.amount, this.base(), 0, true)} ne suffisent pas pour une part entière à ce cours : ajuste la quantité, ou active les parts fractionnées.`, 'info', 7000);
  },

  /** Enregistre directement toutes les échéances en attente, au cours de clôture de chaque date */
  async confirmAllPlans(items) {
    if (!confirm(`Enregistrer ${items.length} achat(s) programmé(s) au cours de clôture de chaque échéance ?`)) return;
    let n = 0, skipped = 0;
    for (const { plan, month, date } of items) {
      const inst = Store.instrument(plan.key);
      try {
        const price = await this.priceAt(plan.key, date);
        const fx = isFinite(Api.fxCached(inst.currency)) ? Api.fxCached(inst.currency) : await Api.fxRate(inst.currency);
        const qty = Portfolio.planShares(plan.amount, price, fx, plan.fractional);
        if (!(qty > 0)) { skipped++; continue; }
        const tx = { key: plan.key, type: 'buy', date, account: plan.account, qty, price, fees: 0, note: 'Versement programmé ' + fmtMoney(plan.amount, this.base(), 0, true) };
        Store.addTransaction(tx);
        plan.done = plan.done || {};
        plan.done[month] = tx.id;
        n++;
      } catch (e) { skipped++; }
    }
    Store.save();
    this.renderAll();
    this.preloadFx();
    toast(n + ' achat(s) enregistré(s)' + (skipped ? ` · ${skipped} à saisir à la main (cours indisponible ou montant trop faible)` : ''), n ? 'success' : 'error', 6000);
  },

  skipPlan(item) {
    item.plan.done = item.plan.done || {};
    item.plan.done[item.month] = 'skip';
    Store.save();
    this.renderTodo(true);
    this.renderPlans();
    undoToast('Échéance ignorée', () => { delete item.plan.done[item.month]; Store.save(); this.renderTodo(true); this.renderPlans(); });
  },

  /* ================================================================== */
  /* LIQUIDITÉS                                                           */
  /* ================================================================== */
  bindCash() {
    const dlg = $('#cashDialog');
    const open = (m = null) => {
      this.editingCash = m;
      $('#cashDialogTitle').textContent = m ? 'Modifier le mouvement' : 'Versement / retrait';
      $('#cashType').value = m ? m.type : 'deposit';
      $('#cashDate').value = m ? m.date : todayISO();
      $('#cashAmount').value = m ? m.amount : '';
      $('#cashNote').value = m ? (m.note || '') : '';
      const accs = Store.state.accounts;
      $('#cashAcc').replaceChildren(...accs.map(a => el('option', { value: a.id }, a.name)));
      const f = Store.state.accountFilter;
      $('#cashAcc').value = m ? (m.account || Store.defaultAccount()) : (f && f !== 'all' ? f : Store.defaultAccount());
      $('#cashAccWrap').classList.toggle('hidden', accs.length < 2);
      dlg.showModal();
    };
    this.openCash = open;
    $('#cashAdd').addEventListener('click', () => open());
    $('#cashAdd2').addEventListener('click', () => open());
    $('#cashCancel').addEventListener('click', () => dlg.close());
    $('#cashForm').addEventListener('submit', e => {
      e.preventDefault();
      const m = { type: $('#cashType').value, date: $('#cashDate').value, account: $('#cashAcc').value || Store.defaultAccount(),
        amount: parseNum($('#cashAmount').value), note: $('#cashNote').value.trim() };
      if (!(m.amount > 0) || !m.date) { toast('Montant et date sont obligatoires', 'error'); return; }
      if (!m.note) delete m.note;
      const first = !Portfolio.cashTracked(m.account);
      if (this.editingCash) { if (!m.note) delete this.editingCash.note; Object.assign(this.editingCash, m); }
      else Store.state.cashMoves.push(Object.assign({ id: uid() }, m));
      Store.save();
      dlg.close();
      this.renderAll();
      toast(first ? 'Mouvement enregistré : les espèces de ce compte sont maintenant suivies ✔' : 'Mouvement enregistré', 'success', first ? 5000 : 2000);
    });
  },

  renderCash() {
    const card = $('#cashCard');
    if (!card) return;
    const cur = this.base();
    const filter = Store.state.accountFilter || 'all';
    const accs = Store.state.accounts.filter(a => (filter === 'all' || a.id === filter) && Portfolio.cashTracked(a.id));
    card.classList.toggle('hidden', !accs.length);
    if (!accs.length) return;
    const moves = Store.state.cashMoves.filter(m => accs.some(a => a.id === (m.account || Store.defaultAccount())))
      .slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const showAll = this.cashShowAll;
    $('#cashBody').replaceChildren(...[
      el('div', { class: 'cash-grid' }, ...accs.map(a => {
        const b = Portfolio.cashBalance(a.id);
        return el('div', { class: 'tax-stat' },
          el('span', { class: 'muted small' }, a.name),
          el('b', { class: 'mono ' + (b.cash < -0.005 ? 'down' : '') }, fmtMoney(b.cash, cur)),
          el('span', { class: 'muted small' }, `Versé ${fmtMoney(b.deposits, cur, 0)}` + (b.withdrawals ? ` · retiré ${fmtMoney(b.withdrawals, cur, 0)}` : '')),
          b.cash < -0.005 ? el('span', { class: 'small down' }, 'Solde négatif : un versement manque sans doute (ajoute-le à la bonne date).') : null);
      })),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Type'), Store.state.accounts.length > 1 ? el('th', {}, 'Compte') : null, el('th', { class: 'num' }, 'Montant'), el('th', {}, 'Note'), el('th'))),
        el('tbody', {}, ...(showAll ? moves : moves.slice(0, 5)).map(m => el('tr', {},
          el('td', {}, fmtDate(m.date)),
          el('td', {}, el('span', { class: 'chip ' + (m.type === 'withdraw' ? 'sell' : 'buy') }, m.type === 'withdraw' ? 'Retrait' : 'Versement')),
          Store.state.accounts.length > 1 ? el('td', { class: 'muted' }, Store.account(m.account).name) : null,
          el('td', { class: 'num ' + (m.type === 'withdraw' ? 'down' : 'up') }, (m.type === 'withdraw' ? '−' : '+') + fmtMoney(m.amount, cur)),
          el('td', { class: 'muted small' }, m.note || ''),
          el('td', { class: 'num' },
            el('button', { class: 'iconbtn', title: 'Modifier', onclick: () => this.openCash(m) }, '✎'),
            el('button', { class: 'iconbtn', title: 'Supprimer', onclick: () => {
              const idx = Store.state.cashMoves.indexOf(m);
              Store.state.cashMoves.splice(idx, 1); Store.markDeleted(m.id); Store.save(); this.renderAll();
              undoToast('Mouvement supprimé', () => { Store.state.cashMoves.splice(idx, 0, m); Store.unmarkDeleted(m.id); Store.save(); this.renderAll(); });
            } }, '🗑'))))))),
      moves.length > 5 ? el('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => { this.cashShowAll = !showAll; this.renderCash(); } },
        showAll ? 'Réduire' : `Voir les ${moves.length} mouvements`) : null,
      noteTip('Espèces = versements − retraits − achats (frais inclus) + ventes + dividendes nets. Les opérations en devises sont converties au taux de change de leur date.')].filter(Boolean));
  },

  /* ================================================================== */
  /* ÉVÉNEMENTS (dividendes, divisions) des positions                     */
  /* ================================================================== */
  /** Quantité détenue d'un instrument sur un compte, la veille d'une date */
  qtyAt(key, accountId, date) {
    let q = 0;
    const txs = Store.state.transactions.filter(t => t.key === key && (t.account || Store.defaultAccount()) === accountId && t.date < date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const t of txs) {
      const n = parseNum(t.qty);
      if (t.type === 'buy') q += n;
      else if (t.type === 'sell') q = Math.max(0, q - n);
      else if (t.type === 'split' && n > 0) q *= n;
    }
    return q;
  },

  async loadEvents(force = false) {
    if (!Api.hasProxy() || this._eventsLoading) return;
    if (!force && this.eventsAt && Date.now() - this.eventsAt < 6 * 3600 * 1000) return;
    const keys = Array.from(new Set(Store.state.transactions.map(t => t.key))).filter(k => Store.instrument(k));
    if (!keys.length) return;
    this._eventsLoading = true;
    const data = {};
    try {
      for (const k of keys) {
        const first = Store.state.transactions.filter(t => t.key === k).reduce((m, t) => (t.date < m ? t.date : m), todayISO());
        try { data[k] = await Api.events(k, first); } catch (e) { /* instrument sans données Yahoo */ }
      }
      this.eventsData = data;
      this.eventsAt = Date.now();
    } finally { this._eventsLoading = false; }
    this.renderTodo(true);
    if (this.renderDividends) this.renderDividends();
  },

  /** Divisions annoncées par Yahoo et pas encore saisies */
  splitSuggestions() {
    const out = [];
    const dismissed = Store.state.dismissed || {};
    for (const [key, ev] of Object.entries(this.eventsData || {})) {
      for (const s of ev.splits || []) {
        const id = 'split:' + key + ':' + s.date;
        if (dismissed[id]) continue;
        const known = Store.state.transactions.some(t => t.type === 'split' && t.key === key && Math.abs(Date.parse(t.date) - Date.parse(s.date)) < 6 * 864e5);
        if (known) continue;
        const accounts = Store.state.accounts.map(a => ({ a, qty: this.qtyAt(key, a.id, s.date) })).filter(x => x.qty > 0);
        if (accounts.length) out.push({ id, key, split: s, accounts });
      }
    }
    return out;
  },

  /** Dividendes détachés ces 4 derniers mois, sur une position détenue, sans dividende enregistré autour */
  dividendSuggestions() {
    const out = [];
    const dismissed = Store.state.dismissed || {};
    const since = addDaysISO(todayISO(), -120);
    for (const [key, ev] of Object.entries(this.eventsData || {})) {
      for (const d of ev.divs || []) {
        if (d.date < since || d.date > todayISO()) continue;
        for (const a of Store.state.accounts) {
          const id = 'div:' + key + ':' + a.id + ':' + d.date;
          if (dismissed[id]) continue;
          const qty = this.qtyAt(key, a.id, d.date);
          if (!(qty > 0)) continue;
          const lo = addDaysISO(d.date, -7), hi = addDaysISO(d.date, 60);
          const known = Store.state.transactions.some(t => t.type === 'div' && t.key === key && (t.account || Store.defaultAccount()) === a.id && t.date >= lo && t.date <= hi);
          if (!known) out.push({ id, key, account: a, date: d.date, perShare: d.amount, qty, gross: d.amount * qty, currency: ev.currency });
        }
      }
    }
    return out;
  },

  dismiss(id, rerender = true) {
    Store.state.dismissed = Store.state.dismissed || {};
    Store.state.dismissed[id] = Date.now();
    Store.save();
    if (rerender) this.renderTodo(true);
    undoToast('Masqué', () => { delete Store.state.dismissed[id]; Store.save(); this.renderTodo(true); });
  },

  addSplit(s) {
    for (const { a } of s.accounts) Store.addTransaction({ key: s.key, type: 'split', date: s.split.date, account: a.id, qty: s.split.ratio, price: 0, fees: 0, note: 'Division détectée automatiquement' });
    this.renderAll();
    toast('Division ' + fmtSplit(s.split.ratio) + ' ajoutée pour ' + Store.label(s.key), 'success');
  },

  /* ================================================================== */
  /* CARTE « À FAIRE »                                                    */
  /* ================================================================== */
  todoItems() {
    const cur = this.base();
    const items = [];
    const due = Store.state.plans.flatMap(p => Portfolio.planDue(p)).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const d of due.slice(0, 12)) {
      const inst = Store.instrument(d.plan.key);
      const q = Api.cachedQuote(d.plan.key);
      const fx = inst ? Api.fxCached(inst.currency) : NaN;
      const est = q ? Portfolio.planShares(d.plan.amount, q.price, fx, d.plan.fractional) : 0;
      items.push({ id: 'plan:' + d.plan.id + ':' + d.month, icon: '🗓', cls: 'plan',
        title: `Versement programmé · ${Store.label(d.plan.key)} · ${fmtMoney(d.plan.amount, cur, 0)}`,
        sub: `Échéance du ${fmtDate(d.date)}` + (Store.state.accounts.length > 1 ? ' · ' + Store.account(d.plan.account).name : '') + (est ? ` · ≈ ${fmtQty(est)} part(s) au cours actuel` : ''),
        actions: [{ label: 'Enregistrer…', primary: true, fn: () => this.confirmPlan(d) }, { label: 'Ignorer', fn: () => this.skipPlan(d) }] });
    }
    if (due.length > 1) items.unshift({ id: 'plan:all', icon: '⚡', cls: 'plan', title: `${due.length} achats programmés en attente`, sub: 'Les enregistrer tous au cours de clôture de chaque échéance',
      actions: [{ label: 'Tout enregistrer', primary: true, fn: () => this.confirmAllPlans(due) }] });

    for (const s of this.splitSuggestions()) {
      const tot = s.accounts.reduce((a, x) => a + x.qty, 0);
      items.push({ id: s.id, icon: '✂️', cls: 'split', title: `Division détectée · ${Store.label(s.key)} · ${fmtSplit(s.split.ratio)} le ${fmtDate(s.split.date)}`,
        sub: `Tes ${fmtQty(tot)} part(s) deviennent ${fmtQty(tot * s.split.ratio)} : sans cette opération, ton nombre de parts et ton PRU sont faux.`,
        actions: [{ label: 'Ajouter la division', primary: true, fn: () => this.addSplit(s) }, { label: 'Ignorer', fn: () => this.dismiss(s.id) }] });
    }
    for (const d of this.dividendSuggestions()) {
      items.push({ id: d.id, icon: '💶', cls: 'div', title: `Dividende détaché · ${Store.label(d.key)} · ${fmtMoney(d.perShare, d.currency, 3)} par part le ${fmtDate(d.date)}`,
        sub: `≈ ${fmtMoney(d.gross, d.currency)} brut pour tes ${fmtQty(d.qty)} part(s)` + (Store.state.accounts.length > 1 ? ' · ' + d.account.name : '') + '. Reçu ? Enregistre-le pour suivre tes revenus.',
        actions: [{ label: 'Enregistrer…', primary: true, fn: () => this.openTxPreset({ key: d.key, type: 'div', date: d.date, account: d.account.id, price: Math.round(d.gross * 100) / 100, note: `${fmtNum(d.perShare, 4)} par part × ${fmtNum(d.qty, 4)}` }) },
          { label: 'Ignorer', fn: () => this.dismiss(d.id) }] });
    }
    if (this.rebalanceTodo) { const r = this.rebalanceTodo(); if (r) items.push(r); }
    const recap = this.recapTodo();
    if (recap) items.unshift(recap);
    return items;
  },

  /**
   * Bilan du mois écoulé (performance, achats, dividendes, versements prévus) : affiché dans « À faire »
   * pendant les 15 premiers jours du mois, jusqu'à ce que tu le marques comme vu.
   */
  monthRecap(today = todayISO()) {
    const [y, m] = today.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const from = prev + '-01', to = prev + '-31';
    const txs = Portfolio.txs();
    if (!txs.some(t => t.date <= to)) return null; // rien à résumer avant ce mois-là
    const fxOf = t => { const inst = Store.instrument(t.key); return Api.fxAt(inst ? inst.currency : this.base(), t.date); };
    const inMonth = txs.filter(t => t.date >= from && t.date <= to);
    const buys = inMonth.filter(t => t.type === 'buy');
    const bought = buys.reduce((a, t) => a + (parseNum(t.qty) * parseNum(t.price) + (parseNum(t.fees) || 0)) * fxOf(t), 0);
    const divs = inMonth.filter(t => t.type === 'div').reduce((a, t) => a + (parseNum(t.qty) * parseNum(t.price) - (parseNum(t.fees) || 0)) * fxOf(t), 0);
    const planned = Store.state.plans.filter(p => p.active !== false).reduce((a, p) => a + (parseNum(p.amount) || 0), 0);
    let perf = null, gain = null;
    const pts = this.historyPoints;
    if (pts && pts.length) {
      const before = pts.filter(p => p.date < from).pop(), end = pts.filter(p => p.date <= to).pop();
      if (end && end.date >= from) {
        const v0 = before ? before.value : 0, i0 = before ? before.invested : 0;
        gain = (end.value - v0) - (end.invested - i0);
        const mr = Portfolio.monthlyReturns(Portfolio.twr(pts));
        const yr = mr[prev.slice(0, 4)];
        perf = yr ? yr.months[+prev.slice(5)] : null;
      }
    }
    const label = new Date(from + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { month: prev, label, perf, gain, buys: buys.length, bought, divs, planned };
  },

  recapText(r) {
    const cur = this.base();
    const parts = [];
    if (isFinite(r.gain)) parts.push(`${isFinite(r.perf) ? fmtPct(r.perf) + ' · ' : ''}${fmtSignedMoney(r.gain, cur)} sur le mois`);
    parts.push(r.buys ? `${r.buys} achat(s) pour ${fmtMoney(r.bought, cur, 0)}` : 'aucun achat');
    if (r.divs > 0) parts.push(`${fmtMoney(r.divs, cur)} de dividendes`);
    if (r.planned > 0) parts.push(`${fmtMoney(r.planned, cur, 0)} de versements programmés ce mois-ci`);
    return parts.join(' · ');
  },

  recapTodo(today = todayISO()) {
    if (+today.slice(8, 10) > 15) return null;
    const r = this.monthRecap(today);
    if (!r) return null;
    const id = 'recap:' + r.month;
    if ((Store.state.dismissed || {})[id]) return null;
    const title = 'Bilan de ' + r.label;
    const text = this.recapText(r);
    this.notifyRecap(r, title, text);
    return { id, icon: '📊', cls: 'recap', title, sub: text + (isFinite(r.gain) ? '' : ' · performance affichée une fois l\'historique chargé'),
      actions: [{ label: 'Vu', fn: () => this.dismiss(id) }] };
  },

  /** Notification du bilan, une fois par mois, si tu as autorisé les notifications (site ouvert) */
  notifyRecap(r, title, body) {
    if (!isFinite(r.gain) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try { if (localStorage.getItem('apistock:recapNotified') === r.month) return; localStorage.setItem('apistock:recapNotified', r.month); } catch (e) { return; }
    const opts = { body, icon: 'icons/icon-192.png', tag: 'recap-' + r.month };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => {});
    else { try { new Notification(title, opts); } catch (e) { /* notifications indisponibles */ } }
  },

  renderTodo(force = false) {
    const card = $('#todoCard');
    if (!card) return;
    const items = this.todoItems();
    const sig = items.map(i => i.id + i.title).join('|');
    if (!force && sig === this._todoSig) return;
    this._todoSig = sig;
    card.classList.toggle('hidden', !items.length);
    $('#todoInfo').textContent = items.length ? items.length + ' élément(s)' : '';
    // pastille sur le sous-onglet « Synthèse », visible depuis les autres sous-onglets
    const tab = $('#pfSubnav [data-tab="synthese"]');
    if (tab) {
      let badge = tab.querySelector('.tab-badge');
      if (!badge) { badge = el('span', { class: 'tab-badge' }); tab.append(badge); }
      badge.textContent = items.length || '';
      badge.classList.toggle('hidden', !items.length);
      badge.title = items.length ? items.length + ' élément(s) à faire' : '';
    }
    $('#todoList').replaceChildren(...items.map(i => el('li', { class: 'todo-item ' + (i.cls || '') },
      el('span', { class: 'todo-icon', 'aria-hidden': 'true' }, i.icon),
      el('div', { class: 'todo-text' }, el('b', {}, i.title), el('span', { class: 'muted small' }, i.sub)),
      el('div', { class: 'todo-actions' }, ...i.actions.map(a => el('button', { class: 'btn small' + (a.primary ? ' primary' : ''), onclick: a.fn }, a.label))))));
  },
});

/* ==================================================================== */
/* Branchements                                                           */
/* ==================================================================== */
App.on('rendered:all', function () {
  this.renderCash();
  this.renderPlans();
  this.renderTodo(true);
});
App.on('rendered:portfolio', function () { this.renderTodo(); }); // seulement si la liste a changé
// après chaque rafraîchissement : dividendes et divisions des positions (au plus toutes les 6 h)
App.on('refreshed', function () { this.loadEvents().catch(() => {}); });

document.addEventListener('DOMContentLoaded', () => {
  App.bindPlans();
  App.bindCash();
  App.renderPlans();
  App.renderCash();
  App.renderTodo(true);
});
