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
  /*
   * Écran de salle de marchés en 4 fenêtres. Chaque fenêtre exécute une fonction (PORT, GP, DES, WEI, CMDTY…) ;
   * la ligne de commande s'adresse à la fenêtre active : « CW8 GP <GO> », « GOLD CMDTY GPC », « COMP SPX CAC DAX »,
   * « SECF apple », « LAY 2 », « 3 » (action n° 3 du menu rouge). Les fonctions « valeur » (GP, GIP, HP, DES, DVD, NEWS)
   * suivent la valeur chargée, partagée par les 4 fenêtres.
   */

  termNewPane(fn, extra) {
    return Object.assign({ fn, range: '1A', irange: '1J', style: 'candle', per: 'auto', st: { ma: true, vol: true, bb: false, rsi: false, macd: false }, log: false }, extra || {});
  },

  termLoadState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('apistock:term') || 'null'); } catch (e) { s = null; }
    const ok = p => p && TERM_FN[p.fn] && !TERM_FN[p.fn].alias;
    this.termPanes = s && Array.isArray(s.panes) && s.panes.length === 4 && s.panes.every(ok)
      ? s.panes.map(p => this.termNewPane(p.fn, { range: p.range || '1A', irange: p.irange || '1J', style: p.style || 'candle', per: p.per || 'auto',
        st: Object.assign({ ma: true, vol: true, bb: false, rsi: false, macd: false }, p.st || {}), log: !!p.log, list: Array.isArray(p.list) ? p.list : null, q: p.q || '' }))
      : TERM_LAYOUTS[1].fns.map(fn => this.termNewPane(fn));
    this.termActive = s && s.active >= 0 && s.active < 4 ? s.active : 0;
    this.termMon = s && Array.isArray(s.mon) ? s.mon.filter(k => typeof k === 'string') : [];
    this.termHist = s && Array.isArray(s.hist) ? s.hist.slice(-50) : [];
    this.termZoom = -1;
    if (s && s.key && !this.termKey && (s.key.startsWith('Y:') || Store.instrument(s.key))) this.termKey = s.key;
  },

  termSaveState() {
    try {
      localStorage.setItem('apistock:term', JSON.stringify({ active: this.termActive, key: this.termKey, mon: this.termMon, hist: this.termHist,
        panes: this.termPanes.map(p => ({ fn: p.fn, range: p.range, irange: p.irange, style: p.style, per: p.per, st: p.st, log: p.log, list: p.list, q: p.q })) }));
    } catch (e) { /* navigation privée : rien n'est gardé */ }
  },

  openTerminal() {
    const T = $('#term');
    if (!T) return;
    this.termOn = true;
    T.classList.remove('hidden');
    document.body.classList.add('term-open');
    if (!this.termPanes) this.termLoadState();
    this.termKey = this.termKey || this.scanKeys()[0] || 'Y:^GSPC';
    if (!this._termBound) { this._termBound = true; this.bindTermKeys(); }
    clearInterval(this._termClock);
    this._termClock = setInterval(() => this.renderTermClock(), 1000);
    clearInterval(this._termRefresh);
    this._termRefresh = setInterval(() => { if (!document.hidden) { this._termLoaded = {}; this.renderTerminal(); } }, 60000);
    this.renderTerminal();
    $('#termCmd').focus();
    if (!this.scanResult || Date.now() - this.scanResult.at > 10 * 60000) this.runScan();
    if (typeof this.loadWorldQuotes === 'function' && Api.hasProxy()) this.loadWorldQuotes().then(() => { if (this.termOn) this.renderTerminal(); }).catch(() => {});
  },

  bindTermKeys() {
    const input = $('#termCmd');
    let hpos = -1;
    input.addEventListener('keydown', e => {
      const sug = this._termSug || [];
      if (e.key === 'Enter') {
        e.preventDefault();
        if (sug.length && this._termSugI >= 0) { this.termAccept(sug[this._termSugI]); return; }
        const v = input.value; input.value = ''; hpos = -1; this.termSuggest('');
        this.termCommand(v);
      } else if (e.key === 'Tab' && sug.length) { e.preventDefault(); this.termAccept(sug[Math.max(0, this._termSugI)]); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sug.length) {
        e.preventDefault();
        const i = this._termSugI;
        this._termSugI = e.key === 'ArrowDown' ? (i + 1 >= sug.length ? -1 : i + 1) : (i - 1 < -1 ? sug.length - 1 : i - 1);
        this.renderTermSug();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // historique des commandes
        const H = this.termHist || [];
        if (!H.length) return;
        e.preventDefault();
        hpos = e.key === 'ArrowUp' ? (hpos < 0 ? H.length - 1 : Math.max(0, hpos - 1)) : (hpos < 0 ? -1 : hpos + 1);
        if (hpos >= H.length) hpos = -1;
        input.value = hpos < 0 ? '' : H[hpos];
      }
    });
    input.addEventListener('input', () => { hpos = -1; this.termSuggest(input.value); });
    input.addEventListener('blur', () => setTimeout(() => this.termSuggest(''), 150));
    $('#termClose').addEventListener('click', () => this.closeTerminal());
    $$('#termKeys button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.cmd) this.termCommand(b.dataset.cmd);
      else if (b.dataset.ins) { input.value = (input.value.trim() + ' ' + b.dataset.ins).trim() + ' '; input.focus(); }
      else if (b.dataset.go !== undefined) { const v = input.value; input.value = ''; this.termSuggest(''); this.termCommand(v); input.focus(); }
    }));
    const fkeys = { F1: 'HELP', F2: 'SCAN', F3: 'WEI', F4: 'XRAY', F5: 'FX', F6: 'CMDTY', F7: 'MOV', F8: 'TOP', F9: 'DES', F10: 'EXIT', F11: 'GP', F12: 'COMP' };
    document.addEventListener('keydown', e => {
      if (!this.termOn) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if ((this._termSug || []).length) this.termSuggest('');
        else if (this.termZoom >= 0) this.termToggleZoom(this.termZoom);
        else this.closeTerminal();
      } else if (fkeys[e.key]) { e.preventDefault(); this.termCommand(fkeys[e.key]); }
      else if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); this.termFocus(+e.key - 1); }
      else if (e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); this.termToggleZoom(this.termActive); }
    });
  },

  closeTerminal() {
    this.termOn = false;
    clearInterval(this._termClock);
    clearInterval(this._termRefresh);
    $('#term').classList.add('hidden');
    document.body.classList.remove('term-open');
    for (const c of Object.values(this._termCharts || {})) c.destroy();
    this._termCharts = {};
  },

  termFocus(i) {
    this.termActive = i;
    $$('#termGrid .tp').forEach((p, j) => p.classList.toggle('on', j === i));
    this.renderTermStatus();
    this.termSaveState();
  },

  termToggleZoom(i) {
    this.termZoom = this.termZoom === i ? -1 : i;
    const g = $('#termGrid');
    g.classList.toggle('zoomed', this.termZoom >= 0);
    $$('#termGrid .tp').forEach((p, j) => p.classList.toggle('zoom', j === this.termZoom));
    this.termFocus(i);
  },

  termMsg(text, bad) { const m = $('#termMsg'); if (m) { m.textContent = text; m.classList.toggle('bad', !!bad); } },

  /* ---------- saisie assistée ---------- */

  /** Suggestions pour le dernier mot tapé : fonctions, valeurs suivies, alias d'indices, matières premières, devises */
  termSuggest(raw) {
    const words = String(raw || '').toUpperCase().split(/\s+/);
    const w = words[words.length - 1];
    if (!w || w.length < 1) { this._termSug = []; this._termSugI = -1; this.renderTermSug(); return; }
    const out = [], seen = new Set();
    const add = (ins, label, tag) => { if (out.length < 9 && !seen.has(ins)) { seen.add(ins); out.push({ ins, label, tag }); } };
    for (const [k, F] of Object.entries(TERM_FN)) if (!F.alias && k.startsWith(w)) add(k, F.title, 'FONCTION');
    for (const k of Object.keys(Store.state.instruments)) { const i = Store.instrument(k); if (i.symbol.toUpperCase().startsWith(w)) add(i.symbol.toUpperCase(), Store.label(k), 'TITRE'); }
    for (const [a, y] of Object.entries(TERM_ALIAS)) if (a.startsWith(w)) add(a, termName(y), TERM_SECTOR_OF(y));
    if (w.length >= 2) {
      for (const L of [TERM_CMDTY, TERM_FX, TERM_CRYPTO]) for (const x of L) if (x[1] && termNorm(x[1]).includes(termNorm(w))) add(TERM_SHORT[x[0]] || x[0], x[1], TERM_SECTOR_OF(x[0]));
      for (const [k, F] of Object.entries(TERM_FN)) if (!F.alias && termNorm(F.title).includes(termNorm(w))) add(k, F.title, 'FONCTION');
      for (const k of Object.keys(Store.state.instruments)) if (termNorm(Store.label(k)).includes(termNorm(w))) add(Store.instrument(k).symbol.toUpperCase(), Store.label(k), 'TITRE');
    }
    this._termSug = out; this._termSugI = -1;
    this.renderTermSug();
  },

  termAccept(s) {
    const input = $('#termCmd');
    const words = input.value.replace(/\s+$/, '').split(/\s+/);
    words[words.length - 1] = s.ins;
    input.value = words.join(' ') + ' ';
    this.termSuggest('');
    input.focus();
  },

  renderTermSug() {
    const box = $('#termSug');
    if (!box) return;
    const S = this._termSug || [];
    box.classList.toggle('hidden', !S.length);
    box.replaceChildren(...S.map((s, k) => el('li', { class: k === this._termSugI ? 'on' : '', onmousedown: e => { e.preventDefault(); this.termAccept(s); } },
      el('b', {}, s.ins), el('span', {}, s.label), el('i', {}, s.tag))));
  },

  /* ---------- commandes ---------- */

  /** Exécute une commande dans la fenêtre active (ou celle donnée) */
  async termCommand(raw, paneIdx = this.termActive) {
    const toks = String(raw || '').toUpperCase().replace(/[<>]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (toks[toks.length - 1] === 'GO') toks.pop();
    if (!toks.length) return;
    const cmd = toks.join(' ');
    if (!/^\d$/.test(cmd)) { this.termHist = (this.termHist || []).filter(h => h !== cmd).concat(cmd).slice(-50); }
    if (['EXIT', 'QUIT', 'Q', 'X'].includes(cmd)) { this.closeTerminal(); return; }
    // « 1 » à « 9 » : action du menu rouge de la fenêtre active
    if (/^\d$/.test(cmd)) {
      const a = this.termActs(paneIdx)[+cmd - 1];
      if (a) { a.run(); this.termMsg(`> ${cmd}) ${a.label} ✓`); } else this.termMsg(`> ${cmd} : pas d'action ${cmd} dans cette fenêtre.`, true);
      return;
    }
    // fenêtre ciblée : « 2 WEI »
    if (/^[1-4]$/.test(toks[0]) && toks.length > 1) { paneIdx = +toks.shift() - 1; this.termFocus(paneIdx); }
    const pane = this.termPanes[paneIdx];
    const head = toks[0];
    // commandes à arguments
    if (head === 'LAY' || head === 'LAYOUT') {
      const L = TERM_LAYOUTS[toks[1]];
      if (!L) { this.termMsg('> LAY 1 à ' + Object.keys(TERM_LAYOUTS).length + ' : ' + Object.entries(TERM_LAYOUTS).map(([k, l]) => k + ' ' + l.name).join(' · '), true); return; }
      this.termPanes = L.fns.map((fn, j) => this.termNewPane(fn, { st: this.termPanes[j].st, style: this.termPanes[j].style }));
      if (L.key) this.termKey = L.key;
      this.termZoom = -1; $('#termGrid').classList.remove('zoomed');
      this.termMsg(`> LAY ${toks[1]} ✓  ${L.name}`);
      this.termSaveState(); this.renderTerminal(); return;
    }
    if (head === 'ZOOM') { this.termToggleZoom(paneIdx); this.termMsg('> ZOOM ✓'); return; }
    if (head === 'SECF' || head === 'FIND') {
      const q = String(raw).replace(/<?go>?\s*$/i, '').trim().split(/\s+/).filter(t => !/^(secf|find|[1-4])$/i.test(t)).join(' ');
      if (!q) { this.termMsg('> SECF <nom ou ISIN> : recherche de valeurs', true); return; }
      Object.assign(pane, { fn: 'SECF', q, res: null });
      this.termMsg(`> SECF ${q} ✓`); this.termSaveState(); this.renderTerminal(); return;
    }
    if (head === 'ADD' || head === 'DEL') {
      if (toks.length < 2) { this.termMsg(`> ${head} <valeur> : ${head === 'ADD' ? 'ajoute à' : 'retire de'} la liste MON`, true); return; }
      const key = await this.termResolve(toks.slice(1).filter(t => !TERM_SECTORS.includes(t)).join(' '), toks.find(t => TERM_SECTORS.includes(t)));
      if (!key) { this.termMsg(`> ${cmd} : valeur introuvable.`, true); return; }
      this.termMon = (this.termMon || []).filter(k => k !== key);
      if (head === 'ADD') this.termMon.push(key);
      pane.fn = 'MON';
      this.termMsg(`> ${this.termSym(key)} ${head === 'ADD' ? 'ajouté à' : 'retiré de'} MON ✓`); this.termSaveState(); this.renderTerminal(); return;
    }
    // période : « GP 5A », « CW8 GP MAX », « GIP 5J », « COMP 1A »
    let range = null;
    if (toks.length > 1 && TERM_RANGES.includes(toks[toks.length - 1]) && TERM_FN[toks[toks.length - 2]]) range = toks.pop();
    let fn = null, set = null;
    if (TERM_FN[toks[toks.length - 1]]) fn = toks.pop();
    // fonctions à liste : « COMP SPX CAC DAX » ou « SPX CAC COMP »
    if (!fn && TERM_FN[toks[0]] && TERM_FN[toks[0]].list) fn = toks.shift();
    if (fn && TERM_FN[fn].alias) { set = TERM_FN[fn].set || null; fn = TERM_FN[fn].alias; }
    if (fn && TERM_FN[fn].list) {
      const rg = toks.find(t => TERM_RANGES.includes(t));
      if (rg) { range = rg; toks.splice(toks.indexOf(rg), 1); }
      if (toks.length) {
        this.termMsg(`> ${fn} … recherche de ${toks.length} valeur${toks.length > 1 ? 's' : ''}`);
        const keys = [];
        for (const t of toks.filter(x => !TERM_SECTORS.includes(x))) { const k = await this.termResolve(t); if (k) keys.push(k); else { this.termMsg(`> ${t} : valeur introuvable.`, true); return; } }
        pane.list = keys;
      }
      pane.fn = fn; if (range) pane.range = range;
      this.termMsg(`> ${fn} ✓  ${TERM_FN[fn].title}`); this.termSaveState(); this.renderTerminal(); return;
    }
    let sector = null;
    if (toks.length && TERM_SECTORS.includes(toks[toks.length - 1])) sector = toks.pop();
    if (toks.length > 1 && /^(US|FP|NA|GY|LN|IM|SM|SW|JP|HK|CN|AU)$/.test(toks[toks.length - 1])) toks.pop(); // suffixe de place, ignoré
    if (toks.length) {
      const sym = toks.join(' ');
      this.termMsg(`> ${sym} … recherche`);
      const key = await this.termResolve(sym, sector);
      if (!key) { this.termMsg(`> ${cmd} : commande inconnue. Tape HELP.`, true); return; }
      this.termKey = key;
      if (!fn) fn = TERM_FN[pane.fn].sec ? pane.fn : (sector === 'CMDTY' || TERM_SECTOR_OF(key.slice(2)) === 'CMDTY' ? 'GP' : 'DES');
    } else if (!fn) { this.termMsg(`> ${cmd} : commande inconnue. Tape HELP.`, true); return; }
    if (set) Object.assign(pane, set);
    if (range) { if (fn === 'GIP' || (fn === 'GP' && (range === '1J' || range === '5J'))) { fn = 'GIP'; pane.irange = range === '5J' ? '5J' : '1J'; } else pane.range = range; }
    pane.fn = fn;
    if (fn === 'SCAN') this.runScan();
    this.termMsg(`> ${TERM_FN[fn].sec ? this.termSym(this.termKey) + ' ' : ''}${fn} ✓  ${TERM_FN[fn].title}`);
    this.termSaveState();
    this.renderTerminal();
  },

  /** Symbole tapé → clé d'instrument (« CW8@XPAR ») ou symbole Yahoo brut (« Y:^GSPC ») */
  async termResolve(sym, sector) {
    const s = sym.replace(/\s+/g, '');
    if (s.startsWith('Y:')) return s;
    const local = Object.keys(Store.state.instruments).find(k => {
      const i = Store.instrument(k);
      return i.symbol.toUpperCase() === s || (i.ysymbol || '').toUpperCase() === s || (i.ysymbol || '').toUpperCase().split('.')[0] === s || (i.isin || '').toUpperCase() === s;
    });
    if (local && sector !== 'CURNCY' && sector !== 'CRYPTO' && sector !== 'CMDTY') return local;
    let y = null;
    const cm = TERM_CMDTY.find(x => x[0] === s + '=F' || termNorm(x[1]).split(' ')[0] === termNorm(s));
    if (sector === 'CURNCY' && /^[A-Z]{6}$/.test(s)) y = s + '=X';
    else if (sector === 'CURNCY' && /^[A-Z]{3}$/.test(s)) y = (s === 'EUR' ? 'EURUSD' : 'EUR' + s) + '=X';
    else if (sector === 'CRYPTO') y = s.includes('-') ? s : s + '-USD';
    else if (TERM_ALIAS[s]) y = TERM_ALIAS[s];
    else if (sector === 'CMDTY' && cm) y = cm[0];
    else if (sector === 'CMDTY' && /^[A-Z]{1,3}$/.test(s)) y = s + '=F';
    else if (/^[A-Z]{6}$/.test(s) && TERM_CCY.includes(s.slice(0, 3)) && TERM_CCY.includes(s.slice(3))) y = s + '=X';
    else if (sector === 'INDEX' && !s.startsWith('^')) y = '^' + s;
    if (y && termName(y) !== y) return 'Y:' + y;
    if (!Api.hasProxy()) return y ? 'Y:' + y : null;
    for (const cand of [y, s].filter(Boolean)) {
      try { const q = await Api.yahooSymbol(cand); if (q && q.price > 0) return 'Y:' + cand; } catch (e) { /* suivant */ }
    }
    return null;
  },

  /* ---------- données ---------- */

  termQuote(key) { return key && key.startsWith('Y:') ? this.idxQuote(key.slice(2)) : Api.cachedQuote(key); },
  termSym(key) {
    if (!key) return '—';
    if (key.startsWith('Y:')) { const y = key.slice(2); return TERM_SHORT[y] || y.replace(/=X$/, '').replace(/^\^/, ''); }
    const i = Store.instrument(key); return i ? i.symbol : key;
  },
  termLabel(key) {
    if (!key) return '';
    if (key.startsWith('Y:')) { const q = this.termQuote(key), n = termName(key.slice(2)); return n !== key.slice(2) ? n : (q && q.name) || n; }
    return Store.label(key);
  },
  termCcy(key) {
    if (key && key.startsWith('Y:')) { const q = this.termQuote(key); return (q && q.currency) || ''; }
    const i = Store.instrument(key); return i ? i.currency : '';
  },
  termYsym(key) {
    if (!key) return null;
    if (key.startsWith('Y:')) return key.slice(2);
    const i = Store.instrument(key);
    return i && !Manual.is(key) ? yahooSymbolFor(i) : null;
  },

  /** Charge en arrière-plan les cours Yahoo manquants ou anciens (> 60 s), puis réaffiche */
  termNeed(syms) {
    if (!Api.hasProxy()) return;
    this._termLoaded = this._termLoaded || {};
    const now = Date.now();
    const todo = Array.from(new Set(syms)).filter(y => !(this._termLoaded[y] > now - 60000));
    if (!todo.length) return;
    for (const y of todo) this._termLoaded[y] = now;
    (async () => {
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(y => Api.yahooSymbol(y).catch(() => null)));
        if (!this.termOn) return;
        this.termSoon();
      }
    })();
  },
  termNeedKey(key) {
    if (!key) return;
    if (key.startsWith('Y:')) this.termNeed([key.slice(2)]);
    else if (!Api.cachedQuote(key) && Api.ready() && !(this._termQ || {})[key]) {
      (this._termQ = this._termQ || {})[key] = 1;
      Api.quote(key).then(() => this.termSoon()).catch(() => {});
    }
  },
  termSoon() { clearTimeout(this._termSoonT); this._termSoonT = setTimeout(() => { if (this.termOn) this.renderTerminal(); }, 250); },

  /** Historique journalier [[date, clôture]] (5 ans, ou plus), cours en direct ajouté pour aujourd'hui */
  async termSeries(key, years = 5) {
    const bars = await this.termOhlc(key, years > 5 ? 'MAX' : years > 2 ? '5A' : years > 1 ? '2A' : '1A');
    const from = addDaysISO(todayISO(), -Math.round(365.25 * years) - 7);
    return bars.filter(b => b.d >= from).map(b => [b.d, b.c]);
  },

  /** Début d'une période (date ISO) */
  termRangeStart(range) {
    const t = todayISO();
    return { '1M': addDaysISO(t, -31), '3M': addDaysISO(t, -92), '6M': addDaysISO(t, -183), YTD: t.slice(0, 4) + '-01-01', '1A': addDaysISO(t, -366), '2A': addDaysISO(t, -731),
      '5A': addDaysISO(t, -1827), '10A': addDaysISO(t, -3653), MAX: '1970-01-01' }[range] || addDaysISO(t, -366);
  },

  /**
   * Bougies [{ d, t, o, h, l, c, v }] d'une valeur : journalières (avec ~14 mois d'avance pour la moyenne 200 jours)
   * ou intraday (« 1J » en 5 min, « 5J » en 15 min). Yahoo si possible, sinon clôtures seules (o = h = l = c).
   */
  async termOhlc(key, range) {
    this._termOhlc = this._termOhlc || {};
    const intraday = range === '1J' || range === '5J';
    const ysym = this.termYsym(key);
    if (intraday) {
      const ck = key + '|' + range, c = this._termOhlc[ck];
      if (c && Date.now() - c.ts < 60000) return c.bars;
      let bars = [];
      if (ysym && Api.hasProxy()) {
        const json = await Api.yahoo({ type: 'chart', symbol: ysym, range: range === '1J' ? '1d' : '5d', interval: range === '1J' ? '5m' : '15m' });
        bars = termParseBars(json, true, range === '5J');
      } else if (!key.startsWith('Y:')) {
        bars = (await Api.chartSeries(key, range)).map(([d, c2]) => ({ d, t: 0, o: c2, h: c2, l: c2, c: c2, v: 0 }));
      }
      this._termOhlc[ck] = { ts: Date.now(), bars };
      return bars;
    }
    const from = range === 'MAX' ? '1970-01-01' : addDaysISO(this.termRangeStart(range), -420);
    const c = this._termOhlc[key];
    if (c && c.from <= from && Date.now() - c.ts < 15 * 60000) return c.bars;
    let bars = [];
    if (ysym && Api.hasProxy()) {
      try {
        const json = await Api.yahoo({ type: 'chart', symbol: ysym, interval: '1d', period1: Math.max(0, Math.floor(Date.parse(from + 'T00:00:00Z') / 1000)), period2: Math.floor(Date.now() / 1000) + 86400 });
        bars = termParseBars(json, false);
      } catch (e) { if (key.startsWith('Y:')) throw e; }
    }
    if (!bars.length && !key.startsWith('Y:')) bars = (await Api.daily(key, from)).map(([d, c2]) => ({ d, t: 0, o: c2, h: c2, l: c2, c: c2, v: 0 }));
    // cours en direct pour la séance du jour
    const q = this.termQuote(key);
    if (q && q.price > 0 && bars.length) {
      const last = bars[bars.length - 1];
      if (last.d === todayISO()) Object.assign(last, { c: q.price, h: Math.max(last.h, q.price), l: Math.min(last.l, q.price) });
      else if (last.d < todayISO() && q.time && new Date(q.time).toISOString().slice(0, 10) === todayISO()) bars.push({ d: todayISO(), t: q.time, o: isFinite(q.open) ? q.open : last.c, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: q.volume || 0 });
    }
    this._termOhlc[key] = { ts: Date.now(), from, bars };
    return bars;
  },

  /* ---------- rendu ---------- */

  renderTermClock() {
    const c = $('#termClock');
    if (!c) return;
    const now = Date.now();
    const d = new Date(now);
    const ex = ['newyork', 'london', 'paris', 'xetra', 'tokyo', 'hongkong'].map(id => EXCHANGES.find(e => e.id === id)).filter(Boolean);
    c.replaceChildren(el('span', { class: 'term-date' }, d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()),
      el('b', {}, d.toLocaleTimeString('fr-FR')), ...ex.map(e => {
        const st = Markets.status(e, now), t = st.localTime;
        return el('span', { class: 'term-mkt ' + st.state, title: e.name + ' : ' + Markets.summary(st, now) }, TERM_CITY[e.id] || e.city.slice(0, 3).toUpperCase(), ' ', `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`);
      }));
  },

  renderTermStatus() {
    const s = $('#termStatus'), pr = $('#termPrompt');
    if (!s) return;
    const p = this.termPanes[this.termActive];
    if (pr) pr.textContent = `${this.termActive + 1}<`;
    const relay = Api.hasProxy() ? el('span', { class: 'tu' }, '● RELAIS EN LIGNE') : el('span', { class: 'td' }, '● RELAIS HORS LIGNE');
    const nq = Object.keys(Api.quotes || {}).length;
    s.replaceChildren(el('span', {}, `FENÊTRE ${this.termActive + 1}${this.termZoom >= 0 ? ' (ZOOM)' : ''}`), el('span', {}, `${p.fn}`), el('span', {}, 'VALEUR ', el('b', {}, this.termSym(this.termKey))), relay,
      el('span', {}, `${nq} COTATIONS`), el('span', { class: 'term-hint' }, 'TAB COMPLÉTER · ↑↓ HISTORIQUE · ALT+1…4 FENÊTRE · ALT+Z ZOOM · LAY 1-6 · F1 AIDE'));
  },

  renderTerminal() {
    const T = $('#term');
    if (!T || !this.termOn) return;
    if (!this.termPanes) this.termLoadState();
    const pc = v => (v >= 0 ? 'tu' : 'td');
    // bandeau défilant : tes valeurs, indices, matières premières, devises, crypto, taux
    const items = [];
    for (const k of Store.trackedKeys()) { const q = Api.cachedQuote(k); if (q && q.price > 0) items.push([Store.instrument(k).symbol, q.price, q.percentChange]); }
    const ys = [...MACRO.map(m => m.y), ...EXCHANGES.map(e => e.index.y), 'GC=F', 'SI=F', 'CL=F', 'NG=F', 'HG=F', 'ZW=F', 'KC=F', 'CC=F', 'BTC-USD', 'ETH-USD', '^TNX', 'DX-Y.NYB'];
    for (const y of new Set(ys)) { const q = this.idxQuote(y); if (q && q.price > 0) items.push([TERM_SHORT[y] || termName(y), q.price, q.percentChange]); }
    const tape = items.map(([n, p, ch]) => el('span', { class: 'term-tk' }, el('b', {}, n), ' ', fmtNum(p, p < 10 ? 4 : 2), ' ', el('span', { class: pc(ch) }, (ch >= 0 ? '▲' : '▼') + fmtNum(Math.abs(ch || 0), 2) + '%')));
    $('#termTape').replaceChildren(el('div', { class: 'term-tape-in' }, ...tape, ...tape.map(n => n.cloneNode(true))));
    // fenêtres
    const grid = $('#termGrid');
    if (grid.children.length !== 4) {
      grid.replaceChildren(...[0, 1, 2, 3].map(i => el('section', { class: 'tp', dataset: { i }, onmousedown: () => { if (this.termActive !== i) this.termFocus(i); } },
        el('header', { class: 'tp-bar', title: 'Double-clic : agrandir / réduire', ondblclick: () => this.termToggleZoom(i) }), el('nav', { class: 'tp-acts' }), el('div', { class: 'tp-body' }))));
    }
    this.termPanes.forEach((p, i) => this.renderTermPane(i));
    $$('#termGrid .tp').forEach((p, j) => { p.classList.toggle('on', j === this.termActive); p.classList.toggle('zoom', j === this.termZoom); });
    grid.classList.toggle('zoomed', this.termZoom >= 0);
    this.renderTermClock();
    this.renderTermStatus();
  },

  /** Actions numérotées (menu rouge) de la fenêtre i */
  termActs(i) {
    const p = this.termPanes[i], F = TERM_FN[p.fn];
    const re = () => { this.termSaveState(); this.renderTermPane(i); this.renderTermStatus(); };
    const go = fn => () => { p.fn = fn; re(); };
    const opt = (k, v, label) => ({ label: label || v, on: p[k] === v, run: () => { p[k] = v; re(); } });
    if (p.fn === 'GP') return ['1M', '3M', '6M', 'YTD', '1A', '2A', '5A', 'MAX'].map(r => opt('range', r)).concat([{ label: 'GIP', run: go('GIP') }]);
    if (p.fn === 'GIP') return [opt('irange', '1J'), opt('irange', '5J'), { label: 'GP', run: go('GP') }, { label: 'DES', run: go('DES') }, { label: 'HP', run: go('HP') }];
    if (p.fn === 'COMP') return ['1M', '3M', '6M', 'YTD', '1A', '2A', '5A', '10A', 'MAX'].map(r => opt('range', r));
    if (p.fn === 'HP') return [opt('per', 'J', 'JOUR'), opt('per', 'S', 'SEMAINE'), opt('per', 'M', 'MOIS'), { label: 'GP', run: go('GP') }, { label: 'DES', run: go('DES') }];
    if (F.sec) return ['DES', 'GP', 'GIP', 'HP', 'DVD', 'NEWS'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
    if (['WEI', 'WMAP', 'FX', 'CMDTY', 'CMAP', 'CRYPTO', 'GOVT', 'MOV'].includes(p.fn)) return ['WEI', 'WMAP', 'FX', 'CMDTY', 'CMAP', 'CRYPTO', 'GOVT', 'MOV'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
    if (['RSK', 'CORR', 'XRAY'].includes(p.fn)) return ['RSK', 'CORR', 'COMP', 'XRAY'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
    if (['TOP', 'CAL', 'ALRT', 'BLT', 'CLK'].includes(p.fn)) return ['TOP', 'CAL', 'ALRT', 'BLT', 'CLK'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
    return ['PORT', 'MON', 'HEAT', 'SCAN', 'XRAY', 'BLT'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
  },

  renderTermPane(i) {
    const node = $$('#termGrid .tp')[i];
    if (!node) return;
    const p = this.termPanes[i], F = TERM_FN[p.fn];
    const [bar, acts, body] = node.children;
    const key = this.termKey;
    this._termCharts = this._termCharts || {};
    if (!F.chart && this._termCharts[i]) { this._termCharts[i].destroy(); delete this._termCharts[i]; }
    termFill(bar, el('span', { class: 'tp-n' }, String(i + 1)),
      el('span', { class: 'tp-fn' }, p.fn), F.sec ? el('span', { class: 'tp-sec' }, this.termSym(key), ' ', el('i', {}, this.termCcy(key))) : null,
      el('span', { class: 'tp-title' }, F.sec ? this.termLabel(key) : F.title));
    acts.replaceChildren(...this.termActs(i).map((a, k) => el('button', { type: 'button', class: a.on ? 'on' : '', onclick: e => { e.stopPropagation(); this.termFocus(i); a.run(); } }, el('b', {}, `${k + 1})`), ' ', a.label)));
    // fenêtres lentes à construire : pas de reconstruction à chaque cotation reçue (garde le défilement)
    const sig = `${p.fn}|${F.sec ? key : ''}|${p.range}|${p.per}|${p.q || ''}|${(p.list || []).join(',')}|${F.sec && this.termQuote(key) ? 1 : 0}`;
    const fresh = F.sticky && body.dataset.sig === sig && Date.now() - (+body.dataset.at || 0) < F.sticky * 1000;
    if (fresh) return;
    if (body.dataset.sig !== sig) body.scrollTop = 0;
    body.dataset.sig = sig; body.dataset.at = Date.now();
    body.classList.toggle('tp-chart', !!F.chart);
    try { F.render.call(this, body, p, i); }
    catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Erreur : ' + e.message)); }
  },

  /* tableaux de cotations (WEI, FX, CMDTY…) */
  termQuoteTable(rows, cols = ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS']) {
    const pc = v => (!isFinite(v) || v === 0 ? '' : v > 0 ? 'tu' : 'td');
    return el('table', { class: 'term-t' },
      el('thead', {}, el('tr', {}, el('th', {}, ''), ...cols.map(c => el('th', { class: c === 'UNITÉ' ? '' : 'n' }, c)))),
      el('tbody', {}, ...rows.map(r => {
        if (r.group) return el('tr', { class: 'grp' }, el('td', { colspan: cols.length + 1 }, r.group));
        const q = this.termQuote(r.key), d = r.digits ?? (q && q.price < 10 ? 4 : 2);
        const vals = {
          'DERNIER': q ? fmtNum(q.price, d) : '…', 'VAR': q ? (q.change > 0 ? '+' : '') + fmtNum(q.change, d) : '', 'VAR %': q ? fmtPct(q.percentChange, 2) : '',
          'HAUT': q ? fmtNum(q.high, d) : '', 'BAS': q ? fmtNum(q.low, d) : '', 'HEURE': q && q.time ? new Date(q.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
          'UNITÉ': r.unit || '', 'JOUR': q && q.spark && q.spark.length > 2 ? termSpark(q.spark, q.previousClose) : '',
          '52 SEM.': q && q.high52 > q.low52 ? termRange52(q) : '',
        };
        return el('tr', { class: r.key === this.termKey ? 'sel' : '', onclick: () => this.termLoad(r.key, r.open) },
          el('td', {}, r.dot ? el('span', { class: 'term-dot ' + r.dot }) : null, el('b', {}, r.label)),
          ...cols.map(c => el('td', { class: (c === 'UNITÉ' ? 'dim' : 'n') + (c.startsWith('VAR') && q ? ' ' + pc(q.change) : '') }, vals[c] ?? '')));
      })));
  },

  /** Clic sur une ligne : charge la valeur ; les fenêtres « valeur » l'affichent (une fenêtre passe en `open` si aucune) */
  termLoad(key, open) {
    this.termKey = key;
    this.termNeedKey(key);
    if (!this.termPanes.some(p => TERM_FN[p.fn].sec)) this.termPanes[this.termActive === 3 ? 1 : 3].fn = open || 'DES';
    this.termSaveState();
    this.renderTerminal();
  },

  /** Mosaïque colorée selon la variation du jour (WMAP, CMAP) */
  termTiles(groups) {
    return el('div', { class: 'tmap' }, ...groups.map(g => el('div', { class: 'tmap-g' }, el('h4', { class: 'tp-sub' }, g.name),
      el('div', { class: 'tmap-tiles' }, ...g.items.map(([y, n]) => {
        const q = this.idxQuote(y), ch = q ? q.percentChange : NaN, a = isFinite(ch) ? Math.min(1, Math.abs(ch) / 2.5) : 0;
        return el('div', { class: 'term-tile', onclick: () => this.termLoad('Y:' + y, 'GP'),
          style: `background:${!isFinite(ch) ? '#151515' : ch >= 0 ? `rgba(0,200,120,${0.18 + a * 0.62})` : `rgba(255,70,70,${0.18 + a * 0.62})`}` },
        el('b', {}, TERM_SHORT[y] || n), el('span', {}, isFinite(ch) ? fmtPct(ch, 2) : '…'), el('span', { class: 'dim' }, q ? fmtNum(q.price, q.price < 10 ? 4 : 2) : ''));
      })))));
  },

  /* ---------- graphiques (chandeliers, barres, ligne…) ---------- */

  termChartTools(p, i) {
    const re = () => { this.termSaveState(); this.renderTermPane(i); };
    const b = (label, on, run, title) => el('button', { type: 'button', class: on ? 'on' : '', title: title || label, onclick: e => { e.stopPropagation(); run(); re(); } }, label);
    const intraday = p.fn === 'GIP';
    return el('div', { class: 'tc-tools' },
      ...[['candle', 'BOUGIES', 'Chandeliers japonais'], ['ohlc', 'BARRES', 'Barres OHLC'], ['heikin', 'H-A', 'Heikin-Ashi (bougies lissées)'], ['line', 'LIGNE'], ['area', 'AIRE']]
        .map(([s, l, t]) => b(l, p.style === s, () => { p.style = s; }, t)),
      el('span', { class: 'sep' }),
      ...(intraday ? [] : [['auto', 'AUTO'], ['J', 'J'], ['S', 'S'], ['M', 'M']].map(([v, l]) => b(l, p.per === v, () => { p.per = v; }, { auto: 'Périodicité automatique', J: 'Bougies journalières', S: 'Bougies hebdomadaires', M: 'Bougies mensuelles' }[v]))),
      intraday ? null : el('span', { class: 'sep' }),
      ...[['ma', 'MM', 'Moyennes mobiles 20 / 50 / 200'], ['bb', 'BB', 'Bandes de Bollinger 20, 2σ'], ['vol', 'VOL', 'Volume'], ['rsi', 'RSI', 'RSI 14'], ['macd', 'MACD', 'MACD 12 / 26 / 9']]
        .map(([k, l, t]) => b(l, p.st[k], () => { p.st[k] = !p.st[k]; }, t)),
      el('span', { class: 'sep' }), b('LOG', p.log, () => { p.log = !p.log; }, 'Échelle logarithmique'),
      el('span', { class: 'tc-help dim' }, 'MOLETTE : ZOOM · GLISSER : DÉPLACER · DOUBLE-CLIC : RÉINIT.'));
  },

  async renderTermCandle(i, body, key, p) {
    const intraday = p.fn === 'GIP';
    const range = intraday ? p.irange : p.range;
    let wrap = body.querySelector('.tc-wrap[data-kind="gp"]');
    if (!wrap) {
      body.replaceChildren(el('div', { class: 'tc-tools-slot' }), el('div', { class: 'tc-wrap', dataset: { kind: 'gp' } }, el('canvas', { id: 'termChart' + i, class: 'tc-cv' })), el('div', { class: 'tc-msg dim' }));
      wrap = body.querySelector('.tc-wrap');
    }
    body.querySelector('.tc-tools-slot').replaceChildren(this.termChartTools(p, i));
    const cv = wrap.querySelector('canvas');
    let ch = this._termCharts[i];
    if (!ch || ch.cv !== cv) { if (ch) ch.destroy(); ch = this._termCharts[i] = new TermChart(cv); }
    const want = `${key}|${range}`;
    const per = intraday ? 'J' : p.per === 'auto' ? ({ '5A': 'S', '10A': 'S', MAX: 'M' }[range] || 'J') : p.per;
    const look = `${want}|${per}|${p.style}|${JSON.stringify(p.st)}|${p.log}`;
    const msg = body.querySelector('.tc-msg');
    if (ch.look === look && ch.data) {
      // même graphique : seul le dernier cours bouge, la vue (zoom) est gardée
      const q = this.termQuote(key), last = ch.data.bars[ch.data.bars.length - 1];
      if (q && q.price > 0 && last && !intraday && last.c !== q.price && last.d === todayISO()) { Object.assign(last, { c: q.price, h: Math.max(last.h, q.price), l: Math.min(last.l, q.price) }); ch.prep(); ch.redraw(); }
      return;
    }
    if (ch.want !== want) msg.textContent = 'Chargement des cours…';
    ch.want = want;
    let bars;
    try { bars = await this.termOhlc(key, range); }
    catch (e) { if (ch.want === want) msg.textContent = 'Historique indisponible : ' + e.message; return; }
    if (!this.termOn || ch.want !== want || this._termCharts[i] !== ch) return;
    if (!bars.length) { msg.textContent = 'Pas d\'historique pour cette valeur.'; return; }
    msg.textContent = bars.every(b => b.o === b.c && b.h === b.c) ? 'Clôtures seules (pas de cours d\'ouverture, haut et bas pour cette valeur) : les bougies sont plates, préfère LIGNE.' : '';
    const series = intraday ? bars : TA.resample(bars, per);
    const start = this.termRangeStart(range);
    let from = intraday ? 0 : series.findIndex(b => (b.dEnd || b.d) >= start);
    if (from < 0) from = Math.max(0, series.length - 30);
    ch.look = look;
    ch.set({ bars: series, style: p.style, studies: p.st, log: p.log, intraday, unit: per, from, digits: (series[series.length - 1].c < 10 ? 4 : 2) });
  },

  async renderTermComp(i, body, p) {
    const keys = (p.list && p.list.length ? p.list : [this.termKey, 'Y:^GSPC', 'Y:^STOXX50E', 'Y:GC=F']).filter((k, j, a) => k && a.indexOf(k) === j).slice(0, 8);
    let wrap = body.querySelector('.tc-wrap[data-kind="comp"]');
    if (!wrap) {
      body.replaceChildren(el('div', { class: 'tp-qline dim' }, 'COMP ', el('span', { class: 'tc-keys' })), el('div', { class: 'tc-wrap', dataset: { kind: 'comp' } }, el('canvas', { id: 'termChart' + i, class: 'tc-cv' })), el('div', { class: 'tc-msg dim' }), el('div', { class: 'tc-table' }));
      wrap = body.querySelector('.tc-wrap');
    }
    body.querySelector('.tc-keys').textContent = keys.map(k => this.termSym(k)).join(' · ') + '   (COMP SPX CAC DAX … pour changer)';
    const cv = wrap.querySelector('canvas');
    let ch = this._termCharts[i];
    if (!ch || ch.cv !== cv) { if (ch) ch.destroy(); ch = this._termCharts[i] = new TermChart(cv); }
    const look = keys.join(',') + '|' + p.range;
    if (ch.look === look && ch.data) return;
    ch.look = look;
    body.querySelector('.tc-msg').textContent = 'Chargement…';
    const all = await Promise.all(keys.map(k => this.termOhlc(k, p.range === 'MAX' || p.range === '10A' ? 'MAX' : '5A').catch(() => [])));
    if (ch.look !== look || this._termCharts[i] !== ch) return;
    const dates = Array.from(new Set(all.flatMap(b => b.map(x => x.d)))).sort();
    const start = this.termRangeStart(p.range);
    const lines = all.map((b, k) => {
      const m = new Map(b.map(x => [x.d, x.c]));
      let last = null;
      return { label: this.termSym(keys[k]), color: TC_SERIES[k % TC_SERIES.length], data: dates.map(d => { if (m.has(d)) last = m.get(d); return last; }) };
    });
    const from = Math.max(0, dates.findIndex(d => d >= start));
    body.querySelector('.tc-msg').textContent = all.some(b => !b.length) ? 'Historique indisponible pour : ' + keys.filter((k, j) => !all[j].length).map(k => this.termSym(k)).join(', ') : '';
    ch.set({ lines, labels: dates, from });
    // tableau : performance, volatilité, pire baisse sur la période
    const stats = lines.map((s, k) => {
      const v = s.data.slice(from).filter(x => x > 0);
      if (v.length < 3) return null;
      const r = v.slice(1).map((x, j) => Math.log(x / v[j]));
      const mu = r.reduce((a, b) => a + b, 0) / r.length;
      let pk = -Infinity, dd = 0;
      for (const x of v) { pk = Math.max(pk, x); dd = Math.min(dd, x / pk - 1); }
      return { k, perf: (v[v.length - 1] / v[0] - 1) * 100, vol: Math.sqrt(r.reduce((a, x) => a + (x - mu) ** 2, 0) / Math.max(1, r.length - 1) * 252) * 100, dd: dd * 100 };
    }).filter(Boolean).sort((a, b) => b.perf - a.perf);
    body.querySelector('.tc-table').replaceChildren(el('table', { class: 'term-t' },
      el('thead', {}, el('tr', {}, ...['VALEUR', 'PERF ' + p.range, 'VOLAT. AN.', 'PIRE BAISSE'].map((h, j) => el('th', { class: j ? 'n' : '' }, h)))),
      el('tbody', {}, ...stats.map(s => el('tr', { onclick: () => this.termLoad(keys[s.k], 'GP') },
        el('td', {}, el('span', { class: 'sw', style: `background:${TC_SERIES[s.k % TC_SERIES.length]}` }), el('b', {}, this.termSym(keys[s.k])), ' ', el('span', { class: 'dim' }, this.termLabel(keys[s.k]))),
        el('td', { class: 'n ' + (s.perf >= 0 ? 'tu' : 'td') }, fmtPct(s.perf, 1)), el('td', { class: 'n' }, fmtNum(s.vol, 1) + '%'), el('td', { class: 'n td' }, fmtPct(s.dd, 1)))))));
  },

  /* ---------- fiches et tableaux asynchrones ---------- */

  async renderTermDes(body, key) {
    const q = this.termQuote(key), cur = this.base();
    const d = q && q.price < 10 ? 4 : 2;
    const pos = key.startsWith('Y:') ? null : Portfolio.snapshot('all').rows.find(r => r.key === key);
    const inst = key.startsWith('Y:') ? null : Store.instrument(key);
    const kv = (k, v, cls) => el('div', { class: 'kv' }, el('span', {}, k), el('b', { class: cls || '' }, v));
    const box = el('div', { class: 'des' },
      el('div', { class: 'des-head' }, el('b', { class: 'big' }, q ? fmtNum(q.price, d) : '…'), ' ', q ? el('span', { class: q.change >= 0 ? 'tu' : 'td' }, `${q.change >= 0 ? '+' : ''}${fmtNum(q.change, d)}  ${fmtPct(q.percentChange, 2)}`) : '',
        el('span', { class: 'dim' }, `  ${this.termCcy(key)}  ${q && q.datetime ? q.datetime : ''}`)),
      el('div', { class: 'des-cols' },
        termFill(el('div'), el('h4', {}, '1) PROFIL'),
          kv('NOM', this.termLabel(key)), kv('TICKER', this.termSym(key)), kv('SECTEUR', key.startsWith('Y:') ? TERM_SECTOR_OF(key.slice(2)) : (inst.type || 'TITRE').toUpperCase()),
          kv('PLACE', (inst && (inst.exchange || inst.mic)) || (q && q.exchange) || '—'),
          inst && inst.isin ? kv('ISIN', inst.isin) : null, kv('DEVISE', this.termCcy(key) || '—'),
          TERM_UNIT[key.slice(2)] ? kv('UNITÉ', TERM_UNIT[key.slice(2)]) : null,
          q ? kv('OUVERTURE', fmtNum(q.open, d)) : null, q ? kv('HAUT / BAS', `${fmtNum(q.high, d)} / ${fmtNum(q.low, d)}`) : null,
          q && q.previousClose ? kv('CLÔTURE VEILLE', fmtNum(q.previousClose, d)) : null,
          q && q.volume ? kv('VOLUME', fmtNum(q.volume, 0)) : null,
          q && q.spark && q.spark.length > 2 ? el('div', { class: 'des-spark' }, el('span', { class: 'dim small' }, 'SÉANCE'), termSpark(q.spark, q.previousClose, 220, 40)) : null),
        el('div', { class: 'des-tech' }, el('h4', {}, '2) PERFORMANCE & RISQUE'), el('p', { class: 'dim' }, 'Calcul…'))),
      pos && pos.qty > 0 ? el('div', { class: 'des-pos' }, el('h4', {}, '3) TA POSITION'),
        el('div', { class: 'des-grid' }, kv('QUANTITÉ', fmtQty(pos.qty)), kv('PRU', fmtNum(pos.pru, 2)), kv('VALEUR', fmtMoney(pos.valueBase, cur, 0)),
          kv('+/- VALUE', `${fmtSignedMoney(pos.pnl * pos.fx, cur)} (${fmtPct(pos.pnlPct, 1)})`, pos.pnl >= 0 ? 'tu' : 'td'), kv('JOUR', isFinite(pos.dayBase) ? fmtSignedMoney(pos.dayBase, cur) : '—', pos.dayBase >= 0 ? 'tu' : 'td'))) : null);
    termFill(body, box);
    let s;
    try { s = await this.termSeries(key, 5); } catch (e) { s = []; }
    const tech = box.querySelector('.des-tech');
    if (!tech.isConnected || this.termKey !== key) return;
    if (s.length < 30) { tech.replaceChildren(el('h4', {}, '2) PERFORMANCE & RISQUE'), el('p', { class: 'dim' }, 'Historique indisponible.')); return; }
    const a = Scan.analyze(s) || {};
    const last = s[s.length - 1][1];
    const perf = from => { const j = s.findIndex(v => v[0] >= from); return j >= 0 ? (last / s[j][1] - 1) * 100 : NaN; };
    const yr = s.filter(v => v[0] >= addDaysISO(todayISO(), -366)).map(v => v[1]);
    const rets = yr.slice(1).map((c, j) => Math.log(c / yr[j]));
    const mu = rets.reduce((x, y) => x + y, 0) / (rets.length || 1);
    const vol = Math.sqrt(rets.reduce((x, r) => x + (r - mu) ** 2, 0) / Math.max(1, rets.length - 1) * 252) * 100;
    let pk = -Infinity, dd = 0;
    for (const c of yr) { pk = Math.max(pk, c); dd = Math.min(dd, c / pk - 1); }
    const pcls = v => (v >= 0 ? 'tu' : 'td');
    const rng = a.hi52 > a.lo52 ? (last - a.lo52) / (a.hi52 - a.lo52) * 100 : 50;
    termFill(tech, el('h4', {}, '2) PERFORMANCE & RISQUE'),
      el('div', { class: 'des-perf' }, ...[['1S', -7], ['1M', -31], ['3M', -92], ['6M', -183], ['YTD', null], ['1A', -366], ['3A', -1096], ['5A', -1827]].map(([l, dd2]) => {
        const v = perf(dd2 === null ? todayISO().slice(0, 4) + '-01-01' : addDaysISO(todayISO(), dd2));
        return el('div', {}, el('span', {}, l), el('b', { class: isFinite(v) ? pcls(v) : 'dim' }, isFinite(v) ? fmtPct(v, 1) : '—'));
      })),
      el('div', { class: 'des-range' }, el('span', {}, fmtNum(a.lo52, d)), el('div', { class: 'bar' }, el('i', { style: `left:${Math.max(0, Math.min(100, rng))}%` })), el('span', {}, fmtNum(a.hi52, d))),
      el('div', { class: 'dim small' }, 'FOURCHETTE 52 SEMAINES'),
      kv('RSI 14', fmtNum(a.rsi, 0), a.rsi >= 70 || a.rsi <= 30 ? 'warn' : ''), kv('VS MM 50', isFinite(a.sma50) ? fmtPct((last / a.sma50 - 1) * 100, 1) : '—', pcls(last - a.sma50)),
      kv('VS MM 200', isFinite(a.sma200) ? fmtPct((last / a.sma200 - 1) * 100, 1) : '—', pcls(last - a.sma200)),
      kv('VOLATILITÉ 1A', fmtNum(vol, 1) + ' %'), kv('PIRE BAISSE 1A', fmtPct(dd * 100, 1), 'td'), kv('VS PLUS HAUT HIST.', fmtPct(a.fromAth * 100, 1), pcls(a.fromAth + 1e-9)),
      a.signals && a.signals.length ? el('ul', { class: 'term-sig' }, ...a.signals.slice(0, 3).map(sg => el('li', { class: 'lv-' + sg.level }, '■ ', sg.text))) : null);
  },

  async renderTermHp(body, key, p) {
    if (!body.querySelector('table')) body.replaceChildren(el('p', { class: 'dim' }, 'Chargement de l\'historique…'));
    let bars;
    try { bars = await this.termOhlc(key, p.per === 'M' ? '5A' : '2A'); } catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Historique indisponible : ' + e.message)); return; }
    if (!body.isConnected || this.termKey !== key) return;
    const per = p.per === 'S' || p.per === 'M' ? p.per : 'J';
    const rows = TA.resample(bars, per).slice(-61);
    if (rows.length < 2) { body.replaceChildren(el('p', { class: 'dim' }, 'Historique indisponible.')); return; }
    const d = rows[rows.length - 1].c < 10 ? 4 : 2, f = v => fmtNum(v, d);
    const cl = rows.map(b => b.c);
    const out = [];
    for (let j = rows.length - 1; j >= 1; j--) out.push([rows[j], (rows[j].c / rows[j - 1].c - 1) * 100]);
    const hasV = rows.some(b => b.v > 0), flat = rows.every(b => b.o === b.c && b.h === b.c);
    const lbl = b => (per === 'M' ? new Date(b.d + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }).toUpperCase()
      : new Date(b.d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: per === 'J' ? 'short' : undefined, day: '2-digit', month: '2-digit', year: '2-digit' }).toUpperCase());
    body.replaceChildren(
      el('div', { class: 'tp-qline dim' }, `${out.length} ${{ J: 'SÉANCES', S: 'SEMAINES', M: 'MOIS' }[per]} · HAUT ${f(Math.max(...rows.map(b => b.h)))} · BAS ${f(Math.min(...rows.map(b => b.l)))} · MOY ${f(cl.reduce((a, b) => a + b, 0) / cl.length)} · VAR ${fmtPct((cl[cl.length - 1] / cl[0] - 1) * 100, 2)}`),
      el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['DATE', ...(flat ? [] : ['OUV.', 'HAUT', 'BAS']), 'CLÔT.', 'VAR %', ...(hasV ? ['VOLUME'] : [])].map((h, j) => el('th', { class: j ? 'n' : '' }, h)))),
        el('tbody', {}, ...out.map(([b, pct]) => el('tr', {}, el('td', {}, lbl(b)),
          ...(flat ? [] : [el('td', { class: 'n' }, f(b.o)), el('td', { class: 'n' }, f(b.h)), el('td', { class: 'n' }, f(b.l))]),
          el('td', { class: 'n' }, el('b', {}, f(b.c))), el('td', { class: 'n ' + (pct >= 0 ? 'tu' : 'td') }, fmtPct(pct, 2)),
          ...(hasV ? [el('td', { class: 'n' }, b.v ? fmtNum(b.v, 0) : '—')] : []))))));
  },

  async renderTermDvd(body, key) {
    const ysym = this.termYsym(key);
    if (!ysym || !Api.hasProxy()) { body.replaceChildren(el('p', { class: 'dim' }, 'Dividendes indisponibles pour cette valeur (relais Yahoo requis).')); return; }
    body.replaceChildren(el('p', { class: 'dim' }, 'Chargement des dividendes…'));
    let json;
    try { json = await Api.yahoo({ type: 'chart', symbol: ysym, interval: '1mo', events: 'div,split', period1: Math.floor(Date.parse(addDaysISO(todayISO(), -3653) + 'T00:00:00Z') / 1000), period2: Math.floor(Date.now() / 1000) + 86400 }); }
    catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Dividendes indisponibles : ' + e.message)); return; }
    if (!body.isConnected || this.termKey !== key) return;
    const r = json.chart && json.chart.result && json.chart.result[0];
    const ev = (r && r.events) || {};
    const divs = Object.values(ev.dividends || {}).map(x => ({ d: new Date(x.date * 1000).toISOString().slice(0, 10), a: x.amount })).filter(x => x.a > 0).sort((a, b) => (a.d < b.d ? 1 : -1));
    const splits = Object.values(ev.splits || {}).map(x => ({ d: new Date(x.date * 1000).toISOString().slice(0, 10), r: `${x.numerator}:${x.denominator}` }));
    const ccy = (r && r.meta && r.meta.currency) || this.termCcy(key);
    if (!divs.length) { termFill(body, el('p', { class: 'dim' }, 'Aucun dividende versé sur 10 ans (valeur de capitalisation, indice ou matière première).'), splits.length ? el('p', {}, 'Divisions : ' + splits.map(s => s.d + ' (' + s.r + ')').join(', ')) : null); return; }
    const byYear = {};
    for (const x of divs) byYear[x.d.slice(0, 4)] = (byYear[x.d.slice(0, 4)] || 0) + x.a;
    const q = this.termQuote(key);
    const last12 = divs.filter(x => x.d >= addDaysISO(todayISO(), -366)).reduce((s, x) => s + x.a, 0);
    const years = Object.keys(byYear).sort().reverse(), maxY = Math.max(...Object.values(byYear));
    termFill(body,
      el('div', { class: 'tp-qline' }, 'DIVIDENDE 12 MOIS ', el('b', {}, fmtNum(last12, 4) + ' ' + ccy), q && q.price > 0 ? ['   RENDEMENT ', el('b', { class: 'tu' }, fmtNum(last12 / q.price * 100, 2) + ' %')] : '', `   ${divs.length} VERSEMENTS SUR 10 ANS`),
      el('div', { class: 'dvd-cols' },
        el('div', {}, el('h4', { class: 'tp-sub' }, 'PAR ANNÉE'), el('ol', { class: 'mov' }, ...years.map(y => el('li', {}, el('span', {}, y),
          el('div', { class: 'mv-bar' }, el('i', { class: 'u', style: `width:${byYear[y] / maxY * 100}%` })), el('b', {}, fmtNum(byYear[y], 3)))))),
        el('div', {}, el('h4', { class: 'tp-sub' }, 'DÉTACHEMENTS'), el('table', { class: 'term-t' }, el('tbody', {}, ...divs.slice(0, 40).map(x =>
          el('tr', {}, el('td', {}, new Date(x.d + 'T12:00:00').toLocaleDateString('fr-FR')), el('td', { class: 'n' }, el('b', {}, fmtNum(x.a, 4) + ' ' + ccy)))))))),
      splits.length ? el('p', { class: 'dim small' }, 'Divisions d\'actions : ' + splits.map(s => s.d + ' (' + s.r + ')').join(', ')) : null);
  },

  async renderTermNews(body, key, general) {
    if (!Api.hasProxy()) { body.replaceChildren(el('p', { class: 'dim' }, 'Configure le relais Yahoo Finance (Réglages) pour les actualités.')); return; }
    const topic = general ? NEWS_GENERAL : (key && !key.startsWith('Y:') && this.newsQuery(key)) || (key && key.startsWith('Y:') ? { fr: this.termLabel(key), en: this.termLabel(key), s: key.slice(2), label: this.termLabel(key) } : NEWS_GENERAL);
    if (!body.querySelector('.term-news')) body.replaceChildren(el('p', { class: 'dim' }, 'Chargement des dépêches…'));
    let r;
    try { r = await this.newsFr(topic); } catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Actualités indisponibles : ' + e.message)); return; }
    if (!body.isConnected || (!general && this.termKey !== key)) return;
    const items = r.items.slice(0, 30);
    termFill(body, el('ol', { class: 'term-news' }, ...(items.length ? items.map(n => el('li', {},
      el('span', { class: 'nt' }, n.time ? new Date(n.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--'),
      el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title),
      el('span', { class: 'np' }, [n.publisher, n.time ? fmtAgo(n.time) : ''].filter(Boolean).join(' · ')))) : [el('li', { class: 'dim' }, 'Aucune dépêche.')])),
    r.general && !general ? el('p', { class: 'dim small' }, 'Pas de dépêche en français sur cette valeur : actualité générale des marchés.') : null);
  },

  async renderTermSecf(body, p) {
    if (!p.res) {
      body.replaceChildren(el('p', { class: 'dim' }, `Recherche « ${p.q} »…`));
      try { p.res = await Api.search(p.q); } catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Recherche impossible : ' + e.message)); return; }
    }
    const res = (p.res || []).slice(0, 40);
    body.replaceChildren(el('div', { class: 'tp-qline' }, `SECF « ${p.q} » · ${res.length} RÉSULTAT${res.length > 1 ? 'S' : ''} · CLIC = CHARGER`),
      res.length ? el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['SYMBOLE', 'NOM', 'TYPE', 'PLACE', 'DEVISE'].map(h => el('th', {}, h)))),
        el('tbody', {}, ...res.map(r => {
          const ys = r.ysymbol || yahooSymbolFor(r) || r.symbol;
          const local = Object.keys(Store.state.instruments).find(k => { const i = Store.instrument(k); return i.symbol === r.symbol && (i.mic || '') === (r.mic || ''); });
          return el('tr', { onclick: () => this.termLoad(local || 'Y:' + ys, 'DES') }, el('td', {}, el('b', {}, ys)), el('td', {}, r.name || ''),
            el('td', { class: 'dim' }, (r.type || '').toUpperCase()), el('td', {}, r.exchange || r.mic || ''), el('td', {}, r.currency || ''));
        }))) : el('p', { class: 'dim' }, 'Aucun résultat. Essaie un autre nom, un symbole ou un ISIN.'));
  },

  /** Rendements journaliers alignés (dates communes) de plusieurs valeurs sur ~1 an */
  async termReturns(keys) {
    const all = await Promise.all(keys.map(k => this.termOhlc(k, '1A').catch(() => [])));
    const from = addDaysISO(todayISO(), -366);
    const maps = all.map(b => new Map(b.filter(x => x.d >= addDaysISO(from, -7)).map(x => [x.d, x.c])));
    const dates = Array.from(new Set(all.flatMap(b => b.map(x => x.d)))).filter(d => d >= from).sort();
    const last = maps.map(() => null), px = maps.map(() => []);
    for (const d of dates) maps.forEach((m, k) => { if (m.has(d)) last[k] = m.get(d); px[k].push(last[k]); });
    const rets = px.map(s => s.slice(1).map((v, j) => (v > 0 && s[j] > 0 ? v / s[j] - 1 : 0)));
    return { dates: dates.slice(1), rets, ok: all.map(b => b.length > 20) };
  },

  async renderTermCorr(body, p) {
    let keys = p.list && p.list.length ? p.list : null;
    if (!keys) {
      const own = Portfolio.snapshot('all').rows.filter(r => r.qty > 0).sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0)).map(r => r.key).slice(0, 5);
      keys = [...own, 'Y:^GSPC', 'Y:^STOXX50E', 'Y:GC=F', 'Y:BTC-USD', 'Y:EURUSD=X'].slice(0, 9);
    }
    body.replaceChildren(el('p', { class: 'dim' }, 'Calcul des corrélations sur 1 an…'));
    const R = await this.termReturns(keys);
    if (!body.isConnected) return;
    const idx = keys.map((k, j) => j).filter(j => R.ok[j]);
    const corr = (a, b) => {
      const x = R.rets[a], y = R.rets[b], n = Math.min(x.length, y.length);
      let mx = 0, my = 0; for (let j = 0; j < n; j++) { mx += x[j]; my += y[j]; } mx /= n; my /= n;
      let sxy = 0, sx = 0, sy = 0; for (let j = 0; j < n; j++) { sxy += (x[j] - mx) * (y[j] - my); sx += (x[j] - mx) ** 2; sy += (y[j] - my) ** 2; }
      return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : NaN;
    };
    const col = c => (!isFinite(c) ? '#111' : c >= 0 ? `rgba(0,200,120,${Math.min(0.85, Math.abs(c))})` : `rgba(255,70,70,${Math.min(0.85, Math.abs(c))})`);
    body.replaceChildren(el('div', { class: 'tp-qline dim' }, 'CORRÉLATION DES RENDEMENTS JOURNALIERS · 1 AN · CORR SPX GOLD BTC … POUR CHANGER'),
      el('table', { class: 'term-t corr' }, el('thead', {}, el('tr', {}, el('th', {}, ''), ...idx.map(j => el('th', { class: 'n' }, this.termSym(keys[j]))))),
        el('tbody', {}, ...idx.map(a => el('tr', {}, el('td', {}, el('b', {}, this.termSym(keys[a]))), ...idx.map(b => {
          const c = a === b ? 1 : corr(a, b);
          return el('td', { class: 'n', style: `background:${a === b ? '#222' : col(c)}` }, fmtNum(c, 2));
        }))))),
      el('p', { class: 'dim small' }, '+1 : évoluent ensemble · 0 : indépendants · −1 : en sens inverse. Des actifs peu corrélés diversifient vraiment le portefeuille.'),
      idx.length < keys.length ? el('p', { class: 'dim small' }, 'Sans historique : ' + keys.filter((k, j) => !R.ok[j]).map(k => this.termSym(k)).join(', ')) : null);
  },

  async renderTermRsk(body) {
    const cur = this.base();
    const rows = Portfolio.snapshot('all').rows.filter(r => r.qty > 0 && r.valueBase > 0);
    if (!rows.length) { body.replaceChildren(el('p', { class: 'dim' }, 'Aucune position : rien à mesurer.')); return; }
    body.replaceChildren(el('p', { class: 'dim' }, 'Calcul du risque sur 1 an…'));
    const total = rows.reduce((s, r) => s + r.valueBase, 0);
    const bench = 'Y:' + (typeof RISK_BENCH !== 'undefined' ? RISK_BENCH.ysym : 'IWDA.AS');
    const keys = [...rows.map(r => r.key), bench];
    const R = await this.termReturns(keys);
    if (!body.isConnected) return;
    const n = R.dates.length;
    if (n < 30) { body.replaceChildren(el('p', { class: 'dim' }, 'Historique insuffisant pour mesurer le risque.')); return; }
    const w = rows.map(r => r.valueBase / total);
    const port = R.dates.map((_, t) => rows.reduce((s, r, k) => s + w[k] * R.rets[k][t], 0));
    const bm = R.rets[rows.length];
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const cov = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((s, x, j) => s + (x - ma) * (b[j] - mb), 0) / Math.max(1, a.length - 1); };
    const vp = cov(port, port), vol = Math.sqrt(vp * 252) * 100;
    const sorted = port.slice().sort((a, b) => a - b), q5 = sorted[Math.floor(0.05 * n)];
    const tail = sorted.slice(0, Math.max(1, Math.floor(0.05 * n))), cvar = mean(tail);
    let v = 1, pk = 1, dd = 0; for (const r of port) { v *= 1 + r; pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); }
    const perf = (v - 1) * 100, beta = R.ok[rows.length] ? cov(port, bm) / cov(bm, bm) : NaN;
    const corrB = R.ok[rows.length] ? cov(port, bm) / Math.sqrt(vp * cov(bm, bm)) : NaN;
    const sharpe = vol > 0 ? (perf - 2) / vol : NaN;
    const kv = (k, val, cls) => el('div', { class: 'kv' }, el('span', {}, k), el('b', { class: cls || '' }, val));
    body.replaceChildren(el('div', { class: 'des' },
      el('div', { class: 'des-cols' },
        el('div', {}, el('h4', {}, '1) PORTEFEUILLE · 1 AN'), kv('VALEUR', fmtMoney(total, cur, 0)), kv('PERF. (POIDS ACTUELS)', fmtPct(perf, 1), perf >= 0 ? 'tu' : 'td'),
          kv('VOLATILITÉ ANNUELLE', fmtNum(vol, 1) + ' %'), kv('SHARPE (TAUX 2 %)', fmtNum(sharpe, 2)), kv('PIRE BAISSE', fmtPct(dd * 100, 1), 'td'),
          kv('MEILLEUR / PIRE JOUR', `${fmtPct(sorted[n - 1] * 100, 2)} / ${fmtPct(sorted[0] * 100, 2)}`)),
        el('div', {}, el('h4', {}, '2) PERTE POSSIBLE EN 1 JOUR'), kv('VAR 95 % (HISTORIQUE)', fmtMoney(-q5 * total, cur, 0), 'td'), kv('EN %', fmtPct(q5 * 100, 2), 'td'),
          kv('CVAR 95 % (MOY. DES 5 % PIRES)', fmtMoney(-cvar * total, cur, 0), 'td'),
          kv('BÊTA VS MSCI WORLD', fmtNum(beta, 2)), kv('CORRÉLATION VS MSCI WORLD', fmtNum(corrB, 2)),
          el('p', { class: 'dim small' }, '1 jour sur 20, la perte dépasse la VaR. Bêta 1 : bouge comme le marché mondial.'))),
      el('h4', {}, '3) CONTRIBUTION AU RISQUE'),
      el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['LIGNE', 'POIDS', 'VOLAT. AN.', 'BÊTA', 'PART DU RISQUE'].map((h, j) => el('th', { class: j ? 'n' : '' }, h)))),
        el('tbody', {}, ...rows.map((r, k) => {
          const ri = R.rets[k], c = w[k] * cov(ri, port) / vp;
          return el('tr', { onclick: () => this.termLoad(r.key, 'DES') }, el('td', {}, el('b', {}, Store.instrument(r.key).symbol), ' ', el('span', { class: 'dim' }, Store.label(r.key))),
            el('td', { class: 'n' }, fmtNum(w[k] * 100, 1) + '%'), el('td', { class: 'n' }, fmtNum(Math.sqrt(cov(ri, ri) * 252) * 100, 1) + '%'),
            el('td', { class: 'n' }, R.ok[rows.length] ? fmtNum(cov(ri, bm) / cov(bm, bm), 2) : '—'),
            el('td', { class: 'n' }, el('div', { class: 'rk-bar' }, el('i', { style: `width:${Math.max(0, Math.min(100, c * 100))}%` }), el('b', {}, fmtNum(c * 100, 1) + '%'))));
        }))),
      el('p', { class: 'dim small' }, 'Rendements journaliers en devise de cotation, poids actuels appliqués sur 1 an. Indicatif.')));
  },
});

/* Univers du terminal : symboles Yahoo, noms, unités */
const TERM_FX = [['EURUSD=X', 'EUR/USD', 4], ['EURGBP=X', 'EUR/GBP', 4], ['EURCHF=X', 'EUR/CHF', 4], ['EURJPY=X', 'EUR/JPY', 2], ['EURCAD=X', 'EUR/CAD', 4], ['EURAUD=X', 'EUR/AUD', 4],
  ['EURSEK=X', 'EUR/SEK', 4], ['EURNOK=X', 'EUR/NOK', 4], ['EURCNY=X', 'EUR/CNY', 4], ['GBPUSD=X', 'GBP/USD', 4], ['USDJPY=X', 'USD/JPY', 2], ['USDCHF=X', 'USD/CHF', 4],
  ['AUDUSD=X', 'AUD/USD', 4], ['NZDUSD=X', 'NZD/USD', 4], ['USDCAD=X', 'USD/CAD', 4], ['USDCNY=X', 'USD/CNY', 4], ['USDHKD=X', 'USD/HKD', 4], ['USDINR=X', 'USD/INR', 3],
  ['USDBRL=X', 'USD/BRL', 4], ['USDMXN=X', 'USD/MXN', 4], ['USDTRY=X', 'USD/TRY', 4], ['USDZAR=X', 'USD/ZAR', 4], ['DX-Y.NYB', 'DOLLAR INDEX', 2]];
/* Toutes les matières premières cotées en continu (contrats à terme du mois le plus proche) : [symbole, nom, unité, famille] */
const TERM_CMDTY = [
  ['CL=F', 'PÉTROLE WTI', '$/baril', 'ÉNERGIE'], ['BZ=F', 'PÉTROLE BRENT', '$/baril', 'ÉNERGIE'], ['NG=F', 'GAZ NATUREL HENRY HUB', '$/MMBtu', 'ÉNERGIE'],
  ['HO=F', 'FIOUL DOMESTIQUE', '$/gallon', 'ÉNERGIE'], ['RB=F', 'ESSENCE RBOB', '$/gallon', 'ÉNERGIE'],
  ['GC=F', 'OR', '$/once', 'MÉTAUX PRÉCIEUX'], ['SI=F', 'ARGENT', '$/once', 'MÉTAUX PRÉCIEUX'], ['PL=F', 'PLATINE', '$/once', 'MÉTAUX PRÉCIEUX'], ['PA=F', 'PALLADIUM', '$/once', 'MÉTAUX PRÉCIEUX'],
  ['HG=F', 'CUIVRE', '$/livre', 'MÉTAUX INDUSTRIELS'], ['ALI=F', 'ALUMINIUM', '$/tonne', 'MÉTAUX INDUSTRIELS'],
  ['ZC=F', 'MAÏS', '¢/boisseau', 'CÉRÉALES & OLÉAGINEUX'], ['ZW=F', 'BLÉ (CHICAGO)', '¢/boisseau', 'CÉRÉALES & OLÉAGINEUX'], ['KE=F', 'BLÉ DUR (KANSAS)', '¢/boisseau', 'CÉRÉALES & OLÉAGINEUX'],
  ['ZS=F', 'SOJA', '¢/boisseau', 'CÉRÉALES & OLÉAGINEUX'], ['ZM=F', 'TOURTEAU DE SOJA', '$/tonne courte', 'CÉRÉALES & OLÉAGINEUX'], ['ZL=F', 'HUILE DE SOJA', '¢/livre', 'CÉRÉALES & OLÉAGINEUX'],
  ['ZO=F', 'AVOINE', '¢/boisseau', 'CÉRÉALES & OLÉAGINEUX'], ['ZR=F', 'RIZ', '$/quintal US', 'CÉRÉALES & OLÉAGINEUX'],
  ['KC=F', 'CAFÉ ARABICA', '¢/livre', 'SOFTS'], ['SB=F', 'SUCRE', '¢/livre', 'SOFTS'], ['CC=F', 'CACAO', '$/tonne', 'SOFTS'], ['CT=F', 'COTON', '¢/livre', 'SOFTS'],
  ['OJ=F', 'JUS D\'ORANGE', '¢/livre', 'SOFTS'], ['LBR=F', 'BOIS DE CONSTRUCTION', '$/1000 pieds-planche', 'SOFTS'],
  ['LE=F', 'BOVINS VIVANTS', '¢/livre', 'ÉLEVAGE & LAIT'], ['GF=F', 'BOVINS D\'ENGRAISSEMENT', '¢/livre', 'ÉLEVAGE & LAIT'], ['HE=F', 'PORCS MAIGRES', '¢/livre', 'ÉLEVAGE & LAIT'],
  ['DC=F', 'LAIT CLASSE III', '$/quintal US', 'ÉLEVAGE & LAIT'],
];
const TERM_CMDTY_GROUPS = Array.from(new Set(TERM_CMDTY.map(x => x[3])));
const TERM_UNIT = Object.fromEntries(TERM_CMDTY.map(x => [x[0], x[2]]));
const TERM_CRYPTO = [['BTC-USD', 'BITCOIN'], ['ETH-USD', 'ETHEREUM'], ['SOL-USD', 'SOLANA'], ['XRP-USD', 'XRP'], ['BNB-USD', 'BNB'], ['ADA-USD', 'CARDANO'], ['DOGE-USD', 'DOGECOIN'],
  ['AVAX-USD', 'AVALANCHE'], ['DOT-USD', 'POLKADOT'], ['LINK-USD', 'CHAINLINK'], ['LTC-USD', 'LITECOIN'], ['TRX-USD', 'TRON'], ['BTC-EUR', 'BITCOIN (€)'], ['ETH-EUR', 'ETHEREUM (€)']];
const TERM_GOVT = [['^IRX', 'US 13 SEMAINES', 3], ['^FVX', 'US 5 ANS', 3], ['^TNX', 'US 10 ANS', 3], ['^TYX', 'US 30 ANS', 3]];
const TERM_CCY = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'HKD', 'SGD', 'INR', 'BRL', 'MXN', 'ZAR', 'TRY'];
const TERM_SECTORS = ['EQUITY', 'INDEX', 'CURNCY', 'CMDTY', 'CRYPTO', 'GOVT', 'CORP', 'MMKT'];
const TERM_RANGES = ['1J', '5J', '1M', '3M', '6M', 'YTD', '1A', '2A', '5A', '10A', 'MAX'];
const TERM_ALIAS = { SPX: '^GSPC', SP500: '^GSPC', CCMP: '^IXIC', NASDAQ: '^IXIC', NDX: '^NDX', INDU: '^DJI', DOW: '^DJI', CAC: '^FCHI', CAC40: '^FCHI', DAX: '^GDAXI',
  UKX: '^FTSE', FTSE: '^FTSE', SX5E: '^STOXX50E', SXXP: '^STOXX', NKY: '^N225', NIKKEI: '^N225', HSI: '^HSI', SMI: '^SSMI', IBEX: '^IBEX', AEX: '^AEX', VIX: '^VIX',
  RTY: '^RUT', TSX: '^GSPTSE', SENSEX: '^BSESN', AS51: '^AXJO', SHCOMP: '000001.SS', FTSEMIB: 'FTSEMIB.MI',
  GOLD: 'GC=F', XAU: 'GC=F', OR: 'GC=F', SILVER: 'SI=F', XAG: 'SI=F', ARGENT: 'SI=F', PLAT: 'PL=F', PLATINE: 'PL=F', PALL: 'PA=F', PALLADIUM: 'PA=F',
  COPPER: 'HG=F', CUIVRE: 'HG=F', ALU: 'ALI=F', ALUMINIUM: 'ALI=F', WTI: 'CL=F', CL1: 'CL=F', PETROLE: 'CL=F', BRENT: 'BZ=F', CO1: 'BZ=F', NATGAS: 'NG=F', NG1: 'NG=F', GAZ: 'NG=F',
  HEATOIL: 'HO=F', FIOUL: 'HO=F', GASOLINE: 'RB=F', ESSENCE: 'RB=F', CORN: 'ZC=F', MAIS: 'ZC=F', WHEAT: 'ZW=F', BLE: 'ZW=F', SOY: 'ZS=F', SOJA: 'ZS=F', OATS: 'ZO=F', AVOINE: 'ZO=F',
  RICE: 'ZR=F', RIZ: 'ZR=F', COFFEE: 'KC=F', CAFE: 'KC=F', SUGAR: 'SB=F', SUCRE: 'SB=F', COCOA: 'CC=F', CACAO: 'CC=F', COTTON: 'CT=F', COTON: 'CT=F', OJ: 'OJ=F',
  LUMBER: 'LBR=F', BOIS: 'LBR=F', CATTLE: 'LE=F', BOVINS: 'LE=F', HOGS: 'HE=F', PORCS: 'HE=F', MILK: 'DC=F', LAIT: 'DC=F',
  BTC: 'BTC-USD', BITCOIN: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', US10Y: '^TNX', USGG10YR: '^TNX', US30Y: '^TYX', US5Y: '^FVX', US3M: '^IRX', DXY: 'DX-Y.NYB' };
const TERM_SHORT = { '^GSPC': 'SPX', '^IXIC': 'CCMP', '^NDX': 'NDX', '^DJI': 'INDU', '^FCHI': 'CAC', '^GDAXI': 'DAX', '^FTSE': 'UKX', '^STOXX50E': 'SX5E', '^STOXX': 'SXXP', '^N225': 'NKY',
  '^HSI': 'HSI', '^SSMI': 'SMI', '^IBEX': 'IBEX', '^AEX': 'AEX', '^VIX': 'VIX', '^RUT': 'RTY', 'GC=F': 'GOLD', 'SI=F': 'SILVER', 'PL=F': 'PLAT', 'PA=F': 'PALL', 'HG=F': 'COPPER',
  'ALI=F': 'ALU', 'BZ=F': 'BRENT', 'CL=F': 'WTI', 'NG=F': 'NATGAS', 'HO=F': 'HEATOIL', 'RB=F': 'GASOLINE', 'ZC=F': 'CORN', 'ZW=F': 'WHEAT', 'KE=F': 'KCWHEAT', 'ZS=F': 'SOY',
  'ZM=F': 'SOYMEAL', 'ZL=F': 'SOYOIL', 'ZO=F': 'OATS', 'ZR=F': 'RICE', 'KC=F': 'COFFEE', 'SB=F': 'SUGAR', 'CC=F': 'COCOA', 'CT=F': 'COTTON', 'OJ=F': 'OJ', 'LBR=F': 'LUMBER',
  'LE=F': 'CATTLE', 'GF=F': 'FEEDER', 'HE=F': 'HOGS', 'DC=F': 'MILK', 'BTC-EUR': 'BTC€', 'BTC-USD': 'BTC', 'ETH-USD': 'ETH', 'ETH-EUR': 'ETH€',
  'EURUSD=X': 'EURUSD', '^TNX': 'US10Y', '^TYX': 'US30Y', '^FVX': 'US5Y', '^IRX': 'US3M', 'FTSEMIB.MI': 'FTSEMIB', '^GSPTSE': 'TSX', '^BSESN': 'SENSEX', '^AXJO': 'AS51', '000001.SS': 'SHCOMP', 'DX-Y.NYB': 'DXY' };
const TERM_CITY = { newyork: 'NY', london: 'LDN', paris: 'PAR', xetra: 'FRA', tokyo: 'TKY', hongkong: 'HK' };
const TERM_LAYOUTS = {
  1: { name: 'DÉFAUT', fns: ['PORT', 'GP', 'WEI', 'DES'] },
  2: { name: 'MARCHÉS', fns: ['WEI', 'FX', 'CMDTY', 'GOVT'] },
  3: { name: 'VALEUR', fns: ['GP', 'DES', 'HP', 'NEWS'] },
  4: { name: 'MATIÈRES PREMIÈRES', fns: ['CMDTY', 'GP', 'CMAP', 'DES'], key: 'Y:GC=F' },
  5: { name: 'RISQUE', fns: ['RSK', 'CORR', 'COMP', 'XRAY'] },
  6: { name: 'VEILLE', fns: ['WMAP', 'MOV', 'TOP', 'CAL'] },
};

/** Nom lisible d'un symbole Yahoo connu (indices, devises, matières premières, crypto, taux), sinon le symbole */
function termName(y) {
  for (const L of [TERM_FX, TERM_CMDTY, TERM_CRYPTO, TERM_GOVT]) { const f = L.find(x => x[0] === y); if (f) return f[1]; }
  const m = MACRO.find(x => x.y === y); if (m) return m.name.toUpperCase();
  for (const e of EXCHANGES) for (const ix of [e.index, ...(e.extra || [])]) if (ix.y === y) return ix.name.toUpperCase();
  return { '^NDX': 'NASDAQ 100', '^RUT': 'RUSSELL 2000', '^STOXX': 'STOXX EUROPE 600' }[y] || y;
}
/** Secteur d'un symbole Yahoo (touches jaunes) */
function TERM_SECTOR_OF(y) {
  y = String(y || '');
  if (/=F$/.test(y)) return 'CMDTY';
  if (/=X$|^DX-Y/.test(y)) return 'CURNCY';
  if (/-(USD|EUR)$/.test(y)) return 'CRYPTO';
  if (['^TNX', '^TYX', '^FVX', '^IRX'].includes(y)) return 'GOVT';
  if (/^\^|\.SS$|^FTSEMIB/.test(y)) return 'INDEX';
  return 'EQUITY';
}
function termNorm(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim(); }

/** Réponse « chart » de Yahoo → bougies [{ d, t, o, h, l, c, v }] (o, h, l manquants : remplacés par la clôture) */
function termParseBars(json, intraday, withDay) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) return [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const off = ((r.meta && r.meta.gmtoffset) || 0) * 1000;
  const out = [], seen = new Map();
  r.timestamp.forEach((t, i) => {
    const c = q.close ? q.close[i] : null;
    if (c === null || c === undefined || !isFinite(c)) return;
    const o = q.open && isFinite(q.open[i]) && q.open[i] !== null ? q.open[i] : c;
    const h = q.high && isFinite(q.high[i]) && q.high[i] !== null ? Math.max(q.high[i], o, c) : Math.max(o, c);
    const l = q.low && isFinite(q.low[i]) && q.low[i] !== null ? Math.min(q.low[i], o, c) : Math.min(o, c);
    const dt = new Date(t * 1000 + off).toISOString();
    const d = intraday ? (withDay ? dt.slice(8, 10) + '/' + dt.slice(5, 7) + ' ' : '') + dt.slice(11, 16) : dt.slice(0, 10);
    const b = { d, t: t * 1000, o, h, l, c, v: (q.volume && q.volume[i]) || 0 };
    if (!intraday && seen.has(d)) Object.assign(out[seen.get(d)], b); else { seen.set(d, out.length); out.push(b); }
  });
  return out;
}

/** Mini-courbe de la séance (SVG), verte ou rouge par rapport à la clôture de la veille */
function termSpark(v, ref, w = 70, h = 16) {
  const lo = Math.min(...v, isFinite(ref) ? ref : Infinity), hi = Math.max(...v, isFinite(ref) ? ref : -Infinity), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - (x - lo) / span * (h - 2) - 1).toFixed(1)}`).join(' ');
  const up = v[v.length - 1] >= (isFinite(ref) ? ref : v[0]);
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('class', 'spark');
  if (isFinite(ref)) { const ln = document.createElementNS(ns, 'line'); const y = (h - (ref - lo) / span * (h - 2) - 1).toFixed(1); Object.entries({ x1: 0, x2: w, y1: y, y2: y, stroke: '#555', 'stroke-dasharray': '2 2' }).forEach(([k, x]) => ln.setAttribute(k, x)); svg.append(ln); }
  const pl = document.createElementNS(ns, 'polyline');
  pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', up ? '#2fe37f' : '#ff4d4d'); pl.setAttribute('stroke-width', '1.2');
  svg.append(pl);
  return svg;
}
/** Position du cours dans sa fourchette 52 semaines */
function termRange52(q) {
  const p = Math.max(0, Math.min(100, (q.price - q.low52) / (q.high52 - q.low52) * 100));
  return el('span', { class: 'r52', title: `${fmtNum(q.low52, 2)} – ${fmtNum(q.high52, 2)}` }, el('i', { style: `left:${p}%` }));
}

/* Fonctions du terminal : titre, valeur (sec : suit la valeur chargée), graphique, liste, rendu */
const TERM_FN = {
  PORT: { title: 'MONITEUR DE PORTEFEUILLE', render(body) {
    const cur = this.base(), { rows, totals } = Portfolio.snapshot();
    const pc = v => (!isFinite(v) || v === 0 ? '' : v > 0 ? 'tu' : 'td');
    const tot = rows.reduce((s, r) => s + (r.valueBase > 0 ? r.valueBase : 0), 0) || 1;
    body.replaceChildren(
      el('div', { class: 'tp-qline' }, 'VALEUR ', el('b', {}, fmtMoney(totals.value, cur, 0)), '   JOUR ', el('b', { class: pc(totals.day) }, `${fmtSignedMoney(totals.day, cur)} (${fmtPct(totals.dayPct, 2)})`),
        '   +/- LAT. ', el('b', { class: pc(totals.pnl) }, `${fmtSignedMoney(totals.pnl, cur)} (${fmtPct(totals.pnlPct, 1)})`)),
      el('table', { class: 'term-t', id: 'termPort' }, el('thead', {}, el('tr', {}, ...['TICKER', 'QTÉ', 'PRU', 'DERNIER', 'VAR %', 'SÉANCE', 'P&L JOUR', 'VALEUR', 'POIDS', '+/- VAL.', '+/- %'].map((h, j) => el('th', { class: j ? 'n' : '' }, h)))),
        el('tbody', {}, ...rows.sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0)).map(r => el('tr', { class: r.key === this.termKey ? 'sel' : '', onclick: () => this.termLoad(r.key) },
          el('td', {}, el('b', {}, Store.instrument(r.key).symbol)), el('td', { class: 'n' }, fmtQty(r.qty)), el('td', { class: 'n' }, fmtNum(r.pru, 2)), el('td', { class: 'n' }, fmtNum(r.price, 2)),
          el('td', { class: 'n ' + pc(r.quote ? r.quote.percentChange : 0) }, r.quote ? fmtPct(r.quote.percentChange, 2) : '—'),
          el('td', { class: 'n' }, r.quote && r.quote.spark && r.quote.spark.length > 2 ? termSpark(r.quote.spark, r.quote.previousClose, 60, 14) : ''),
          el('td', { class: 'n ' + pc(r.dayBase) }, isFinite(r.dayBase) ? fmtSignedMoney(r.dayBase, cur) : '—'),
          el('td', { class: 'n' }, fmtMoney(r.valueBase, cur, 0)), el('td', { class: 'n' }, fmtNum((r.valueBase || 0) / tot * 100, 1) + '%'),
          el('td', { class: 'n ' + pc(r.pnlBase) }, fmtSignedMoney(r.pnlBase, cur)),
          el('td', { class: 'n ' + pc(r.pnlBase) }, fmtPct(r.pnlPct, 1)))))));
    if (!rows.length) body.append(el('p', { class: 'dim' }, 'Aucune position. Tape SPX <GO>, WEI, CMDTY… pour explorer les marchés.'));
  } },
  MON: { title: 'LISTE DE SUIVI (ADD / DEL <VALEUR>)', render(body) {
    const keys = Array.from(new Set([...Store.trackedKeys(), ...(this.termMon || [])]));
    keys.forEach(k => this.termNeedKey(k));
    body.replaceChildren(keys.length ? this.termQuoteTable(keys.map(k => ({ key: k, label: this.termSym(k) })), ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS', 'JOUR', '52 SEM.', 'HEURE'])
      : el('p', { class: 'dim' }, 'Liste de suivi vide. Tape ADD GOLD, ADD AAPL…'));
  } },
  WEI: { title: 'INDICES BOURSIERS MONDIAUX', render(body) {
    const rows = [];
    for (const reg of ['Amériques', 'Europe', 'Asie-Pacifique']) {
      rows.push({ group: reg.toUpperCase() });
      for (const e of EXCHANGES.filter(x => x.region === reg)) {
        const st = Markets.status(e).state;
        for (const ix of [e.index, ...(e.extra || [])]) rows.push({ key: 'Y:' + ix.y, label: TERM_SHORT[ix.y] ? `${TERM_SHORT[ix.y]}  ${ix.name}` : ix.name, dot: st, open: 'GP' });
        if (e.id === 'newyork') rows.push({ key: 'Y:^NDX', label: 'NDX  Nasdaq 100', dot: st, open: 'GP' }, { key: 'Y:^RUT', label: 'RTY  Russell 2000', dot: st, open: 'GP' });
        if (e.id === 'paris') rows.push({ key: 'Y:^STOXX50E', label: 'SX5E  Euro Stoxx 50', dot: st, open: 'GP' }, { key: 'Y:^STOXX', label: 'SXXP  Stoxx Europe 600', dot: st, open: 'GP' });
      }
    }
    rows.push({ group: 'VOLATILITÉ' }, { key: 'Y:^VIX', label: 'VIX  Indice de la peur', open: 'GP' });
    this.termNeed(rows.filter(r => r.key).map(r => r.key.slice(2)));
    body.replaceChildren(this.termQuoteTable(rows, ['DERNIER', 'VAR', 'VAR %', 'JOUR', '52 SEM.', 'HEURE']));
  } },
  WMAP: { title: 'CARTE DES MARCHÉS MONDIAUX', render(body) {
    const groups = ['Amériques', 'Europe', 'Asie-Pacifique'].map(reg => ({ name: reg.toUpperCase(),
      items: EXCHANGES.filter(e => e.region === reg).flatMap(e => [e.index, ...(e.extra || [])]).map(ix => [ix.y, ix.name]) }));
    groups[1].items.push(['^STOXX50E', 'Euro Stoxx 50']);
    groups.push({ name: 'TAUX, DEVISES, VOLATILITÉ', items: [['^TNX', 'US 10 ANS'], ['EURUSD=X', 'EUR/USD'], ['DX-Y.NYB', 'DXY'], ['^VIX', 'VIX'], ['BTC-USD', 'BITCOIN']] });
    this.termNeed(groups.flatMap(g => g.items.map(x => x[0])));
    body.replaceChildren(this.termTiles(groups));
  } },
  FX: { title: 'DEVISES', render(body) {
    this.termNeed(TERM_FX.map(x => x[0]));
    const ccy = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
    const eur = { EUR: 1, USD: 'EURUSD=X', GBP: 'EURGBP=X', CHF: 'EURCHF=X', JPY: 'EURJPY=X', CAD: 'EURCAD=X', AUD: 'EURAUD=X' };
    const r = c => (c === 'EUR' ? 1 : (this.idxQuote(eur[c]) || {}).price);
    body.replaceChildren(this.termQuoteTable(TERM_FX.map(([y, n, d]) => ({ key: 'Y:' + y, label: n, digits: d, open: 'GP' })), ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS', 'JOUR']),
      el('h4', { class: 'tp-sub' }, 'MATRICE DES CHANGES CROISÉS (1 LIGNE = X COLONNE)'),
      el('table', { class: 'term-t fxm' }, el('thead', {}, el('tr', {}, el('th', {}, ''), ...ccy.map(c => el('th', { class: 'n' }, c)))),
        el('tbody', {}, ...ccy.map(a => el('tr', {}, el('td', {}, el('b', {}, a)), ...ccy.map(b => {
          const v = r(b) / r(a);
          return el('td', { class: 'n' + (a === b ? ' dim' : '') }, a === b ? '—' : isFinite(v) ? fmtNum(v, v >= 100 ? 2 : 4) : '…');
        }))))));
  } },
  CMDTY: { title: 'MATIÈRES PREMIÈRES : TOUS LES CONTRATS À TERME', render(body) {
    this.termNeed(TERM_CMDTY.map(x => x[0]));
    const rows = TERM_CMDTY_GROUPS.flatMap(g => [{ group: g }, ...TERM_CMDTY.filter(x => x[3] === g).map(([y, n, u]) => ({ key: 'Y:' + y, label: `${TERM_SHORT[y] || y}  ${n}`, unit: u, open: 'GP' }))]);
    body.replaceChildren(this.termQuoteTable(rows, ['DERNIER', 'VAR', 'VAR %', 'JOUR', '52 SEM.', 'UNITÉ']),
      el('p', { class: 'dim small' }, `${TERM_CMDTY.length} contrats à terme (échéance la plus proche, marchés américains et ICE). Clic : graphique en chandeliers. CMAP : carte colorée.`));
  } },
  CMAP: { title: 'CARTE DES MATIÈRES PREMIÈRES', render(body) {
    this.termNeed(TERM_CMDTY.map(x => x[0]));
    body.replaceChildren(this.termTiles(TERM_CMDTY_GROUPS.map(g => ({ name: g, items: TERM_CMDTY.filter(x => x[3] === g).map(x => [x[0], x[1]]) }))));
  } },
  CRYPTO: { title: 'CRYPTO-ACTIFS', render(body) {
    this.termNeed(TERM_CRYPTO.map(x => x[0]));
    body.replaceChildren(this.termQuoteTable(TERM_CRYPTO.map(([y, n]) => ({ key: 'Y:' + y, label: n, open: 'GP' })), ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS', 'JOUR', '52 SEM.']));
  } },
  GOVT: { title: 'TAUX SOUVERAINS AMÉRICAINS (RENDEMENT %)', render(body) {
    this.termNeed(TERM_GOVT.map(x => x[0]));
    const pts = TERM_GOVT.map(([y]) => (this.idxQuote(y) || {}).price);
    body.replaceChildren(this.termQuoteTable(TERM_GOVT.map(([y, n, d]) => ({ key: 'Y:' + y, label: n, digits: d, open: 'GP' })), ['DERNIER', 'VAR', 'HAUT', 'BAS', 'JOUR', 'HEURE']),
      el('h4', { class: 'tp-sub' }, 'COURBE DES TAUX'),
      el('div', { class: 'yc' }, ...TERM_GOVT.map(([, n], j) => el('div', {}, el('i', { style: `height:${isFinite(pts[j]) ? Math.max(4, pts[j] / Math.max(...pts.filter(isFinite), 1) * 100) : 0}%` }), el('b', {}, isFinite(pts[j]) ? fmtNum(pts[j], 2) + '%' : '…'), el('span', {}, n.replace('US ', ''))))),
      el('p', { class: 'dim small' }, pts.every(isFinite) ? (pts[2] < pts[0] ? '▼ COURBE INVERSÉE : le 10 ans rapporte moins que le 3 mois (signal historique de ralentissement).' : '▲ COURBE POSITIVE : les taux longs rapportent plus que les taux courts.') : ''));
  } },
  MOV: { title: 'PLUS FORTES VARIATIONS DU JOUR', render(body) {
    const all = [];
    for (const k of Store.trackedKeys()) { const q = Api.cachedQuote(k); if (q && isFinite(q.percentChange)) all.push([k, Store.instrument(k).symbol, q.percentChange]); }
    const ys = [...EXCHANGES.flatMap(e => [e.index, ...(e.extra || [])]).map(x => x.y), ...MACRO.map(m => m.y), ...TERM_FX.map(x => x[0]), ...TERM_CMDTY.map(x => x[0]), ...TERM_CRYPTO.map(x => x[0])];
    this.termNeed(ys);
    for (const y of new Set(ys)) { const q = this.idxQuote(y); if (q && isFinite(q.percentChange)) all.push(['Y:' + y, TERM_SHORT[y] || termName(y), q.percentChange]); }
    all.sort((a, b) => b[2] - a[2]);
    const max = Math.max(0.5, ...all.map(x => Math.abs(x[2])));
    const list = (arr, up) => el('ol', { class: 'mov' }, ...arr.map(([k, n, ch]) => el('li', { onclick: () => this.termLoad(k, 'GP') }, el('span', {}, n),
      el('div', { class: 'mv-bar' }, el('i', { class: up ? 'u' : 'd', style: `width:${Math.abs(ch) / max * 100}%` })), el('b', { class: ch >= 0 ? 'tu' : 'td' }, fmtPct(ch, 2)))));
    body.replaceChildren(el('div', { class: 'mov-cols' },
      el('div', {}, el('h4', { class: 'tp-sub tu' }, '▲ HAUSSES'), list(all.filter(x => x[2] > 0).slice(0, 12), true)),
      el('div', {}, el('h4', { class: 'tp-sub td' }, '▼ BAISSES'), list(all.filter(x => x[2] < 0).reverse().slice(0, 12), false))));
  } },
  HEAT: { title: 'CARTE DE CHALEUR DU PORTEFEUILLE', render(body) {
    const { rows } = Portfolio.snapshot();
    const tot = rows.reduce((s, r) => s + (r.valueBase > 0 ? r.valueBase : 0), 0) || 1;
    body.replaceChildren(el('div', { class: 'term-heat' }, ...rows.filter(r => r.valueBase > 0).map(r => {
      const ch = r.quote ? r.quote.percentChange : 0, a = Math.min(1, Math.abs(ch) / 2.5);
      return el('div', { class: 'term-tile', style: `flex-grow:${Math.max(1, r.valueBase / tot * 100)};background:${ch >= 0 ? `rgba(0,200,120,${0.2 + a * 0.6})` : `rgba(255,70,70,${0.2 + a * 0.6})`}`, onclick: () => this.termLoad(r.key) },
        el('b', {}, Store.instrument(r.key).symbol), el('span', {}, fmtPct(ch, 2)), el('span', { class: 'dim' }, fmtNum(r.valueBase / tot * 100, 0) + '%'));
    })));
  } },
  SCAN: { title: 'SCANNER DE SIGNAUX TECHNIQUES', render(body) {
    const S = this.scanResult;
    const sig = S ? S.res.flatMap(r => r.signals.map(s => Object.assign({ key: r.key }, s))).sort((a, b) => b.score - a.score) : [];
    body.replaceChildren(el('div', { class: 'tp-qline' }, S ? `${sig.length} SIGNAUX SUR ${S.res.length} VALEURS` : 'SCAN EN COURS…'),
      el('ul', { class: 'term-sig' }, ...(sig.length ? sig.slice(0, 20).map(s =>
        el('li', { class: 'lv-' + s.level, onclick: () => this.termLoad(s.key, 'GP') }, el('b', {}, Store.instrument(s.key).symbol), ' ', s.text)) : [el('li', {}, S ? 'Aucun signal. Marché calme.' : '…')])));
  } },
  XRAY: { title: 'RADIOGRAPHIE : TES VRAIES ENTREPRISES', render(body) {
    const cur = this.base(), X = Xray.lookthrough(this.xrayList());
    body.replaceChildren(el('div', { class: 'tp-qline' }, 'XRAY  7 MAGNIFIQUES ', el('b', { class: X.mag7 >= 25 ? 'td' : '' }, fmtNum(X.mag7, 1) + '%'), `  ·  COUVERTURE ${fmtNum(X.covered, 0)}%`),
      el('table', { class: 'term-t' }, el('tbody', {}, ...X.companies.slice(0, 20).map(e =>
        el('tr', {}, el('td', {}, e.name, XRAY_MAG7.includes(e.name) ? el('span', { class: 'xr-m7' }, ' M7') : ''), el('td', { class: 'n' }, fmtMoney(e.value, cur, 0)), el('td', { class: 'n' }, fmtNum(e.pct, 1) + '%'))))));
  } },
  RSK: { sticky: 120, title: 'RISQUE DU PORTEFEUILLE (VAR, BÊTA, CONTRIBUTIONS)', render(body) { this.renderTermRsk(body); } },
  CORR: { list: true, sticky: 120, title: 'MATRICE DE CORRÉLATION', render(body, p) { this.renderTermCorr(body, p); } },
  COMP: { list: true, chart: true, title: 'COMPARAISON DE PERFORMANCES', render(body, p, i) { p.list && p.list.forEach(k => this.termNeedKey(k)); this.renderTermComp(i, body, p); } },
  BLT: { title: 'JOURNAL DES OPÉRATIONS', render(body) {
    const cur = this.base();
    const tx = (Store.state.transactions || []).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const T = { buy: ['ACHAT', 'tu'], sell: ['VENTE', 'td'], div: ['DIVIDENDE', 'warn'], split: ['DIVISION', 'dim'] };
    body.replaceChildren(el('div', { class: 'tp-qline' }, `${tx.length} OPÉRATIONS`),
      tx.length ? el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['DATE', 'SENS', 'TICKER', 'QTÉ', 'PRIX', 'FRAIS', 'MONTANT', 'COMPTE'].map((h, j) => el('th', { class: j >= 3 && j <= 6 ? 'n' : '' }, h)))),
        el('tbody', {}, ...tx.slice(0, 300).map(t => {
          const inst = Store.instrument(t.key) || {}, q = parseNum(t.qty), pr = parseNum(t.price), fe = parseNum(t.fees) || 0;
          return el('tr', { onclick: () => this.termLoad(t.key, 'DES') }, el('td', {}, new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR')),
            el('td', { class: (T[t.type] || ['', ''])[1] }, (T[t.type] || [t.type])[0]), el('td', {}, el('b', {}, inst.symbol || t.key)),
            el('td', { class: 'n' }, t.type === 'split' ? q + ':1' : fmtQty(q)), el('td', { class: 'n' }, t.type === 'split' ? '' : fmtNum(pr, 2)), el('td', { class: 'n' }, fe ? fmtNum(fe, 2) : ''),
            el('td', { class: 'n' }, t.type === 'split' ? '' : fmtMoney(t.type === 'div' ? q * pr : q * pr + (t.type === 'buy' ? fe : -fe), inst.currency || cur, 2)),
            el('td', { class: 'dim' }, Store.state.accounts.length > 1 && t.account ? (Store.account(t.account) || {}).name || '' : ''));
        }))) : el('p', { class: 'dim' }, 'Aucune opération saisie.'));
  } },
  CAL: { title: 'AGENDA : ÉCHÉANCES À 90 JOURS', render(body) {
    const ev = typeof Agenda !== 'undefined' ? Agenda.events(todayISO(), 90) : [];
    const cur = this.base();
    body.replaceChildren(ev.length ? el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['DATE', 'TYPE', 'ÉVÉNEMENT', 'MONTANT'].map((h, j) => el('th', { class: j === 3 ? 'n' : '' }, h)))),
      el('tbody', {}, ...ev.slice(0, 80).map(e => el('tr', {}, el('td', {}, new Date(e.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()),
        el('td', { class: 'warn' }, ((AGENDA_KINDS[e.kind] || {}).label || e.kind).toUpperCase()), el('td', {}, e.title, e.sub ? el('span', { class: 'dim' }, '  ' + e.sub) : ''),
        el('td', { class: 'n' }, isFinite(e.amount) ? fmtMoney(e.amount, cur, 0) : ''))))) : el('p', { class: 'dim' }, 'Aucune échéance dans les 90 prochains jours.'));
  } },
  ALRT: { title: 'ALERTES DE PRIX', render(body) {
    const A = Store.state.alerts || [];
    body.replaceChildren(A.length ? el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['TICKER', 'CONDITION', 'COURS', 'ÉTAT'].map((h, j) => el('th', { class: j === 2 ? 'n' : '' }, h)))),
      el('tbody', {}, ...A.map(a => { const q = Api.cachedQuote(a.key);
        return el('tr', { onclick: () => this.termLoad(a.key, 'GP') }, el('td', {}, el('b', {}, (Store.instrument(a.key) || {}).symbol || a.key)), el('td', {}, this.alertText(a)),
          el('td', { class: 'n' }, q ? fmtNum(q.price, 2) : '—'), el('td', { class: a.triggeredAt ? 'warn' : a.active ? 'tu' : 'dim' }, a.triggeredAt ? 'DÉCLENCHÉE' : a.active ? 'ACTIVE' : 'EN PAUSE'));
      }))) : el('p', { class: 'dim' }, 'Aucune alerte. Crée-en depuis l\'onglet Investir → Alertes.'));
  } },
  SECF: { sticky: 600, title: 'RECHERCHE DE VALEURS', render(body, p) { if (!p.q) { body.replaceChildren(el('p', { class: 'dim' }, 'Tape SECF <nom, symbole ou ISIN>, par exemple SECF LVMH.')); return; } this.renderTermSecf(body, p); } },
  TOP: { sticky: 300, title: 'À LA UNE : ACTUALITÉ DES MARCHÉS', render(body) { this.renderTermNews(body, null, true); } },
  CLK: { title: 'HORLOGES ET SÉANCES DES BOURSES', render(body) {
    const now = Date.now();
    body.replaceChildren(el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, ...['PLACE', 'HEURE', 'ÉTAT', ''].map((h, j) => el('th', { class: j === 1 ? 'n' : '' }, h)))),
      el('tbody', {}, ...EXCHANGES.map(e => {
        const st = Markets.status(e, now), t = st.localTime;
        return el('tr', {}, el('td', {}, el('span', { class: 'term-dot ' + st.state }), e.name.toUpperCase()), el('td', { class: 'n' }, `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`),
          el('td', { class: st.state === 'open' ? 'tu' : st.state === 'break' ? 'warn' : 'dim' }, { open: 'OUVERT', break: 'PAUSE', closed: 'FERMÉ' }[st.state] || st.state.toUpperCase()),
          el('td', { class: 'dim' }, Markets.summary(st, now)));
      }))));
  } },
  HELP: { title: 'AIDE : COMMANDES', render(body) {
    body.replaceChildren(el('pre', { class: 'term-help' },
`SYNTAXE   <VALEUR> [SECTEUR] <FONCTION> [PÉRIODE] <GO>
          CW8 <GO>  ·  CW8 GP <GO>  ·  AAPL US EQUITY DES  ·  GOLD CMDTY GPC 5A
          EURUSD CURNCY GP  ·  SPX INDEX GIP 5J  ·  BTC CRYPTO HP
          « 2 WEI » ouvre WEI dans la fenêtre 2 · « 3 » lance l'action 3)
          TAB complète · ↑↓ rappelle les commandes · ALT+Z agrandit la fenêtre

GRAPHES   GP    chandeliers (1M 3M 6M YTD 1A 2A 5A MAX), barres, Heikin-Ashi,
                ligne, aire · périodicité J/S/M · MM20/50/200, Bollinger,
                volume, RSI, MACD · échelle LOG · molette = zoom
          GPC   chandeliers   GPO  barres OHLC   GPH  Heikin-Ashi   GPL  ligne
          GIP   intraday (1J en 5 min, 5J en 15 min)
          COMP  comparaison en % : COMP SPX CAC DAX GOLD
VALEUR    DES   fiche, performances, risque, ta position
          HP    historique OHLC + volume (jour, semaine, mois)
          DVD   dividendes sur 10 ans, rendement
          NEWS  dépêches de la valeur
MARCHÉS   WEI   indices mondiaux        WMAP  carte des marchés
          CMDTY toutes les matières premières (contrats à terme)  CMAP carte
          FX    devises + matrice       CRYPTO  crypto-actifs
          GOVT  taux US et courbe       MOV   plus fortes variations
          TOP   actualité des marchés   CLK   horloges des bourses
          SECF  recherche : SECF LVMH, SECF FR0010315770
TOI       PORT  portefeuille   MON  suivi (ADD / DEL <valeur>)   HEAT  chaleur
          RSK   risque (VaR, bêta, contributions)   CORR  corrélations
          SCAN  signaux   XRAY  tes entreprises   BLT  opérations
          CAL   agenda    ALRT  alertes
ÉCRANS    LAY 1 défaut · 2 marchés · 3 valeur · 4 matières premières
          5 risque · 6 veille        ZOOM  agrandir la fenêtre active

TOUCHES   F1 AIDE F2 SCAN F3 WEI F4 XRAY F5 FX F6 CMDTY F7 MOV F8 TOP
          F9 DES F10 QUITTER F11 GP F12 COMP · ÉCHAP quitter
ALIAS     SPX CCMP NDX INDU RTY CAC DAX UKX SX5E NKY HSI VIX · GOLD SILVER
          WTI BRENT NATGAS COPPER WHEAT CORN SOY COFFEE COCOA SUGAR CATTLE…
          BTC ETH · US10Y DXY · ou tout symbole Yahoo (MC.PA, AAPL, ASML.AS)`));
  } },
  DES: { sec: true, sticky: 20, title: 'DESCRIPTION', render(body) { this.termNeedKey(this.termKey); this.renderTermDes(body, this.termKey); } },
  GP: { sec: true, chart: true, title: 'GRAPHIQUE', render(body, p, i) { this.termNeedKey(this.termKey); this.renderTermCandle(i, body, this.termKey, p); } },
  GIP: { sec: true, chart: true, title: 'GRAPHIQUE INTRADAY', render(body, p, i) { this.termNeedKey(this.termKey); this.renderTermCandle(i, body, this.termKey, p); } },
  HP: { sec: true, sticky: 300, title: 'HISTORIQUE DES COURS', render(body, p) { this.renderTermHp(body, this.termKey, p); } },
  DVD: { sec: true, sticky: 600, title: 'DIVIDENDES', render(body) { this.renderTermDvd(body, this.termKey); } },
  NEWS: { sec: true, sticky: 300, title: 'DÉPÊCHES', render(body) { this.renderTermNews(body, this.termKey); } },
  GPC: { alias: 'GP', set: { style: 'candle' } }, GPO: { alias: 'GP', set: { style: 'ohlc' } }, GPH: { alias: 'GP', set: { style: 'heikin' } }, GPL: { alias: 'GP', set: { style: 'line' } },
  GPA: { alias: 'GP', set: { style: 'area' } }, G: { alias: 'GP' }, CN: { alias: 'NEWS' }, N: { alias: 'TOP' }, W: { alias: 'MON' }, IMAP: { alias: 'HEAT' }, WCR: { alias: 'FX' },
  FXC: { alias: 'FX' }, GLCO: { alias: 'CMDTY' }, BTMM: { alias: 'GOVT' }, MOST: { alias: 'MOV' }, WB: { alias: 'GOVT' }, PRTU: { alias: 'PORT' }, PORT2: { alias: 'RSK' },
  VAR: { alias: 'RSK' }, RV: { alias: 'COMP' }, HS: { alias: 'COMP' }, DVDH: { alias: 'DVD' }, EVTS: { alias: 'CAL' }, CALL: { alias: 'CAL' }, ALERT: { alias: 'ALRT' }, TX: { alias: 'BLT' },
  CRYP: { alias: 'CRYPTO' }, RATES: { alias: 'GOVT' }, MAP: { alias: 'WMAP' }, NEWS2: { alias: 'TOP' },
};

/** replaceChildren sans les éléments absents (null, false…), qui s'afficheraient sinon en texte « null » ; renvoie le nœud */
function termFill(node, ...kids) { node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '')); return node; }
