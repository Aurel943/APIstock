/*
 * Terminal, scanner de signaux et radiographie.
 *
 * - Mode terminal : un écran plein façon terminal de salle de marchés (bandeau de cours défilant, ligne de commande,
 *   positions en direct, carte de chaleur, graphique, signaux, indices mondiaux, horloges des bourses).
 * - Scanner de signaux : RSI 14, croisements des moyennes 50 / 200 jours (golden / death cross), plus hauts et plus
 *   bas sur 52 semaines, mouvement inhabituel (en écarts-types), séries de hausses ou de baisses, marché baissier.
 * - Radiographie : à travers tes ETF, les entreprises que tu possèdes vraiment (principales lignes des indices,
 *   pondérations approximatives) et ta dépendance aux « 7 Magnifiques » de la tech américaine.
 *
 * Calculs purs (objets Scan et Xray) testés dans tests/terminal.test.mjs ; affichage en bas du fichier.
 */
'use strict';

/*
 * Principales lignes des indices (pondérations approximatives, en % de l'indice, ordre de grandeur 2025).
 * Elles évoluent chaque jour : c'est un ordre de grandeur pour voir à qui ton argent est confié, pas un inventaire exact.
 */
const XRAY_HOLDINGS = {
  sp500: [['NVIDIA', 7.3], ['Microsoft', 6.7], ['Apple', 5.8], ['Amazon', 4.1], ['Alphabet', 3.8], ['Meta', 3], ['Broadcom', 2.6], ['Tesla', 1.9], ['Berkshire Hathaway', 1.6], ['JPMorgan', 1.5], ['Eli Lilly', 1.1], ['Visa', 1]],
  ndx: [['NVIDIA', 9.5], ['Microsoft', 8.6], ['Apple', 7.5], ['Amazon', 5.6], ['Broadcom', 5.2], ['Alphabet', 5.2], ['Meta', 3.8], ['Tesla', 2.9], ['Netflix', 2.6], ['Costco', 2.4], ['Palantir', 2.2]],
  world: [['NVIDIA', 5.3], ['Microsoft', 4.8], ['Apple', 4.2], ['Amazon', 2.9], ['Alphabet', 2.7], ['Meta', 2.2], ['Broadcom', 1.9], ['Tesla', 1.3], ['JPMorgan', 1.1], ['Berkshire Hathaway', 0.9], ['Eli Lilly', 0.8], ['Visa', 0.75]],
  allworld: [['NVIDIA', 4.7], ['Microsoft', 4.3], ['Apple', 3.8], ['Amazon', 2.6], ['Alphabet', 2.4], ['Meta', 2], ['Broadcom', 1.7], ['Tesla', 1.2], ['TSMC', 1.1], ['JPMorgan', 1], ['Tencent', 0.5]],
  em: [['TSMC', 10.5], ['Tencent', 5], ['Samsung Electronics', 2.8], ['Alibaba', 2.8], ['HDFC Bank', 1.5], ['Xiaomi', 1.4], ['Reliance Industries', 1.1], ['ICICI Bank', 0.9], ['Meituan', 0.8], ['China Construction Bank', 0.8]],
  europe: [['ASML', 2.4], ['SAP', 2.4], ['Nestlé', 1.9], ['Novartis', 1.9], ['Roche', 1.8], ['AstraZeneca', 1.8], ['Shell', 1.6], ['HSBC', 1.6], ['Novo Nordisk', 1.4], ['Siemens', 1.3], ['LVMH', 1.2], ['Schneider Electric', 1.1]],
  es50: [['ASML', 8], ['SAP', 7], ['Siemens', 4.5], ['LVMH', 3.6], ['Allianz', 3.6], ['Schneider Electric', 3.6], ['Deutsche Telekom', 3.3], ['TotalEnergies', 3.2], ['Sanofi', 3], ['Airbus', 3], ['Iberdrola', 2.8], ['L\'Oréal', 2.5]],
  cac: [['Schneider Electric', 8], ['LVMH', 7.5], ['TotalEnergies', 7], ['Airbus', 6], ['Air Liquide', 6], ['Safran', 6], ['L\'Oréal', 5.5], ['Sanofi', 5.5], ['Hermès', 5], ['AXA', 4.5], ['BNP Paribas', 4.5], ['EssilorLuxottica', 4.5]],
  japan: [['Toyota', 4.5], ['Sony', 3.8], ['Mitsubishi UFJ', 3.5], ['Hitachi', 3.2], ['Sumitomo Mitsui', 2.2], ['Recruit', 2], ['Keyence', 1.8], ['Tokyo Electron', 1.8], ['Shin-Etsu', 1.5], ['Mitsubishi Corp.', 1.5]],
  gold: [['Or physique', 100]],
  crypto: [['Crypto-actifs', 100]],
};
const XRAY_MAG7 = ['NVIDIA', 'Microsoft', 'Apple', 'Amazon', 'Alphabet', 'Meta', 'Tesla'];

const Scan = {
  /** Moyenne des n derniers points (NaN si historique insuffisant) */
  sma(c, n, end = c.length) { if (end < n) return NaN; let s = 0; for (let i = end - n; i < end; i++) s += c[i]; return s / n; },

  /** RSI de Wilder sur n périodes (0-100) */
  rsi(c, n = 14) {
    if (c.length <= n) return NaN;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (n - 1) + Math.max(0, d)) / n;
      l = (l * (n - 1) + Math.max(0, -d)) / n;
    }
    return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  },

  /** Dernier croisement des moyennes courte et longue dans les `lookback` dernières séances */
  cross(c, short = 50, long = 200, lookback = 20) {
    for (let k = 0; k < lookback; k++) {
      const end = c.length - k;
      const a = this.sma(c, short, end) - this.sma(c, long, end), b = this.sma(c, short, end - 1) - this.sma(c, long, end - 1);
      if (!isFinite(a) || !isFinite(b)) return null;
      if (a > 0 && b <= 0) return { type: 'golden', daysAgo: k };
      if (a < 0 && b >= 0) return { type: 'death', daysAgo: k };
    }
    return null;
  },

  /** Analyse d'une série de cours [[date, cours]] : indicateurs et signaux classés (le plus fort d'abord) */
  analyze(series) {
    const c = (series || []).map(v => v[1]).filter(x => x > 0);
    if (c.length < 30) return null;
    const last = c[c.length - 1], prev = c[c.length - 2];
    const year = c.slice(-252), hi = Math.max(...year), lo = Math.min(...year), ath = Math.max(...c);
    const rets = [];
    for (let i = Math.max(1, c.length - 61); i < c.length - 1; i++) rets.push(c[i] / c[i - 1] - 1);
    const m = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / Math.max(1, rets.length - 1));
    const move = last / prev - 1, z = sd > 0 ? (move - m) / sd : 0;
    let streak = 0;
    for (let i = c.length - 1; i > 0; i--) {
      const s = Math.sign(c[i] - c[i - 1]);
      if (!s || (streak && Math.sign(streak) !== s)) break;
      streak += s;
    }
    const r = { last, move, z, rsi: this.rsi(c), sma50: this.sma(c, 50), sma200: this.sma(c, 200), hi52: hi, lo52: lo, fromHigh: last / hi - 1, fromAth: last / ath - 1, streak, cross: this.cross(c), signals: [] };
    const S = (level, kind, text, score) => r.signals.push({ level, kind, text, score });
    if (Math.abs(z) >= 2.5) S('hot', 'move', `Mouvement inhabituel aujourd'hui : ${fmtPct(move * 100, 1)}, soit ${fmtNum(Math.abs(z), 1)} écarts-types`, 90 + Math.abs(z));
    if (r.cross) S(r.cross.type === 'golden' ? 'up' : 'down', 'cross', r.cross.type === 'golden'
      ? `Golden cross : la moyenne 50 jours passe au-dessus de la 200 jours${r.cross.daysAgo ? ` (il y a ${r.cross.daysAgo} séance${r.cross.daysAgo > 1 ? 's' : ''})` : ' aujourd\'hui'}`
      : `Death cross : la moyenne 50 jours passe sous la 200 jours${r.cross.daysAgo ? ` (il y a ${r.cross.daysAgo} séance${r.cross.daysAgo > 1 ? 's' : ''})` : ' aujourd\'hui'}`, 80 - r.cross.daysAgo);
    if (c.length >= 200 && last >= hi * 0.995) S('up', 'high', 'Au plus haut sur 52 semaines', 70);
    else if (c.length >= 200 && last <= lo * 1.01) S('down', 'low', 'Au plus bas sur 52 semaines', 70);
    if (r.rsi >= 70) S('warn', 'rsi', `RSI ${fmtNum(r.rsi, 0)} : suracheté (hausse rapide, souvent suivie d'une pause)`, 50 + r.rsi - 70);
    else if (r.rsi <= 30) S('warn', 'rsi', `RSI ${fmtNum(r.rsi, 0)} : survendu (baisse rapide, rebond fréquent)`, 50 + 30 - r.rsi);
    if (r.fromAth <= -0.2) S('down', 'bear', `Marché baissier : ${fmtPct(r.fromAth * 100, 0)} depuis son plus haut historique`, 60);
    if (Math.abs(streak) >= 5) S(streak > 0 ? 'up' : 'down', 'streak', `${Math.abs(streak)} séances de ${streak > 0 ? 'hausse' : 'baisse'} d'affilée`, 40 + Math.abs(streak));
    r.signals.sort((a, b) => b.score - a.score);
    return r;
  },
};

const Xray = {
  /** Nom de société normalisé pour rapprocher une action détenue en direct d'une ligne d'indice */
  norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); },

  /**
   * Transparence : `list` [{ key, label, value, profile }] → entreprises détenues (valeur et % du portefeuille),
   * part couverte par les principales lignes connues, part des 7 Magnifiques.
   */
  lookthrough(list, holdings = XRAY_HOLDINGS) {
    const total = list.reduce((s, x) => s + (x.value > 0 ? x.value : 0), 0);
    const map = new Map();
    const add = (name, v, key) => {
      const k = this.norm(name);
      const e = map.get(k) || { name, value: 0, via: [] };
      e.value += v; e.via.push({ key, value: v });
      map.set(k, e);
    };
    const known = Object.values(holdings).flat().map(([n]) => n);
    for (const x of list) {
      if (!(x.value > 0)) continue;
      const h = holdings[x.profile];
      if (h) for (const [name, pct] of h) add(name, x.value * pct / 100, x.key);
      else if (x.profile === 'stock') {
        // action détenue en direct : rattachée à la même société que dans les indices (« Apple Inc. » → Apple)
        const n = this.norm(x.label);
        const match = known.find(k => n === this.norm(k) || n.startsWith(this.norm(k) + ' '));
        add(match || x.label, x.value, x.key);
      }
    }
    const companies = Array.from(map.values()).map(e => Object.assign(e, { pct: total > 0 ? e.value / total * 100 : 0 })).sort((a, b) => b.value - a.value);
    const covered = companies.reduce((s, e) => s + e.value, 0);
    const mag = companies.filter(e => XRAY_MAG7.includes(e.name));
    return { companies, total, covered: total > 0 ? covered / total * 100 : 0, mag7: total > 0 ? mag.reduce((s, e) => s + e.value, 0) / total * 100 : 0, mag7Value: mag.reduce((s, e) => s + e.value, 0) };
  },
};

/* ==================== Affichage ==================== */

Object.assign(App, {
  bindTerminal() {
    if ($('#termOpen')) $('#termOpen').addEventListener('click', () => { this.toggleTabMenu(false); this.openTerminal(); });
    if ($('#scanRun')) $('#scanRun').addEventListener('click', () => this.runScan());
    this.on('rendered:portfolio', () => { if (this.termOn) this.renderTerminal(); if (this.view === 'portfolio') this.renderXray(); });
    this.on('rendered:all', () => this.renderXray());
  },

  /* ---------- radiographie ---------- */

  xrayList() {
    const { rows } = Portfolio.snapshot();
    return rows.map(r => ({ key: r.key, label: Store.label(r.key), value: isFinite(r.valueBase) ? r.valueBase : r.costBase, profile: Expo.of(r.key).profile }));
  },

  renderXray() {
    const card = $('#xrayCard'), box = $('#xrayBody');
    if (!card || !box) return;
    const X = Xray.lookthrough(this.xrayList());
    card.classList.toggle('hidden', !X.companies.length);
    if (!X.companies.length) return;
    const cur = this.base();
    const top = X.companies.slice(0, 15), max = top[0].value;
    box.replaceChildren(...[
      el('p', { class: 'q-lead' }, X.mag7 >= 1 ? ['Les ', el('b', {}, '7 Magnifiques'), ' (NVIDIA, Microsoft, Apple, Amazon, Alphabet, Meta, Tesla) représentent ', el('b', { class: X.mag7 >= 25 ? 'down' : '' }, fmtNum(X.mag7, 1) + ' %'), ` de ton portefeuille, soit ${fmtMoney(X.mag7Value, cur, 0)}. `] : '',
        `Ta première entreprise, `, el('b', {}, top[0].name), `, pèse ${fmtNum(top[0].pct, 1)} % (${fmtMoney(top[0].value, cur, 0)}).`),
      el('ol', { class: 'xr-list' }, ...top.map(e => el('li', { class: XRAY_MAG7.includes(e.name) ? 'mag' : '' },
        el('span', { class: 'xr-name' }, e.name, XRAY_MAG7.includes(e.name) ? el('span', { class: 'xr-tag' }, 'M7') : null),
        el('div', { class: 'xr-bar' }, el('span', { style: `width:${Math.max(1, e.value / max * 100)}%` })),
        el('span', { class: 'mono xr-val' }, fmtMoney(e.value, cur, 0)),
        el('span', { class: 'mono muted small' }, fmtNum(e.pct, 1) + ' %'),
        el('span', { class: 'xr-via muted small' }, 'via ' + e.via.map(v => Store.label(v.key)).join(', '))))),
      noteTip(`Principales lignes de chaque indice (ordre de grandeur 2025, elles évoluent chaque jour) multipliées par la valeur de tes ETF ; actions détenues en direct ajoutées telles quelles. Ces ${top.length} entreprises couvrent ${fmtNum(X.covered, 0)} % de ton portefeuille : le reste est réparti entre des centaines d'autres sociétés. Indicatif, pas un inventaire officiel.`, 'Méthode')]);
  },

  /* ---------- scanner ---------- */

  scanKeys() { return Array.from(new Set([...Portfolio.snapshot('all').rows.map(r => r.key), ...Store.state.watchlist])).filter(k => Store.instrument(k) && !Manual.is(k)); },

  async runScan() {
    const box = $('#scanBody'), btn = $('#scanRun');
    const keys = this.scanKeys();
    if (!keys.length) { if (box) box.replaceChildren(el('p', { class: 'muted' }, 'Ajoute des lignes ou des valeurs suivies pour les scanner.')); return null; }
    if (btn) { btn.disabled = true; btn.textContent = 'Scan…'; }
    try {
      const start = addDaysISO(todayISO(), -420), res = [];
      for (const k of keys) {
        try {
          let s = await Api.daily(k, start);
          const q = Api.cachedQuote(k);
          if (q && q.price > 0) s = s.filter(v => v[0] < todayISO()).concat([[todayISO(), q.price]]);
          const a = Scan.analyze(s);
          if (a) res.push(Object.assign({ key: k }, a));
        } catch (e) { /* ligne ignorée */ }
      }
      this.scanResult = { at: Date.now(), res };
      this.renderScan();
      if (this.termOn) this.renderTerminal();
      return this.scanResult;
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Rescanner'; } }
  },

  renderScan() {
    const S = this.scanResult, box = $('#scanBody');
    if (!S || !box) return;
    const sig = S.res.flatMap(r => r.signals.map(s => Object.assign({ key: r.key }, s))).sort((a, b) => b.score - a.score);
    box.replaceChildren(...[
      el('p', { class: 'q-lead' }, sig.length ? [el('b', {}, `${sig.length} signal${sig.length > 1 ? 'aux' : ''}`), ` sur ${S.res.length} valeur${S.res.length > 1 ? 's' : ''} scannée${S.res.length > 1 ? 's' : ''}.`] : `Rien d'inhabituel sur tes ${S.res.length} valeurs : marché calme.`),
      sig.length ? el('ul', { class: 'sc-list' }, ...sig.map(s => el('li', { class: 'sc-' + s.level }, el('b', {}, Store.label(s.key)), el('span', {}, s.text)))) : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'q-table sc-table' },
        el('thead', {}, el('tr', {}, ...['Valeur', 'Jour', 'RSI 14', 'vs MM 200', 'vs plus haut 1 an', 'Série'].map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
        el('tbody', {}, ...S.res.map(r => el('tr', {},
          el('td', {}, Store.label(r.key)),
          el('td', { class: 'num mono ' + trendClass(r.move) }, fmtPct(r.move * 100, 2)),
          el('td', { class: 'num mono ' + (r.rsi >= 70 || r.rsi <= 30 ? 'sc-warn-txt' : '') }, fmtNum(r.rsi, 0)),
          el('td', { class: 'num mono ' + trendClass(r.last - r.sma200) }, isFinite(r.sma200) ? fmtPct((r.last / r.sma200 - 1) * 100, 1) : '—'),
          el('td', { class: 'num mono ' + trendClass(r.fromHigh) }, fmtPct(r.fromHigh * 100, 1)),
          el('td', { class: 'num mono ' + trendClass(r.streak) }, (r.streak > 0 ? '▲' : r.streak < 0 ? '▼' : '') + Math.abs(r.streak))))))),
      noteTip('Cours de clôture des 14 derniers mois (cours en direct pour aujourd\'hui). RSI de Wilder sur 14 séances ; moyennes mobiles simples 50 et 200 séances (croisement dans les 20 dernières séances) ; plus haut et plus bas sur 52 semaines ; mouvement inhabituel = variation du jour supérieure à 2,5 écarts-types des 60 séances précédentes. Des repères d\'analyse technique, pas des prévisions.', 'Méthode')].filter(Boolean));
  },

  /* ---------- mode terminal ---------- */

  openTerminal() {
    const T = $('#term');
    if (!T) return;
    this.termOn = true;
    T.classList.remove('hidden');
    document.body.classList.add('term-open');
    this.termPanel = this.termPanel || 'scan';
    this.termKey = this.termKey || this.scanKeys()[0] || null;
    if (!this._termBound) {
      this._termBound = true;
      const input = $('#termCmd');
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this.termCommand(input.value); input.value = ''; }
        if (e.key === 'Escape') this.closeTerminal();
      });
      $('#termClose').addEventListener('click', () => this.closeTerminal());
      $$('#termKeys button').forEach(b => b.addEventListener('click', () => this.termCommand(b.dataset.cmd)));
      const fkeys = { F1: 'HELP', F2: 'SCAN', F3: 'WEI', F4: 'XRAY', F10: 'EXIT' };
      document.addEventListener('keydown', e => {
        if (!this.termOn) return;
        if (e.key === 'Escape') this.closeTerminal();
        else if (fkeys[e.key]) { e.preventDefault(); this.termCommand(fkeys[e.key]); }
      });
    }
    clearInterval(this._termClock);
    this._termClock = setInterval(() => this.renderTermClock(), 1000);
    this.renderTerminal();
    this.renderTermChart();
    $('#termCmd').focus();
    if (!this.scanResult || Date.now() - this.scanResult.at > 10 * 60000) this.runScan();
    if (typeof this.loadWorldQuotes === 'function' && Api.hasProxy()) this.loadWorldQuotes().then(() => { if (this.termOn) this.renderTerminal(); }).catch(() => {});
  },

  closeTerminal() {
    this.termOn = false;
    clearInterval(this._termClock);
    $('#term').classList.add('hidden');
    document.body.classList.remove('term-open');
    Charts.destroy('termChart');
  },

  /** Commandes : PORT, SCAN, WEI, XRAY, HELP, EXIT, ou un symbole (ex. « CW8 », « CW8 GP ») */
  termCommand(raw) {
    const cmd = String(raw || '').trim().toUpperCase().replace(/\s*<?GO>?$/, '');
    const out = $('#termMsg');
    if (!cmd) return;
    if (['EXIT', 'QUIT', 'Q', 'X'].includes(cmd)) { this.closeTerminal(); return; }
    if (['SCAN', 'WEI', 'XRAY', 'HELP', 'PORT'].includes(cmd)) {
      this.termPanel = cmd === 'PORT' ? this.termPanel : cmd.toLowerCase();
      if (cmd === 'SCAN') this.runScan();
      out.textContent = `> ${cmd} ✓`;
      this.renderTerminal();
      return;
    }
    const sym = cmd.split(/\s+/)[0];
    const key = Object.keys(Store.state.instruments).find(k => { const i = Store.instrument(k); return i.symbol.toUpperCase() === sym || (i.ysymbol || '').toUpperCase().split('.')[0] === sym; });
    if (key) {
      this.termKey = key;
      out.textContent = `> ${Store.label(key)} ✓`;
      this.renderTerminal();
      this.renderTermChart();
      return;
    }
    out.textContent = `> ${cmd} : commande inconnue. Tape HELP.`;
  },

  renderTermClock() {
    const c = $('#termClock');
    if (!c) return;
    const now = Date.now();
    const ex = ['paris', 'london', 'newyork', 'tokyo'].map(id => EXCHANGES.find(e => e.id === id)).filter(Boolean);
    c.replaceChildren(el('b', {}, new Date(now).toLocaleTimeString('fr-FR')), ...ex.map(e => {
      const st = Markets.status(e, now);
      const t = st.localTime;
      return el('span', { class: 'term-mkt ' + st.state }, e.city.slice(0, 3).toUpperCase(), ' ', `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`);
    }));
  },

  renderTerminal() {
    const T = $('#term');
    if (!T || !this.termOn) return;
    const cur = this.base();
    const { rows, totals } = Portfolio.snapshot();
    const pc = v => (v >= 0 ? 'tu' : 'td');
    // bandeau défilant : tes valeurs + indices mondiaux connus
    const items = [];
    for (const k of Store.trackedKeys()) { const q = Api.cachedQuote(k); if (q && q.price > 0) items.push([Store.instrument(k).symbol, q.price, q.percentChange]); }
    for (const m of (typeof MACRO !== 'undefined' ? MACRO : [])) { const q = this.idxQuote && this.idxQuote(m.y); if (q && q.price > 0) items.push([m.name, q.price, q.percentChange]); }
    const tape = items.map(([n, p, ch]) => el('span', { class: 'term-tk' }, el('b', {}, n), ' ', fmtNum(p, p >= 1000 ? 0 : 2), ' ', el('span', { class: pc(ch) }, (ch >= 0 ? '▲' : '▼') + fmtNum(Math.abs(ch || 0), 2) + '%')));
    $('#termTape').replaceChildren(el('div', { class: 'term-tape-in' }, ...tape, ...tape.map(n => n.cloneNode(true))));
    // positions
    $('#termPort').replaceChildren(
      el('div', { class: 'term-h' }, 'PORT  ', el('span', { class: pc(totals.day) }, `${fmtSignedMoney(totals.day, cur)} (${fmtPct(totals.dayPct, 2)})`), '  VAL ', fmtMoney(totals.value, cur, 0)),
      el('table', { class: 'term-t' }, el('tbody', {}, ...rows.sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0)).map(r => el('tr', { class: r.key === this.termKey ? 'sel' : '', onclick: () => { this.termKey = r.key; this.renderTerminal(); this.renderTermChart(); } },
        el('td', {}, Store.instrument(r.key).symbol), el('td', { class: 'n' }, fmtNum(r.price, 2)),
        el('td', { class: 'n ' + pc(r.quote ? r.quote.percentChange : 0) }, r.quote ? fmtPct(r.quote.percentChange, 2) : '—'),
        el('td', { class: 'n ' + pc(r.dayBase) }, isFinite(r.dayBase) ? fmtSignedMoney(r.dayBase, cur) : '—'),
        el('td', { class: 'n ' + pc(r.pnlBase) }, fmtPct(r.pnlPct, 1)))))));
    // carte de chaleur
    const tot = rows.reduce((s, r) => s + (r.valueBase > 0 ? r.valueBase : 0), 0) || 1;
    $('#termHeat').replaceChildren(el('div', { class: 'term-h' }, 'HEAT'), el('div', { class: 'term-heat' }, ...rows.filter(r => r.valueBase > 0).map(r => {
      const ch = r.quote ? r.quote.percentChange : 0, a = Math.min(1, Math.abs(ch) / 2.5);
      return el('div', { class: 'term-tile', style: `flex-grow:${Math.max(1, r.valueBase / tot * 100)};background:${ch >= 0 ? `rgba(0,200,120,${0.2 + a * 0.6})` : `rgba(255,70,70,${0.2 + a * 0.6})`}`, onclick: () => { this.termKey = r.key; this.renderTerminal(); this.renderTermChart(); } },
        el('b', {}, Store.instrument(r.key).symbol), el('span', {}, fmtPct(ch, 2)));
    })));
    // panneau d'information
    const side = $('#termSide');
    const P = this.termPanel;
    if (P === 'help') {
      side.replaceChildren(el('div', { class: 'term-h' }, 'HELP'), el('pre', { class: 'term-help' },
        'CW8 <GO>    graphique d\'une valeur (symbole)\nSCAN        signaux techniques\nWEI         indices mondiaux\nXRAY        tes vraies entreprises\nPORT        positions\nEXIT / Échap  quitter'));
    } else if (P === 'wei') {
      side.replaceChildren(el('div', { class: 'term-h' }, 'WEI  INDICES MONDIAUX'), el('table', { class: 'term-t' }, el('tbody', {}, ...EXCHANGES.map(e => {
        const q = this.idxQuote && this.idxQuote(e.index.y), st = Markets.status(e);
        return el('tr', {}, el('td', {}, el('span', { class: 'term-dot ' + st.state }), e.index.name), el('td', { class: 'n' }, q ? fmtNum(q.price, 0) : '—'), el('td', { class: 'n ' + pc(q ? q.percentChange : 0) }, q ? fmtPct(q.percentChange, 2) : ''));
      }))));
    } else if (P === 'xray') {
      const X = Xray.lookthrough(this.xrayList());
      side.replaceChildren(el('div', { class: 'term-h' }, `XRAY  M7 ${fmtNum(X.mag7, 1)}%`), el('table', { class: 'term-t' }, el('tbody', {}, ...X.companies.slice(0, 14).map(e =>
        el('tr', {}, el('td', {}, e.name), el('td', { class: 'n' }, fmtMoney(e.value, cur, 0)), el('td', { class: 'n' }, fmtNum(e.pct, 1) + '%'))))));
    } else {
      const S = this.scanResult;
      const sig = S ? S.res.flatMap(r => r.signals.map(s => Object.assign({ key: r.key }, s))).sort((a, b) => b.score - a.score) : [];
      side.replaceChildren(el('div', { class: 'term-h' }, 'SCAN  ', S ? `${sig.length} SIGNAUX` : 'CHARGEMENT…'), el('ul', { class: 'term-sig' }, ...(sig.length ? sig.slice(0, 12).map(s =>
        el('li', { class: 'lv-' + s.level }, el('b', {}, Store.instrument(s.key).symbol), ' ', s.text)) : [el('li', {}, S ? 'Aucun signal. Marché calme.' : '…')])));
    }
    this.renderTermClock();
  },

  async renderTermChart() {
    const key = this.termKey, head = $('#termChartHead');
    if (!key || !head) return;
    const inst = Store.instrument(key), q = Api.cachedQuote(key);
    head.replaceChildren('GP  ', el('b', {}, inst.symbol), '  ', Store.label(key), q ? el('span', { class: q.percentChange >= 0 ? 'tu' : 'td' }, `  ${fmtNum(q.price, 2)} ${inst.currency}  ${fmtPct(q.percentChange, 2)}`) : '');
    let s = [];
    try { s = await Api.daily(key, addDaysISO(todayISO(), -365)); } catch (e) { s = []; }
    if (!this.termOn || key !== this.termKey || typeof Chart === 'undefined' || !s.length) return;
    Charts.destroy('termChart');
    const closes = s.map(v => v[1]);
    const ma = closes.map((_, i) => (i >= 49 ? Scan.sma(closes, 50, i + 1) : null));
    const o = Charts.baseOptions();
    o.plugins.legend.display = false;
    o.animation = false;
    o.elements = { point: { radius: 0 } };
    o.scales.x.ticks.color = '#ffb000'; o.scales.y.ticks.color = '#ffb000';
    o.scales.y.grid = { color: 'rgba(255,176,0,.12)' }; o.scales.y.position = 'right';
    Charts.instances.termChart = new Chart($('#termChart'), { type: 'line', options: o, data: { labels: s.map(v => v[0].slice(2, 7)),
      datasets: [{ data: closes, borderColor: '#ffb000', borderWidth: 1.6, fill: false, tension: 0 }, { data: ma, borderColor: '#4fc3f7', borderWidth: 1, borderDash: [4, 3], fill: false }] } });
  },
});
