/*
 * Agenda financier : toutes les échéances au même endroit (versements programmés, dividendes attendus,
 * publications de résultats des actions suivies, grands rendez-vous macroéconomiques des indices,
 * jours de bourse fermée, jalons PEA / assurance-vie, déclaration fiscale, relevés à saisir),
 * exportables vers l'agenda du téléphone (fichier .ics).
 */
'use strict';

const AGENDA_KINDS = {
  plan: { label: 'Versements', icon: '🗓' },
  div: { label: 'Dividendes', icon: '💶' },
  earn: { label: 'Résultats', icon: '📊' },
  eco: { label: 'Indices & macro', icon: '🌍' },
  market: { label: 'Bourse', icon: '🏛' },
  tax: { label: 'Fiscalité', icon: '🧾' },
  todo: { label: 'Relevés', icon: '✏️' },
};

/*
 * Grands rendez-vous macroéconomiques qui font bouger les indices.
 * Sources officielles, consultées le 17/11/2026 : federalreserve.gov (calendrier FOMC révisé le 12/11/2026),
 * ecb.europa.eu, bankofengland.co.uk, boj.or.jp, bls.gov (CPI et Employment Situation).
 * À compléter chaque année quand ces institutions publient le calendrier suivant (en général à l'automne).
 * `time` : heure locale de l'annonce dans le fuseau `tz` (convertie en heure de Paris à l'affichage).
 */
const MACRO_CALENDAR = [
  { id: 'fed', flag: '🇺🇸', title: 'Fed : décision sur les taux', tz: 'America/New_York', time: '14:00',
    sub: 'Communiqué puis conférence de presse du président de la Fed 30 min plus tard. Fait bouger le S&P 500, le Nasdaq, le Dow Jones et le dollar, et par ricochet toutes les bourses.',
    dates: ['2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-11-17'],
    notes: { '2026-12-09': 'Avec les nouvelles prévisions des membres (« dot plot »).' } },
  { id: 'ecb', flag: '🇪🇺', title: 'BCE : décision sur les taux', tz: 'Europe/Berlin', time: '14:15',
    sub: 'Conférence de presse de la présidente de la BCE à 14h45. Fait bouger le CAC 40, le DAX, l\'Euro Stoxx 50 et l\'euro.',
    dates: ['2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-10', '2027-07-22', '2027-09-09', '2027-10-28', '2027-12-16'] },
  { id: 'boe', flag: '🇬🇧', title: 'Banque d\'Angleterre : décision sur les taux', tz: 'Europe/London', time: '12:00',
    sub: 'Fait bouger le FTSE 100 et la livre sterling.',
    dates: ['2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-17', '2027-07-29', '2027-09-16', '2027-11-04', '2027-12-16'],
    notes: { '2027-02-04': 'Avec le rapport trimestriel de politique monétaire.', '2027-04-29': 'Avec le rapport trimestriel de politique monétaire.',
      '2027-07-29': 'Avec le rapport trimestriel de politique monétaire.', '2027-11-04': 'Avec le rapport trimestriel de politique monétaire.' } },
  { id: 'boj', flag: '🇯🇵', title: 'Banque du Japon : décision sur les taux', tz: 'Asia/Tokyo',
    sub: 'Annonce en général dans la matinée à Tokyo (la nuit en France). Fait bouger le Nikkei 225 et le yen.',
    dates: ['2026-12-18', '2027-01-22', '2027-03-18', '2027-04-28', '2027-06-11', '2027-07-22', '2027-09-22', '2027-10-29', '2027-12-17'] },
  { id: 'cpi', flag: '🇺🇸', title: 'États-Unis : inflation (CPI) de {mois}', tz: 'America/New_York', time: '08:30',
    sub: 'Chiffre suivi de près par la Fed : une surprise fait bouger Wall Street et les taux, et souvent les bourses européennes l\'après-midi.',
    dates: ['2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'] },
  { id: 'nfp', flag: '🇺🇸', title: 'États-Unis : rapport sur l\'emploi de {mois}', tz: 'America/New_York', time: '08:30',
    sub: 'Créations d\'emplois et taux de chômage : l\'une des publications qui font le plus bouger les marchés.',
    dates: ['2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'] },
];

const Macro = {
  /** Heure de Paris d'une heure locale (« 14h30 ») */
  parisTime(tz, date, hhmm) {
    const t = Markets.wallToUtc(tz, date, hhmm);
    const p = Markets.parts('Europe/Paris', t);
    return `${p.h}h${String(p.mi).padStart(2, '0')}`;
  },

  /** Troisième vendredi de mars, juin, septembre et décembre */
  witchingDays(from, to) {
    const out = [];
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      for (const m of [3, 6, 9, 12]) {
        const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
        const d = 1 + ((5 - first + 7) % 7) + 14;
        out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    return out.filter(d => d >= from && d <= to);
  },

  events(today, end) {
    const out = [];
    for (const c of MACRO_CALENDAR) {
      for (const d of c.dates) {
        if (d < today || d > end) continue;
        const month = new Date(addMonthsISO(d.slice(0, 7) + '-01', -1) + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
        const at = c.time ? `À ${this.parisTime(c.tz, d, c.time)} (heure de Paris). ` : '';
        out.push({ date: d, kind: 'eco', title: `${c.flag} ${c.title.replace('{mois}', month)}`, sub: at + c.sub + (c.notes && c.notes[d] ? ' ' + c.notes[d] : '') });
      }
    }
    const nyse = (HOLIDAYS.nyse && HOLIDAYS.nyse.closed) || [];
    for (const d of this.witchingDays(today, end)) {
      out.push({ date: d, kind: 'eco', title: '🌍 Quatre sorcières : échéance trimestrielle des options et contrats à terme',
        sub: 'Volumes et volatilité en hausse, surtout en fin de séance. Le soir même, les révisions trimestrielles des indices (S&P 500, Nasdaq-100, CAC 40, Euro Stoxx 50…) prennent effet : entrées et sorties de valeurs.'
          + (nyse.includes(d) ? ' Wall Street est fermée ce jour-là : les échéances américaines sont avancées à la veille.' : '') });
    }
    return out;
  },
};

/* Prochaines publications de résultats des actions suivies (relais Yahoo, type=calendar), gardées 12 h dans le navigateur */
const EARN_STORE = 'apistock:earnings';
const Earnings = {
  TTL: 12 * 3600000,
  RETRY: 10 * 60000,
  cache: null,      // symbole Yahoo -> { ts, data }
  status: '',       // '' | 'loading' | 'old-relay' | 'error'
  failedAt: 0,

  load() {
    if (!this.cache) {
      try { this.cache = JSON.parse(localStorage.getItem(EARN_STORE) || '{}') || {}; } catch (e) { this.cache = {}; }
    }
    return this.cache;
  },
  save() {
    const keep = new Set(this.targets().map(t => t.sym));
    for (const s of Object.keys(this.cache || {})) if (!keep.has(s)) delete this.cache[s];
    try { localStorage.setItem(EARN_STORE, JSON.stringify(this.cache || {})); } catch (e) { /* stockage indisponible */ }
  },

  /** Actions du portefeuille et de la watchlist (pas les ETF, fonds, indices, devises…) */
  targets() {
    const out = [], seen = new Set();
    for (const key of Store.trackedKeys()) {
      const i = Store.instrument(key);
      if (!i || i.provider === 'manual') continue;
      if (/etf|etc|etn|fonds|fund|trust|indice|index|crypto|devise|currency|mati|future|obligation|bond|warrant|turbo/i.test(i.type || '')) continue;
      const sym = yahooSymbolFor(i);
      if (!sym || !SYMBOL_OK.test(sym) || /^\^|=|-(EUR|USD)$/.test(sym) || seen.has(sym)) continue;
      seen.add(sym);
      out.push({ key, sym });
    }
    return out;
  },

  /** Recharge les dates périmées ; renvoie true si quelque chose a changé (à réafficher) */
  async refresh(force = false) {
    if (this._busy || !Api.hasProxy()) return false;
    if (!force && Date.now() - this.failedAt < this.RETRY) return false;
    const c = this.load(), now = Date.now();
    const todo = this.targets().map(t => t.sym).filter(s => force || !c[s] || now - c[s].ts > this.TTL);
    if (!todo.length) return false;
    this._busy = true;
    this.status = 'loading';
    try {
      for (let i = 0; i < todo.length; i += 20) {
        const chunk = todo.slice(i, i + 20);
        const json = await Api.yahoo({ type: 'calendar', symbols: chunk.join(',') });
        if (!json || typeof json.results !== 'object' || !json.results) throw new ApiError('requête invalide', 0);
        for (const s of chunk) c[s] = { ts: now, data: json.results[s] || null };
      }
      this.status = '';
    } catch (e) {
      // relais pas encore mis à jour : il ne connaît pas « type=calendar »
      this.status = /requête invalide/i.test(e.message || '') ? 'old-relay' : 'error';
      this.error = e.message || '';
      this.failedAt = Date.now();
    } finally {
      this._busy = false;
      this.save();
    }
    return true;
  },

  events(today, end) {
    const c = this.load(), out = [];
    for (const { key, sym } of this.targets()) {
      const d = c[sym] && c[sym].data;
      if (d) out.push(...this.eventsFor(d, Store.label(key), Store.instrument(key), today, end));
    }
    return out;
  },

  /** « T3 2026 », ou « T3 de l'exercice 2027 » si l'exercice de la société est décalé */
  quarterLabel(fiscal, calendar) {
    const f = /^(\d)Q(\d{4})$/.exec(fiscal || ''), cq = /^(\d)Q(\d{4})$/.exec(calendar || '');
    if (!f) return '';
    return f[1] === (cq && cq[1]) && f[2] === (cq && cq[2]) ? `T${f[1]} ${f[2]}` : `T${f[1]} de l'exercice ${f[2]}`;
  },

  /** Événements d'une société à partir de la réponse Yahoo (calendarEvents + earnings) */
  eventsFor(d, name, inst = {}, today = todayISO(), end = addDaysISO(today, 366)) {
    const raw = x => (x && isFinite(x.raw) ? x.raw : null);
    const localISO = t => { const x = new Date(t); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const ce = (d.calendarEvents && d.calendarEvents.earnings) || {};
    const ec = (d.earnings && d.earnings.earningsChart) || {};
    const ccy = (d.earnings && d.earnings.financialCurrency) || inst.currency || 'USD';
    const money = v => fmtMoney(v, ccy, 2, true);
    const big = v => {
      try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: ccy, notation: 'compact', maximumFractionDigits: 1 }).format(v); }
      catch (e) { return fmtNum(v / 1e9, 1) + ' Md ' + ccy; }
    };
    const surprise = (a, e) => (e ? fmtPct(((a - e) / Math.abs(e)) * 100, 1) : '');
    const beat = q => {
      const a = raw(q.actual), e = raw(q.estimate);
      if (a === null) return '';
      return `bénéfice par action ${money(a)}` + (e !== null ? ` contre ${money(e)} attendu (${surprise(a, e)}, ${a >= e ? 'au-dessus' : 'en dessous'} des attentes)` : '');
    };
    const quarters = (ec.quarterly || []).filter(q => raw(q.actual) !== null).sort((a, b) => (raw(a.reportedDate) || 0) - (raw(b.reportedDate) || 0));
    const out = [];

    // résultats publiés aujourd'hui
    for (const q of quarters) {
      const t = raw(q.reportedDate);
      if (!t) continue;
      const day = localISO(t * 1000);
      if (day < today || day > end) continue;
      const ql = this.quarterLabel(q.fiscalQuarter, q.calendarQuarter);
      out.push({ date: day, kind: 'earn', title: `Résultats publiés${ql ? ' ' + ql : ''} · ${name}`, sub: beat(q).replace(/^./, ch => ch.toUpperCase()) + '.' });
    }

    // prochaine publication
    const dates = (ce.earningsDate && ce.earningsDate.length ? ce.earningsDate : ec.earningsDate || []).map(raw).filter(Boolean).map(x => x * 1000);
    if (!dates.length) return out;
    const t0 = dates[0], day = localISO(t0);
    if (day < today || day > end || out.some(e => e.date === day)) return out;
    const estimate = !!(ce.isEarningsDateEstimate || ec.isEarningsDateEstimate);
    // trimestre concerné : clos avant la publication, et au plus 4 mois avant
    const pend = raw(ec.currentPeriodEndDate);
    const ql = pend && pend * 1000 < t0 && t0 - pend * 1000 < 130 * 86400000 ? this.quarterLabel(ec.currentFiscalQuarter, ec.currentCalendarQuarter) : '';
    const parts = [];
    if (estimate) parts.push(dates[1] && localISO(dates[1]) !== day ? `Date estimée, entre le ${fmtDate(day)} et le ${fmtDate(localISO(dates[1]))}` : 'Date estimée');
    else if (US_MICS.has(inst.mic)) {
      // horaires fiables pour Wall Street : avant l'ouverture ou après la clôture
      const p = Markets.parts('America/New_York', t0), hm = p.h * 60 + p.mi;
      const when = hm < 9 * 60 + 30 ? 'avant l\'ouverture de Wall Street' : hm >= 16 * 60 ? 'après la clôture de Wall Street' : 'pendant la séance';
      const pt = Markets.parts('Europe/Paris', t0);
      if (hm > 0) parts.push(`${when.replace(/^./, ch => ch.toUpperCase())} (vers ${pt.h}h${String(pt.mi).padStart(2, '0')}, heure de Paris)`);
    }
    if (ql && pend) parts.push(`trimestre clos le ${fmtDate(new Date(pend * 1000).toISOString().slice(0, 10))}`);
    const eps = raw(ce.earningsAverage) !== null ? raw(ce.earningsAverage) : raw(ec.currentQuarterEstimate);
    if (eps !== null) {
      const lo = raw(ce.earningsLow), hi = raw(ce.earningsHigh);
      parts.push(`bénéfice par action attendu ${money(eps)}` + (lo !== null && hi !== null && lo !== hi ? ` (estimations de ${money(lo)} à ${money(hi)})` : ''));
    }
    if (raw(ce.revenueAverage) !== null) parts.push(`chiffre d'affaires attendu ${big(raw(ce.revenueAverage))}`);
    const last = quarters[quarters.length - 1];
    if (last && beat(last)) parts.push(`trimestre précédent : ${beat(last)}`);
    const sub = parts.map((x, i) => (i ? x : x.replace(/^./, ch => ch.toUpperCase()))).join(' · ');
    out.push({ date: day, kind: 'earn', title: `Résultats${ql ? ' ' + ql : ''} · ${name}`, sub: sub ? sub + '.' : 'Date annoncée par la société.' });
    return out;
  },
};

const Agenda = {
  /** Échéances des `days` prochains jours, triées par date : [{ date, kind, title, sub, amount? }] */
  events(today = todayISO(), days = 366) {
    const end = addDaysISO(today, days);
    const cur = Store.state.settings.baseCurrency;
    const out = [];
    const inRange = d => d >= today && d <= end;

    // versements programmés actifs : chaque mois jusqu'à l'horizon
    for (const p of Store.state.plans || []) {
      if (p.active === false || !p.start) continue;
      let month = (p.start > today ? p.start : today).slice(0, 7);
      for (let g = 0; g < 14; g++, month = addMonthsISO(month + '-01', 1).slice(0, 7)) {
        const d = Portfolio.planDate(p, month);
        if (d < p.start || !inRange(d) || (p.done && p.done[month])) continue;
        out.push({ date: d, kind: 'plan', amount: parseNum(p.amount), title: `Versement programmé · ${Store.label(p.key)}`,
          sub: fmtMoney(parseNum(p.amount), cur, 0) + (Store.state.accounts.length > 1 ? ' · ' + Store.account(p.account).name : '') });
      }
    }

    // dividendes attendus (d'après les détachements des 12 derniers mois)
    if (typeof App !== 'undefined' && App.divForecast) {
      for (const d of App.divForecast(today, 'all')) {
        if (!inRange(d.date)) continue;
        out.push({ date: d.date, kind: 'div', amount: d.amount, title: `Dividende attendu · ${Store.label(d.key)}`,
          sub: (isFinite(d.amount) ? '≈ ' + fmtMoney(d.amount, cur) + ' brut' : 'montant inconnu') + ` (${fmtMoney(d.perShare, d.currency, 3)} par part)` });
      }
    }

    // publications de résultats des actions suivies (portefeuille et watchlist)
    out.push(...Earnings.events(today, end));

    // grands rendez-vous des indices : banques centrales, inflation et emploi américains, échéances trimestrielles
    out.push(...Macro.events(today, end));

    // bourses où tu as des lignes : jours fériés et clôtures anticipées
    const held = Portfolio.snapshot('all').rows;
    const exchanges = new Map();
    for (const r of held) { const ex = r.inst && Markets.forMic(r.inst.mic); if (ex && ex.holidays) exchanges.set(ex.id, ex); }
    for (const ex of exchanges.values()) {
      const H = HOLIDAYS[ex.holidays] || {};
      for (const d of H.closed || []) {
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        if (inRange(d) && wd !== 0 && wd !== 6) out.push({ date: d, kind: 'market', title: `${ex.name} fermée (jour férié)`, sub: '' });
      }
      for (const [d, at] of Object.entries(H.early || {})) {
        if (inRange(d)) out.push({ date: d, kind: 'market', title: `${ex.name} : clôture anticipée à ${at} (heure locale)`, sub: '' });
      }
    }

    // jalons fiscaux : 5 ans du PEA, 8 ans de l'assurance-vie, plafond du PEA
    for (const a of Store.state.accounts) {
      if (!Tax.sortedTxs(a.id).length) continue;
      if (a.type === 'pea') {
        const p = Tax.pea(a);
        if (p.five && inRange(p.five)) out.push({ date: p.five, kind: 'tax', title: `${a.name} : 5 ans`, sub: 'Retraits possibles sans clôture, gains exonérés d\'impôt sur le revenu (prélèvements sociaux seulement).' });
        const cap = Tax.peaCapDate(a, p.deposits, taxConf().peaCap, today);
        if (cap && inRange(cap.date)) out.push({ date: cap.date, kind: 'tax', title: `${a.name} : plafond des versements`, sub: `Atteint vers cette date au rythme de ${fmtMoney(cap.monthly, cur, 0)}/mois.` });
      }
      if (a.type === 'av') {
        const v = Tax.av(a, today);
        if (v.eight && inRange(v.eight)) out.push({ date: v.eight, kind: 'tax', title: `${a.name} : 8 ans`, sub: 'Abattement annuel sur les gains rachetés (4 600 €, 9 200 € en couple).' });
      }
    }

    // déclaration de revenus : plus-values et dividendes du compte-titres de l'année précédente
    const declYear = +today.slice(0, 4) - (today.slice(5) < '06-15' ? 1 : 0);
    const declDate = `${declYear + 1}-04-10`;
    if (inRange(declDate)) {
      let gains = 0, divs = 0, any = false;
      for (const a of Store.state.accounts.filter(x => x.type === 'cto' || x.type === 'autre')) {
        const e = Tax.events(a);
        for (const s of e.sales) if (s.date.startsWith(String(declYear))) { gains += s.gain; any = true; }
        for (const d of e.divs) if (d.date.startsWith(String(declYear))) { divs += d.amount; any = true; }
      }
      if (any) out.push({ date: declDate, kind: 'tax', title: `Déclaration des revenus ${declYear}`,
        sub: `Compte-titres : ${gains >= 0 ? 'plus-value' : 'moins-value'} ${fmtMoney(Math.abs(gains), cur, 0)} (case ${gains >= 0 ? '3VG' : '3VH'}), dividendes ${fmtMoney(divs, cur, 0)} (case 2DC ou 2TR). Ouverture en ligne vers avril ; date limite selon ton département (impots.gouv.fr).` });
    }

    // placements à valeur saisie : prochain relevé trimestriel à reporter
    if (typeof Manual !== 'undefined') {
      for (const r of held) {
        if (!Manual.is(r.key)) continue;
        const last = Manual.last(r.key);
        const next = last ? addMonthsISO(last[0], 3) : null;
        if (next) out.push({ date: next < today ? today : next, kind: 'todo', title: `Valeur à mettre à jour · ${Store.label(r.key)}`,
          sub: `Dernière valeur saisie le ${fmtDate(last[0])} : reporte celle de ton prochain relevé.` });
      }
    }

    return out.filter(e => inRange(e.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind.localeCompare(b.kind)));
  },

  /** Fichier iCalendar (journées entières) : importable dans Agenda iPhone, Google Agenda, Outlook */
  ics(events, stamp = new Date()) {
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const ymd = d => d.replace(/-/g, '');
    const fold = line => { // lignes de 75 octets au plus (RFC 5545)
      const out = [];
      let cur = '';
      for (const ch of line) {
        if (new TextEncoder().encode(cur + ch).length > 73) { out.push(cur); cur = ' '; }
        cur += ch;
      }
      out.push(cur);
      return out.join('\r\n');
    };
    const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//APIstock//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:APIstock'];
    for (const e of events) {
      lines.push('BEGIN:VEVENT',
        `UID:${ymd(e.date)}-${e.kind}-${hash(e.title)}@apistock`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${ymd(e.date)}`,
        `DTEND;VALUE=DATE:${ymd(addDaysISO(e.date, 1))}`,
        fold('SUMMARY:' + esc(e.title)),
        fold('DESCRIPTION:' + esc(e.sub)),
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  },
};

Object.assign(App, {
  agendaFilter: '',

  bindAgenda() {
    const btn = $('#agendaExport');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const evs = Agenda.events().filter(e => !this.agendaFilter || e.kind === this.agendaFilter);
      if (!evs.length) { toast('Aucune échéance à exporter'); return; }
      const blob = new Blob([Agenda.ics(evs)], { type: 'text/calendar;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'apistock-agenda.ics' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`${evs.length} échéance(s) exportée(s) : ouvre le fichier pour les ajouter à ton agenda`, 'success', 5000);
    });
  },

  renderAgenda() {
    const box = $('#agendaList');
    if (!box) return;
    const pending = Earnings.refresh(); // dates de résultats périmées : rechargées en arrière-plan
    pending.then(changed => { if (changed && this.view === 'agenda') this.renderAgenda(); });
    const note = $('#agendaNote');
    if (note) {
      const msg = {
        loading: 'Chargement des dates de résultats de tes actions…',
        'old-relay': 'Dates de résultats indisponibles : ton relais Yahoo doit être mis à jour (copie à nouveau proxy/cloudflare-worker.js dans ton worker Cloudflare, puis Deploy).',
        error: 'Dates de résultats indisponibles pour l\'instant' + (Earnings.error ? ' (' + Earnings.error + ')' : '') + '.',
      }[Earnings.status] || '';
      note.textContent = msg;
      note.hidden = !msg;
    }
    const all = Agenda.events();
    const counts = {};
    for (const e of all) counts[e.kind] = (counts[e.kind] || 0) + 1;
    if (this.agendaFilter && !counts[this.agendaFilter]) this.agendaFilter = '';
    $('#agendaKinds').replaceChildren(
      el('button', { class: this.agendaFilter ? '' : 'active', onclick: () => { this.agendaFilter = ''; this.renderAgenda(); } }, `Tout (${all.length})`),
      ...Object.entries(AGENDA_KINDS).filter(([k]) => counts[k]).map(([k, v]) =>
        el('button', { class: this.agendaFilter === k ? 'active' : '', onclick: () => { this.agendaFilter = k; this.renderAgenda(); } }, `${v.label} (${counts[k]})`)));
    const evs = all.filter(e => !this.agendaFilter || e.kind === this.agendaFilter);
    if (!evs.length) {
      box.replaceChildren(el('p', { class: 'empty' }, all.length ? 'Rien dans cette catégorie.' : 'Aucune échéance pour l\'instant. Programme un versement (onglet Investir) ou ajoute des lignes : leurs dividendes et les jours fériés de leur bourse apparaîtront ici.'));
      return;
    }
    const today = todayISO();
    const byMonth = new Map();
    for (const e of evs) { const m = e.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(e); }
    const cur = this.base();
    box.replaceChildren(...Array.from(byMonth.entries()).map(([m, list]) => {
      const sum = list.filter(e => e.kind === 'div' && isFinite(e.amount)).reduce((s, e) => s + e.amount, 0);
      const plans = list.filter(e => e.kind === 'plan').reduce((s, e) => s + (e.amount || 0), 0);
      const label = new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return el('section', { class: 'agenda-month' },
        el('h3', {}, label, el('span', { class: 'muted small' }, [plans ? `${fmtMoney(plans, cur, 0)} à investir` : '', sum ? `≈ ${fmtMoney(sum, cur)} de dividendes` : ''].filter(Boolean).join(' · '))),
        el('ul', { class: 'agenda-list' }, ...list.map(e => {
          const d = new Date(e.date + 'T12:00:00Z');
          return el('li', { class: 'agenda-item ' + e.kind + (e.date === today ? ' today' : '') },
            el('div', { class: 'agenda-date' }, el('b', {}, String(d.getUTCDate())),
              el('span', {}, d.toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }))),
            el('span', { class: 'agenda-icon', 'aria-hidden': 'true' }, AGENDA_KINDS[e.kind].icon),
            el('div', { class: 'agenda-text' }, el('b', {}, e.title), e.sub ? el('span', { class: 'muted small' }, e.sub) : null));
        })));
    }));
  },
});
