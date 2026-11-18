/*
 * Filtre d'actions (Marchés › Signaux) : une centaine de grandes sociétés françaises, européennes et américaines
 * passées au crible de leurs chiffres — valorisation (PER, PEG, cours / actif net), dividende, croissance, rentabilité,
 * endettement et avis des analystes. Profils prêts à l'emploi (value, rendement, croissance raisonnable, qualité,
 * potentiel) ou seuils libres ; éligibilité au PEA indiquée. Données Yahoo lues par le relais (type=summary,
 * paquets de 20 sociétés), gardées 24 h dans le navigateur. Un outil de recherche d'idées, pas un conseil.
 * Calculs purs (objet Screener) testés dans tests/screener.test.mjs ; affichage en bas du fichier.
 */
'use strict';

const SCREEN_MODULES = 'financialData,summaryDetail,defaultKeyStatistics';
/* Univers : [symbole Yahoo, nom, zone (fr | eu | us), éligible au PEA] */
const SCREEN_UNIVERSE = [
  ['AI.PA', 'Air Liquide', 'fr', 1], ['AIR.PA', 'Airbus', 'fr', 1], ['ALO.PA', 'Alstom', 'fr', 1], ['MT.AS', 'ArcelorMittal', 'eu', 1], ['CS.PA', 'AXA', 'fr', 1],
  ['BNP.PA', 'BNP Paribas', 'fr', 1], ['EN.PA', 'Bouygues', 'fr', 1], ['CAP.PA', 'Capgemini', 'fr', 1], ['CA.PA', 'Carrefour', 'fr', 1], ['ACA.PA', 'Crédit Agricole', 'fr', 1],
  ['BN.PA', 'Danone', 'fr', 1], ['DSY.PA', 'Dassault Systèmes', 'fr', 1], ['EDEN.PA', 'Edenred', 'fr', 1], ['ENGI.PA', 'Engie', 'fr', 1], ['EL.PA', 'EssilorLuxottica', 'fr', 1],
  ['ERF.PA', 'Eurofins Scientific', 'fr', 1], ['RMS.PA', 'Hermès', 'fr', 1], ['KER.PA', 'Kering', 'fr', 1], ['OR.PA', 'L\'Oréal', 'fr', 1], ['LR.PA', 'Legrand', 'fr', 1],
  ['MC.PA', 'LVMH', 'fr', 1], ['ML.PA', 'Michelin', 'fr', 1], ['ORA.PA', 'Orange', 'fr', 1], ['RI.PA', 'Pernod Ricard', 'fr', 1], ['PUB.PA', 'Publicis', 'fr', 1],
  ['RNO.PA', 'Renault', 'fr', 1], ['SAF.PA', 'Safran', 'fr', 1], ['SGO.PA', 'Saint-Gobain', 'fr', 1], ['SAN.PA', 'Sanofi', 'fr', 1], ['SU.PA', 'Schneider Electric', 'fr', 1],
  ['GLE.PA', 'Société Générale', 'fr', 1], ['STLAP.PA', 'Stellantis', 'fr', 1], ['STMPA.PA', 'STMicroelectronics', 'fr', 1], ['TEP.PA', 'Teleperformance', 'fr', 1],
  ['HO.PA', 'Thales', 'fr', 1], ['TTE.PA', 'TotalEnergies', 'fr', 1], ['URW.PA', 'Unibail-Rodamco-Westfield', 'fr', 1], ['VIE.PA', 'Veolia', 'fr', 1], ['DG.PA', 'Vinci', 'fr', 1],
  ['AC.PA', 'Accor', 'fr', 1], ['BVI.PA', 'Bureau Veritas', 'fr', 1],
  ['ASML.AS', 'ASML', 'eu', 1], ['SAP.DE', 'SAP', 'eu', 1], ['SIE.DE', 'Siemens', 'eu', 1], ['ALV.DE', 'Allianz', 'eu', 1], ['DTE.DE', 'Deutsche Telekom', 'eu', 1],
  ['MBG.DE', 'Mercedes-Benz', 'eu', 1], ['BAS.DE', 'BASF', 'eu', 1], ['VOW3.DE', 'Volkswagen (préf.)', 'eu', 1], ['IFX.DE', 'Infineon', 'eu', 1], ['MUV2.DE', 'Munich Re', 'eu', 1],
  ['NESN.SW', 'Nestlé', 'eu', 0], ['NOVN.SW', 'Novartis', 'eu', 0], ['RO.SW', 'Roche', 'eu', 0], ['NOVO-B.CO', 'Novo Nordisk', 'eu', 1], ['AZN.L', 'AstraZeneca', 'eu', 0],
  ['SHEL.L', 'Shell', 'eu', 0], ['HSBA.L', 'HSBC', 'eu', 0], ['ULVR.L', 'Unilever', 'eu', 0], ['ITX.MC', 'Inditex', 'eu', 1], ['SAN.MC', 'Banco Santander', 'eu', 1],
  ['IBE.MC', 'Iberdrola', 'eu', 1], ['ISP.MI', 'Intesa Sanpaolo', 'eu', 1], ['ENEL.MI', 'Enel', 'eu', 1], ['UCG.MI', 'UniCredit', 'eu', 1], ['ABI.BR', 'AB InBev', 'eu', 1],
  ['INGA.AS', 'ING', 'eu', 1], ['ADYEN.AS', 'Adyen', 'eu', 1], ['PRX.AS', 'Prosus', 'eu', 1], ['RACE.MI', 'Ferrari', 'eu', 1], ['NOKIA.HE', 'Nokia', 'eu', 1],
  ['AAPL', 'Apple', 'us', 0], ['MSFT', 'Microsoft', 'us', 0], ['NVDA', 'NVIDIA', 'us', 0], ['AMZN', 'Amazon', 'us', 0], ['GOOGL', 'Alphabet', 'us', 0], ['META', 'Meta Platforms', 'us', 0],
  ['TSLA', 'Tesla', 'us', 0], ['BRK-B', 'Berkshire Hathaway', 'us', 0], ['JPM', 'JPMorgan Chase', 'us', 0], ['V', 'Visa', 'us', 0], ['MA', 'Mastercard', 'us', 0],
  ['UNH', 'UnitedHealth', 'us', 0], ['JNJ', 'Johnson & Johnson', 'us', 0], ['XOM', 'ExxonMobil', 'us', 0], ['PG', 'Procter & Gamble', 'us', 0], ['HD', 'Home Depot', 'us', 0],
  ['KO', 'Coca-Cola', 'us', 0], ['PEP', 'PepsiCo', 'us', 0], ['COST', 'Costco', 'us', 0], ['WMT', 'Walmart', 'us', 0], ['ABBV', 'AbbVie', 'us', 0], ['LLY', 'Eli Lilly', 'us', 0],
  ['MRK', 'Merck & Co', 'us', 0], ['AVGO', 'Broadcom', 'us', 0], ['ORCL', 'Oracle', 'us', 0], ['CSCO', 'Cisco', 'us', 0], ['ADBE', 'Adobe', 'us', 0], ['CRM', 'Salesforce', 'us', 0],
  ['NFLX', 'Netflix', 'us', 0], ['DIS', 'Disney', 'us', 0], ['MCD', 'McDonald\'s', 'us', 0], ['NKE', 'Nike', 'us', 0], ['INTC', 'Intel', 'us', 0], ['AMD', 'AMD', 'us', 0],
  ['CVX', 'Chevron', 'us', 0], ['BAC', 'Bank of America', 'us', 0], ['PFE', 'Pfizer', 'us', 0],
];
const SCREEN_ZONES = { all: 'Toutes', fr: 'France', eu: 'Europe hors France', us: 'États-Unis' };
/* Seuils : clé de filtre → [indicateur, sens (max | min), libellé, unité] */
const SCREEN_FIELDS = {
  peMax: ['pe', 'max', 'PER au plus', ''],
  pegMax: ['peg', 'max', 'PEG au plus', ''],
  dyMin: ['dy', 'min', 'Dividende d\'au moins', '%'],
  payoutMax: ['payout', 'max', 'Part des bénéfices distribuée au plus', '%'],
  growthMin: ['epsGrowth', 'min', 'Croissance des bénéfices d\'au moins', '%'],
  roeMin: ['roe', 'min', 'Rentabilité des capitaux propres d\'au moins', '%'],
  marginMin: ['margin', 'min', 'Marge nette d\'au moins', '%'],
  debtMax: ['debtEq', 'max', 'Dette / capitaux propres au plus', '%'],
  upsideMin: ['upside', 'min', 'Potentiel selon les analystes d\'au moins', '%'],
  recoMax: ['reco', 'max', 'Avis moyen des analystes au plus (1 = achat fort)', ''],
};
const SCREEN_PRESETS = [
  { id: 'value', name: 'Value', hint: 'peu chères au regard de leurs bénéfices', f: { peMax: 15, debtMax: 150 } },
  { id: 'yield', name: 'Rendement', hint: 'dividende élevé et soutenable', f: { dyMin: 3.5, payoutMax: 80 } },
  { id: 'garp', name: 'Croissance raisonnable', hint: 'croissance des bénéfices à prix raisonnable', f: { growthMin: 10, pegMax: 1.5 } },
  { id: 'quality', name: 'Qualité', hint: 'rentables et peu endettées', f: { roeMin: 15, marginMin: 15, debtMax: 100 } },
  { id: 'upside', name: 'Potentiel', hint: 'les analystes y voient le plus de hausse', f: { upsideMin: 15, recoMax: 2.5 } },
  { id: 'all', name: 'Tout voir', hint: 'aucun filtre', f: {} },
];
/* Colonnes du tableau : indicateur → [libellé, format, explication] */
const SCREEN_COLS = {
  pe: ['PER', 'x', 'Cours ÷ bénéfice par action des 12 derniers mois. Moins de 15 : bon marché ; plus de 30 : le marché attend beaucoup de croissance.'],
  dy: ['Dividende', '%', 'Dividendes sur un an ÷ cours.'],
  epsGrowth: ['Croiss. bénéf.', '%', 'Évolution du bénéfice du dernier trimestre sur un an.'],
  roe: ['ROE', '%', 'Rentabilité des capitaux propres : bénéfice ÷ fonds apportés par les actionnaires.'],
  margin: ['Marge nette', '%', 'Bénéfice ÷ chiffre d\'affaires.'],
  debtEq: ['Dette/CP', '%', 'Dette financière ÷ capitaux propres.'],
  upside: ['Potentiel', '%', 'Objectif de cours moyen des analystes à 12 mois ÷ cours actuel − 1.'],
  reco: ['Avis', 'r', 'Consensus des analystes (1 = achat fort … 5 = vente).'],
};

const Screener = {
  /** Indicateurs d'une société à partir des modules Yahoo (null quand ils manquent) ; pourcentages en % */
  metrics(d) {
    const r = Fundamentals.raw;
    const fd = (d && d.financialData) || {}, sd = (d && d.summaryDetail) || {}, ks = (d && d.defaultKeyStatistics) || {};
    const pc = x => (x === null ? null : x * 100);
    const price = r(fd.currentPrice), target = r(fd.targetMeanPrice);
    const pe = r(sd.trailingPE);
    const dy = r(sd.dividendYield) !== null ? r(sd.dividendYield) : r(sd.trailingAnnualDividendYield);
    return {
      pe: pe !== null && pe > 0 ? pe : null,
      fpe: r(sd.forwardPE) > 0 ? r(sd.forwardPE) : null,
      peg: r(ks.pegRatio) > 0 ? r(ks.pegRatio) : (r(ks.trailingPegRatio) > 0 ? r(ks.trailingPegRatio) : null),
      pb: r(ks.priceToBook) > 0 ? r(ks.priceToBook) : null,
      dy: dy !== null ? dy * 100 : 0,
      payout: pc(r(sd.payoutRatio)),
      epsGrowth: pc(r(fd.earningsGrowth)),
      revGrowth: pc(r(fd.revenueGrowth)),
      roe: pc(r(fd.returnOnEquity)),
      margin: pc(r(fd.profitMargins)),
      debtEq: r(fd.debtToEquity),
      upside: price && target ? (target / price - 1) * 100 : null,
      reco: r(fd.recommendationMean),
      mcap: r(sd.marketCap),
      ccy: fd.financialCurrency || sd.currency || null,
    };
  },

  /** Une société passe-t-elle les seuils ? Un indicateur inconnu ne passe pas un seuil qui le concerne */
  passes(m, filters) {
    for (const [k, v] of Object.entries(filters || {})) {
      if (v === null || v === undefined || v === '' || !isFinite(v) || !SCREEN_FIELDS[k]) continue;
      const [field, dir] = SCREEN_FIELDS[k];
      const x = m[field];
      if (x === null || x === undefined || !isFinite(x)) return false;
      if (dir === 'max' ? x > v : x < v) return false;
    }
    return true;
  },

  /** Lignes [{ sym, name, zone, pea, m }] filtrées par zone, PEA et seuils */
  filter(rows, { zone = 'all', pea = false, filters = {} } = {}) {
    return rows.filter(row => (zone === 'all' || row.zone === zone) && (!pea || row.pea) && row.m && this.passes(row.m, filters));
  },
};

Object.assign(App, {
  screenState() {
    if (!this._screen) this._screen = { preset: 'value', zone: 'all', pea: false, filters: Object.assign({}, SCREEN_PRESETS[0].f), sort: null };
    return this._screen;
  },

  /** Données des sociétés de l'univers : cache de 24 h, puis le relais par paquets de 20 (progression dans `onProgress`) */
  async loadScreenData(onProgress) {
    const c = Fundamentals.load(), now = Date.now();
    const todo = SCREEN_UNIVERSE.map(u => u[0]).filter(s => !c[s + '|screen'] || now - c[s + '|screen'].ts > Fundamentals.TTL);
    let done = SCREEN_UNIVERSE.length - todo.length;
    if (onProgress) onProgress(done);
    const chunks = [];
    for (let i = 0; i < todo.length; i += 20) chunks.push(todo.slice(i, i + 20));
    for (let i = 0; i < chunks.length; i += 2) {
      await Promise.all(chunks.slice(i, i + 2).map(async chunk => {
        try {
          const json = await Api.yahoo({ type: 'summary', symbols: chunk.join(','), modules: SCREEN_MODULES });
          if (!json || typeof json.results !== 'object' || !json.results) throw new ApiError('requête invalide', 0);
          for (const s of chunk) c[s + '|screen'] = { ts: Date.now(), kind: 'screen', data: json.results[s] || null };
        } catch (e) {
          if (/requête invalide/i.test(e.message || '')) throw e; // relais ancien : inutile d'essayer les autres paquets
        }
        done += chunk.length;
        if (onProgress) onProgress(done);
      }));
    }
    Fundamentals.save();
    return SCREEN_UNIVERSE.map(([sym, name, zone, pea]) => {
      const e = c[sym + '|screen'];
      return { sym, name, zone, pea: !!pea, m: e && e.data ? Screener.metrics(e.data) : null };
    });
  },

  renderScreenForm() {
    const box = $('#screenBody');
    if (!box || box.querySelector('#screenForm')) return;
    const st = this.screenState();
    const inputs = el('div', { class: 'screen-fields', id: 'screenFields' });
    const drawInputs = () => inputs.replaceChildren(...Object.entries(SCREEN_FIELDS).map(([k, [, , label, unit]]) =>
      el('label', {}, el('span', {}, label + (unit ? ` (${unit})` : '')),
        el('input', { type: 'number', step: 'any', inputmode: 'decimal', value: st.filters[k] ?? '', placeholder: '—', 'data-k': k, oninput: e => {
          const v = e.target.value.trim();
          if (v === '') delete st.filters[k]; else st.filters[k] = parseNum(v);
          st.preset = null;
          $$('#screenPresets button').forEach(b => b.classList.remove('active'));
          this.renderScreenResults();
        } }))));
    drawInputs();
    box.replaceChildren(el('div', { id: 'screenForm', class: 'screen-form' },
      el('div', { class: 'seg', id: 'screenPresets', role: 'group', 'aria-label': 'Profils' }, ...SCREEN_PRESETS.map(p =>
        el('button', { type: 'button', class: st.preset === p.id ? 'active' : '', title: p.hint, 'data-preset': p.id, onclick: () => {
          st.preset = p.id; st.filters = Object.assign({}, p.f);
          $$('#screenPresets button').forEach(b => b.classList.toggle('active', b.dataset.preset === p.id));
          drawInputs(); this.renderScreenResults();
        } }, p.name))),
      el('div', { class: 'screen-opts' },
        el('label', {}, 'Zone ', el('select', { id: 'screenZone', onchange: e => { st.zone = e.target.value; this.renderScreenResults(); } },
          ...Object.entries(SCREEN_ZONES).map(([id, l]) => el('option', { value: id, selected: st.zone === id || null }, l)))),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', id: 'screenPea', checked: st.pea || null, onchange: e => { st.pea = e.target.checked; this.renderScreenResults(); } }), ' Éligibles au PEA'),
        el('details', { class: 'screen-adv' }, el('summary', {}, 'Seuils'), inputs))),
    el('div', { id: 'screenOut' }, el('p', { class: 'muted' }, `${SCREEN_UNIVERSE.length} grandes sociétés françaises, européennes et américaines : « Filtrer » charge leurs chiffres (une fois par jour).`)));
  },

  async runScreener() {
    this.renderScreenForm();
    const out = $('#screenOut'), btn = $('#screenRun');
    if (!out) return;
    if (!Api.hasProxy()) { out.replaceChildren(el('p', { class: 'muted' }, 'Le relais Yahoo est nécessaire (Réglages).')); return; }
    btn.disabled = true;
    const prog = el('p', { class: 'muted small' });
    out.replaceChildren(prog);
    try {
      this._screenRows = await this.loadScreenData(n => { prog.textContent = `Chargement des chiffres des sociétés… ${n}/${SCREEN_UNIVERSE.length}`; });
      this.renderScreenResults();
    } catch (e) {
      out.replaceChildren(el('p', { class: 'muted' }, /requête invalide/i.test(e.message || '')
        ? 'Filtre indisponible : ton relais Yahoo doit être mis à jour (copie à nouveau proxy/cloudflare-worker.js dans ton worker Cloudflare, puis Deploy).'
        : 'Données indisponibles pour l\'instant (' + (e.message || e) + ').'));
    } finally { btn.disabled = false; btn.textContent = 'Actualiser'; }
  },

  renderScreenResults() {
    const out = $('#screenOut'), rows = this._screenRows;
    if (!out || !rows) return;
    const st = this.screenState();
    const known = rows.filter(r => r.m);
    let list = Screener.filter(rows, { zone: st.zone, pea: st.pea, filters: st.filters });
    const sortKey = st.sort ? st.sort.key : (st.filters.dyMin ? 'dy' : st.filters.upsideMin ? 'upside' : st.filters.growthMin ? 'epsGrowth' : st.filters.roeMin ? 'roe' : 'pe');
    const dir = st.sort ? st.sort.dir : (['pe', 'debtEq', 'reco'].includes(sortKey) ? 'asc' : 'desc');
    list = WatchCols.sort(list, r => r.m[sortKey], dir);
    const fmt = (v, f) => (v === null || v === undefined || !isFinite(v) ? '—' : f === '%' ? fmtNum(v, 1) + ' %' : f === 'x' ? fmtNum(v, 1) : fmtNum(v, 1));
    const recoTone = v => { const c = Fundamentals.consensus(v); return c ? c.tone : ''; };
    const head = el('tr', {}, el('th', {}, 'Société'), ...Object.entries(SCREEN_COLS).map(([k, [label, , tip]]) =>
      el('th', { class: 'num sortable' + (k === sortKey ? ' sorted ' + dir : ''), title: tip, 'aria-sort': k === sortKey ? (dir === 'asc' ? 'ascending' : 'descending') : null,
        onclick: () => { st.sort = { key: k, dir: k === sortKey && dir === 'desc' ? 'asc' : k === sortKey ? 'desc' : (['pe', 'debtEq', 'reco'].includes(k) ? 'asc' : 'desc') }; this.renderScreenResults(); } },
      label, k === sortKey ? (dir === 'asc' ? ' ▲' : ' ▼') : '')), el('th', {}));
    out.replaceChildren(
      el('p', { class: 'small' }, el('b', {}, `${list.length} société${list.length > 1 ? 's' : ''}`), ` sur ${known.length} analysées`,
        known.length < rows.length ? el('span', { class: 'muted' }, ` (${rows.length - known.length} sans données chez Yahoo pour l'instant)`) : null, '.'),
      list.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'data screen-table' },
        el('thead', {}, head),
        el('tbody', {}, ...list.slice(0, 60).map(r => el('tr', {},
          el('td', { class: 'txt' }, el('button', { type: 'button', class: 'linklike', title: 'Ouvrir la fiche', onclick: () => this.openScreenSym(r.sym) }, r.name),
            el('small', { class: 'muted' }, ` ${r.sym}${r.pea ? ' · PEA' : ''}`)),
          ...Object.entries(SCREEN_COLS).map(([k, [, f]]) => el('td', { class: 'num mono' + (k === 'reco' ? ' ' + recoTone(r.m[k]) : k === 'upside' ? ' ' + trendClass(r.m[k]) : '') }, fmt(r.m[k], f))),
          el('td', {}, el('button', { type: 'button', class: 'btn small ghost', title: 'Ajouter à ma liste de suivi', 'aria-label': 'Suivre ' + r.name, onclick: e => this.openScreenSym(r.sym, e.currentTarget) }, '★')))))))
        : el('p', { class: 'muted' }, 'Aucune société ne passe tous ces seuils : assouplis-en un (menu « Seuils »).'),
      noteTip('Chiffres Yahoo Finance (12 derniers mois, consensus des analystes), mis à jour une fois par jour. PER, marges et croissance ne se comparent bien qu\'entre sociétés d\'un même secteur : une banque n\'a pas la marge d\'un éditeur de logiciels. Éligibilité au PEA : société dont le siège est dans l\'Union européenne ou l\'Espace économique européen. Une liste d\'idées à creuser dans la fiche de chaque société, pas une recommandation.', 'Sources et limites'));
  },

  /** Ajoute la société (instrument Yahoo) à la liste de suivi et ouvre sa fiche ; `btn` : bouton ★ (sans changer de page) */
  async openScreenSym(sym, btn) {
    try {
      let key = Object.keys(Store.state.instruments).find(k => (Store.instrument(k).ysymbol || '') === sym);
      if (!key) {
        const res = await Api.search(sym);
        const d = res.find(x => x.ysymbol === sym) || res.find(x => (x.symbol || '').toUpperCase() === sym.split('.')[0].toUpperCase() && x.source === 'yahoo');
        if (!d) throw new Error(sym + ' introuvable');
        key = Store.upsertInstrument({ symbol: d.symbol, mic: d.mic, exchange: d.exchange, name: d.name, currency: d.currency, type: d.type, provider: d.provider, ysymbol: d.ysymbol || sym, short: d.short, isin: d.isin });
        const inst = Store.instrument(key);
        inst.provider = d.provider || 'yahoo'; inst.ysymbol = d.ysymbol || sym; Store.save();
      }
      if (!Store.state.watchlist.includes(key)) Store.toggleWatch(key, true);
      if (btn) { btn.textContent = '✓'; btn.disabled = true; toast(Store.label(key) + ' ajouté à ta liste de suivi.', 'success'); this.renderWatchlist(); return; }
      this.show('markets', 'suivi');
      this.selectDetail(key);
    } catch (e) { toast(e.message || String(e), 'error', 5000); }
  },
});

App.on('view:shown', function (page) {
  if (page !== 'markets/signaux') return;
  this.renderScreenForm();
  const b = $('#screenRun');
  if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => this.runScreener()); }
});
