/*
 * Bilan de santé du portefeuille : une note sur 100 et des points à surveiller (diversification, frais,
 * doublons, respect de l'allocation cible, courtage, sauvegarde). Indicateurs pédagogiques, pas un conseil.
 */
'use strict';

const HEALTH_SCORE = { ok: 1, warn: 0.5, bad: 0 };

const Health = {
  /** Statut selon des seuils croissants : ≤ ok → ok, ≤ warn → warn, au-delà → bad */
  grade(v, ok, warn) { return v <= ok ? 'ok' : v <= warn ? 'warn' : 'bad'; },

  /**
   * Évalue le portefeuille affiché (filtre de compte). Renvoie { score, checks } ou null s'il n'y a rien à évaluer.
   * Chaque point : { id, label, status: ok|warn|bad|info, value, advice, weight, action? } ; « info » n'entre pas dans la note.
   */
  evaluate(opts = {}) {
    const { rows } = Portfolio.snapshot(opts.account);
    const list = rows.map(r => ({ key: r.key, w: isFinite(r.valueBase) ? r.valueBase : r.costBase })).filter(x => x.w > 0);
    const total = list.reduce((s, x) => s + x.w, 0);
    if (!(total > 0)) return null;
    const checks = [];
    const pct = v => fmtNum(v, 0) + ' %';

    // 1. pays : part du premier pays (le MSCI World seul est à ~72 % américain)
    const agg = Expo.aggregate(list);
    const topCountry = Object.entries(agg.country).filter(([k]) => k !== 'other').sort((a, b) => b[1] - a[1])[0];
    if (topCountry) {
      const name = (typeof COUNTRY_FR !== 'undefined' && COUNTRY_FR[topCountry[0]]) || topCountry[0];
      const st = this.grade(topCountry[1], 75, 90);
      checks.push({ id: 'country', label: 'Répartition géographique', status: st, weight: 2, value: `${pct(topCountry[1])} ${name}`,
        advice: st === 'ok' ? 'Pas de dépendance excessive à un seul pays.' : `Ton portefeuille dépend surtout d'un pays. Un ETF sur d'autres zones (Europe, émergents, monde entier) réduirait cette dépendance.` });
    }

    // 2. secteurs : part du premier secteur
    const topSector = Object.entries(agg.sector).sort((a, b) => b[1] - a[1])[0];
    if (topSector) {
      const name = (typeof SECT !== 'undefined' && SECT[topSector[0]]) || topSector[0];
      const st = this.grade(topSector[1], 35, 50);
      checks.push({ id: 'sector', label: 'Répartition par secteur', status: st, weight: 1.5, value: `${pct(topSector[1])} ${name}`,
        advice: st === 'ok' ? 'Aucun secteur ne domine nettement.' : `Le secteur ${name} pèse lourd : une baisse de ce secteur toucherait une grande partie de ton portefeuille.` });
    }

    // 3. titres individuels, crypto : lignes non diversifiées
    const single = list.filter(x => ['stock', 'crypto'].includes(Expo.of(x.key).profile)).reduce((s, x) => s + x.w, 0) / total * 100;
    if (single > 0.5) {
      const st = this.grade(single, 20, 40);
      checks.push({ id: 'single', label: 'Actions individuelles et crypto', status: st, weight: 1.5, value: pct(single),
        advice: st === 'ok' ? 'Part limitée de lignes non diversifiées.' : 'Une action ou une crypto peut perdre beaucoup seule ; un ETF répartit ce risque sur des centaines de titres.' });
    }

    // 4. frais courants (TER moyen pondéré)
    let fees = 0, base = 0;
    for (const x of list) { const ter = Expo.of(x.key).ter; if (isFinite(ter)) { fees += x.w * ter; base += x.w; } }
    if (base > total * 0.5) {
      const ter = fees / base;
      const st = this.grade(ter, 0.3, 0.6);
      checks.push({ id: 'ter', label: 'Frais courants des ETF', status: st, weight: 1.5, value: `${fmtNum(ter, 2)} % / an`, action: 'exposure',
        advice: st === 'ok' ? 'Des frais bas : ils pèsent peu sur la performance à long terme.' : 'Des ETF équivalents moins chers existent peut-être : voir « Exposition réelle & frais ».' });
    }

    // 5. doublons : deux lignes sur le même indice
    const byProfile = {};
    for (const x of list) {
      const p = Expo.of(x.key).profile;
      if (EXPO_PROFILES[p] && EXPO_PROFILES[p].country) (byProfile[p] = byProfile[p] || []).push(x.key);
    }
    const dups = Object.entries(byProfile).filter(([, k]) => k.length > 1);
    checks.push({ id: 'dups', label: 'Doublons', status: dups.length ? 'warn' : 'ok', weight: 1,
      value: dups.length ? dups.map(([p]) => EXPO_PROFILES[p].label.split(' (')[0]).join(', ') : 'aucun',
      advice: dups.length ? 'Plusieurs lignes suivent le même indice : ça n\'ajoute pas de diversification, seulement des frais et du suivi en plus (sauf si c\'est voulu, par ex. une ligne par enveloppe).' : 'Chaque ligne apporte quelque chose de différent.' });

    // 6. allocation cible : définie et respectée
    const info = typeof App !== 'undefined' && App.rebalanceInfo ? App.rebalanceInfo() : null;
    if (info && info.drift && isFinite(info.drift.max)) {
      const st = this.grade(info.drift.max, 5, 10);
      checks.push({ id: 'target', label: 'Respect de ta cible', status: st, weight: 1.5, value: `écart max ${fmtNum(info.drift.max, 1)} pt`, action: 'invest',
        advice: st === 'ok' ? 'Ton portefeuille suit ton allocation cible.' : 'Une ligne s\'écarte de ta cible : le plan « Ce mois-ci, j\'investis… » (onglet Investir) te dit quoi acheter pour revenir vers elle.' });
    } else {
      checks.push({ id: 'target', label: 'Allocation cible', status: 'info', weight: 0, value: 'non définie', action: 'invest',
        advice: 'Fixer une répartition cible (onglet Investir) aide à garder le cap et à savoir quoi acheter chaque mois.' });
    }

    // 7. frais de courtage payés / montant acheté
    let bought = 0, paid = 0;
    for (const t of Portfolio.txs(opts.account)) {
      if (t.type !== 'buy' && t.type !== 'sell') continue;
      const inst = Store.instrument(t.key);
      const fx = Api.fxAt(inst ? inst.currency : Store.state.settings.baseCurrency, t.date);
      if (!isFinite(fx)) continue;
      if (t.type === 'buy') bought += parseNum(t.qty) * parseNum(t.price) * fx;
      paid += (parseNum(t.fees) || 0) * fx;
    }
    if (bought > 0) {
      const r = paid / bought * 100;
      const st = this.grade(r, 0.5, 1);
      checks.push({ id: 'brokerage', label: 'Frais de courtage', status: st, weight: 1, value: `${fmtNum(r, 2)} % des achats`,
        advice: st === 'ok' ? 'Tes frais d\'achat restent faibles.' : 'Des achats plus gros et moins fréquents, ou un courtier moins cher, réduiraient ces frais (le minimum par ordre pèse sur les petits achats).' });
    }

    // 8. sauvegarde des données
    let last = 0;
    try { last = +localStorage.getItem('apistock:lastBackup') || 0; } catch (e) { last = 0; }
    const synced = typeof Sync !== 'undefined' && !!Sync.conf();
    const fresh = synced || Date.now() - last < 30 * 864e5;
    checks.push({ id: 'backup', label: 'Sauvegarde de tes données', status: fresh ? 'ok' : 'warn', weight: 1, action: 'backup',
      value: synced ? 'synchronisées' : last ? 'export du ' + fmtDate(new Date(last).toISOString().slice(0, 10)) : 'aucune',
      advice: fresh ? 'Tes données sont à l\'abri.' : 'Elles ne sont que dans ce navigateur : active la synchronisation ou exporte-les (Réglages).' });

    const scored = checks.filter(c => c.status !== 'info');
    const wsum = scored.reduce((s, c) => s + c.weight, 0);
    const score = wsum ? Math.round(scored.reduce((s, c) => s + c.weight * HEALTH_SCORE[c.status], 0) / wsum * 100) : NaN;
    const order = { bad: 0, warn: 1, info: 2, ok: 3 };
    checks.sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);
    return { score, checks };
  },
};

Object.assign(App, {
  renderHealth() {
    const card = $('#healthCard');
    if (!card) return;
    const h = Health.evaluate();
    card.classList.toggle('hidden', !h || !isFinite(h.score));
    if (!h || !isFinite(h.score)) return;
    const level = h.score >= 80 ? 'ok' : h.score >= 55 ? 'warn' : 'bad';
    const word = { ok: 'Bonne santé', warn: 'Quelques points à surveiller', bad: 'À revoir' }[level];
    const go = {
      exposure: () => { this.portfolioTab('analyse'); const d = $('#expoDetail'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      invest: () => this.show('invest'),
      backup: () => { this.show('settings'); setTimeout(() => $('#syncCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); },
    };
    const icon = { ok: '✔', warn: '!', bad: '✖', info: 'i' };
    $('#healthBody').replaceChildren(
      el('div', { class: 'health-top' },
        el('div', { class: 'health-ring ' + level, style: `--p:${h.score}`, role: 'img', 'aria-label': `Note ${h.score} sur 100` },
          el('b', {}, String(h.score)), el('span', {}, '/ 100')),
        el('div', {}, el('div', { class: 'health-word ' + level }, word),
          el('div', { class: 'muted small' }, `${h.checks.filter(c => c.status === 'ok').length} point(s) au vert sur ${h.checks.filter(c => c.status !== 'info').length}`))),
      el('ul', { class: 'health-list' }, ...h.checks.map(c => el('li', { class: 'health-item st-' + c.status },
        el('span', { class: 'health-icon', 'aria-hidden': 'true' }, icon[c.status]),
        el('div', {},
          el('div', { class: 'health-head' }, el('b', {}, c.label), el('span', { class: 'mono small' }, c.value)),
          el('div', { class: 'muted small' }, c.advice,
            c.action && c.status !== 'ok' ? el('button', { type: 'button', class: 'link small health-go', onclick: go[c.action] }, ' Voir') : null))))));
  },
});
