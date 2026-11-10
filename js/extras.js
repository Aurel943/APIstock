/* Comptes (PEA, CTO…), objectif patrimonial, calendrier des performances, mode discret, import/export CSV */
'use strict';

/* Types de compte ; le taux par défaut vient de la configuration fiscale (taxConf, js/store.js) */
const ACCOUNT_TYPES = {
  pea: { label: 'PEA', get rate() { return taxRateFor('pea'); }, hint: 'PEA de plus de 5 ans : prélèvements sociaux' },
  cto: { label: 'Compte-titres', get rate() { return taxRateFor('cto'); }, hint: 'Prélèvement forfaitaire unique (flat tax)' },
  av: { label: 'Assurance-vie', get rate() { return taxRateFor('av'); }, hint: 'Contrat de plus de 8 ans, au-delà de l\'abattement' },
  per: { label: 'PER', get rate() { return taxRateFor('per'); }, hint: 'À la sortie en capital (hors versements déduits)' },
  autre: { label: 'Autre', rate: 0, hint: '' },
};
const MONTHS_FR = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

Object.assign(App, {
  /* ================================================================== */
  /* COMPTES                                                              */
  /* ================================================================== */
  renderAccountFilter() {
    const box = $('#accFilter');
    const accs = Store.state.accounts;
    box.classList.toggle('hidden', accs.length < 2);
    if (accs.length < 2) return;
    const cur = Store.state.accountFilter || 'all';
    box.replaceChildren(...[{ id: 'all', name: 'Tous les comptes' }, ...accs].map(a => el('button', {
      class: a.id === cur ? 'active' : '',
      onclick: () => { Store.state.accountFilter = a.id; Store.save(); this.renderAll(); if (this.historyLoaded) this.loadHistory(); },
    }, a.name)));
  },

  renderAccountsSummary() {
    const card = $('#accSummary');
    const accs = Store.state.accounts;
    if (accs.length < 2 || (Store.state.accountFilter || 'all') !== 'all') { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const cur = this.base();
    const rows = accs.map(a => {
      const { totals } = Portfolio.snapshot(a.id);
      const rate = parseNum(a.taxRate) || 0;
      return { a, t: totals, net: totals.pnl > 0 ? totals.pnl * (1 - rate / 100) : totals.pnl, rate };
    });
    const tot = rows.reduce((s, r) => s + r.t.value, 0);
    $('#accSummaryBody').replaceChildren(...rows.map(r => el('tr', { onclick: () => { Store.state.accountFilter = r.a.id; Store.save(); this.renderAll(); } },
      el('td', {}, el('span', { class: 'sym' }, r.a.name), el('span', { class: 'name' }, ACCOUNT_TYPES[r.a.type] ? ACCOUNT_TYPES[r.a.type].label : '')),
      el('td', { class: 'num' }, fmtMoney(r.t.value, cur), Portfolio.cashTracked(r.a.id) ? el('div', { class: 'small muted' }, '+ ' + fmtMoney(Portfolio.cashBalance(r.a.id).cash, cur) + ' espèces') : null),
      el('td', { class: 'num' }, fmtPct(tot > 0 ? (r.t.value / tot) * 100 : NaN, 1, false)),
      el('td', { class: 'num' }, fmtMoney(r.t.cost, cur)),
      el('td', { class: 'num ' + trendClass(r.t.pnl) }, fmtSignedMoney(r.t.pnl, cur), el('div', { class: 'small' }, fmtPct(r.t.pnlPct))),
      el('td', { class: 'num ' + trendClass(r.net) }, r.rate > 0 ? fmtSignedMoney(r.net, cur) : '—', r.rate > 0 ? el('div', { class: 'small muted' }, 'impôt ' + fmtNum(r.rate, 1) + ' %') : null))));
  },

  /* ================================================================== */
  /* FISCALITÉ (Réglages)                                                 */
  /* ================================================================== */
  bindTaxSettings() {
    if (!$('#taxSettings')) return;
    const apply = () => {
      if (Store.syncAccountRates()) this.renderAccountsSettings();
      Store.save();
      this.renderTaxSettings();
      this.renderAll();
    };
    $$('#taxSettingsForm [data-tax]').forEach(i => i.addEventListener('change', () => {
      const v = parseNum(i.value), k = i.dataset.tax;
      const tax = Object.assign({}, Store.state.settings.tax);
      if (isFinite(v) && v >= 0 && v !== TAX_DEFAULTS[k]) tax[k] = v; else delete tax[k];
      Store.state.settings.tax = tax;
      apply();
    }));
    $('#taxDefaults').addEventListener('click', () => { Store.state.settings.tax = {}; apply(); toast('Taux fiscaux par défaut rétablis', 'success', 2000); });
    this.renderTaxSettings();
  },

  renderTaxSettings() {
    if (!$('#taxSettings')) return;
    const c = taxConf();
    $$('#taxSettingsForm [data-tax]').forEach(i => { if (document.activeElement !== i) i.value = c[i.dataset.tax]; });
    $('#taxSettingsInfo').textContent = `Taux utilisés pour l'impôt estimé, la carte Fiscalité et le rapport annuel. Valeurs par défaut : revenus ${TAX_DEFAULTS.year} (${TAX_DEFAULTS.source}). À vérifier après chaque loi de finances.`;
    $('#taxSettingsSum').textContent = `Prélèvement forfaitaire unique : ${fmtNum(c.pfu, 1)} % · PEA de plus de 5 ans : ${fmtNum(taxRateFor('pea', c), 1)} % · assurance-vie de plus de 8 ans : ${fmtNum(taxRateFor('av', c), 1)} %`
      + (c.custom ? ' · taux personnalisés' : '') + '. Les comptes restés sur le taux par défaut de leur type suivent ces valeurs.';
  },

  bindAccounts() {
    this.bindTaxSettings();
    $('#accAdd').addEventListener('click', () => {
      const type = $('#accNewType').value;
      const name = $('#accNewName').value.trim() || ACCOUNT_TYPES[type].label;
      Store.state.accounts.push({ id: uid(), name, type, taxRate: ACCOUNT_TYPES[type].rate });
      Store.save();
      $('#accNewName').value = '';
      this.renderAccountsSettings();
      this.renderAll();
      toast('Compte « ' + name + ' » ajouté', 'success', 2000);
    });
  },

  renderAccountsSettings() {
    const list = $('#accList');
    const accs = Store.state.accounts;
    list.replaceChildren(...accs.map(a => {
      const n = Store.state.transactions.filter(t => (t.account || Store.defaultAccount()) === a.id).length;
      const name = el('input', { type: 'text', value: a.name });
      name.addEventListener('change', () => { a.name = name.value.trim() || a.name; Store.save(); this.renderAll(); });
      const type = el('select', {}, ...Object.entries(ACCOUNT_TYPES).map(([k, v]) => el('option', { value: k }, v.label)));
      type.value = a.type;
      const rate = el('input', { type: 'number', min: 0, max: 100, step: 0.1, value: a.taxRate, title: 'Taux d\'imposition des plus-values (%)' });
      type.addEventListener('change', () => { a.type = type.value; a.taxRate = ACCOUNT_TYPES[a.type].rate; rate.value = a.taxRate; Store.save(); this.renderAll(); });
      rate.addEventListener('change', () => { a.taxRate = parseNum(rate.value) || 0; Store.save(); this.renderAll(); });
      return el('div', { class: 'acc-row' }, name, type,
        el('div', { class: 'pct' }, rate),
        el('span', { class: 'muted small' }, n + ' op.'),
        accs.length > 1 ? el('button', { class: 'iconbtn', title: 'Supprimer le compte', onclick: () => {
          const target = accs.find(x => x !== a);
          if (!confirm(`Supprimer « ${a.name} » ?` + (n ? ` Ses ${n} opération(s) seront déplacées vers « ${target.name} ».` : ''))) return;
          for (const t of Store.state.transactions) if ((t.account || Store.defaultAccount()) === a.id) t.account = target.id;
          for (const m of Store.state.cashMoves) if ((m.account || Store.defaultAccount()) === a.id) m.account = target.id;
          for (const pl of Store.state.plans) if (pl.account === a.id) pl.account = target.id;
          Store.state.accounts = accs.filter(x => x !== a);
          Store.markDeleted(a.id);
          if (Store.state.accountFilter === a.id) Store.state.accountFilter = 'all';
          Store.save(); this.renderAccountsSettings(); this.renderAll();
        } }, '🗑') : el('span'));
    }));
  },

  /* ================================================================== */
  /* OBJECTIF PATRIMONIAL                                                 */
  /* ================================================================== */
  bindGoal() {
    const g = Store.state.goal = Store.state.goal || { target: 100000, date: addMonthsISO(todayISO(), 120), monthly: 300, rate: 6 };
    const ids = { target: '#goalTarget', date: '#goalDate', monthly: '#goalMonthly', rate: '#goalRate' };
    for (const [k, id] of Object.entries(ids)) {
      $(id).value = g[k];
      $(id).addEventListener('input', () => { g[k] = k === 'date' ? $(id).value : parseNum($(id).value) || 0; Store.save(); this.renderGoal(); });
    }
  },

  renderGoal() {
    const g = Store.state.goal;
    if (!g || !$('#goalResult')) return;
    const cur = this.base();
    // l'objectif porte sur l'ensemble des comptes
    const { totals } = Portfolio.snapshot('all');
    const V = (totals.value || 0) + Portfolio.cashTotal('all').cash; // titres + espèces suivies
    const T = g.target || 0;
    const r = Math.pow(1 + (g.rate || 0) / 100, 1 / 12) - 1;
    const m = g.monthly || 0;
    const n = Math.max(0, this.monthsBetween(todayISO(), g.date || todayISO()));
    const fv = r ? V * Math.pow(1 + r, n) + m * (Math.pow(1 + r, n) - 1) / r : V + m * n;
    let reach = null;
    if (V >= T) reach = 0;
    else {
      let v = V;
      for (let k = 1; k <= 1200; k++) { v = v * (1 + r) + m; if (v >= T) { reach = k; break; } }
    }
    const need = n > 0 ? (r ? (T - V * Math.pow(1 + r, n)) * r / (Math.pow(1 + r, n) - 1) : (T - V) / n) : NaN;
    const pct = T > 0 ? Math.min(100, (V / T) * 100) : 0;
    const onTrack = fv >= T;
    $('#goalResult').replaceChildren(
      el('div', { class: 'goal-bar' }, el('span', { style: `width:${pct}%` }), el('b', {}, fmtNum(pct, 1) + ' %')),
      el('div', { class: 'goal-legend' }, el('span', {}, fmtMoney(V, cur, 0) + ' aujourd\'hui'), el('span', {}, 'objectif ' + fmtMoney(T, cur, 0))),
      el('div', { class: 'kpis' },
        this.kpi('À la date cible', fmtMoney(fv, cur, 0), fmtDate(g.date) + (onTrack ? ' · objectif atteint ✔' : ' · il manquera ' + fmtMoney(T - fv, cur, 0)), onTrack ? 'up' : 'down'),
        this.kpi('Objectif atteint', reach === null ? 'Jamais' : reach === 0 ? 'Déjà !' : fmtDate(addMonthsISO(todayISO(), reach)),
          reach ? `dans ${Math.floor(reach / 12)} an(s) et ${reach % 12} mois` : 'avec ces hypothèses', reach !== null && (reach === 0 || addMonthsISO(todayISO(), reach) <= g.date) ? 'up' : ''),
        this.kpi('Versement mensuel nécessaire', isFinite(need) ? (need <= 0 ? '0 €' : fmtMoney(need, cur, 0)) : '—',
          'pour atteindre l\'objectif à la date cible', isFinite(need) && need <= m ? 'up' : 'down')));
  },

  /* ================================================================== */
  /* CALENDRIER DES PERFORMANCES MENSUELLES                               */
  /* ================================================================== */
  renderCalendar(series) {
    this.historyLoaded = true;
    const box = $('#calendar');
    const data = Portfolio.monthlyReturns(series);
    const years = Object.keys(data).sort().reverse();
    if (!years.length) { box.replaceChildren(); return; }
    const cell = v => {
      if (v === undefined || !isFinite(v)) return el('td', { class: 'cal-empty' }, '');
      const a = Math.min(1, Math.abs(v) / 8);
      return el('td', { class: 'num cal ' + (v >= 0 ? 'pos' : 'neg'), style: `--a:${(0.12 + a * 0.6).toFixed(2)}` }, (v > 0 ? '+' : '') + fmtNum(v, 1));
    };
    box.replaceChildren(
      el('h3', {}, 'Performance mois par mois (hors versements)'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data calendar' },
        el('thead', {}, el('tr', {}, el('th'), ...MONTHS_FR.map(m => el('th', { class: 'num' }, m)), el('th', { class: 'num' }, 'Année'))),
        el('tbody', {}, ...years.map(y => el('tr', {}, el('td', { class: 'sym' }, y),
          ...MONTHS_FR.map((_, i) => cell(data[y].months[i + 1])), (() => { const c = cell(data[y].year); c.classList.add('cal-year'); return c; })()))))),
      el('p', { class: 'muted small' }, 'Performance pondérée dans le temps (TWR), en % : tes versements et retraits ne la faussent pas. Le premier mois est partiel.'));
  },

  /* ================================================================== */
  /* MODE DISCRET                                                         */
  /* ================================================================== */
  bindPrivacy() {
    const btn = $('#privacyBtn');
    const sync = () => {
      document.documentElement.classList.toggle('privacy', !!Store.state.settings.privacy);
      btn.title = Store.state.settings.privacy ? 'Afficher les montants' : 'Masquer les montants (mode discret)';
      btn.classList.toggle('on', !!Store.state.settings.privacy);
    };
    btn.addEventListener('click', () => {
      Store.state.settings.privacy = !Store.state.settings.privacy;
      Store.save(); sync();
      this.renderAll();
      if (this.historyLoaded) this.loadHistory();
      toast(Store.state.settings.privacy ? 'Mode discret activé : montants masqués' : 'Montants affichés', 'info', 2000);
    });
    sync();
  },

  /* ================================================================== */
  /* IMPORT / EXPORT CSV                                                  */
  /* ================================================================== */
  bindCsv() {
    const dl = (name, text) => {
      const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const exportCsv = () => dl('apistock-operations-' + todayISO() + '.csv', this.toCsv());
    $('#csvExport').addEventListener('click', exportCsv);
    $('#txExport').addEventListener('click', exportCsv);
    $('#csvTemplate').addEventListener('click', () => dl('apistock-modele.csv',
      'date;type;compte;symbole;place;nom;quantite;prix;frais;devise;note\n' +
      '2024-03-15;achat;PEA;CW8;XPAR;Amundi MSCI World;10;470,50;2;EUR;Premier achat\n' +
      '2025-01-10;achat;PEA;ESE;XPAR;BNP Paribas Easy S&P 500;100;28,01;1;EUR\n' +
      '2025-06-20;dividende;Compte-titres;SPY;ARCX;SPDR S&P 500 ETF;;12,40;1,86;USD\n'));
    $('#csvImport').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const res = this.parseCsv(await file.text());
        if (!res.txs.length) throw new Error('aucune opération reconnue' + (res.errors.length ? ' (' + res.errors[0] + ')' : ''));
        const msg = `${res.txs.length} opération(s) à importer` + (res.newInst.length ? `, ${res.newInst.length} nouvel(s) instrument(s)` : '') +
          (res.newAcc.length ? `, compte(s) créé(s) : ${res.newAcc.join(', ')}` : '') + (res.errors.length ? `\n${res.errors.length} ligne(s) ignorée(s) : ${res.errors.slice(0, 3).join(' ; ')}` : '') + '\n\nContinuer ?';
        if (!confirm(msg)) return;
        res.commit();
        this.renderAll();
        this.renderAccountsSettings();
        this.refresh();
        this.preloadFx();
        toast(res.txs.length + ' opération(s) importée(s)', 'success');
      } catch (err) {
        toast('Import CSV impossible : ' + err.message, 'error', 8000);
      }
    });
  },

  toCsv() {
    const esc = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const num = v => (isFinite(v) ? String(v).replace('.', ',') : '');
    const lines = ['date;type;compte;symbole;place;nom;quantite;prix;frais;devise;montant;note'];
    const txs = Store.state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const t of txs) {
      const i = Store.instrument(t.key) || { symbol: t.key, mic: '', name: '', currency: '' };
      const split = t.type === 'split';
      const amount = t.qty * t.price + (t.type === 'buy' ? 1 : -1) * (t.fees || 0);
      lines.push([t.date, { buy: 'achat', sell: 'vente', div: 'dividende', split: 'division' }[t.type], Store.account(t.account || Store.defaultAccount()).name,
        i.symbol, i.mic, i.name, t.type === 'div' ? '' : num(t.qty), split ? '' : num(t.price), split ? '' : num(t.fees || 0), i.currency,
        split ? '' : num(Math.round(amount * 100) / 100), t.note || ''].map(esc).join(';'));
    }
    return lines.join('\n') + '\n';
  },

  /** Analyse un CSV (séparateur ; ou , — en-têtes flexibles) et prépare l'import */
  parseCsv(text) {
    text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    const first = text.split('\n')[0];
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell); rows.push(row);
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const head = rows.shift().map(norm);
    const col = (...names) => head.findIndex(h => names.includes(h));
    const C = {
      date: col('date'), type: col('type', 'operation', 'sens'), account: col('compte', 'account', 'enveloppe'),
      symbol: col('symbole', 'symbol', 'ticker', 'code', 'mnemo'), mic: col('place', 'mic', 'marche', 'exchange', 'bourse'),
      name: col('nom', 'name', 'libelle', 'valeur'), qty: col('quantite', 'qty', 'quantity', 'nombre', 'parts'),
      price: col('prix', 'price', 'cours', 'prixunitaire'), fees: col('frais', 'fees', 'commission'), ccy: col('devise', 'currency', 'monnaie'),
      note: col('note', 'notes', 'commentaire', 'remarque', 'memo'),
    };
    if (C.date < 0 || C.symbol < 0 || C.price < 0) throw new Error('colonnes « date », « symbole » et « prix » obligatoires');
    const get = (r, k) => (C[k] >= 0 ? (r[C[k]] || '').trim() : '');
    const num = v => parseNum(String(v).replace(/[^\d,.\-]/g, '').replace(/\.(?=.*[.,])/g, ''));
    const parseDate = v => {
      let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
      if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
      return null;
    };
    const parseType = v => { const s = norm(v); if (!s || /achat|buy|souscription|achats/.test(s)) return 'buy'; if (/vente|sell/.test(s)) return 'sell'; if (/division|split|regroupement/.test(s)) return 'split'; if (/div|coupon/.test(s)) return 'div'; return null; };

    const txs = [], errors = [], newInst = [], newAcc = [], accByName = {};
    for (const a of Store.state.accounts) accByName[a.name.toLowerCase()] = a.id;
    const pendingAcc = [], pendingInst = {};
    rows.forEach((r, i) => {
      if (r.every(c => !c.trim())) return;
      const line = i + 2;
      const date = parseDate(get(r, 'date')), type = parseType(get(r, 'type'));
      const symbol = get(r, 'symbol').toUpperCase().split('.')[0];
      const split = type === 'split';
      const price = split ? 0 : num(get(r, 'price')), qty = type === 'div' ? 1 : split ? parseSplit(get(r, 'qty')) : num(get(r, 'qty')), fees = split ? 0 : num(get(r, 'fees')) || 0;
      if (!date) { errors.push(`ligne ${line} : date invalide`); return; }
      if (!type) { errors.push(`ligne ${line} : type inconnu « ${get(r, 'type')} »`); return; }
      if (!symbol) { errors.push(`ligne ${line} : symbole manquant`); return; }
      if ((!split && !(price > 0)) || !(qty > 0)) { errors.push(`ligne ${line} : ${split ? 'parité' : 'quantité ou prix'} invalide`); return; }
      let mic = get(r, 'mic').toUpperCase();
      if (mic && !MIC_TO_YAHOO_SUFFIX.hasOwnProperty(mic)) mic = YAHOO_EX_TO_MIC[mic] || ({ EURONEXT: 'XPAR', PARIS: 'XPAR', XETRA: 'XETR', NYSE: 'XNYS', NASDAQ: 'XNAS', LSE: 'XLON', LONDON: 'XLON', AMSTERDAM: 'XAMS', MILAN: 'XMIL' }[mic] || mic);
      // instrument : on réutilise un instrument existant (même symbole + place, ou même symbole si la place est absente)
      let key = mic ? Store.key(symbol, mic) : Object.keys(Store.state.instruments).find(k => k.split('@')[0] === symbol);
      if (!key) key = Store.key(symbol, mic);
      if (!Store.instrument(key) && !pendingInst[key]) {
        pendingInst[key] = { symbol, mic, name: get(r, 'name') || symbol, currency: get(r, 'ccy').toUpperCase() || EXCHANGE_CCY[mic] || (US_MICS.has(mic) ? 'USD' : Store.state.settings.baseCurrency) };
        newInst.push(Store.label(key));
      }
      let accName = get(r, 'account');
      let account = Store.defaultAccount();
      if (accName) {
        const k = accName.toLowerCase();
        if (!accByName[k]) { const id = uid(); accByName[k] = id; pendingAcc.push({ id, name: accName }); newAcc.push(accName); }
        account = accByName[k];
      }
      const note = get(r, 'note');
      txs.push(Object.assign({ key, type, date, account, qty, price, fees }, note ? { note } : {}));
    });
    return {
      txs, errors, newInst, newAcc,
      commit: () => {
        for (const a of pendingAcc) {
          const t = /pea/i.test(a.name) ? 'pea' : /assurance|av\b/i.test(a.name) ? 'av' : /per\b/i.test(a.name) ? 'per' : /cto|titre/i.test(a.name) ? 'cto' : 'autre';
          Store.state.accounts.push({ id: a.id, name: a.name, type: t, taxRate: ACCOUNT_TYPES[t].rate });
        }
        for (const [key, info] of Object.entries(pendingInst)) {
          const useYahoo = Api.hasProxy() && MIC_TO_YAHOO_SUFFIX[info.mic] !== undefined && !(US_MICS.has(info.mic) && Api.hasKey());
          Store.upsertInstrument(Object.assign(info, useYahoo ? { provider: 'yahoo', ysymbol: info.symbol + MIC_TO_YAHOO_SUFFIX[info.mic] } : { provider: 'twelve' }));
        }
        for (const t of txs) Store.state.transactions.push(Object.assign({ id: uid() }, t));
        Store.save();
      },
    };
  },
});
