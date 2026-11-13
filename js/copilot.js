/*
 * Copilote (Ctrl+K ou ⌘K, ou « / ») : une barre où l'on pose ses questions en français, sur ses propres données,
 * sans rien envoyer à personne. « Combien vaut mon portefeuille ? », « dividendes 2025 », « part des États-Unis »,
 * « plus-value sur CW8 », « j'ai besoin de 8 000 € », « 300 €/mois pendant 20 ans à 6 % », « acheter 3 CW8 à 520 »,
 * « crash-test », « mode sombre »… La réponse s'affiche aussitôt, avec des raccourcis vers la carte concernée.
 *
 * Compréhension locale par règles (mots-clés, nombres, noms de tes lignes) : Copilot.parse() est pur et testé
 * (tests/copilot.test.mjs) ; Copilot.answer() calcule la réponse à partir des données du site.
 */
'use strict';

/* Mots trop courants pour servir de symbole boursier (« ON », « AI », « OR »…) */
const COPILOT_STOP = new Set(['a', 'ai', 'au', 'ca', 'ce', 'de', 'du', 'en', 'es', 'et', 'il', 'je', 'la', 'le', 'les', 'ma', 'me', 'mes', 'mon', 'on', 'or', 'ou', 'sa', 'se', 'si', 'ta', 'tu', 'un', 'va', 'vs', 'pea', 'cto', 'etf', 'top', 'ans', 'mois', 'part', 'plus', 'pour', 'tout', 'tous', 'quoi', 'quel', 'cash', 'gain', 'perf', 'world', 'monde']);
/* Mots des noms de fonds qui ne permettent pas de reconnaître une ligne */
const COPILOT_GENERIC = new Set(['amundi', 'ishares', 'lyxor', 'vanguard', 'xtrackers', 'spdr', 'invesco', 'core', 'ucits', 'index', 'indice', 'msci', 'swap', 'bnp', 'paribas', 'easy', 'hsbc', 'wisdomtree', 'global', 'screened', 'select', 'equity', 'shares', 'fund', 'fonds', 'class', 'capitalisation', 'distribution', 'leveraged', 'daily', 'trust', 'monde', 'world']);

/* Expositions reconnues : pays (codes de COUNTRY_FR), zones, secteurs (SECT), devises */
const COPILOT_EXPO = [
  { dim: 'country', keys: ['US'], words: ['usa', 'etats-unis', 'etats unis', 'amerique', 'americain', 'americaines', 'us'], name: 'États-Unis' },
  { dim: 'country', keys: ['JP'], words: ['japon', 'japonais'], name: 'Japon' },
  { dim: 'country', keys: ['FR'], words: ['france', 'francais', 'francaises'], name: 'France' },
  { dim: 'country', keys: ['GB'], words: ['royaume-uni', 'royaume uni', 'uk', 'angleterre', 'britannique'], name: 'Royaume-Uni' },
  { dim: 'country', keys: ['CN', 'HK'], words: ['chine', 'chinois'], name: 'Chine' },
  { dim: 'country', keys: ['DE'], words: ['allemagne', 'allemand'], name: 'Allemagne' },
  { dim: 'country', keys: ['IN'], words: ['inde'], name: 'Inde' },
  { dim: 'country', keys: ['FR', 'DE', 'NL', 'CH', 'GB', 'IT', 'ES', 'BE', 'FI', 'SE', 'DK'], words: ['europe', 'europeen', 'europeennes', 'europeens'], name: 'Europe' },
  { dim: 'country', keys: ['CN', 'TW', 'IN', 'KR', 'BR', 'SA', 'ZA', 'MX'], words: ['emergent', 'emergents', 'pays emergents'], name: 'pays émergents' },
  { dim: 'sector', keys: ['tech'], words: ['tech', 'technologie', 'technologique', 'technologiques'], name: 'technologie' },
  { dim: 'sector', keys: ['fin'], words: ['finance', 'banque', 'banques', 'financier', 'financieres'], name: 'finance' },
  { dim: 'sector', keys: ['health'], words: ['sante', 'pharma', 'pharmaceutique'], name: 'santé' },
  { dim: 'sector', keys: ['energy'], words: ['energie', 'petrole', 'petrolier'], name: 'énergie' },
  { dim: 'sector', keys: ['re'], words: ['immobilier'], name: 'immobilier' },
  { dim: 'sector', keys: ['ind'], words: ['industrie', 'industriel'], name: 'industrie' },
  { dim: 'ccy', keys: ['USD'], words: ['dollar', 'dollars', 'usd'], name: 'dollar' },
  { dim: 'ccy', keys: ['EUR'], words: ['euro', 'eur'], name: 'euro' },
  { dim: 'ccy', keys: ['JPY'], words: ['yen'], name: 'yen' },
  { dim: 'ccy', keys: ['GBP'], words: ['livre sterling', 'livre', 'gbp'], name: 'livre sterling' },
];

const COPILOT_EXAMPLES = ['Combien vaut mon portefeuille ?', 'J\'ai besoin de 5 000 €', 'Part des États-Unis', 'Dividendes 2025', 'Ma meilleure ligne', '300 €/mois pendant 20 ans à 7 %', 'Rendement annualisé', 'Crash-test'];

const Copilot = {
  /** Minuscules, sans accents, apostrophes droites, espaces simples */
  norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘`´]/g, '\'').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  },

  /** Le texte contient-il l'un des mots ou expressions (limites de mots) ? */
  has(t, words) {
    return words.some(w => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t));
  },

  /**
   * Nombres du texte normalisé, avec leur unité :
   * { value, unit: 'money' | 'pct' | 'years' | 'months' | 'year' | '', index }. « 10 000 », « 10k », « 1,5 M€ », « 2 millions ».
   */
  numbers(t) {
    const out = [];
    const re = /(?<![a-z0-9.,])(\d{1,3}(?:[ .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?:\s*(k|m|millions?|milliers?|mille)(?![a-z]))?(?:\s*(%|€|eur(?:os?)?(?![a-z])|ans?(?![a-z])|annees?|mois(?![a-z])|pourcents?|pour cent))?(?![a-z0-9])/g;
    let m;
    while ((m = re.exec(t))) {
      let raw = m[1];
      if (/[ .]\d{3}/.test(raw) && !/^\d+\.\d{1,2}$/.test(raw)) raw = raw.replace(/[ .](?=\d{3}(\D|$))/g, '');
      let v = parseFloat(raw.replace(',', '.'));
      const mult = m[2] ? (/^k|mill(e|ier)/.test(m[2]) ? 1e3 : 1e6) : 1;
      v *= mult;
      const u = m[3] || '';
      let unit = '';
      if (/^%|^pour/.test(u)) unit = 'pct';
      else if (/^€|^eur/.test(u)) unit = 'money';
      else if (/^an|^annee/.test(u)) unit = 'years';
      else if (/^mois/.test(u)) unit = 'months';
      else if (mult > 1) unit = 'money';
      else if (Number.isInteger(v) && v >= 1990 && v <= 2100 && !/[ .,]/.test(m[1])) unit = 'year';
      if (isFinite(v)) out.push({ value: v, unit, index: m.index, end: m.index + m[0].length });
    }
    return out;
  },

  /**
   * Ligne mentionnée dans le texte : symbole exact, ou nom (mots distinctifs).
   * `catalog` : [{ key, symbol, names: [noms] }]. Renvoie { key, start, end } ou null.
   */
  findInstrument(t, catalog) {
    let best = null;
    for (const c of catalog || []) {
      for (const s of [c.symbol, c.ysymbol].filter(Boolean).map(x => this.norm(x).split('.')[0])) {
        if (s.length < 2 || COPILOT_STOP.has(s)) continue;
        const m = new RegExp('(^|[^a-z0-9])(' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')($|[^a-z0-9])').exec(t);
        if (m && (!best || best.score < 10)) best = { key: c.key, score: 10, start: m.index + m[1].length, end: m.index + m[1].length + s.length };
      }
      for (const n of (c.names || []).map(x => this.norm(x))) {
        if (n.length >= 4 && t.includes(n)) { const i = t.indexOf(n); if (!best || best.score < 8) best = { key: c.key, score: 8, start: i, end: i + n.length }; continue; }
        const words = n.split(/[^a-z0-9&]+/).filter(w => (w.length >= 4 || (w.includes('&') && w.length >= 3)) && !COPILOT_GENERIC.has(w) && !/^\d+$/.test(w));
        const hit = words.filter(w => this.has(t, [w]));
        if (hit.length) {
          const score = hit.length * 2 + (/\d/.test(n) && n.match(/\d+/g).some(d => this.has(t, [d])) ? 1 : 0);
          if (!best || score > best.score) { const i = t.indexOf(hit[0]); best = { key: c.key, score, start: i, end: i + hit[0].length }; }
        }
      }
    }
    return best;
  },

  /** Intention de la question : { intent, … } */
  parse(text, catalog = []) {
    const t = this.norm(text).replace(/[?!]+$/, '').trim();
    if (!t) return { intent: 'empty' };
    const has = w => this.has(t, w);
    const inst = this.findInstrument(t, catalog);
    // les nombres se lisent hors du nom de la ligne (« cw8 », « s&p 500 »)
    const rest = inst ? t.slice(0, inst.start) + ' ' + t.slice(inst.end) : t;
    const nums = this.numbers(rest);
    const money = nums.find(n => n.unit === 'money') || nums.find(n => n.unit === '' && n.value >= 50);
    const year = (nums.find(n => n.unit === 'year') || {}).value;
    const key = inst ? inst.key : null;

    if (/^(aide|help|\?|exemples?)$/.test(t) || has(['que sais-tu faire', 'que peux-tu faire', 'tu sais faire quoi'])) return { intent: 'help' };
    if (has(['mode sombre', 'theme sombre', 'sombre', 'nuit', 'dark'])) return { intent: 'theme', theme: 'dark' };
    if (has(['mode clair', 'theme clair', 'clair', 'light'])) return { intent: 'theme', theme: 'light' };
    if (has(['mode discret', 'masquer', 'cacher', 'afficher les montants', 'montrer les montants'])) return { intent: 'privacy' };
    if (has(['rafraichir', 'rafraichis', 'actualiser', 'actualise', 'mettre a jour les cours', 'mets a jour'])) return { intent: 'refresh' };
    if (has(['sauvegarde', 'sauvegarder', 'exporter', 'export', 'backup'])) return { intent: 'backup' };

    // achat / vente : « acheter 3 cw8 à 520 »
    const trade = /^(j'ai |je veux |je vais )?(acheter|achete|achat|vendre|vends|vendu|vente|j'ai vendu)\b/.exec(t);
    if (trade && key && !has(['pour avoir', 'besoin'])) {
      const side = /vend|vente/.test(trade[0]) ? 'sell' : 'buy';
      const priced = nums.find(n => /(a|@|au prix de|au cours de|pour)\s*$/.test(rest.slice(0, n.index)));
      const qty = nums.find(n => n !== priced && n.unit !== 'year');
      return { intent: 'trade', side, key, qty: qty ? qty.value : undefined, price: priced ? priced.value : undefined };
    }
    // retrait : « j'ai besoin de 10 000 € », « retirer 5k »
    const wd = money || nums.find(n => n.unit === 'year');
    if (has(['besoin de', 'besoin d\'', 'retirer', 'retrait', 'sortir', 'debloquer', 'recuperer', 'vendre pour', 'liquider', 'financer']) && wd) return { intent: 'withdraw', amount: wd.value };
    // projection : « 300 €/mois pendant 20 ans à 6 % »
    if (/(\/ ?mois|par mois|mensuel|chaque mois|tous les mois)/.test(t) && nums.some(n => n.unit === 'years')) {
      const m = nums.find(n => n.unit === 'money') || nums.find(n => n.unit === '');
      return { intent: 'projection', monthly: m ? m.value : NaN, years: nums.find(n => n.unit === 'years').value, rate: (nums.find(n => n.unit === 'pct') || {}).value, fromZero: has(['de zero', 'en partant de 0', 'depuis zero', 'sans capital']) };
    }
    if (has(['part', 'parts', 'exposition', 'expose', 'exposee', 'poids', 'pourcentage', 'combien de %', 'proportion', 'quelle part', 'dependance'])) {
      const e = COPILOT_EXPO.find(x => this.has(t, x.words));
      if (e) return { intent: 'expo', expo: e };
    }
    if (has(['dividende', 'dividendes', 'coupon', 'coupons', 'revenus passifs', 'rente'])) return { intent: 'dividends', year, key };
    if (has(['frais', 'courtage', 'ter', 'commission', 'commissions'])) return { intent: 'fees', key };
    if (has(['liquidites', 'liquidite', 'especes', 'cash', 'solde'])) return { intent: 'cash' };
    if (/\bpea\b/.test(t) && has(['plafond', '5 ans', 'cinq ans', 'versements', 'verse', 'anciennete', 'reste'])) return { intent: 'pea' };
    if (has(['annualise', 'annualisee', 'xirr', 'par an', 'rendement annuel', 'taux de rendement', 'tri', 'rendement moyen'])) return { intent: 'annual' };
    if (has(['meilleur', 'meilleure', 'meilleures', 'top', 'star', 'gagnant', 'gagnante', 'monte le plus', 'rapporte le plus'])) return { intent: 'best' };
    if (has(['pire', 'pires', 'plus mauvais', 'plus mauvaise', 'perdant', 'perdante', 'flop', 'baisse le plus', 'perd le plus', 'coute le plus'])) return { intent: 'worst' };
    if (has(['aujourd\'hui', 'du jour', 'ce matin', 'ce soir', 'ca bouge', 'variation', 'seance', 'cette seance'])) return { intent: 'day' };
    if (has(['investi', 'investis', 'investie', 'verse', 'versements', 'mis de cote', 'place', 'apport', 'apports', 'achete pour'])) return { intent: 'invested', year, key };
    if (has(['plus-value', 'plus value', 'plus-values', 'moins-value', 'gagne', 'gagner', 'perdu', 'gain', 'gains', 'benefice', 'perte', 'pertes', 'rapporte', 'performance', 'perf', 'rendement'])) return { intent: 'pnl', key, year };
    if (has(['objectif', 'objectifs', 'but', 'cible financiere'])) return { intent: 'goal' };
    if (has(['patrimoine', 'fortune', 'tout compris', 'net worth'])) return { intent: 'wealth' };
    if (key) return { intent: 'position', key };
    if (has(['combien vaut', 'combien j\'ai', 'combien ai-je', 'valeur', 'vaut', 'total', 'mon portefeuille', 'portefeuille', 'combien'])) return { intent: 'value' };
    return { intent: 'search', text: t };
  },

  /** Catalogue des instruments connus pour la reconnaissance des noms */
  catalog() {
    return Object.entries(Store.state.instruments).map(([key, i]) => ({ key, symbol: i.symbol, ysymbol: i.ysymbol, names: [i.short, friendlyName(i.name, i.symbol), Store.label(key)].filter(Boolean) }));
  },

  /** Raccourcis (navigation et actions), filtrés par mots-clés */
  commands() {
    const A = App;
    const go = (view, sel, sub) => () => {
      A.show(view);
      if (sub) A.portfolioTab(sub);
      if (!sel) return;
      requestAnimationFrame(() => {
        const node = $(sel);
        const card = node && (node.closest('.card') || node);
        if (!card) return;
        card.classList.remove('hidden-by-filter');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.remove('cp-flash'); void card.offsetWidth; card.classList.add('cp-flash');
      });
    };
    const click = sel => () => { const b = $(sel); if (b) b.click(); };
    const runQuant = sel => () => { go('quant', sel)(); click(sel)(); };
    return [
      { label: 'Synthèse du portefeuille', kw: 'portefeuille synthese accueil resume', run: go('portfolio', null, 'synthese') },
      { label: 'Analyse du portefeuille', kw: 'analyse', run: go('portfolio', null, 'analyse') },
      { label: 'Opérations', kw: 'operations transactions historique achats ventes liste', run: go('portfolio', '#pfSubnav', 'operations') },
      { label: 'Nouvelle opération', kw: 'ajouter operation nouvelle achat vente saisir', run: () => A.openTx() },
      { label: 'À faire', kw: 'a faire todo taches', run: go('portfolio', '#todoCard', 'synthese') },
      { label: 'Bilan de santé', kw: 'sante bilan note diagnostic', run: go('portfolio', '#healthCard', 'analyse') },
      { label: 'Exposition réelle (pays, secteurs, devises)', kw: 'exposition pays secteurs devises repartition geographique', run: go('portfolio', '#exposureCard', 'analyse') },
      { label: 'Carte du portefeuille', kw: 'carte treemap', run: go('portfolio', '#mapCard', 'analyse') },
      { label: 'Risque du portefeuille', kw: 'risque volatilite sharpe drawdown beta', run: go('portfolio', '#riskCard', 'analyse') },
      { label: 'Optimiseur de répartition', kw: 'optimiseur markowitz frontiere efficiente', run: go('portfolio', '#optCard', 'analyse') },
      { label: 'Actualités', kw: 'actualites news nouvelles', run: go('portfolio', '#newsCard', 'analyse') },
      { label: 'Dividendes à venir', kw: 'dividendes calendrier revenus', run: go('portfolio', '#divCard', 'revenus') },
      { label: 'Fiscalité (PEA, compte-titres, assurance-vie)', kw: 'fiscalite impots declaration pea cto assurance vie 2074', run: go('portfolio', '#taxCard', 'revenus') },
      { label: 'Patrimoine global', kw: 'patrimoine livrets immobilier', run: go('portfolio', '#wealthCard', 'synthese') },
      { label: 'Liquidités', kw: 'liquidites especes cash', run: go('portfolio', '#cashCard', 'synthese') },
      { label: 'Retrait malin : quoi vendre pour payer moins d\'impôt', kw: 'retrait malin retirer vendre besoin argent impot optimiser', run: () => A.openWithdraw() },
      { label: 'Radar fiscal : impôt à économiser', kw: 'radar fiscal optimisation impot economiser moins-values purge abattement', run: go('invest', '#radarCard') },
      { label: 'Objectifs', kw: 'objectifs objectif but', run: go('invest', '#goalList') },
      { label: 'Allocation cible et plan d\'investissement', kw: 'allocation cible plan investir repartition', run: go('invest', '#tgtShare') },
      { label: 'Versements programmés', kw: 'versements programmes dca mensuel', run: go('invest', '#plansCard') },
      { label: 'Alertes de prix', kw: 'alertes alerte prix notification', run: go('invest', '#alertForm') },
      { label: 'Marchés', kw: 'marches cours graphique fiche watchlist suivi', run: go('markets') },
      { label: 'Agenda financier', kw: 'agenda calendrier evenements', run: go('agenda') },
      { label: 'Catalogue d\'ETF', kw: 'catalogue etf portefeuilles types', run: go('catalog') },
      { label: 'Monde et horaires des bourses', kw: 'monde horaires bourses ouverture indices', run: go('world') },
      { label: 'Comparer des valeurs', kw: 'comparer comparaison battre le marche', run: go('compare') },
      { label: 'Simulation « et si j\'avais investi »', kw: 'simulation et si backtest', run: go('simulation', '#simRun') },
      { label: 'Projection dans le futur', kw: 'projection futur interets composes monte carlo', run: go('simulation', '#projInitial') },
      { label: 'Laboratoire de stratégies', kw: 'laboratoire strategies dca lump sum', run: go('simulation', '#labCard') },
      { label: 'Phase de retraite', kw: 'retraite retraits rente', run: go('simulation', '#retireCard') },
      { label: 'Labo quant', kw: 'labo quant', run: go('quant') },
      { label: 'Météo des marchés (régimes)', kw: 'meteo marches regime calme agite hmm', run: runQuant('#qRegimeRun') },
      { label: 'Crash-test historique', kw: 'crash test crise krach subprimes covid', run: runQuant('#qCrashRun') },
      { label: 'Scénarios « et si… »', kw: 'scenarios et si choc stress test', run: runQuant('#qScenRun') },
      { label: 'Anatomie du risque', kw: 'anatomie risque var expected shortfall risk parity', run: runQuant('#qRiskRun') },
      { label: 'Audit de mes décisions', kw: 'audit decisions comportement timing', run: runQuant('#qBehavRun') },
      { label: 'Mon année en bourse', kw: 'annee bourse wrapped recap bilan annuel', run: () => A.openWrapped() },
      { label: 'Rapport annuel PDF', kw: 'rapport annuel pdf imprimer', run: () => { go('portfolio', null, 'operations')(); click('#reportBtn')(); } },
      { label: 'Importer un relevé CSV', kw: 'importer import csv degiro trade republic releve', run: () => { go('portfolio', null, 'operations')(); click('#csvImport')(); } },
      { label: 'Réglages', kw: 'reglages parametres cle api relais', run: go('settings') },
      { label: 'Synchronisation entre appareils', kw: 'synchronisation sync appareils telephone', run: go('settings', '#syncCard') },
      { label: 'Taux d\'imposition', kw: 'taux fiscalite reglages pfu prelevements', run: go('settings', '#taxSettings') },
      { label: 'Mode discret (masquer les montants)', kw: 'mode discret masquer montants', run: click('#privacyBtn') },
      { label: 'Changer de thème', kw: 'theme sombre clair', run: click('#themeBtn') },
      { label: 'Rafraîchir les cours', kw: 'rafraichir actualiser cours', run: () => A.refresh(true) },
      { label: 'Exporter une sauvegarde', kw: 'exporter sauvegarde backup json', run: () => A.exportBackup() },
    ];
  },

  /** Raccourcis classés par pertinence pour le texte (mots-clés et libellé) */
  search(text, list = this.commands(), limit = 6) {
    const t = this.norm(text);
    const words = t.split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !COPILOT_STOP.has(w));
    if (!words.length) return [];
    return list.map(c => {
      const hay = this.norm(c.label + ' ' + c.kw);
      const tokens = hay.split(/[^a-z0-9]+/);
      let score = 0;
      for (const w of words) {
        if (tokens.includes(w)) score += 3;
        else if (tokens.some(x => x.startsWith(w) || (w.length >= 5 && x.startsWith(w.slice(0, -1))))) score += 2;
        else if (w.length >= 4 && hay.includes(w)) score += 1;
      }
      return { c, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.c);
  },
};

/* ==================================================================== */
/* Réponses (données du site)                                            */
/* ==================================================================== */
Object.assign(Copilot, {
  /** Somme en devise de base d'opérations filtrées (au taux de change de leur date) */
  sumTx(filter, amount) {
    let s = 0;
    for (const t of Portfolio.txs()) {
      if (!filter(t)) continue;
      const inst = Store.instrument(t.key);
      const fx = Api.fxAt((inst && inst.currency) || Store.state.settings.baseCurrency, t.date);
      const v = amount(t) * (isFinite(fx) ? fx : 1);
      if (isFinite(v)) s += v;
    }
    return s;
  },

  /**
   * Réponse à une intention : { title, value?, cls?, lines: [texte], actions: [{ label, run }] } ou null.
   * Montants dans la devise de base, sur le compte sélectionné (filtre de compte).
   */
  answer(p) {
    const cur = App.base();
    const m = (v, d = 0) => fmtMoney(v, cur, d);
    const { rows, totals } = Portfolio.snapshot();
    const filter = Store.state.accountFilter || 'all';
    const scope = filter === 'all' ? '' : ' (' + Store.account(filter).name + ')';
    const yearTx = (t, y) => !y || t.date.slice(0, 4) === String(y);
    const cmd = label => { const c = this.commands().find(x => x.label.startsWith(label)); return c ? { label: 'Ouvrir : ' + c.label.split(' :')[0], run: c.run } : null; };
    const label = k => Store.label(k);
    switch (p.intent) {
      case 'help':
        return { title: 'Pose ta question en français', lines: ['Tout est calculé dans ton navigateur, sur tes propres données. Quelques idées :'], examples: COPILOT_EXAMPLES };
      case 'theme': return { title: p.theme === 'dark' ? 'Passer en thème sombre' : 'Passer en thème clair', lines: [], actions: [{ label: 'Appliquer', run: () => { App.applyTheme(p.theme); localStorage.setItem('apistock:theme', p.theme); App.renderAll(); } }] };
      case 'privacy': return { title: Store.state.settings.privacy ? 'Afficher les montants' : 'Masquer les montants (mode discret)', lines: [], actions: [{ label: Store.state.settings.privacy ? 'Afficher' : 'Masquer', run: () => $('#privacyBtn').click() }] };
      case 'refresh': return { title: 'Rafraîchir les cours', lines: [], actions: [{ label: 'Rafraîchir', run: () => App.refresh(true) }] };
      case 'backup': return { title: 'Exporter une sauvegarde de tes données', lines: ['Fichier JSON avec tes opérations, comptes et réglages (sans la clé API).'], actions: [{ label: 'Exporter', run: () => App.exportBackup() }] };

      case 'value': {
        const cash = Portfolio.cashTotal();
        const lines = [`Titres ${m(totals.value)}` + (cash.tracked ? ` · liquidités ${m(cash.cash)}` : ''),
          `Plus-value latente ${fmtSignedMoney(totals.pnl, cur)} (${fmtPct(totals.pnlPct, 1)})`];
        if (isFinite(totals.day) && Math.abs(totals.day) > 0.005) lines.push(`Aujourd'hui ${fmtSignedMoney(totals.day, cur)} (${fmtPct(totals.dayPct, 2)})`);
        return { title: 'Ton portefeuille vaut' + scope, value: m(totals.value + (cash.tracked ? cash.cash : 0)), lines, actions: [cmd('Synthèse')] };
      }
      case 'wealth': {
        const cash = Portfolio.cashTotal('all').cash || 0;
        const others = typeof Wealth !== 'undefined' ? Wealth.othersTotal() : 0;
        const titres = Portfolio.snapshot('all').totals.value;
        return { title: 'Ton patrimoine', value: m(titres + cash + others), lines: [`Titres ${m(titres)} · liquidités ${m(cash)} · autres actifs ${m(others)}`], actions: [cmd('Patrimoine')] };
      }
      case 'pnl': {
        if (p.key) {
          const r = rows.find(x => x.key === p.key) || Portfolio.snapshot().closed.find(x => x.key === p.key);
          if (!r) return this.answer({ intent: 'position', key: p.key });
          const tot = (r.qty > 0 ? r.pnlBase : 0) + (r.realizedBase || 0) + (r.dividendsBase || 0);
          return { title: 'Gain sur ' + label(p.key), value: fmtSignedMoney(tot, cur), cls: trendClass(tot),
            lines: [r.qty > 0 ? `Plus-value latente ${fmtSignedMoney(r.pnlBase, cur)} (${fmtPct(r.pnlPct, 1)})` : 'Position soldée', `Réalisé ${fmtSignedMoney(r.realizedBase || 0, cur)} · dividendes ${m(r.dividendsBase || 0)}`],
            actions: [{ label: 'Voir la fiche', run: () => { App.show('markets'); App.selectDetail(p.key); } }] };
        }
        const xirr = Portfolio.portfolioXirr(totals.value);
        return { title: 'Ce que tu as gagné' + scope, value: fmtSignedMoney(totals.totalGain, cur), cls: trendClass(totals.totalGain),
          lines: [`Latent ${fmtSignedMoney(totals.pnl, cur)} (${fmtPct(totals.pnlPct, 1)}) · réalisé ${fmtSignedMoney(totals.realized, cur)} · dividendes ${m(totals.dividends)}`,
            isFinite(xirr) ? `Soit ${fmtPct(xirr, 1)} par an (rendement annualisé, dates de versement comprises)` : null,
            p.year ? `Depuis le début. Le détail de ${p.year} est dans « Mon année en bourse ».` : null].filter(Boolean),
          actions: [p.year ? { label: 'Mon année en bourse', run: () => App.openWrapped() } : cmd('Analyse')] };
      }
      case 'invested': {
        const match = t => t.type === 'buy' && yearTx(t, p.year) && (!p.key || t.key === p.key);
        const bought = this.sumTx(match, t => parseNum(t.qty) * parseNum(t.price) + (parseNum(t.fees) || 0));
        const sold = this.sumTx(t => t.type === 'sell' && yearTx(t, p.year) && (!p.key || t.key === p.key), t => parseNum(t.qty) * parseNum(t.price) - (parseNum(t.fees) || 0));
        const n = Portfolio.txs().filter(match).length;
        const lines = [`${n} achat${n > 1 ? 's' : ''}` + (sold > 0.5 ? ` · ventes ${m(sold)}` : '')];
        if (!p.year && !p.key) lines.push(`Encore investi dans tes positions (prix de revient) : ${m(totals.cost)}`);
        return { title: 'Investi' + (p.key ? ' dans ' + label(p.key) : '') + (p.year ? ' en ' + p.year : ' au total') + scope, value: m(bought), lines, actions: [cmd('Opérations')] };
      }
      case 'dividends': {
        const got = this.sumTx(t => t.type === 'div' && yearTx(t, p.year) && (!p.key || t.key === p.key), t => parseNum(t.qty) * parseNum(t.price) - (parseNum(t.fees) || 0));
        const lines = [];
        if (!p.year && !p.key && typeof App.divForecast === 'function') {
          const next = App.divForecast().filter(d => isFinite(d.amount));
          const sum = next.reduce((s, d) => s + d.amount, 0);
          if (sum > 0) lines.push(`Attendus sur 12 mois : environ ${m(sum)}` + (next[0] ? ` (prochain : ${label(next[0].key)} vers le ${fmtDate(next[0].date)})` : ''));
          if (sum > 0 && totals.value > 0) lines.push(`Rendement sur la valeur actuelle : ${fmtPct(sum / totals.value * 100, 2, false)}`);
        }
        return { title: 'Dividendes reçus' + (p.key ? ' de ' + label(p.key) : '') + (p.year ? ' en ' + p.year : '') + scope, value: m(got, 2), lines, actions: [cmd('Dividendes')] };
      }
      case 'fees': {
        const paid = this.sumTx(t => t.type !== 'split' && (!p.key || t.key === p.key), t => parseNum(t.fees) || 0);
        let ter = 0, known = 0;
        for (const r of rows.filter(x => !p.key || x.key === p.key)) { const e = Expo.of(r.key); if (isFinite(e.ter) && isFinite(r.valueBase)) { ter += r.valueBase * e.ter / 100; known++; } }
        return { title: 'Frais' + (p.key ? ' de ' + label(p.key) : '') + scope, value: m(paid, 2), lines: ['Courtage déjà payé, toutes opérations confondues', known ? `Frais de gestion des ETF (TER) : environ ${m(ter)} par an` : null].filter(Boolean), actions: [cmd('Exposition')] };
      }
      case 'cash': {
        const c = Portfolio.cashTotal();
        if (!c.tracked) return { title: 'Liquidités', lines: ['Tu ne suis pas encore les espèces de tes comptes : ajoute un premier « Versement / retrait » dans la carte Opérations.'], actions: [cmd('Opérations')] };
        return { title: 'Liquidités disponibles' + scope, value: m(c.cash, 2), lines: c.accounts.map(id => `${Store.account(id).name} : ${m(Portfolio.cashBalance(id).cash, 2)}`), actions: [cmd('Liquidités')] };
      }
      case 'pea': {
        const peas = Store.state.accounts.filter(a => a.type === 'pea');
        if (!peas.length) return { title: 'PEA', lines: ['Aucun compte de type PEA : crée-le dans Réglages → Comptes.'], actions: [cmd('Réglages')] };
        const cap = taxConf().peaCap;
        return { title: 'Ton PEA', lines: peas.flatMap(a => { const q = Tax.pea(a); return [`${a.name} : ${m(q.deposits)} versés sur ${m(cap)} (reste ${m(Math.max(0, cap - q.deposits))})`, q.five ? (q.five <= todayISO() ? `5 ans passés depuis le ${fmtDate(q.five)} : retraits partiels possibles sans clôture` : `5 ans le ${fmtDate(q.five)} : pas de retrait avant`) : null].filter(Boolean); }), actions: [cmd('Fiscalité')] };
      }
      case 'annual': {
        const x = Portfolio.portfolioXirr(totals.value);
        return { title: 'Rendement annualisé' + scope, value: isFinite(x) ? fmtPct(x, 2) : '—', cls: trendClass(x), lines: ['Taux de rendement interne (XIRR) : chaque versement compte depuis sa date, dividendes et ventes inclus.'], actions: [cmd('Risque')] };
      }
      case 'best': case 'worst': {
        const list = rows.filter(r => isFinite(r.pnlPct)).sort((a, b) => (p.intent === 'best' ? b.pnlPct - a.pnlPct : a.pnlPct - b.pnlPct)).slice(0, 3);
        if (!list.length) return { title: 'Pas encore de position cotée', lines: [] };
        return { title: p.intent === 'best' ? 'Tes meilleures lignes' : 'Tes lignes les moins performantes', value: label(list[0].key), cls: trendClass(list[0].pnlPct),
          lines: list.map(r => `${label(r.key)} : ${fmtPct(r.pnlPct, 1)} (${fmtSignedMoney(r.pnlBase, cur)})`), actions: [cmd('Analyse')] };
      }
      case 'day': {
        const mv = rows.filter(r => r.quote && isFinite(r.quote.percentChange)).sort((a, b) => b.quote.percentChange - a.quote.percentChange);
        const lines = [];
        if (mv.length) lines.push(`En tête : ${label(mv[0].key)} ${fmtPct(mv[0].quote.percentChange, 2)}`, mv.length > 1 ? `En queue : ${label(mv[mv.length - 1].key)} ${fmtPct(mv[mv.length - 1].quote.percentChange, 2)}` : null);
        return { title: 'Aujourd\'hui' + scope, value: fmtSignedMoney(totals.day, cur), cls: trendClass(totals.day), lines: [fmtPct(totals.dayPct, 2), ...lines].filter(Boolean), actions: [cmd('Analyse')] };
      }
      case 'expo': {
        const list = rows.map(r => ({ key: r.key, w: isFinite(r.valueBase) ? r.valueBase : r.costBase })).filter(x => x.w > 0);
        const agg = Expo.aggregate(list)[p.expo.dim] || {};
        const v = p.expo.keys.reduce((s, k) => s + (agg[k] || 0), 0);
        return { title: 'Part ' + (p.expo.dim === 'ccy' ? 'en ' : 'exposée à : ') + p.expo.name + scope, value: fmtNum(v, 1) + ' %', lines: [`Soit environ ${m(totals.value * v / 100)}, en regardant à l'intérieur de chaque ETF.`], actions: [cmd('Exposition')] };
      }
      case 'goal': {
        const g = typeof Goals !== 'undefined' ? Goals.all()[0] : null;
        if (!g) return { title: 'Aucun objectif', lines: ['Fixe un objectif (retraite, apport…) pour suivre ta progression.'], actions: [cmd('Objectifs')] };
        const V = Goals.current(g).value, pr = Goals.project(g, V);
        return { title: 'Objectif : ' + (g.name || 'principal'), value: fmtNum(pr.pct, 0) + ' %', lines: [`${m(V)} sur ${m(pr.T)}`, pr.reach === 0 ? 'Objectif atteint 🎉' : pr.reach ? `Atteint dans environ ${pr.reach >= 24 ? fmtNum(pr.reach / 12, 0) + ' ans' : pr.reach + ' mois'} à ce rythme` : 'Pas atteignable à ce rythme : augmente le versement mensuel'], actions: [cmd('Objectifs')] };
      }
      case 'position': {
        const r = rows.find(x => x.key === p.key);
        const q = Api.cachedQuote(p.key);
        const lines = [];
        if (q) lines.push(`Cours ${fmtMoney(q.price, (Store.instrument(p.key) || {}).currency || cur, 2, true)} (${fmtPct(q.percentChange, 2)} aujourd'hui)`);
        if (r) lines.push(`${fmtQty(r.qty)} parts · PRU ${fmtMoney(r.pru, r.currency, 2, true)} · ${fmtNum(r.weightValue, 1)} % du portefeuille`, `Plus-value ${fmtSignedMoney(r.pnlBase, cur)} (${fmtPct(r.pnlPct, 1)})`);
        else lines.push('Pas dans ton portefeuille' + scope + '.');
        return { title: label(p.key), value: r ? m(r.valueBase) : undefined, lines,
          actions: [{ label: 'Voir la fiche', run: () => { App.show('markets'); App.selectDetail(p.key); } }, { label: 'Acheter', run: () => App.openTxPreset({ type: 'buy', key: p.key, price: q ? q.price : undefined }) },
            r ? { label: 'Vendre', run: () => App.openTxPreset({ type: 'sell', key: p.key, qty: r.qty, price: q ? q.price : undefined }) } : null].filter(Boolean) };
      }
      case 'trade': {
        const q = Api.cachedQuote(p.key);
        const price = isFinite(p.price) ? p.price : q ? q.price : undefined;
        const ccy = (Store.instrument(p.key) || {}).currency || cur;
        return { title: (p.side === 'sell' ? 'Vendre ' : 'Acheter ') + (isFinite(p.qty) ? fmtQty(p.qty) + ' ' : '') + label(p.key), value: isFinite(p.qty) && price ? fmtMoney(p.qty * price, ccy) : undefined,
          lines: [price ? `Au cours de ${fmtMoney(price, ccy, 2, true)}` + (isFinite(p.price) ? '' : ' (cours actuel)') : 'Cours à saisir'], actions: [{ label: 'Préparer l\'opération', run: () => App.openTxPreset({ type: p.side, key: p.key, qty: p.qty, price }) }] };
      }
      case 'withdraw': {
        const r = Fisc.plan(Fisc.context(), p.amount, { whole: true });
        if (r.short || !r.plan) return { title: `Retirer ${m(p.amount)} nets`, lines: [`Pas possible avec tes comptes disponibles : au maximum ${m(r.max)} après impôt.`, ...r.warnings], actions: [{ label: 'Ouvrir le retrait malin', run: () => App.openWithdraw(p.amount) }] };
        const ord = r.plan.accounts.flatMap(a => a.sales.map(s => `${fmtQty(s.qty)} ${label(s.key)}`)).slice(0, 4);
        return { title: `Pour obtenir ${m(p.amount)} nets`, value: m(Math.max(0, r.plan.cost)) + ' d\'impôt et frais', lines: [ord.length ? 'Vendre : ' + ord.join(', ') : 'Les liquidités suffisent', r.saving > 0.5 ? `${m(r.saving)} de moins qu'en vendant un peu de tout` : null].filter(Boolean),
          actions: [{ label: 'Voir le plan détaillé', run: () => App.openWithdraw(p.amount) }] };
      }
      case 'projection': {
        const V0 = p.fromZero ? 0 : totals.value + (Portfolio.cashTotal().cash || 0);
        const rate = isFinite(p.rate) ? p.rate : 7;
        const n = Math.round(p.years * 12), mo = isFinite(p.monthly) ? p.monthly : 0;
        const r = Math.pow(1 + rate / 100, 1 / 12) - 1;
        const fv = r ? V0 * Math.pow(1 + r, n) + mo * (Math.pow(1 + r, n) - 1) / r : V0 + mo * n;
        const paid = V0 + mo * n;
        return { title: `${m(mo)}/mois pendant ${fmtNum(p.years, 0)} ans à ${fmtNum(rate, 1)} %/an`, value: m(fv),
          lines: [(V0 > 0 ? `En partant de tes ${m(V0)} actuels · ` : '') + `versé ${m(paid)} · intérêts composés ${m(fv - paid)}`, 'Hors frais, impôts et inflation : un ordre de grandeur, pas une promesse.'],
          actions: [{ label: 'Affiner dans la projection', run: () => { App.show('simulation'); $('#projInitial').value = Math.round(V0); $('#projMonthly').value = mo; $('#projRate').value = rate; $('#projYears').value = p.years; $('#projYears').dispatchEvent(new Event('input', { bubbles: true })); App.renderProjection(); $('#projInitial').closest('.card').scrollIntoView({ behavior: 'smooth' }); } }] };
      }
      default: return null;
    }
  },
});

/* ==================================================================== */
/* Interface                                                             */
/* ==================================================================== */
Object.assign(App, {
  bindCopilot() {
    const dlg = $('#copilot'), input = $('#cpInput');
    $('#copilotBtn').addEventListener('click', () => this.openCopilot());
    document.addEventListener('keydown', e => {
      const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.openCopilot(); }
      else if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); this.openCopilot(); }
    });
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.renderCopilot(), 60); });
    input.addEventListener('keydown', e => {
      const items = $$('#cpOut .cp-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        this.cpActive = (this.cpActive + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach((b, i) => b.classList.toggle('active', i === this.cpActive));
        items[this.cpActive].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[this.cpActive]) items[this.cpActive].click();
      }
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  },

  openCopilot(text = '') {
    const dlg = $('#copilot'), input = $('#cpInput');
    if (!dlg.open) dlg.showModal();
    input.value = text;
    this.renderCopilot();
    input.focus();
    input.select();
  },

  renderCopilot() {
    const text = $('#cpInput').value;
    const out = $('#cpOut');
    const close = () => $('#copilot').close();
    const item = (content, run, cls = '') => el('button', { type: 'button', class: 'cp-item ' + cls, onclick: () => { close(); run(); } }, content);
    const p = Copilot.parse(text, Copilot.catalog());
    let a = null;
    try { a = p.intent === 'empty' || p.intent === 'search' ? null : Copilot.answer(p); } catch (e) { a = null; }
    const parts = [];
    if (p.intent === 'empty' || (a && a.examples)) {
      const ex = (a && a.examples) || COPILOT_EXAMPLES;
      if (a) parts.push(el('div', { class: 'cp-answer' }, el('b', {}, a.title), ...a.lines.map(l => el('p', { class: 'small muted' }, l))));
      parts.push(el('p', { class: 'cp-label' }, 'Essaie'),
        el('div', { class: 'cp-examples' }, ...ex.map(x => el('button', { type: 'button', class: 'cp-chip', onclick: () => { $('#cpInput').value = x; this.renderCopilot(); $('#cpInput').focus(); } }, x))));
    } else if (a) {
      parts.push(el('div', { class: 'cp-answer', role: 'status' },
        el('span', { class: 'cp-q muted small' }, a.title),
        a.value !== undefined ? el('div', { class: 'cp-value mono ' + (a.cls || '') }, a.value) : null,
        ...a.lines.map(l => el('p', { class: 'small' }, l))));
      for (const act of (a.actions || []).filter(Boolean)) parts.push(item([el('span', { class: 'cp-ico' }, '↵'), act.label], act.run, 'cp-act'));
    }
    const cmds = p.intent === 'empty' ? [] : Copilot.search(text, Copilot.commands(), a ? 4 : 8);
    if (cmds.length) {
      parts.push(el('p', { class: 'cp-label' }, a ? 'Aller à' : 'Raccourcis'));
      for (const c of cmds) parts.push(item([el('span', { class: 'cp-ico' }, '→'), c.label], c.run));
    }
    if (!a && !cmds.length && p.intent !== 'empty') parts.push(el('p', { class: 'muted small cp-none' }, 'Je n\'ai pas compris. Essaie « valeur », « plus-value sur CW8 », « dividendes 2025 », « j\'ai besoin de 3 000 € » ou tape « aide ».'));
    out.replaceChildren(...parts);
    this.cpActive = 0;
    const first = $('#cpOut .cp-item');
    if (first) first.classList.add('active');
  },
});
