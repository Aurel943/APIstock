/* Horaires des bourses mondiales : séances, pauses, jours fériés, fuseaux horaires */
'use strict';

/*
 * Jours fériés connus (fermeture complète) et clôtures anticipées.
 * Sources : calendriers officiels Euronext, Deutsche Börse, LSE et NYSE pour 2026-2027.
 * Les autres places ne gèrent que les week-ends.
 */
const HOLIDAYS = {
  euronext: {
    closed: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-25',
      '2027-01-01', '2027-03-26', '2027-03-29'],
    early: { '2026-12-24': '14:05', '2026-12-31': '14:05', '2027-12-24': '14:05', '2027-12-31': '14:05' },
  },
  xetra: {
    closed: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-24', '2026-12-25', '2026-12-31',
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-12-24', '2027-12-31'],
    early: {},
  },
  lse: {
    closed: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28'],
    early: { '2026-12-24': '12:30', '2026-12-31': '12:30', '2027-12-24': '12:30', '2027-12-31': '12:30' },
  },
  nyse: {
    closed: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
      '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
      '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
    early: { '2026-11-27': '13:00', '2026-12-24': '13:00', '2027-11-26': '13:00' },
  },
};

const EXCHANGES = [
  { id: 'paris', name: 'Euronext Paris', city: 'Paris', flag: '🇫🇷', tz: 'Europe/Paris', sessions: [['09:00', '17:30']],
    holidays: 'euronext', mics: ['XPAR'], index: { y: '^FCHI', name: 'CAC 40' }, region: 'Europe' },
  { id: 'amsterdam', name: 'Euronext Amsterdam', city: 'Amsterdam', flag: '🇳🇱', tz: 'Europe/Amsterdam', sessions: [['09:00', '17:30']],
    holidays: 'euronext', mics: ['XAMS', 'XBRU', 'XLIS', 'XDUB'], index: { y: '^AEX', name: 'AEX' }, region: 'Europe' },
  { id: 'xetra', name: 'Xetra (Francfort)', city: 'Francfort', flag: '🇩🇪', tz: 'Europe/Berlin', sessions: [['09:00', '17:30']],
    holidays: 'xetra', mics: ['XETR', 'XFRA', 'XSTU', 'XMUN', 'XDUS', 'XHAM', 'XBER'], index: { y: '^GDAXI', name: 'DAX' }, region: 'Europe' },
  { id: 'london', name: 'London Stock Exchange', city: 'Londres', flag: '🇬🇧', tz: 'Europe/London', sessions: [['08:00', '16:30']],
    holidays: 'lse', mics: ['XLON'], index: { y: '^FTSE', name: 'FTSE 100' }, region: 'Europe' },
  { id: 'zurich', name: 'SIX Swiss Exchange', city: 'Zurich', flag: '🇨🇭', tz: 'Europe/Zurich', sessions: [['09:00', '17:30']],
    mics: ['XSWX'], index: { y: '^SSMI', name: 'SMI' }, region: 'Europe' },
  { id: 'milan', name: 'Borsa Italiana', city: 'Milan', flag: '🇮🇹', tz: 'Europe/Rome', sessions: [['09:00', '17:30']],
    mics: ['XMIL'], index: { y: 'FTSEMIB.MI', name: 'FTSE MIB' }, region: 'Europe' },
  { id: 'madrid', name: 'Bolsa de Madrid', city: 'Madrid', flag: '🇪🇸', tz: 'Europe/Madrid', sessions: [['09:00', '17:30']],
    mics: ['XMAD'], index: { y: '^IBEX', name: 'IBEX 35' }, region: 'Europe' },
  { id: 'newyork', name: 'NYSE / Nasdaq', city: 'New York', flag: '🇺🇸', tz: 'America/New_York', sessions: [['09:30', '16:00']],
    holidays: 'nyse', mics: ['XNYS', 'XNAS', 'XNGS', 'XNCM', 'XNMS', 'ARCX', 'XASE', 'BATS'], index: { y: '^GSPC', name: 'S&P 500' },
    extra: [{ y: '^IXIC', name: 'Nasdaq' }, { y: '^DJI', name: 'Dow Jones' }], region: 'Amériques' },
  { id: 'toronto', name: 'Toronto Stock Exchange', city: 'Toronto', flag: '🇨🇦', tz: 'America/Toronto', sessions: [['09:30', '16:00']],
    mics: ['XTSE'], index: { y: '^GSPTSE', name: 'S&P/TSX' }, region: 'Amériques' },
  { id: 'tokyo', name: 'Bourse de Tokyo', city: 'Tokyo', flag: '🇯🇵', tz: 'Asia/Tokyo', sessions: [['09:00', '11:30'], ['12:30', '15:30']],
    mics: ['XTKS', 'XJPX'], index: { y: '^N225', name: 'Nikkei 225' }, region: 'Asie-Pacifique' },
  { id: 'hongkong', name: 'Hong Kong Exchange', city: 'Hong Kong', flag: '🇭🇰', tz: 'Asia/Hong_Kong', sessions: [['09:30', '12:00'], ['13:00', '16:00']],
    mics: ['XHKG'], index: { y: '^HSI', name: 'Hang Seng' }, region: 'Asie-Pacifique' },
  { id: 'shanghai', name: 'Bourse de Shanghai', city: 'Shanghai', flag: '🇨🇳', tz: 'Asia/Shanghai', sessions: [['09:30', '11:30'], ['13:00', '15:00']],
    mics: ['XSHG', 'XSHE'], index: { y: '000001.SS', name: 'SSE Composite' }, region: 'Asie-Pacifique' },
  { id: 'mumbai', name: 'Bourse de Bombay', city: 'Mumbai', flag: '🇮🇳', tz: 'Asia/Kolkata', sessions: [['09:15', '15:30']],
    mics: ['XBOM', 'XNSE'], index: { y: '^BSESN', name: 'Sensex' }, region: 'Asie-Pacifique' },
  { id: 'sydney', name: 'ASX Sydney', city: 'Sydney', flag: '🇦🇺', tz: 'Australia/Sydney', sessions: [['10:00', '16:00']],
    mics: ['XASX'], index: { y: '^AXJO', name: 'S&P/ASX 200' }, region: 'Asie-Pacifique' },
];

/* Indicateurs globaux affichés en tête de l'onglet Monde */
const MACRO = [
  { y: '^STOXX50E', name: 'Euro Stoxx 50', kind: 'index' },
  { y: 'EURUSD=X', name: 'EUR / USD', kind: 'fx', digits: 4 },
  { y: 'GC=F', name: 'Or (once)', kind: 'commo', ccy: 'USD' },
  { y: 'BZ=F', name: 'Pétrole Brent', kind: 'commo', ccy: 'USD' },
  { y: 'BTC-EUR', name: 'Bitcoin', kind: 'crypto', ccy: 'EUR' },
  { y: '^VIX', name: 'VIX (peur)', kind: 'index' },
];

const Markets = {
  _fmt: {},

  /** Composants de date/heure d'un instant dans un fuseau donné */
  parts(tz, t) {
    const f = this._fmt[tz] = this._fmt[tz] || new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    const o = {};
    for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd, date: `${o.year}-${o.month}-${o.day}` };
  },

  offset(tz, t) {
    const p = this.parts(tz, t);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
  },

  /** Instant UTC correspondant à une heure murale dans un fuseau */
  wallToUtc(tz, dateISO, hhmm) {
    const [y, m, d] = dateISO.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    let t = guess - this.offset(tz, guess);
    const off2 = this.offset(tz, t);
    if (guess - off2 !== t) t = guess - off2;
    return t;
  },

  shiftDate(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  },

  weekday(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  },

  /** Séances [début, fin] (instants UTC) d'une place pour une date locale ; [] si fermé */
  sessionsOn(ex, iso) {
    const wd = this.weekday(iso);
    if (wd === 0 || wd === 6) return { list: [], reason: 'Week-end' };
    const hol = ex.holidays ? HOLIDAYS[ex.holidays] : null;
    if (hol && hol.closed.includes(iso)) return { list: [], reason: 'Jour férié' };
    const sessions = ex.sessions.map(s => s.slice());
    let early = null;
    if (hol && hol.early[iso]) {
      early = hol.early[iso];
      const last = sessions[sessions.length - 1];
      last[1] = early;
    }
    return {
      list: sessions.map(([a, b]) => [this.wallToUtc(ex.tz, iso, a), this.wallToUtc(ex.tz, iso, b)]),
      early,
    };
  },

  /** État courant d'une place : open | break | closed + prochain changement */
  status(ex, now = Date.now()) {
    const today = this.parts(ex.tz, now).date;
    const todays = this.sessionsOn(ex, today);
    let state = 'closed', reason = todays.reason || '';
    for (let i = 0; i < todays.list.length; i++) {
      const [a, b] = todays.list[i];
      if (now >= a && now < b) { state = 'open'; break; }
      if (i > 0 && now >= todays.list[i - 1][1] && now < a) { state = 'break'; reason = 'Pause déjeuner'; }
    }
    if (state === 'closed' && !reason) {
      if (todays.list.length && now < todays.list[0][0]) reason = 'Avant l\'ouverture';
      else if (todays.list.length) reason = 'Séance terminée';
    }
    // prochain événement (ouverture ou fermeture)
    let next = null;
    for (let k = 0; k < 15 && !next; k++) {
      const s = this.sessionsOn(ex, this.shiftDate(today, k));
      for (const [a, b] of s.list) {
        if (state === 'open' && now < b && now >= a) { next = { type: 'close', at: b }; break; }
        if (state !== 'open' && a > now) { next = { type: 'open', at: a }; break; }
      }
    }
    return { state, reason, next, early: todays.early, localTime: this.parts(ex.tz, now), hasHolidays: !!ex.holidays };
  },

  forMic(mic) {
    if (!mic) return null;
    return EXCHANGES.find(e => e.mics.includes(mic)) || null;
  },

  /** Libellés */
  fmtDuration(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m} min`;
  },

  fmtLocal(t, withDay) {
    const d = new Date(t);
    const sameDay = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (!withDay || sameDay) return time;
    return d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + time;
  },

  /** Phrase courte : « Ouvert · ferme dans 2 h 10 » */
  summary(st, now = Date.now()) {
    if (st.state === 'open') return st.next ? `Ouvert · ferme dans ${this.fmtDuration(st.next.at - now)}` : 'Ouvert';
    const pre = st.state === 'break' ? 'Pause' : (st.reason === 'Jour férié' ? 'Férié' : 'Fermé');
    return st.next ? `${pre} · ouvre ${st.next.at - now < 86400000 ? 'dans ' + this.fmtDuration(st.next.at - now) : this.fmtLocal(st.next.at, true)}` : pre;
  },

  /** Segments de séance qui tombent dans la journée locale de l'utilisateur, en % (0-100) */
  daySegments(ex, now = Date.now()) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const dayMs = end - start;
    const exToday = this.parts(ex.tz, now).date;
    const segs = [];
    for (const k of [-1, 0, 1]) {
      for (const [a, b] of this.sessionsOn(ex, this.shiftDate(exToday, k)).list) {
        const s = Math.max(a, +start), e = Math.min(b, +end);
        if (e > s) segs.push({ left: ((s - start) / dayMs) * 100, width: ((e - s) / dayMs) * 100, a, b });
      }
    }
    return { segs, nowPct: ((now - start) / dayMs) * 100 };
  },
};
