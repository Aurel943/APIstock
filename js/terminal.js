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
   * Écran de salle de marchés en 4 fenêtres. Chaque fenêtre exécute une fonction (PORT, GP, DES, WEI, FX…) ; la ligne de
   * commande s'adresse à la fenêtre active : « CW8 GP <GO> », « EURUSD CURNCY DES », « WEI », « 3 » (action n° 3 du menu).
   * Les fonctions « valeur » (GP, GIP, HP, DES, NEWS) suivent la valeur chargée, partagée par les 4 fenêtres.
   */

  termLoadState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('apistock:term') || 'null'); } catch (e) { s = null; }
    const ok = p => p && TERM_FN[p.fn] && !TERM_FN[p.fn].alias;
    this.termPanes = s && Array.isArray(s.panes) && s.panes.length === 4 && s.panes.every(ok)
      ? s.panes.map(p => ({ fn: p.fn, range: p.range || '1A' }))
      : [{ fn: 'PORT' }, { fn: 'GP', range: '1A' }, { fn: 'WEI' }, { fn: 'DES' }];
    this.termActive = s && s.active >= 0 && s.active < 4 ? s.active : 0;
    if (s && s.key && !this.termKey && (s.key.startsWith('Y:') || Store.instrument(s.key))) this.termKey = s.key;
  },

  termSaveState() {
    try { localStorage.setItem('apistock:term', JSON.stringify({ panes: this.termPanes.map(p => ({ fn: p.fn, range: p.range })), active: this.termActive, key: this.termKey })); }
    catch (e) { /* navigation privée : rien n'est gardé */ }
  },

  openTerminal() {
    const T = $('#term');
    if (!T) return;
    this.termOn = true;
    T.classList.remove('hidden');
    document.body.classList.add('term-open');
    if (!this.termPanes) this.termLoadState();
    this.termKey = this.termKey || this.scanKeys()[0] || 'Y:^GSPC';
    if (!this._termBound) {
      this._termBound = true;
      const input = $('#termCmd');
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; this.termCommand(v); }
      });
      $('#termClose').addEventListener('click', () => this.closeTerminal());
      $$('#termKeys button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.cmd) this.termCommand(b.dataset.cmd);
        else if (b.dataset.ins) { input.value = (input.value.trim() + ' ' + b.dataset.ins).trim() + ' '; input.focus(); }
        else if (b.dataset.go !== undefined) { const v = input.value; input.value = ''; this.termCommand(v); input.focus(); }
      }));
      const fkeys = { F1: 'HELP', F2: 'SCAN', F3: 'WEI', F4: 'XRAY', F5: 'FX', F6: 'CMDTY', F7: 'MOV', F8: 'NEWS', F9: 'DES', F10: 'EXIT' };
      document.addEventListener('keydown', e => {
        if (!this.termOn) return;
        if (e.key === 'Escape') { e.preventDefault(); this.closeTerminal(); }
        else if (fkeys[e.key]) { e.preventDefault(); this.termCommand(fkeys[e.key]); }
        else if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); this.termFocus(+e.key - 1); }
      });
    }
    clearInterval(this._termClock);
    this._termClock = setInterval(() => this.renderTermClock(), 1000);
    clearInterval(this._termRefresh);
    this._termRefresh = setInterval(() => { if (!document.hidden) { this._termLoaded = {}; this.renderTerminal(); } }, 60000);
    this.renderTerminal();
    $('#termCmd').focus();
    if (!this.scanResult || Date.now() - this.scanResult.at > 10 * 60000) this.runScan();
    if (typeof this.loadWorldQuotes === 'function' && Api.hasProxy()) this.loadWorldQuotes().then(() => { if (this.termOn) this.renderTerminal(); }).catch(() => {});
  },

  closeTerminal() {
    this.termOn = false;
    clearInterval(this._termClock);
    clearInterval(this._termRefresh);
    $('#term').classList.add('hidden');
    document.body.classList.remove('term-open');
    for (let i = 0; i < 4; i++) Charts.destroy('termChart' + i);
  },

  termFocus(i) {
    this.termActive = i;
    $$('#termGrid .tp').forEach((p, j) => p.classList.toggle('on', j === i));
    this.renderTermStatus();
    this.termSaveState();
  },

  termMsg(text, bad) { const m = $('#termMsg'); if (m) { m.textContent = text; m.classList.toggle('bad', !!bad); } },

  /** Exécute une commande dans la fenêtre active (ou celle donnée) */
  async termCommand(raw, paneIdx = this.termActive) {
    const toks = String(raw || '').toUpperCase().replace(/[<>]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (toks[toks.length - 1] === 'GO') toks.pop();
    if (!toks.length) return;
    const cmd = toks.join(' ');
    if (['EXIT', 'QUIT', 'Q', 'X'].includes(cmd)) { this.closeTerminal(); return; }
    // « 1 » à « 9 » : action du menu rouge de la fenêtre active
    if (/^\d$/.test(cmd)) {
      const acts = this.termActs(paneIdx);
      const a = acts[+cmd - 1];
      if (a) { a.run(); this.termMsg(`> ${cmd}) ${a.label} ✓`); } else this.termMsg(`> ${cmd} : pas d'action ${cmd} dans cette fenêtre.`, true);
      return;
    }
    // fenêtre ciblée : « 2 WEI »
    if (/^[1-4]$/.test(toks[0]) && toks.length > 1) { paneIdx = +toks.shift() - 1; this.termFocus(paneIdx); }
    // période du graphique : « GP 5A », « CW8 GP MAX »
    let range = null;
    if (toks.length > 1 && /^(1M|6M|YTD|1A|5A|MAX)$/.test(toks[toks.length - 1]) && ['GP', 'G'].includes(toks[toks.length - 2])) range = toks.pop();
    let fn = TERM_FN[toks[toks.length - 1]] ? toks.pop() : null;
    if (fn && TERM_FN[fn].alias) fn = TERM_FN[fn].alias;
    let sector = null;
    if (toks.length && TERM_SECTORS.includes(toks[toks.length - 1])) sector = toks.pop();
    if (toks.length && /^(US|FP|NA|GY|LN|IM|SM|SW|JP|HK)$/.test(toks[toks.length - 1]) && toks.length > 1) toks.pop(); // suffixe de place, ignoré
    const pane = this.termPanes[paneIdx];
    if (toks.length) {
      const sym = toks.join(' ');
      this.termMsg(`> ${sym} … recherche`);
      const key = await this.termResolve(sym, sector);
      if (!key) { this.termMsg(`> ${cmd} : commande inconnue. Tape HELP.`, true); return; }
      this.termKey = key;
      if (!fn) fn = TERM_FN[pane.fn].sec ? pane.fn : 'DES';
    } else if (!fn) { this.termMsg(`> ${cmd} : commande inconnue. Tape HELP.`, true); return; }
    if (range) pane.range = range;
    pane.fn = fn;
    if (fn === 'SCAN') this.runScan();
    this.termMsg(`> ${TERM_FN[fn].sec ? this.termSym(this.termKey) + ' ' : ''}${fn} ✓  ${TERM_FN[fn].title}`);
    this.termSaveState();
    this.renderTerminal();
  },

  /** Symbole tapé → clé d'instrument (« CW8@XPAR ») ou symbole Yahoo brut (« Y:^GSPC ») */
  async termResolve(sym, sector) {
    const s = sym.replace(/\s+/g, '');
    const local = Object.keys(Store.state.instruments).find(k => {
      const i = Store.instrument(k);
      return i.symbol.toUpperCase() === s || (i.ysymbol || '').toUpperCase() === s || (i.ysymbol || '').toUpperCase().split('.')[0] === s || (i.isin || '').toUpperCase() === s;
    });
    if (local && sector !== 'CURNCY' && sector !== 'CRYPTO') return local;
    let y = null;
    if (sector === 'CURNCY' && /^[A-Z]{6}$/.test(s)) y = s + '=X';
    else if (sector === 'CURNCY' && /^[A-Z]{3}$/.test(s)) y = (s === 'EUR' ? 'EURUSD' : 'EUR' + s) + '=X';
    else if (sector === 'CRYPTO') y = s.includes('-') ? s : s + '-USD';
    else if (TERM_ALIAS[s]) y = TERM_ALIAS[s];
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

  /** Charge en arrière-plan les cours Yahoo manquants ou anciens (> 60 s), puis réaffiche */
  termNeed(syms) {
    if (!Api.hasProxy()) return;
    this._termLoaded = this._termLoaded || {};
    const now = Date.now();
    const todo = syms.filter(y => !(this._termLoaded[y] > now - 60000));
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

  /** Historique journalier (5 ans, ou 20 ans pour MAX), cours en direct ajouté pour aujourd'hui */
  async termSeries(key, years = 5) {
    let s = await Api.daily(key, addDaysISO(todayISO(), -Math.round(365.25 * years) - 7));
    const q = this.termQuote(key);
    if (q && q.price > 0) s = s.filter(v => v[0] < todayISO()).concat([[todayISO(), q.price]]);
    return s;
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
    s.replaceChildren(el('span', {}, `FENÊTRE ${this.termActive + 1}`), el('span', {}, `${p.fn}`), el('span', {}, 'VALEUR ', el('b', {}, this.termSym(this.termKey))), relay,
      el('span', { class: 'term-hint' }, 'ALT+1…4 FENÊTRE · 1-9 ACTION · F1 AIDE · ÉCHAP QUITTER'));
  },

  renderTerminal() {
    const T = $('#term');
    if (!T || !this.termOn) return;
    if (!this.termPanes) this.termLoadState();
    const pc = v => (v >= 0 ? 'tu' : 'td');
    // bandeau défilant : tes valeurs + indicateurs mondiaux
    const items = [];
    for (const k of Store.trackedKeys()) { const q = Api.cachedQuote(k); if (q && q.price > 0) items.push([Store.instrument(k).symbol, q.price, q.percentChange]); }
    for (const m of [...MACRO, ...EXCHANGES.map(e => e.index)]) { const q = this.idxQuote(m.y); if (q && q.price > 0) items.push([TERM_SHORT[m.y] || m.name, q.price, q.percentChange]); }
    const tape = items.map(([n, p, ch]) => el('span', { class: 'term-tk' }, el('b', {}, n), ' ', fmtNum(p, p < 10 ? 4 : 2), ' ', el('span', { class: pc(ch) }, (ch >= 0 ? '▲' : '▼') + fmtNum(Math.abs(ch || 0), 2) + '%')));
    $('#termTape').replaceChildren(el('div', { class: 'term-tape-in' }, ...tape, ...tape.map(n => n.cloneNode(true))));
    // fenêtres
    const grid = $('#termGrid');
    if (grid.children.length !== 4) {
      grid.replaceChildren(...[0, 1, 2, 3].map(i => el('section', { class: 'tp', dataset: { i }, onmousedown: () => { if (this.termActive !== i) this.termFocus(i); } },
        el('header', { class: 'tp-bar' }), el('nav', { class: 'tp-acts' }), el('div', { class: 'tp-body' }))));
    }
    this.termPanes.forEach((p, i) => this.renderTermPane(i));
    $$('#termGrid .tp').forEach((p, j) => p.classList.toggle('on', j === this.termActive));
    this.renderTermClock();
    this.renderTermStatus();
  },

  /** Actions numérotées (menu rouge) de la fenêtre i */
  termActs(i) {
    const p = this.termPanes[i], F = TERM_FN[p.fn];
    const go = fn => () => { p.fn = fn; this.termSaveState(); this.renderTermPane(i); this.renderTermStatus(); };
    if (p.fn === 'GP') return ['1M', '6M', 'YTD', '1A', '5A', 'MAX'].map(r => ({ label: r, on: (p.range || '1A') === r, run: () => { p.range = r; this.termSaveState(); this.renderTermPane(i); } }))
      .concat([{ label: 'GIP', run: go('GIP') }, { label: 'HP', run: go('HP') }, { label: 'DES', run: go('DES') }]);
    if (F.sec) return ['DES', 'GP', 'GIP', 'HP', 'NEWS'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
    if (['WEI', 'FX', 'CMDTY', 'CRYPTO', 'GOVT', 'MOV'].includes(p.fn)) return ['WEI', 'FX', 'CMDTY', 'CRYPTO', 'GOVT', 'MOV'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
    return ['PORT', 'MON', 'HEAT', 'SCAN', 'XRAY'].map(f => ({ label: f, on: p.fn === f, run: go(f) }));
  },

  renderTermPane(i) {
    const node = $$('#termGrid .tp')[i];
    if (!node) return;
    const p = this.termPanes[i], F = TERM_FN[p.fn];
    const [bar, acts, body] = node.children;
    const key = this.termKey;
    if (!F.chart) Charts.destroy('termChart' + i);
    // fenêtres lentes à construire (DES, HP, NEWS) : pas de reconstruction à chaque cotation reçue (garde le défilement)
    const sig = `${p.fn}|${key}|${p.range || ''}|${this.termQuote(key) ? 1 : 0}`;
    const fresh = F.sticky && body.dataset.sig === sig && Date.now() - (+body.dataset.at || 0) < F.sticky * 1000;
    termFill(bar, el('span', { class: 'tp-n' }, String(i + 1)),
      el('span', { class: 'tp-fn' }, p.fn), F.sec ? el('span', { class: 'tp-sec' }, this.termSym(key), ' ', el('i', {}, this.termCcy(key))) : null,
      el('span', { class: 'tp-title' }, F.sec ? this.termLabel(key) : F.title));
    acts.replaceChildren(...this.termActs(i).map((a, k) => el('button', { type: 'button', class: a.on ? 'on' : '', onclick: e => { e.stopPropagation(); this.termFocus(i); a.run(); } }, el('b', {}, `${k + 1})`), ' ', a.label)));
    if (fresh) return;
    body.dataset.sig = sig; body.dataset.at = Date.now();
    body.classList.toggle('tp-chart', !!F.chart);
    try { F.render.call(this, body, p, i); }
    catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Erreur : ' + e.message)); }
  },

  /* tableaux de cotations (WEI, FX, CMDTY…) */
  termQuoteTable(rows, cols = ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS']) {
    const pc = v => (!isFinite(v) || v === 0 ? '' : v > 0 ? 'tu' : 'td');
    return el('table', { class: 'term-t' },
      el('thead', {}, el('tr', {}, el('th', {}, ''), ...cols.map(c => el('th', { class: 'n' }, c)))),
      el('tbody', {}, ...rows.map(r => {
        if (r.group) return el('tr', { class: 'grp' }, el('td', { colspan: cols.length + 1 }, r.group));
        const q = this.termQuote(r.key), d = r.digits ?? (q && q.price < 10 ? 4 : 2);
        const vals = {
          'DERNIER': q ? fmtNum(q.price, d) : '…', 'VAR': q ? (q.change > 0 ? '+' : '') + fmtNum(q.change, d) : '', 'VAR %': q ? fmtPct(q.percentChange, 2) : '',
          'HAUT': q ? fmtNum(q.high, d) : '', 'BAS': q ? fmtNum(q.low, d) : '', 'HEURE': q && q.time ? new Date(q.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
        };
        return el('tr', { class: r.key === this.termKey ? 'sel' : '', onclick: () => this.termLoad(r.key) },
          el('td', {}, r.dot ? el('span', { class: 'term-dot ' + r.dot }) : null, el('b', {}, r.label)),
          ...cols.map(c => el('td', { class: 'n ' + (c.startsWith('VAR') && q ? pc(q.change) : '') }, vals[c] ?? '')));
      })));
  },

  /** Clic sur une ligne : charge la valeur ; la fenêtre « valeur » la plus proche l'affiche */
  termLoad(key) {
    this.termKey = key;
    this.termNeedKey(key);
    if (!this.termPanes.some(p => TERM_FN[p.fn].sec)) this.termPanes[3].fn = 'DES';
    this.termSaveState();
    this.renderTerminal();
  },

  async renderTermChart(i, body, key, kind) {
    const p = this.termPanes[i], id = 'termChart' + i;
    let canvas = body.querySelector('canvas');
    if (!canvas) {
      body.replaceChildren(el('div', { class: 'tp-qline' }), el('div', { class: 'term-chart' }, el('canvas', { id })));
      canvas = body.querySelector('canvas');
    }
    const q = this.termQuote(key), qline = body.querySelector('.tp-qline');
    const ccy = this.termCcy(key);
    qline.replaceChildren(...(q ? [el('b', { class: 'big' }, fmtNum(q.price, q.price < 10 ? 4 : 2)), ' ', el('span', { class: q.change >= 0 ? 'tu' : 'td' }, `${q.change >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(q.change), q.price < 10 ? 4 : 2)}  ${fmtPct(q.percentChange, 2)}`),
      el('span', { class: 'dim' }, `  O ${fmtNum(q.open, 2)}  H ${fmtNum(q.high, 2)}  B ${fmtNum(q.low, 2)}  ${ccy}`)] : [el('span', { class: 'dim' }, 'Cours en attente…')]));
    const want = `${key}|${kind}|${p.range}`;
    if (canvas.dataset.want === want && Charts.instances[id]) return;
    canvas.dataset.want = want;
    let labels, data, ma50 = null, ma200 = null;
    try {
      if (kind === 'GIP') {
        let s;
        if (key.startsWith('Y:')) {
          const json = await Api.yahoo({ type: 'chart', symbol: key.slice(2), range: '1d', interval: '5m' });
          const r = json.chart.result[0], cl = r.indicators.quote[0].close;
          s = (r.timestamp || []).map((t, j) => [new Date(t * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), cl[j]]).filter(v => v[1] !== null && isFinite(v[1]));
        } else s = await Api.chartSeries(key, '1J');
        labels = s.map(v => v[0]); data = s.map(v => v[1]);
      } else {
        const range = p.range || '1A';
        const all = await this.termSeries(key, range === 'MAX' ? 20 : 5);
        const from = { '1M': addDaysISO(todayISO(), -31), '6M': addDaysISO(todayISO(), -183), YTD: todayISO().slice(0, 4) + '-01-01', '1A': addDaysISO(todayISO(), -366), '5A': addDaysISO(todayISO(), -1827), MAX: '0000' }[range];
        const closes = all.map(v => v[1]);
        const start = Math.max(0, all.findIndex(v => v[0] >= from));
        labels = all.slice(start).map(v => (range === '1M' || range === '6M' || range === 'YTD' ? v[0].slice(8, 10) + '/' + v[0].slice(5, 7) : v[0].slice(5, 7) + '/' + v[0].slice(2, 4)));
        data = closes.slice(start);
        ma50 = closes.map((_, j) => (j >= 49 ? Scan.sma(closes, 50, j + 1) : null)).slice(start);
        ma200 = closes.map((_, j) => (j >= 199 ? Scan.sma(closes, 200, j + 1) : null)).slice(start);
      }
    } catch (e) {
      if (canvas.dataset.want === want) body.querySelector('.term-chart').replaceChildren(el('p', { class: 'td' }, 'Historique indisponible : ' + e.message));
      return;
    }
    if (!this.termOn || canvas.dataset.want !== want || !canvas.isConnected || typeof Chart === 'undefined') return;
    if (!data.length) { body.querySelector('.term-chart').replaceChildren(el('p', { class: 'dim' }, 'Pas d\'historique pour cette valeur.')); return; }
    Charts.destroy(id);
    const up = data[data.length - 1] >= data[0];
    const o = Charts.baseOptions();
    o.plugins.legend.display = false;
    o.plugins.tooltip = { backgroundColor: '#111', borderColor: '#ff9f1c', borderWidth: 1, titleColor: '#ff9f1c', bodyColor: '#fff', cornerRadius: 0, displayColors: false,
      callbacks: { label: c => (c.datasetIndex === 0 ? '' : c.datasetIndex === 1 ? 'MM50 ' : 'MM200 ') + fmtNum(c.parsed.y, 2) } };
    o.animation = false;
    o.elements = { point: { radius: 0, hoverRadius: 3 } };
    o.scales.x.ticks.color = '#ff9f1c'; o.scales.y.ticks.color = '#ff9f1c';
    o.scales.x.ticks.font = o.scales.y.ticks.font = { family: 'JetBrains Mono', size: 10 };
    o.scales.x.grid = { display: true, color: 'rgba(255,159,28,.08)' };
    o.scales.y.grid = { color: 'rgba(255,159,28,.14)' }; o.scales.y.position = 'right';
    const line = up ? '#2fe37f' : '#ff4d4d';
    const ds = [{ data, borderColor: line, borderWidth: 1.4, tension: 0, fill: 'origin',
      backgroundColor: c => { const a = c.chart.chartArea; if (!a) return 'transparent'; const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, up ? 'rgba(47,227,127,.25)' : 'rgba(255,77,77,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; } }];
    if (ma50) ds.push({ data: ma50, borderColor: '#ffd23f', borderWidth: 1, borderDash: [4, 3], fill: false }, { data: ma200, borderColor: '#4fc3f7', borderWidth: 1, borderDash: [2, 3], fill: false });
    Charts.instances[id] = new Chart(canvas, { type: 'line', options: o, data: { labels, datasets: ds } });
  },

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
        el('div', {}, el('h4', {}, '1) PROFIL'),
          kv('NOM', this.termLabel(key)), kv('TICKER', this.termSym(key)), kv('PLACE', (inst && (inst.exchange || inst.mic)) || (q && q.exchange) || '—'),
          inst && inst.isin ? kv('ISIN', inst.isin) : null, kv('DEVISE', this.termCcy(key) || '—'),
          q ? kv('OUVERTURE', fmtNum(q.open, d)) : null, q ? kv('HAUT / BAS', `${fmtNum(q.high, d)} / ${fmtNum(q.low, d)}`) : null,
          q && q.volume ? kv('VOLUME', fmtNum(q.volume, 0)) : null),
        el('div', { class: 'des-tech' }, el('h4', {}, '2) PERFORMANCE & RISQUE'), el('p', { class: 'dim' }, 'Calcul…'))),
      pos && pos.qty > 0 ? el('div', { class: 'des-pos' }, el('h4', {}, '3) TA POSITION'),
        el('div', { class: 'des-grid' }, kv('QUANTITÉ', fmtQty(pos.qty)), kv('PRU', fmtNum(pos.pru, 2)), kv('VALEUR', fmtMoney(pos.valueBase, cur, 0)),
          kv('+/- VALUE', `${fmtSignedMoney(pos.pnl * pos.fx, cur)} (${fmtPct(pos.pnlPct, 1)})`, pos.pnl >= 0 ? 'tu' : 'td'), kv('JOUR', isFinite(pos.dayBase) ? fmtSignedMoney(pos.dayBase, cur) : '—', pos.dayBase >= 0 ? 'tu' : 'td'))) : null);
    body.replaceChildren(box);
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

  async renderTermHp(body, key) {
    body.replaceChildren(el('p', { class: 'dim' }, 'Chargement de l\'historique…'));
    let s;
    try { s = await this.termSeries(key, 1); } catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Historique indisponible : ' + e.message)); return; }
    if (!body.isConnected || this.termKey !== key) return;
    const rows = s.slice(-61);
    const d = rows.length && rows[rows.length - 1][1] < 10 ? 4 : 2;
    const cl = rows.map(v => v[1]);
    const out = [];
    for (let j = rows.length - 1; j >= 1; j--) out.push([rows[j][0], rows[j][1], rows[j][1] - rows[j - 1][1], (rows[j][1] / rows[j - 1][1] - 1) * 100]);
    body.replaceChildren(
      el('div', { class: 'tp-qline dim' }, `60 SÉANCES · HAUT ${fmtNum(Math.max(...cl), d)} · BAS ${fmtNum(Math.min(...cl), d)} · MOY ${fmtNum(cl.reduce((a, b) => a + b, 0) / (cl.length || 1), d)} · VAR ${fmtPct((cl[cl.length - 1] / cl[0] - 1) * 100, 2)}`),
      el('table', { class: 'term-t' }, el('thead', {}, el('tr', {}, el('th', {}, 'DATE'), el('th', { class: 'n' }, 'CLÔTURE'), el('th', { class: 'n' }, 'VAR'), el('th', { class: 'n' }, 'VAR %'))),
        el('tbody', {}, ...out.map(([dt, c, ch, pct]) => el('tr', {},
          el('td', {}, new Date(dt + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }).toUpperCase()),
          el('td', { class: 'n' }, fmtNum(c, d)), el('td', { class: 'n ' + (ch >= 0 ? 'tu' : 'td') }, (ch >= 0 ? '+' : '') + fmtNum(ch, d)),
          el('td', { class: 'n ' + (pct >= 0 ? 'tu' : 'td') }, fmtPct(pct, 2)))))));
  },

  async renderTermNews(body, key) {
    if (!Api.hasProxy()) { body.replaceChildren(el('p', { class: 'dim' }, 'Configure le relais Yahoo Finance (Réglages) pour les actualités.')); return; }
    const topic = (key && !key.startsWith('Y:') && this.newsQuery(key)) || (key && key.startsWith('Y:') ? { fr: this.termLabel(key), en: this.termLabel(key), s: key.slice(2), label: this.termLabel(key) } : NEWS_GENERAL);
    if (!body.querySelector('.term-news')) body.replaceChildren(el('p', { class: 'dim' }, 'Chargement des dépêches…'));
    let r;
    try { r = await this.newsFr(topic); } catch (e) { body.replaceChildren(el('p', { class: 'td' }, 'Actualités indisponibles : ' + e.message)); return; }
    if (!body.isConnected || this.termKey !== key) return;
    const items = r.items.slice(0, 25);
    termFill(body, el('ol', { class: 'term-news' }, ...(items.length ? items.map(n => el('li', {},
      el('span', { class: 'nt' }, n.time ? new Date(n.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--'),
      el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title),
      el('span', { class: 'np' }, [n.publisher, n.time ? fmtAgo(n.time) : ''].filter(Boolean).join(' · ')))) : [el('li', { class: 'dim' }, 'Aucune dépêche.')])),
    r.general ? el('p', { class: 'dim small' }, 'Pas de dépêche en français sur cette valeur : actualité générale des marchés.') : null);
  },
});

/* Noms et raccourcis des symboles Yahoo utilisés par le terminal */
const TERM_FX = [['EURUSD=X', 'EUR/USD', 4], ['EURGBP=X', 'EUR/GBP', 4], ['EURCHF=X', 'EUR/CHF', 4], ['EURJPY=X', 'EUR/JPY', 2], ['GBPUSD=X', 'GBP/USD', 4],
  ['USDJPY=X', 'USD/JPY', 2], ['USDCHF=X', 'USD/CHF', 4], ['AUDUSD=X', 'AUD/USD', 4], ['USDCAD=X', 'USD/CAD', 4], ['USDCNY=X', 'USD/CNY', 4], ['DX-Y.NYB', 'DOLLAR INDEX', 2]];
const TERM_CMDTY = [['GC=F', 'OR ($/OZ)'], ['SI=F', 'ARGENT ($/OZ)'], ['PL=F', 'PLATINE'], ['HG=F', 'CUIVRE'], ['CL=F', 'PÉTROLE WTI'], ['BZ=F', 'PÉTROLE BRENT'],
  ['NG=F', 'GAZ NATUREL'], ['ZW=F', 'BLÉ'], ['ZC=F', 'MAÏS'], ['KC=F', 'CAFÉ'], ['SB=F', 'SUCRE']];
const TERM_CRYPTO = [['BTC-USD', 'BITCOIN'], ['ETH-USD', 'ETHEREUM'], ['SOL-USD', 'SOLANA'], ['XRP-USD', 'XRP'], ['BNB-USD', 'BNB'], ['ADA-USD', 'CARDANO'], ['DOGE-USD', 'DOGECOIN'], ['BTC-EUR', 'BITCOIN (€)']];
const TERM_GOVT = [['^IRX', 'US 13 SEMAINES', 3], ['^FVX', 'US 5 ANS', 3], ['^TNX', 'US 10 ANS', 3], ['^TYX', 'US 30 ANS', 3]];
const TERM_CCY = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'HKD', 'SGD', 'INR', 'BRL', 'MXN', 'ZAR', 'TRY'];
const TERM_SECTORS = ['EQUITY', 'INDEX', 'CURNCY', 'CMDTY', 'CRYPTO', 'GOVT', 'CORP', 'MMKT'];
const TERM_ALIAS = { SPX: '^GSPC', SP500: '^GSPC', CCMP: '^IXIC', NASDAQ: '^IXIC', NDX: '^NDX', INDU: '^DJI', DOW: '^DJI', CAC: '^FCHI', CAC40: '^FCHI', DAX: '^GDAXI',
  UKX: '^FTSE', FTSE: '^FTSE', SX5E: '^STOXX50E', SXXP: '^STOXX', NKY: '^N225', NIKKEI: '^N225', HSI: '^HSI', SMI: '^SSMI', IBEX: '^IBEX', AEX: '^AEX', VIX: '^VIX',
  RTY: '^RUT', TSX: '^GSPTSE', SENSEX: '^BSESN', AS51: '^AXJO', SHCOMP: '000001.SS', GOLD: 'GC=F', XAU: 'GC=F', OR: 'GC=F', SILVER: 'SI=F', XAG: 'SI=F', WTI: 'CL=F', CL1: 'CL=F',
  BRENT: 'BZ=F', CO1: 'BZ=F', NATGAS: 'NG=F', NG1: 'NG=F', COPPER: 'HG=F', BTC: 'BTC-USD', BITCOIN: 'BTC-USD', ETH: 'ETH-USD', US10Y: '^TNX', USGG10YR: '^TNX', US30Y: '^TYX', DXY: 'DX-Y.NYB' };
const TERM_SHORT = { '^GSPC': 'SPX', '^IXIC': 'CCMP', '^NDX': 'NDX', '^DJI': 'INDU', '^FCHI': 'CAC', '^GDAXI': 'DAX', '^FTSE': 'UKX', '^STOXX50E': 'SX5E', '^N225': 'NKY',
  '^HSI': 'HSI', '^SSMI': 'SMI', '^IBEX': 'IBEX', '^AEX': 'AEX', '^VIX': 'VIX', 'GC=F': 'GOLD', 'BZ=F': 'BRENT', 'CL=F': 'WTI', 'BTC-EUR': 'BTC€', 'BTC-USD': 'BTC',
  'EURUSD=X': 'EURUSD', '^TNX': 'US10Y', 'FTSEMIB.MI': 'FTSEMIB', '^GSPTSE': 'TSX', '^BSESN': 'SENSEX', '^AXJO': 'AS51', '000001.SS': 'SHCOMP', 'DX-Y.NYB': 'DXY' };
const TERM_CITY = { newyork: 'NY', london: 'LDN', paris: 'PAR', xetra: 'FRA', tokyo: 'TKY', hongkong: 'HK' };

/** Nom lisible d'un symbole Yahoo connu (indices, devises, matières premières, crypto, taux), sinon le symbole */
function termName(y) {
  for (const L of [TERM_FX, TERM_CMDTY, TERM_CRYPTO, TERM_GOVT]) { const f = L.find(x => x[0] === y); if (f) return f[1]; }
  const m = MACRO.find(x => x.y === y); if (m) return m.name.toUpperCase();
  for (const e of EXCHANGES) for (const ix of [e.index, ...(e.extra || [])]) if (ix.y === y) return ix.name.toUpperCase();
  return { '^NDX': 'NASDAQ 100', '^RUT': 'RUSSELL 2000', '^STOXX': 'STOXX EUROPE 600' }[y] || y;
}

/* Fonctions du terminal : titre, valeur (sec : suit la valeur chargée), graphique, rendu */
const TERM_FN = {
  PORT: { title: 'MONITEUR DE PORTEFEUILLE', render(body) {
    const cur = this.base(), { rows, totals } = Portfolio.snapshot();
    const pc = v => (!isFinite(v) || v === 0 ? '' : v > 0 ? 'tu' : 'td');
    const tot = rows.reduce((s, r) => s + (r.valueBase > 0 ? r.valueBase : 0), 0) || 1;
    body.replaceChildren(
      el('div', { class: 'tp-qline' }, 'VALEUR ', el('b', {}, fmtMoney(totals.value, cur, 0)), '   JOUR ', el('b', { class: pc(totals.day) }, `${fmtSignedMoney(totals.day, cur)} (${fmtPct(totals.dayPct, 2)})`),
        '   +/- LAT. ', el('b', { class: pc(totals.pnl) }, `${fmtSignedMoney(totals.pnl, cur)} (${fmtPct(totals.pnlPct, 1)})`)),
      el('table', { class: 'term-t', id: 'termPort' }, el('thead', {}, el('tr', {}, ...['TICKER', 'DERNIER', 'VAR %', 'P&L JOUR', 'VALEUR', 'POIDS', '+/- %'].map((h, j) => el('th', { class: j ? 'n' : '' }, h)))),
        el('tbody', {}, ...rows.sort((a, b) => (b.valueBase || 0) - (a.valueBase || 0)).map(r => el('tr', { class: r.key === this.termKey ? 'sel' : '', onclick: () => this.termLoad(r.key) },
          el('td', {}, el('b', {}, Store.instrument(r.key).symbol)), el('td', { class: 'n' }, fmtNum(r.price, 2)),
          el('td', { class: 'n ' + pc(r.quote ? r.quote.percentChange : 0) }, r.quote ? fmtPct(r.quote.percentChange, 2) : '—'),
          el('td', { class: 'n ' + pc(r.dayBase) }, isFinite(r.dayBase) ? fmtSignedMoney(r.dayBase, cur) : '—'),
          el('td', { class: 'n' }, fmtMoney(r.valueBase, cur, 0)), el('td', { class: 'n' }, fmtNum((r.valueBase || 0) / tot * 100, 1) + '%'),
          el('td', { class: 'n ' + pc(r.pnlBase) }, fmtPct(r.pnlPct, 1)))))));
    if (!rows.length) body.append(el('p', { class: 'dim' }, 'Aucune position. Tape SPX <GO>, WEI, FX… pour explorer les marchés.'));
  } },
  MON: { title: 'LISTE DE SUIVI', render(body) {
    const keys = Store.trackedKeys();
    keys.forEach(k => this.termNeedKey(k));
    body.replaceChildren(keys.length ? this.termQuoteTable(keys.map(k => ({ key: k, label: Store.instrument(k).symbol })), ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS', 'HEURE'])
      : el('p', { class: 'dim' }, 'Liste de suivi vide.'));
  } },
  WEI: { title: 'INDICES BOURSIERS MONDIAUX', render(body) {
    const rows = [];
    for (const reg of ['Amériques', 'Europe', 'Asie-Pacifique']) {
      rows.push({ group: reg.toUpperCase() });
      for (const e of EXCHANGES.filter(x => x.region === reg)) {
        const st = Markets.status(e).state;
        for (const ix of [e.index, ...(e.extra || [])]) rows.push({ key: 'Y:' + ix.y, label: TERM_SHORT[ix.y] ? `${TERM_SHORT[ix.y]}  ${ix.name}` : ix.name, dot: st });
        if (e.id === 'paris') rows.push({ key: 'Y:^STOXX50E', label: 'SX5E  Euro Stoxx 50', dot: st });
      }
    }
    rows.push({ group: 'VOLATILITÉ' }, { key: 'Y:^VIX', label: 'VIX  Indice de la peur' });
    this.termNeed(rows.filter(r => r.key).map(r => r.key.slice(2)));
    body.replaceChildren(this.termQuoteTable(rows, ['DERNIER', 'VAR', 'VAR %', 'HEURE']));
  } },
  FX: { title: 'DEVISES', render(body) {
    this.termNeed(TERM_FX.map(x => x[0]));
    const ccy = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];
    const eur = { EUR: 1, USD: 'EURUSD=X', GBP: 'EURGBP=X', CHF: 'EURCHF=X', JPY: 'EURJPY=X' };
    const r = c => (c === 'EUR' ? 1 : (this.idxQuote(eur[c]) || {}).price);
    body.replaceChildren(this.termQuoteTable(TERM_FX.map(([y, n, d]) => ({ key: 'Y:' + y, label: n, digits: d }))),
      el('h4', { class: 'tp-sub' }, 'MATRICE DES CHANGES CROISÉS (1 LIGNE = X COLONNE)'),
      el('table', { class: 'term-t fxm' }, el('thead', {}, el('tr', {}, el('th', {}, ''), ...ccy.map(c => el('th', { class: 'n' }, c)))),
        el('tbody', {}, ...ccy.map(a => el('tr', {}, el('td', {}, el('b', {}, a)), ...ccy.map(b => {
          const v = r(b) / r(a);
          return el('td', { class: 'n' + (a === b ? ' dim' : '') }, a === b ? '—' : isFinite(v) ? fmtNum(v, v >= 100 ? 2 : 4) : '…');
        }))))));
  } },
  CMDTY: { title: 'MATIÈRES PREMIÈRES (CONTRATS À TERME)', render(body) {
    this.termNeed(TERM_CMDTY.map(x => x[0]));
    body.replaceChildren(this.termQuoteTable(TERM_CMDTY.map(([y, n]) => ({ key: 'Y:' + y, label: n })), ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS', 'HEURE']));
  } },
  CRYPTO: { title: 'CRYPTO-ACTIFS', render(body) {
    this.termNeed(TERM_CRYPTO.map(x => x[0]));
    body.replaceChildren(this.termQuoteTable(TERM_CRYPTO.map(([y, n]) => ({ key: 'Y:' + y, label: n })), ['DERNIER', 'VAR', 'VAR %', 'HAUT', 'BAS']));
  } },
  GOVT: { title: 'TAUX SOUVERAINS AMÉRICAINS (RENDEMENT %)', render(body) {
    this.termNeed(TERM_GOVT.map(x => x[0]));
    const pts = TERM_GOVT.map(([y]) => (this.idxQuote(y) || {}).price);
    body.replaceChildren(this.termQuoteTable(TERM_GOVT.map(([y, n, d]) => ({ key: 'Y:' + y, label: n, digits: d })), ['DERNIER', 'VAR', 'HAUT', 'BAS', 'HEURE']),
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
    const list = (arr, up) => el('ol', { class: 'mov' }, ...arr.map(([k, n, ch]) => el('li', { onclick: () => this.termLoad(k) }, el('span', {}, n),
      el('div', { class: 'mv-bar' }, el('i', { class: up ? 'u' : 'd', style: `width:${Math.abs(ch) / max * 100}%` })), el('b', { class: ch >= 0 ? 'tu' : 'td' }, fmtPct(ch, 2)))));
    body.replaceChildren(el('div', { class: 'mov-cols' },
      el('div', {}, el('h4', { class: 'tp-sub tu' }, '▲ HAUSSES'), list(all.filter(x => x[2] > 0).slice(0, 10), true)),
      el('div', {}, el('h4', { class: 'tp-sub td' }, '▼ BAISSES'), list(all.filter(x => x[2] < 0).reverse().slice(0, 10), false))));
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
        el('li', { class: 'lv-' + s.level, onclick: () => this.termLoad(s.key) }, el('b', {}, Store.instrument(s.key).symbol), ' ', s.text)) : [el('li', {}, S ? 'Aucun signal. Marché calme.' : '…')])));
  } },
  XRAY: { title: 'RADIOGRAPHIE : TES VRAIES ENTREPRISES', render(body) {
    const cur = this.base(), X = Xray.lookthrough(this.xrayList());
    body.replaceChildren(el('div', { class: 'tp-qline' }, 'XRAY  7 MAGNIFIQUES ', el('b', { class: X.mag7 >= 25 ? 'td' : '' }, fmtNum(X.mag7, 1) + '%'), `  ·  COUVERTURE ${fmtNum(X.covered, 0)}%`),
      el('table', { class: 'term-t' }, el('tbody', {}, ...X.companies.slice(0, 20).map(e =>
        el('tr', {}, el('td', {}, e.name, XRAY_MAG7.includes(e.name) ? el('span', { class: 'xr-m7' }, ' M7') : ''), el('td', { class: 'n' }, fmtMoney(e.value, cur, 0)), el('td', { class: 'n' }, fmtNum(e.pct, 1) + '%'))))));
  } },
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
`SYNTAXE   <VALEUR> [SECTEUR] <FONCTION> <GO>
          ex.  CW8 <GO>   ·   CW8 GP <GO>   ·   AAPL US EQUITY DES
               EURUSD CURNCY GP   ·   SPX INDEX GIP   ·   BTC CRYPTO HP
          « 2 WEI » ouvre WEI dans la fenêtre 2 · « 3 » lance l'action 3)

VALEUR    DES   description, performances, risque, ta position
          GP    graphique historique (1M 6M YTD 1A 5A MAX, MM50/MM200)
          GIP   graphique intraday du jour
          HP    historique des cours (60 séances)
          NEWS  dépêches de la valeur
MARCHÉS   WEI   indices mondiaux        FX     devises + matrice
          CMDTY matières premières     CRYPTO crypto-actifs
          GOVT  taux et courbe US      MOV    plus fortes variations
          CLK   horloges des bourses
TOI       PORT  portefeuille   MON  liste de suivi   HEAT  carte de chaleur
          SCAN  signaux techniques     XRAY tes vraies entreprises

TOUCHES   F1 AIDE F2 SCAN F3 WEI F4 XRAY F5 FX F6 CMDTY F7 MOV F8 NEWS
          F9 DES F10 / ÉCHAP QUITTER · ALT+1…4 CHANGER DE FENÊTRE
ALIAS     SPX CCMP NDX INDU CAC DAX UKX SX5E NKY HSI VIX GOLD BRENT
          WTI BTC ETH US10Y DXY … ou tout symbole Yahoo (MC.PA, AAPL)`));
  } },
  DES: { sec: true, sticky: 20, title: 'DESCRIPTION', render(body) { this.termNeedKey(this.termKey); this.renderTermDes(body, this.termKey); } },
  GP: { sec: true, chart: true, title: 'GRAPHIQUE', render(body, p, i) { this.termNeedKey(this.termKey); this.renderTermChart(i, body, this.termKey, 'GP'); } },
  GIP: { sec: true, chart: true, title: 'GRAPHIQUE INTRADAY', render(body, p, i) { this.termNeedKey(this.termKey); this.renderTermChart(i, body, this.termKey, 'GIP'); } },
  HP: { sec: true, sticky: 300, title: 'HISTORIQUE DES COURS', render(body) { this.renderTermHp(body, this.termKey); } },
  NEWS: { sec: true, sticky: 300, title: 'DÉPÊCHES', render(body) { this.renderTermNews(body, this.termKey); } },
  N: { alias: 'NEWS' }, TOP: { alias: 'NEWS' }, W: { alias: 'MON' }, IMAP: { alias: 'HEAT' }, WCR: { alias: 'FX' }, FXC: { alias: 'FX' }, GLCO: { alias: 'CMDTY' },
  BTMM: { alias: 'GOVT' }, MOST: { alias: 'MOV' }, WB: { alias: 'GOVT' }, CN: { alias: 'NEWS' }, G: { alias: 'GP' }, PRTU: { alias: 'PORT' },
};

/** replaceChildren sans les éléments absents (null, false…), qui s'afficheraient sinon en texte « null » */
function termFill(node, ...kids) { node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '')); }
