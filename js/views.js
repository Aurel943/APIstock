/* Vues « Monde » (horaires des bourses + indices) et « Investir » (plan, rééquilibrage, alertes) */
'use strict';

/** Mini-graphique SVG (sparkline) */
function sparkline(values, { w = 120, h = 32, ref } = {}) {
  const v = (values || []).filter(x => isFinite(x));
  if (v.length < 2) return el('span', { class: 'spark-empty' });
  const base = isFinite(ref) ? ref : v[0];
  const min = Math.min(...v, base), max = Math.max(...v, base);
  const span = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const up = v[v.length - 1] >= base;
  const y0 = (h - 2 - ((base - min) / span) * (h - 4)).toFixed(1);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark ' + (up ? 'up' : 'down'));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `<line x1="0" x2="${w}" y1="${y0}" y2="${y0}" class="spark-ref"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  return svg;
}

Object.assign(App, {
  region: 'all',
  worldLoadedAt: 0,

  /* ================================================================== */
  /* MONDE                                                                */
  /* ================================================================== */
  bindWorld() {
    $$('#regionSel button').forEach(b => b.addEventListener('click', () => {
      this.region = b.dataset.region;
      $$('#regionSel button').forEach(x => x.classList.toggle('active', x === b));
      this.renderWorld();
    }));
    $('#localTz').textContent = '(' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
    setInterval(() => {
      if (this.view === 'world') $('#localClock').textContent = new Date().toLocaleTimeString('fr-FR');
    }, 1000);
    setInterval(() => {
      if (document.hidden) return;
      this.renderMarketState();
      if (this.view === 'world') this.renderWorld();
    }, 15000);
    setInterval(() => { if (this.view === 'world' && !document.hidden) this.loadWorldQuotes(); }, 60000);
  },

  myExchanges() {
    const ids = new Set();
    for (const k of Store.trackedKeys()) {
      const inst = Store.instrument(k);
      const ex = inst && Markets.forMic(inst.mic);
      if (ex) ids.add(ex.id);
    }
    return EXCHANGES.filter(e => ids.has(e.id));
  },

  instrumentsOn(ex) {
    return Store.trackedKeys().filter(k => { const i = Store.instrument(k); return i && ex.mics.includes(i.mic); });
  },

  async loadWorldQuotes(force = false) {
    if (!Api.hasProxy()) {
      $('#macroNote').textContent = 'Configure le relais Yahoo Finance (Réglages) pour afficher les indices en direct.';
      return;
    }
    if (!force && Date.now() - this.worldLoadedAt < 30000) return;
    this.worldLoadedAt = Date.now();
    const syms = [...MACRO.map(m => m.y), ...EXCHANGES.flatMap(e => [e.index.y, ...(e.extra || []).map(x => x.y)])];
    for (let i = 0; i < syms.length; i += 4) {
      await Promise.all(syms.slice(i, i + 4).map(s => Api.yahooSymbol(s).catch(() => null)));
      if (this.view === 'world') this.renderWorld();
    }
  },

  idxQuote(y) { const c = Api.quotes['Y:' + y]; return c ? c.data : null; },

  renderWorld() {
    const now = Date.now();
    $('#localClock').textContent = new Date(now).toLocaleTimeString('fr-FR');

    // Indicateurs
    $('#macroGrid').replaceChildren(...MACRO.map(m => {
      const q = this.idxQuote(m.y);
      return el('div', { class: 'macro' },
        el('div', { class: 'macro-name' }, m.name),
        el('div', { class: 'macro-val mono' }, q ? (m.ccy ? fmtMoney(q.price, m.ccy, m.kind === 'crypto' ? 0 : 2, true) : fmtNum(q.price, m.digits || 2)) : '—'),
        q ? el('div', { class: 'macro-chg ' + trendClass(q.percentChange) }, fmtPct(q.percentChange)) : el('div', { class: 'muted small' }, '…'),
        q ? sparkline(q.spark, { ref: q.previousClose }) : null);
    }));

    // Filtre de régions
    let list = EXCHANGES;
    if (this.region === 'mine') {
      list = this.myExchanges();
      if (!list.length) list = EXCHANGES.filter(e => e.id === 'paris' || e.id === 'newyork');
    } else if (this.region !== 'all') list = EXCHANGES.filter(e => e.region === this.region);

    // Frise 24 h
    const tl = $('#timeline');
    const ticks = [];
    for (let h = 0; h <= 24; h += 3) ticks.push(el('span', { style: `left:${(h / 24) * 100}%` }, String(h).padStart(2, '0') + 'h'));
    const rows = list.map(ex => {
      const st = Markets.status(ex, now);
      const { segs, nowPct } = Markets.daySegments(ex, now);
      return el('div', { class: 'tl-row' },
        el('div', { class: 'tl-label' }, el('span', { class: 'flag' }, ex.flag), ex.city,
          el('span', { class: 'tl-dot ' + st.state })),
        el('div', { class: 'tl-track' },
          ...segs.map(sg => el('div', {
            class: 'tl-seg' + (now >= sg.a && now < sg.b ? ' live' : ''),
            style: `left:${sg.left}%;width:${sg.width}%`,
            title: `${ex.city} : ${Markets.fmtLocal(sg.a)} – ${Markets.fmtLocal(sg.b)} (heure locale)`,
          })),
          !segs.length ? el('span', { class: 'tl-closed' }, st.reason || 'Fermé') : null,
          el('div', { class: 'tl-now', style: `left:${nowPct}%` })));
    });
    tl.replaceChildren(el('div', { class: 'tl-row tl-head' }, el('div', { class: 'tl-label' }), el('div', { class: 'tl-ticks' }, ...ticks)), ...rows);

    // Cartes
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    $('#exchangeGrid').replaceChildren(...list.map(ex => {
      const st = Markets.status(ex, now);
      const lt = st.localTime;
      const exToday = lt.date;
      const label = { open: 'Ouvert', break: 'Pause', closed: st.reason === 'Jour férié' ? 'Férié' : 'Fermé' }[st.state];
      const hours = ex.sessions.map(([a, b]) => `${a} – ${b}`).join(' · ');
      const localHours = ex.tz === userTz ? null : ex.sessions.map(([a, b]) =>
        `${Markets.fmtLocal(Markets.wallToUtc(ex.tz, exToday, a))} – ${Markets.fmtLocal(Markets.wallToUtc(ex.tz, exToday, b))}`).join(' · ');
      const idxs = [ex.index, ...(ex.extra || [])];
      const mine = this.instrumentsOn(ex);
      return el('div', { class: 'ex-card ' + st.state },
        el('div', { class: 'ex-head' },
          el('div', {}, el('div', { class: 'ex-city' }, el('span', { class: 'flag' }, ex.flag), ex.city), el('div', { class: 'muted small' }, ex.name)),
          el('span', { class: 'ex-state ' + st.state }, label)),
        el('div', { class: 'ex-time mono' }, String(lt.h).padStart(2, '0') + ':' + String(lt.mi).padStart(2, '0'),
          el('span', { class: 'muted small' }, ' heure locale')),
        el('div', { class: 'ex-next' }, st.next
          ? (st.next.type === 'close' ? 'Ferme dans ' : 'Ouvre ') + (st.next.type === 'close' || st.next.at - now < 86400000 ? (st.next.type === 'open' ? 'dans ' : '') + Markets.fmtDuration(st.next.at - now) : Markets.fmtLocal(st.next.at, true))
          : ''),
        el('div', { class: 'ex-hours small' },
          el('div', {}, 'Séance : ', el('b', {}, hours)),
          localHours ? el('div', { class: 'muted' }, 'Chez toi : ' + localHours) : null,
          st.early ? el('div', { class: 'warn-text' }, 'Clôture anticipée aujourd\'hui à ' + st.early) : null,
          !st.hasHolidays ? el('div', { class: 'muted' }, 'Jours fériés non gérés') : null),
        el('div', { class: 'ex-idx' }, ...idxs.map(ix => {
          const q = this.idxQuote(ix.y);
          return el('div', { class: 'idx-row' },
            el('span', { class: 'idx-name' }, ix.name),
            el('span', { class: 'mono' }, q ? fmtNum(q.price, 2) : '—'),
            q ? el('span', { class: 'chip ' + trendClass(q.percentChange) }, fmtPct(q.percentChange)) : el('span'),
            q ? sparkline(q.spark, { w: 80, h: 22, ref: q.previousClose }) : el('span'));
        })),
        mine.length ? el('div', { class: 'ex-mine' }, el('span', { class: 'muted small' }, 'Mes lignes : '),
          ...mine.map(k => el('button', { class: 'btn small', onclick: () => { this.show('markets'); this.selectDetail(k); } }, Store.label(k)))) : null);
    }));
  },

  /** Pastille d'état dans la barre du haut */
  renderMarketState() {
    const pill = $('#marketState');
    const now = Date.now();
    let exs = this.myExchanges();
    if (!exs.length) exs = EXCHANGES.filter(e => e.id === 'paris' || e.id === 'newyork');
    const sts = exs.map(ex => ({ ex, st: Markets.status(ex, now) }));
    const open = sts.filter(x => x.st.state === 'open');
    let text;
    if (sts.length === 1) text = sts[0].ex.city + ' · ' + Markets.summary(sts[0].st, now);
    else if (open.length) text = open.length === 1 ? `${open[0].ex.city} ouvert · ferme dans ${Markets.fmtDuration(open[0].st.next.at - now)}` : `${open.length}/${sts.length} marchés ouverts`;
    else {
      const nx = sts.filter(x => x.st.next).sort((a, b) => a.st.next.at - b.st.next.at)[0];
      text = nx ? `Fermé · ${nx.ex.city} ouvre ${nx.st.next.at - now < 86400000 ? 'dans ' + Markets.fmtDuration(nx.st.next.at - now) : Markets.fmtLocal(nx.st.next.at, true)}` : 'Marchés fermés';
    }
    pill.textContent = text;
    pill.className = 'pill' + (open.length ? ' open' : '');
    pill.title = sts.map(x => `${x.ex.flag} ${x.ex.city} : ${Markets.summary(x.st, now)}`).join('\n');
  },

  /** Petit texte d'état de marché pour une ligne d'instrument */
  marketBadge(key) {
    const inst = Store.instrument(key);
    const ex = inst && Markets.forMic(inst.mic);
    if (!ex) return null;
    const st = Markets.status(ex);
    return el('span', { class: 'mkt ' + st.state, title: ex.name }, Markets.summary(st));
  },

  /* ================================================================== */
  /* INVESTIR : allocation cible + plan                                   */
  /* ================================================================== */
  bindInvest() {
    const t = Store.state.targets;
    this.picker($('#tgtPicker'), {
      placeholder: 'Ajouter un ETF à l\'allocation cible…',
      onPick: async key => {
        if (t[key] === undefined) t[key] = 0;
        Store.save();
        this.renderInvest();
        if (!Api.cachedQuote(key)) {
          try { await Api.quote(key); await Api.fxRate(Store.instrument(key).currency); } catch (e) { toast(e.message, 'error'); }
          this.renderInvest();
        }
      },
    });
    $('#tgtFromPf').addEventListener('click', () => {
      const { rows, totals } = Portfolio.snapshot();
      if (!rows.length) { toast('Ton portefeuille est vide.'); return; }
      const tot = totals.missing ? totals.cost : totals.value;
      for (const k of Object.keys(t)) t[k] = 0;
      for (const r of rows) t[r.key] = Math.round(((totals.missing ? r.costBase : r.valueBase) / tot) * 1000) / 10;
      Store.save();
      this.renderInvest();
    });
    $('#tgtEqual').addEventListener('click', () => {
      const keys = this.investKeys();
      if (!keys.length) return;
      const each = Math.floor((100 / keys.length) * 10) / 10;
      keys.forEach((k, i) => (t[k] = i === 0 ? Math.round((100 - each * (keys.length - 1)) * 10) / 10 : each));
      Store.save();
      this.renderInvest();
    });
    const p = Store.state.plan = Store.state.plan || { amount: 500, fractional: false, allowSell: false };
    $('#planAmount').value = p.amount;
    $('#planFractional').checked = !!p.fractional;
    $('#planSell').checked = !!p.allowSell;
    for (const id of ['#planAmount', '#planFractional', '#planSell']) $(id).addEventListener('input', () => {
      p.amount = parseNum($('#planAmount').value) || 0;
      p.fractional = $('#planFractional').checked;
      p.allowSell = $('#planSell').checked;
      Store.save();
      this.renderPlan();
    });
    this.bindAlerts();
  },

  investKeys() {
    const keys = new Set(Object.keys(Store.state.targets));
    for (const r of Portfolio.snapshot().rows) keys.add(r.key);
    return Array.from(keys).filter(k => Store.instrument(k));
  },

  investLines() {
    const snap = Portfolio.snapshot();
    const byKey = Object.fromEntries(snap.rows.map(r => [r.key, r]));
    return this.investKeys().map(k => {
      const inst = Store.instrument(k);
      const q = Api.cachedQuote(k);
      const fx = Api.fxCached(inst.currency);
      const r = byKey[k];
      return {
        key: k, inst, quote: q,
        value: r ? (isFinite(r.valueBase) ? r.valueBase : r.costBase) : 0,
        qty: r ? r.qty : 0,
        target: parseNum(Store.state.targets[k]) || 0,
        unitPrice: q ? q.price * fx : NaN,
      };
    });
  },

  renderInvest() {
    const cur = this.base();
    const lines = this.investLines();
    const total = lines.reduce((a, l) => a + l.value, 0);
    const tgtSum = lines.reduce((a, l) => a + l.target, 0);
    $('#tgtTable tbody').replaceChildren(...lines.map(l => {
      const w = total > 0 ? (l.value / total) * 100 : 0;
      const gap = w - l.target;
      const input = el('input', { type: 'number', min: 0, max: 100, step: 0.5, value: l.target, class: 'pct-input' });
      input.addEventListener('change', () => { Store.state.targets[l.key] = parseNum(input.value) || 0; Store.save(); this.renderInvest(); });
      return el('tr', {},
        el('td', {}, el('span', { class: 'sym' }, Store.label(l.key)), el('span', { class: 'name', title: l.inst.name }, Store.code(l.key))),
        el('td', { class: 'num' }, l.quote ? fmtMoney(l.quote.price, l.inst.currency, 3) : '—'),
        el('td', { class: 'num' }, fmtMoney(l.value, cur)),
        el('td', { class: 'num' }, fmtPct(w, 1, false)),
        el('td', { class: 'num' }, input),
        el('td', { class: 'num ' + (Math.abs(gap) < 1 ? 'flat' : gap > 0 ? 'up' : 'down') }, (gap > 0 ? '+' : '') + fmtNum(gap, 1) + ' pt'),
        el('td', { class: 'num' }, l.qty > 0 ? null : el('button', { class: 'iconbtn', title: 'Retirer', onclick: () => { delete Store.state.targets[l.key]; Store.save(); this.renderInvest(); } }, '✕')));
    }));
    if (!lines.length) $('#tgtTable tbody').append(el('tr', {}, el('td', { colspan: 7, class: 'empty' }, 'Ajoute des ETF (ou des opérations dans ton portefeuille) pour définir ton allocation cible.')));
    const ok = Math.abs(tgtSum - 100) < 0.05;
    $('#tgtTable tfoot').replaceChildren(lines.length ? el('tr', {},
      el('td', {}, 'Total'), el('td'), el('td', { class: 'num' }, fmtMoney(total, cur)), el('td', { class: 'num' }, '100 %'),
      el('td', { class: 'num ' + (ok ? 'up' : 'down') }, fmtNum(tgtSum, 1) + ' %'), el('td', { colspan: 2, class: 'small ' + (ok ? 'muted' : 'down') }, ok ? '' : 'la cible doit faire 100 %')) : '');
    this.renderPlan(lines);
    this.emit('rendered:invest');
  },

  renderPlan(lines) {
    lines = lines || this.investLines();
    const box = $('#planResult');
    const cur = this.base();
    const p = Store.state.plan || {};
    const tgtSum = lines.reduce((a, l) => a + l.target, 0);
    if (!lines.length) { box.replaceChildren(); return; }
    if (Math.abs(tgtSum - 100) > 0.05) { box.replaceChildren(el('p', { class: 'muted' }, 'Règle d\'abord ton allocation cible à 100 % pour obtenir le plan.')); return; }
    const missing = lines.filter(l => l.target > 0 && !(l.unitPrice > 0));
    if (missing.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Cours manquant pour ' + missing.map(l => Store.label(l.key)).join(', ') + ' — clique sur ↻ en haut à droite.')); return; }
    const res = Portfolio.plan(lines, p.amount || 0, { allowSell: !!p.allowSell, fractional: !!p.fractional });
    const rows = res.lines.filter(o => o.shares !== 0 || o.target > 0);
    const buyLines = res.lines.filter(o => o.shares !== 0);
    box.replaceChildren(
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, ...['ETF', 'Action', 'Parts', 'Cours', 'Montant', '% avant', '% après', '% cible'].map((h, i) => el('th', { class: i > 1 ? 'num' : '' }, h)))),
        el('tbody', {}, ...rows.map(o => el('tr', {},
          el('td', {}, el('span', { class: 'sym' }, Store.label(o.key)), el('span', { class: 'name' }, Store.code(o.key))),
          el('td', {}, o.shares > 0 ? el('span', { class: 'chip buy' }, 'Acheter') : o.shares < 0 ? el('span', { class: 'chip sell' }, 'Vendre') : el('span', { class: 'muted' }, '—')),
          el('td', { class: 'num' }, fmtQty(Math.abs(o.shares))),
          el('td', { class: 'num' }, fmtMoney(o.quote.price, o.inst.currency, 3)),
          el('td', { class: 'num' }, fmtMoney(Math.abs(o.cost), cur)),
          el('td', { class: 'num muted' }, fmtPct(o.weightNow, 1, false)),
          el('td', { class: 'num' }, fmtPct(o.weightAfter, 1, false)),
          el('td', { class: 'num muted' }, fmtPct(o.target, 1, false))))),
        el('tfoot', {}, el('tr', {},
          el('td', { colspan: 4 }, p.allowSell ? 'Solde net des achats/ventes' : 'Total investi'),
          el('td', { class: 'num' }, fmtMoney(res.invested, cur)),
          el('td', { colspan: 3, class: 'num small muted' }, 'Reste non investi : ' + fmtMoney(res.cash, cur)))))),
      el('div', { class: 'actions', style: 'margin-top:12px' },
        el('button', { class: 'btn primary', disabled: buyLines.length ? null : true, onclick: () => this.recordPlan(buyLines) }, 'Enregistrer ces opérations au cours actuel'),
        el('span', { class: 'muted small' }, 'Les ordres réels sont à passer chez ton courtier ; ce bouton les ajoute à ton suivi.')));
  },

  recordPlan(lines) {
    if (!confirm(`Ajouter ${lines.length} opération(s) datée(s) d'aujourd'hui à ton portefeuille ?`)) return;
    for (const o of lines) {
      const f = Store.state.accountFilter;
      Store.addTransaction({ key: o.key, type: o.shares > 0 ? 'buy' : 'sell', date: todayISO(), account: f && f !== 'all' ? f : Store.defaultAccount(), qty: Math.abs(o.shares), price: o.quote.price, fees: 0 });
    }
    this.renderAll();
    toast('Opérations ajoutées au portefeuille', 'success');
  },

  /* ================================================================== */
  /* ALERTES                                                              */
  /* ================================================================== */
  bindAlerts() {
    $('#alertForm').addEventListener('submit', e => {
      e.preventDefault();
      const value = parseNum($('#alertValue').value);
      if (!$('#alertKey').value || !(value >= 0)) return;
      Store.state.alerts.push({ id: uid(), key: $('#alertKey').value, kind: $('#alertKind').value, value, active: true, createdAt: Date.now() });
      Store.save();
      $('#alertValue').value = '';
      this.renderAlerts();
      toast('Alerte ajoutée', 'success', 2000);
      const q = Api.cachedQuote($('#alertKey').value);
      if (q) this.checkAlerts($('#alertKey').value, q);
    });
    $('#alertKey').addEventListener('change', () => {
      const q = Api.cachedQuote($('#alertKey').value);
      $('#alertValue').placeholder = q ? 'Cours actuel : ' + fmtNum(q.price, 3) : 'Valeur';
    });
    $('#notifBtn').addEventListener('click', async () => {
      if (!('Notification' in window)) { toast('Notifications non supportées par ce navigateur', 'error'); return; }
      const p = await Notification.requestPermission();
      this.renderAlerts();
      if (p === 'granted') this.notify('APIstock', 'Les notifications sont activées ✔');
    });
  },

  alertText(a) {
    const inst = Store.instrument(a.key);
    const ccy = inst ? inst.currency : this.base();
    return { above: `Cours ≥ ${fmtMoney(a.value, ccy, 3)}`, below: `Cours ≤ ${fmtMoney(a.value, ccy, 3)}`,
      dayUp: `Hausse du jour ≥ ${fmtNum(a.value, 2)} %`, dayDown: `Baisse du jour ≥ ${fmtNum(a.value, 2)} %` }[a.kind];
  },

  renderAlerts() {
    const sel = $('#alertKey');
    const prev = sel.value;
    const keys = Object.keys(Store.state.instruments);
    sel.replaceChildren(...keys.map(k => el('option', { value: k }, Store.label(k) + ' — ' + Store.code(k))));
    if (keys.includes(prev)) sel.value = prev;
    const btn = $('#notifBtn');
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    btn.textContent = perm === 'granted' ? 'Notifications activées ✔' : perm === 'denied' ? 'Notifications bloquées' : 'Activer les notifications';
    btn.disabled = perm === 'granted' || perm === 'denied' || perm === 'unsupported';
    const list = Store.state.alerts;
    $('#alertTable tbody').replaceChildren(...list.map(a => {
      const inst = Store.instrument(a.key);
      const q = Api.cachedQuote(a.key);
      return el('tr', {},
        el('td', {}, el('span', { class: 'sym' }, Store.label(a.key)), el('span', { class: 'name' }, Store.code(a.key))),
        el('td', {}, this.alertText(a)),
        el('td', { class: 'num' }, q ? fmtMoney(q.price, inst.currency, 3) : '—', q ? el('div', { class: 'small ' + trendClass(q.percentChange) }, fmtPct(q.percentChange)) : null),
        el('td', {}, a.active ? el('span', { class: 'chip buy' }, 'Active') : el('span', { class: 'chip sell' }, 'Déclenchée ' + (a.triggeredAt ? new Date(a.triggeredAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''))),
        el('td', { class: 'num' },
          !a.active ? el('button', { class: 'iconbtn', title: 'Réactiver', onclick: () => { a.active = true; a.triggeredAt = null; Store.save(); this.renderAlerts(); } }, '↺') : null,
          el('button', { class: 'iconbtn', title: 'Supprimer', onclick: () => {
            const idx = Store.state.alerts.indexOf(a);
            Store.state.alerts = Store.state.alerts.filter(x => x !== a); Store.markDeleted(a.id); Store.save(); this.renderAlerts();
            undoToast('Alerte supprimée', () => { Store.state.alerts.splice(Math.max(0, idx), 0, a); Store.unmarkDeleted(a.id); Store.save(); this.renderAlerts(); });
          } }, '🗑')));
    }));
    if (!list.length) $('#alertTable tbody').append(el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'Aucune alerte. Exemple : « CW8 · Cours ≤ 650 € » pour être prévenu d\'un point d\'entrée.')));
    this.emit('rendered:alerts');
  },

  checkAlerts(key, q) {
    if (!q || !isFinite(q.price)) return;
    let fired = false;
    for (const a of Store.state.alerts) {
      if (!a.active || a.key !== key) continue;
      const hit = (a.kind === 'above' && q.price >= a.value) || (a.kind === 'below' && q.price <= a.value) ||
        (a.kind === 'dayUp' && q.percentChange >= a.value) || (a.kind === 'dayDown' && q.percentChange <= -a.value);
      if (!hit) continue;
      a.active = false; a.triggeredAt = Date.now(); fired = true;
      const inst = Store.instrument(key);
      const msg = `${Store.label(key)} : ${this.alertText(a)} — cours ${fmtMoney(q.price, inst.currency, 3)} (${fmtPct(q.percentChange)})`;
      toast('🔔 ' + msg, 'success', 10000);
      this.notify('Alerte APIstock', msg);
    }
    if (fired) { Store.save(); this.renderAlerts(); }
  },

  async notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) { reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }); return; }
    } catch (e) { /* repli ci-dessous */ }
    try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch (e) { /* ignore */ }
  },
});
