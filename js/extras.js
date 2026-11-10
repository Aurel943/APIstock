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
        if (!(await this.confirmCsvImport(res))) return;
        const n = res.commit();
        this.renderAll();
        this.renderAccountsSettings();
        this.refresh();
        this.preloadFx();
        toast(n + ' opération(s) importée(s)' + (res.format.id !== 'generic' ? ' depuis ' + res.format.label : ''), 'success');
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

  /** Découpe un texte CSV (séparateur ; , ou tabulation détecté sur la première ligne, guillemets gérés) */
  csvRows(text) {
    text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    const first = text.split('\n')[0];
    const count = c => first.split(c).length - 1;
    const sep = first.includes('\t') && count('\t') > Math.max(count(';'), count(',')) ? '\t' : count(';') >= count(',') ? ';' : ',';
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
    return rows;
  },

  /**
   * Analyse un CSV et prépare l'import : format APIstock (ou en-têtes proches), relevés Degiro et Trade Republic
   * reconnus d'après leurs en-têtes (voir CSV_BROKERS). Les lignes connues seulement par leur ISIN sont regroupées
   * dans `unresolved` : le symbole est ensuite choisi (recherche par ISIN) et confirmé avant l'import.
   */
  parseCsv(text) {
    const rows = this.csvRows(text);
    const rawHead = rows.shift().map(h => h.trim());
    const head = rawHead.map(csvNorm);
    const broker = CSV_BROKERS.find(b => b.detect(head)) || null;
    const ctx = broker ? broker.columns(head, rawHead) : csvGenericColumns(head);
    if (!broker && (ctx.date < 0 || (ctx.symbol < 0 && ctx.isin < 0) || (ctx.price < 0 && ctx.amount < 0))) {
      throw new Error('colonnes « date », « symbole » (ou « ISIN ») et « prix » (ou « montant ») obligatoires — format de fichier non reconnu');
    }

    const txs = [], errors = [], newInst = [], newAcc = [], accByName = {}, pendingAcc = [], pendingInst = {}, unresolved = {};
    let skipped = 0;
    for (const a of Store.state.accounts) accByName[a.name.toLowerCase()] = a.id;
    const byIsin = isin => Object.keys(Store.state.instruments).find(k => (Store.state.instruments[k].isin || '').toUpperCase() === isin);
    rows.forEach((r, i) => {
      if (r.every(c => !c.trim())) return;
      const line = i + 2;
      const rec = broker ? broker.row(r, ctx) : csvGenericRow(r, ctx);
      if (!rec) { skipped++; return; } // ligne sans titre (virement, intérêts…) : ignorée
      if (rec.error) { errors.push(`ligne ${line} : ${rec.error}`); return; }
      const { date, type } = rec;
      const split = type === 'split';
      if (!date) { errors.push(`ligne ${line} : date invalide`); return; }
      if (!type) { errors.push(`ligne ${line} : type inconnu « ${rec.rawType || ''} »`); return; }
      if (!rec.symbol && !rec.isin) { errors.push(`ligne ${line} : symbole ou ISIN manquant`); return; }
      if ((!split && !(rec.price > 0)) || !(rec.qty > 0)) { errors.push(`ligne ${line} : ${split ? 'parité' : 'quantité ou prix'} invalide`); return; }
      let mic = (rec.mic || '').toUpperCase();
      if (mic && !MIC_TO_YAHOO_SUFFIX.hasOwnProperty(mic)) mic = YAHOO_EX_TO_MIC[mic] || CSV_PLACES[mic] || mic;
      let key = null, isin = (rec.isin || '').toUpperCase();
      if (rec.symbol) {
        const symbol = rec.symbol.toUpperCase().split('.')[0];
        // instrument existant : même symbole + place, ou même symbole si la place est absente
        key = mic ? Store.key(symbol, mic) : Object.keys(Store.state.instruments).find(k => k.split('@')[0] === symbol);
        if (!key) key = Store.key(symbol, mic);
        if (!Store.instrument(key) && !pendingInst[key]) {
          pendingInst[key] = { symbol, mic, name: rec.name || symbol, isin, currency: (rec.ccy || '').toUpperCase() || EXCHANGE_CCY[mic] || (US_MICS.has(mic) ? 'USD' : Store.state.settings.baseCurrency) };
          newInst.push(Store.label(key));
        }
      } else {
        key = byIsin(isin) || null;
        if (!key) {
          const u = unresolved[isin] = unresolved[isin] || { isin, name: rec.name || '', currency: rec.ccy || '', mic, count: 0, choice: undefined };
          u.count++;
        }
      }
      let account = Store.defaultAccount();
      const accName = rec.account;
      if (accName) {
        const k = accName.toLowerCase();
        if (!accByName[k]) { const id = uid(); accByName[k] = id; pendingAcc.push({ id, name: accName }); newAcc.push(accName); }
        account = accByName[k];
      }
      txs.push(Object.assign({ key, type, date, account, qty: rec.qty, price: split ? 0 : rec.price, fees: split ? 0 : rec.fees || 0 },
        rec.note ? { note: rec.note } : {}, key ? {} : { isin }));
    });
    const res = {
      txs, errors, skipped, newInst, newAcc,
      format: broker ? { id: broker.id, label: broker.label, verified: broker.verified, note: broker.note } : { id: 'generic', label: 'CSV générique (format APIstock ou en-têtes proches)', verified: true },
      unresolved: Object.values(unresolved),
      /** Choix du symbole pour un ISIN : résultat de Api.search, ou null pour ignorer ses lignes */
      resolve(isin, d) { const u = unresolved[isin]; if (u) u.choice = d; },
      /** Opérations réellement importées (ISIN ignorés ou non résolus exclus) */
      ready() { return txs.filter(t => t.key || (unresolved[t.isin] && unresolved[t.isin].choice)); },
      commit: () => {
        for (const a of pendingAcc) {
          const t = /pea/i.test(a.name) ? 'pea' : /assurance|av\b/i.test(a.name) ? 'av' : /per\b/i.test(a.name) ? 'per' : /cto|titre/i.test(a.name) ? 'cto' : 'autre';
          Store.state.accounts.push({ id: a.id, name: a.name, type: t, taxRate: ACCOUNT_TYPES[t].rate });
        }
        for (const [key, info] of Object.entries(pendingInst)) {
          const useYahoo = Api.hasProxy() && MIC_TO_YAHOO_SUFFIX[info.mic] !== undefined && !(US_MICS.has(info.mic) && Api.hasKey());
          Store.upsertInstrument(Object.assign(info, useYahoo ? { provider: 'yahoo', ysymbol: info.symbol + MIC_TO_YAHOO_SUFFIX[info.mic] } : { provider: 'twelve' }));
        }
        const keyOfIsin = {};
        for (const u of Object.values(unresolved)) {
          const d = u.choice;
          if (!d) continue;
          keyOfIsin[u.isin] = Store.upsertInstrument({ symbol: d.symbol, mic: d.mic, exchange: d.exchange, name: d.name || u.name, currency: d.currency || u.currency,
            type: d.type, provider: d.provider, ysymbol: d.ysymbol, short: d.short, isin: u.isin });
        }
        let n = 0;
        for (const t of txs) {
          const key = t.key || keyOfIsin[t.isin];
          if (!key) continue;
          const tx = Object.assign({ id: uid() }, t, { key });
          delete tx.isin;
          Store.state.transactions.push(tx);
          n++;
        }
        Store.save();
        return n;
      },
    };
    return res;
  },

  /** Recherche par ISIN des lignes sans symbole : candidats classés (même place, même devise, places principales d'abord) */
  async csvCandidates(u) {
    let list = [];
    try { list = await Api.search(u.isin); } catch (e) { return []; }
    const prio = { XPAR: 0, XETR: 1, XAMS: 2, XMIL: 3, XLON: 4, XNYS: 5, ARCX: 5, XNAS: 6, XNGS: 6 };
    const score = d => (u.mic && d.mic === u.mic ? -20 : 0) + (u.currency && d.currency === u.currency ? -10 : 0) + (prio[d.mic] ?? 9);
    return list.filter(d => d.symbol && d.symbol.toUpperCase() !== u.isin).sort((a, b) => score(a) - score(b));
  },

  /** Fenêtre de confirmation de l'import (résumé, choix du symbole de chaque ISIN) */
  async confirmCsvImport(res) {
    const dlg = $('#csvDialog');
    const f = res.format;
    $('#csvFormat').replaceChildren(...[el('b', {}, f.label), f.verified ? null : el('span', { class: 'chip sell', style: 'margin-left:6px' }, 'format non vérifié'),
      f.note ? el('div', { class: 'muted small' }, f.note) : null].filter(Boolean));
    const list = $('#csvIsins');
    list.replaceChildren();
    if (res.unresolved.length) {
      list.append(el('p', { class: 'small' }, `${res.unresolved.length} titre(s) connu(s) seulement par leur ISIN : recherche du symbole…`));
      dlg.showModal();
      const rows = [];
      for (const u of res.unresolved) {
        const cands = await this.csvCandidates(u);
        res.resolve(u.isin, cands[0] || null);
        const sel = el('select', { 'aria-label': 'Symbole pour ' + u.isin, onchange: e => { res.resolve(u.isin, e.target.value === '' ? null : cands[+e.target.value]); summary(); } },
          ...cands.map((d, i) => el('option', { value: i }, `${d.symbol} · ${d.mic || d.exchange || ''} · ${d.currency || '?'} — ${d.name || ''}`)),
          el('option', { value: '' }, 'Ignorer ces lignes'));
        if (!cands.length) sel.value = '';
        rows.push(el('div', { class: 'csv-isin' },
          el('div', {}, el('span', { class: 'sym' }, u.isin), el('span', { class: 'name' }, (u.name || '') + ' · ' + u.count + ' ligne(s)'),
            cands.length ? null : el('div', { class: 'small down' }, 'Aucun résultat pour cet ISIN : ces lignes seront ignorées.')), sel));
      }
      list.replaceChildren(el('p', { class: 'small' }, 'Vérifie le symbole retenu pour chaque ISIN (place de cotation et devise) :'), ...rows);
    }
    const summary = () => {
      const n = res.ready().length;
      $('#csvSummary').replaceChildren(...[
        el('p', {}, el('b', {}, n + ' opération(s) à importer'), res.newInst.length ? ` · ${res.newInst.length} nouvel(s) instrument(s)` : '',
          res.newAcc.length ? ` · compte(s) créé(s) : ${res.newAcc.join(', ')}` : ''),
        res.skipped ? el('p', { class: 'muted small' }, `${res.skipped} ligne(s) sans titre ignorée(s) (virements, intérêts, frais seuls…).`) : null,
        res.errors.length ? el('p', { class: 'small down' }, `${res.errors.length} ligne(s) non reconnue(s) : ${res.errors.slice(0, 3).join(' ; ')}`) : null].filter(Boolean));
      $('#csvOk').disabled = !n;
    };
    summary();
    if (!dlg.open) dlg.showModal();
    return new Promise(ok => {
      const done = v => { $('#csvOk').onclick = null; $('#csvCancel').onclick = null; dlg.close(); ok(v); };
      $('#csvOk').onclick = e => { e.preventDefault(); done(true); };
      $('#csvCancel').onclick = () => done(false);
      dlg.onclose = () => ok(false);
    });
  },
});

/* ==================================================================== */
/* Formats CSV des courtiers                                              */
/* ==================================================================== */
const csvNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const csvNum = v => parseNum(String(v ?? '').replace(/[^\d,.\-]/g, '').replace(/\.(?=.*[.,])/g, ''));
const csvDate = v => {
  v = String(v || '').trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
const csvType = v => {
  const s = csvNorm(v);
  if (!s) return null;
  if (/vente|sell|verkauf|cession/.test(s)) return 'sell';
  if (/division|split|regroupement/.test(s)) return 'split';
  if (/div|coupon|distribution/.test(s)) return 'div';
  if (/achat|buy|kauf|souscription|savingsplan|investissement/.test(s)) return 'buy';
  return undefined;
};
/* Noms de places courants → code MIC (Degiro : bourse de référence et lieu d'exécution) */
const CSV_PLACES = { EURONEXT: 'XPAR', PARIS: 'XPAR', EPA: 'XPAR', XETRA: 'XETR', XET: 'XETR', XETA: 'XETR', FRA: 'XFRA', NYSE: 'XNYS', NSY: 'XNYS', NASDAQ: 'XNAS', NDQ: 'XNAS',
  LSE: 'XLON', LONDON: 'XLON', AMSTERDAM: 'XAMS', EAM: 'XAMS', MILAN: 'XMIL', MIL: 'XMIL', MTAA: 'XMIL', ETFP: 'XMIL', EBR: 'XBRU', SWX: 'XSWX', MAD: 'XMAD', BME: 'XMAD' };

/** Colonnes du format générique (APIstock ou en-têtes proches) */
function csvGenericColumns(head) {
  const col = (...names) => head.findIndex(h => names.includes(h));
  return {
    date: col('date', 'dateoperation', 'datedoperation', 'dateexecution', 'datedexecution'), type: col('type', 'operation', 'sens', 'nature', 'typedoperation'),
    account: col('compte', 'account', 'enveloppe'),
    symbol: col('symbole', 'symbol', 'ticker', 'code', 'mnemo', 'mnemonique'), isin: col('isin', 'codeisin'),
    mic: col('place', 'mic', 'marche', 'exchange', 'bourse', 'placedecotation'),
    name: col('nom', 'name', 'libelle', 'valeur', 'produit', 'product', 'instrument'), qty: col('quantite', 'qty', 'quantity', 'nombre', 'parts', 'qte', 'shares'),
    price: col('prix', 'price', 'cours', 'prixunitaire', 'coursdexecution', 'prixdexecution', 'prixdexe'), fees: col('frais', 'fees', 'commission', 'courtage'),
    ccy: col('devise', 'currency', 'monnaie'), amount: col('montant', 'montantnet', 'amount', 'total', 'montanttotal'),
    note: col('note', 'notes', 'commentaire', 'remarque', 'memo'),
  };
}

/** Ligne du format générique : sens donné par la colonne « type », ou à défaut par le signe de la quantité / du montant */
function csvGenericRow(r, C) {
  const get = k => (C[k] >= 0 ? (r[C[k]] || '').trim() : '');
  const rawType = get('type');
  let type = rawType ? csvType(rawType) : 'buy';
  const qRaw = csvNum(get('qty')), amount = csvNum(get('amount'));
  if (!rawType && qRaw < 0) type = 'sell'; // pas de colonne « sens » : quantité négative = vente
  if (type === undefined) type = qRaw < 0 ? 'sell' : null;
  const split = type === 'split';
  const qty = type === 'div' ? 1 : split ? parseSplit(get('qty')) : Math.abs(qRaw);
  let price = split ? 0 : Math.abs(csvNum(get('price')));
  const fees = Math.abs(csvNum(get('fees'))) || 0;
  if (type === 'div' && !(price > 0)) price = Math.abs(amount) + fees;           // dividende : montant net + retenue = brut
  else if (!split && !(price > 0) && isFinite(amount) && qty > 0) price = Math.max(0, (Math.abs(amount) + (type === 'sell' ? fees : -fees)) / qty);
  return { date: csvDate(get('date')), type, rawType, account: get('account'), symbol: get('symbol'), isin: get('isin'), mic: get('mic'),
    name: get('name'), qty, price, fees, ccy: get('ccy'), note: get('note') };
}

/*
 * Relevés de courtiers reconnus automatiquement d'après leurs en-têtes.
 * - Degiro « Transactions.csv » : en-têtes anglais confirmés par un analyseur open source testé sur un export réel
 *   (Date, Time, Product, ISIN, Reference exchange, Venue, Quantity, Price, <devise>, Local value, …, Exchange rate,
 *   AutoFX Fee, Transaction and/or third party fees EUR, Total EUR, Order ID) ; quantité négative = vente, dates JJ-MM-AAAA.
 *   En-têtes français (Produit, Code ISIN, Quantité, Cours, Lieu d'exécution…) d'après des exemples publics, non revérifiés.
 * - Trade Republic (export « Transactions » de l'application, 2026) : liste des 23 colonnes rapportée par un utilisateur
 *   (datetime, date, account_type, category, type, asset_class, name, symbol, shares, price, amount, fee, tax, currency, …,
 *   transaction_id, …) ; aucun exemple de valeurs publié : sens déduit du type s'il est explicite, sinon du signe du montant.
 * - Boursorama, Fortuneo : aucun exemple d'export CSV d'opérations de bourse trouvé ; pas de format dédié inventé.
 *   Leurs fichiers passent par le format générique (colonnes date, sens, ISIN ou symbole, quantité, cours, frais, montant).
 */
const CSV_BROKERS = [
  {
    id: 'degiro', label: 'Degiro (Transactions.csv)', verified: true,
    note: 'Frais Degiro convertis dans la devise du titre avec le taux de change du relevé.',
    detect: h => h.includes('isin') || h.includes('codeisin') ? ['venue', 'referenceexchange', 'lieudexecution', 'boursedereference'].some(x => h.includes(x)) && ['quantity', 'quantite'].some(x => h.includes(x)) : false,
    columns(h) {
      const col = (...names) => h.findIndex(x => names.includes(x));
      const pref = (...names) => h.map((x, i) => (names.some(n => x.startsWith(n)) ? i : -1)).filter(i => i >= 0);
      const price = col('price', 'cours');
      return {
        date: col('date'), name: col('product', 'produit'), isin: col('isin', 'codeisin'), ref: col('referenceexchange', 'boursedereference'),
        venue: col('venue', 'lieudexecution'), qty: col('quantity', 'quantite'), price, ccy: h[price + 1] === '' ? price + 1 : -1,
        rate: col('exchangerate', 'tauxdechange'), fees: pref('transactionandorthirdpartyfees', 'transactioncosts', 'fraisdecourtage', 'fraisdetransaction', 'autofxfee', 'fraisautofx'),
        order: col('orderid', 'idordre'),
      };
    },
    row(r, C) {
      const get = i => (i >= 0 ? (r[i] || '').trim() : '');
      const q = csvNum(get(C.qty));
      if (!get(C.isin) || !isFinite(q) || q === 0) return null;
      const ccy = get(C.ccy).toUpperCase();
      const rate = csvNum(get(C.rate));
      const feeBase = C.fees.reduce((s, i) => s + (Math.abs(csvNum(get(i))) || 0), 0);
      const fees = feeBase * (rate > 0 ? rate : 1); // frais en euros → devise du titre (taux = unités de devise pour 1 €)
      const place = get(C.ref).toUpperCase(), venue = get(C.venue).toUpperCase();
      const mic = CSV_PLACES[place] || (MIC_TO_YAHOO_SUFFIX[venue] !== undefined ? venue : CSV_PLACES[venue]) || '';
      return { date: csvDate(get(C.date)), type: q < 0 ? 'sell' : 'buy', isin: get(C.isin), mic, name: get(C.name), qty: Math.abs(q), price: Math.abs(csvNum(get(C.price))),
        fees: Math.round(fees * 100) / 100, ccy: ccy === 'GBX' ? 'GBp' : ccy, note: get(C.order) ? 'Degiro ' + get(C.order) : '' };
    },
  },
  {
    id: 'traderepublic', label: 'Trade Republic (export des transactions)', verified: false,
    note: 'Colonnes connues d\'après un export rapporté publiquement, sans exemple de valeurs : contrôle les opérations après l\'import.',
    detect: h => h.includes('transactionid') && h.includes('shares') && (h.includes('assetclass') || h.includes('category')),
    columns(h) {
      const col = n => h.indexOf(n);
      return { date: col('date') >= 0 ? col('date') : col('datetime'), category: col('category'), type: col('type'), name: col('name'), symbol: col('symbol'), isin: col('isin'),
        shares: col('shares'), price: col('price'), amount: col('amount'), fee: col('fee'), tax: col('tax'), ccy: col('currency') };
    },
    row(r, C) {
      const get = i => (i >= 0 ? (r[i] || '').trim() : '');
      const id = get(C.isin) || get(C.symbol);
      const raw = get(C.type) + ' ' + get(C.category);
      const shares = csvNum(get(C.shares)), amount = csvNum(get(C.amount)), fee = Math.abs(csvNum(get(C.fee))) || 0, tax = Math.abs(csvNum(get(C.tax))) || 0;
      let type = csvType(get(C.type)) || csvType(get(C.category));
      if (type === 'div') {
        if (!id || !isFinite(amount)) return null;
        return { date: csvDate(get(C.date)), type, isin: ISIN_RE.test(id) ? id : '', symbol: ISIN_RE.test(id) ? '' : id, name: get(C.name), qty: 1, price: Math.abs(amount) + tax, fees: tax, ccy: get(C.ccy) };
      }
      if (!id || !isFinite(shares) || shares === 0) return null; // virements, intérêts, carte…
      if (!type || type === 'split') type = shares < 0 || amount > 0 ? 'sell' : 'buy';
      const qty = Math.abs(shares);
      let price = Math.abs(csvNum(get(C.price)));
      if (!(price > 0) && isFinite(amount)) price = Math.max(0, (Math.abs(amount) + (type === 'sell' ? fee + tax : -fee)) / qty);
      return { date: csvDate(get(C.date)), type, rawType: raw, isin: ISIN_RE.test(id) ? id : '', symbol: ISIN_RE.test(id) ? '' : id, name: get(C.name), qty, price, fees: fee, ccy: get(C.ccy) };
    },
  },
];
