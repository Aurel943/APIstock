/*
 * Export tableur (Excel, LibreOffice, Numbers, Google Sheets) : un classeur .xlsx avec la synthèse, les positions par
 * compte, toutes les opérations, les plus-values réalisées (détail et par année) et les dividendes — pour un comptable,
 * un conseiller ou tes propres calculs. Écrit dans le navigateur, sans bibliothèque : fichier Office Open XML (zip non
 * compressé), nombres et dates en vraies valeurs (formats monétaire, pourcentage, date), en-têtes figés.
 * Écriture pure (objet Xlsx) testée dans tests/xlsx.test.mjs ; contenu du classeur en bas du fichier.
 */
'use strict';

const Xlsx = {
  /** Table CRC-32 (zip) */
  _crc: null,
  crc32(bytes) {
    if (!this._crc) {
      this._crc = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; this._crc[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = this._crc[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  },

  /** Archive zip sans compression : files [{ name, data (texte ou Uint8Array) }] → Uint8Array */
  zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const u16 = v => [v & 0xff, (v >>> 8) & 0xff], u32 = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = this.crc32(data);
      // en-tête local : version 2.0, drapeau UTF-8 (bit 11), sans compression, date fixe (1er janvier 2026)
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16((46 << 9) | (1 << 5) | 1), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      const local = new Uint8Array([...u32(0x04034b50), ...common]);
      parts.push(local, name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  },

  esc(s) {
    // caractères de contrôle interdits en XML (sauf tabulation et retours à la ligne) retirés
    const clean = Array.from(String(s)).filter(ch => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13; }).join('');
    return clean.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  },

  /** Lettres d'une colonne (0 → A, 26 → AA) */
  col(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; },

  /** Numéro de série Excel d'une date « AAAA-MM-JJ » */
  serial(iso) { return (Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 864e5; },

  /* Styles : 0 normal, 1 en-tête, 2 monétaire, 3 quantité, 4 pourcentage, 5 date, 6 titre */
  STYLE: { head: 1, money: 2, qty: 3, pct: 4, date: 5, title: 6 },

  /** Cellule : texte, nombre, ou { v, f: money | qty | pct | date | head | title } */
  cell(c, ref) {
    if (c === null || c === undefined || c === '') return '';
    const o = typeof c === 'object' ? c : { v: c };
    let v = o.v;
    const s = o.f ? this.STYLE[o.f] || 0 : 0;
    if (o.f === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) v = this.serial(v);
    if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${Math.round(v * 1e8) / 1e8}</v></c>` : '';
    return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${this.esc(v)}</t></is></c>`;
  },

  sheet({ rows, widths = [], freeze = 1 }) {
    const data = rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => this.cell(c, this.col(j) + (i + 1))).join('')}</row>`).join('');
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const pane = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${data}</sheetData></worksheet>`;
  },

  /** Classeur : sheets [{ name, rows, widths?, freeze? }] → Uint8Array (.xlsx) */
  build(sheets) {
    const names = sheets.map((s, i) => this.esc(String(s.name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Feuille ' + (i + 1)));
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.######"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F5EF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    return this.zip([
      { name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels }, { name: 'xl/styles.xml', data: styles },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: this.sheet(s) })),
    ]);
  },
};

Object.assign(App, {
  /** Feuilles du classeur d'export (devise de base ; opérations dans la devise de l'instrument) */
  xlsxSheets() {
    const base = this.base(), M = v => ({ v, f: 'money' }), Q = v => ({ v, f: 'qty' }), P = v => ({ v: v / 100, f: 'pct' }), D = v => ({ v, f: 'date' });
    const H = list => list.map(v => ({ v, f: 'head' }));
    const accName = id => (Store.state.accounts.find(a => a.id === id) || {}).name || id;
    const TYPES = { buy: 'Achat', sell: 'Vente', div: 'Dividende', split: 'Division' };
    const inst = k => Store.instrument(k) || {};
    // synthèse et positions par compte
    const all = Portfolio.snapshot('all').totals;
    const synth = [[{ v: 'APIstock · export du ' + fmtDate(todayISO()), f: 'title' }], [],
      H(['Indicateur', 'Montant (' + base + ')']),
      ['Valeur des positions', M(all.value)], ['Montant investi (prix de revient)', M(all.cost)], ['Plus-value latente', M(all.pnl)],
      ['Plus-values réalisées', M(all.realized)], ['Dividendes reçus', M(all.dividends)], ['Gain total', M(all.totalGain)], [],
      H(['Compte', 'Type', 'Valeur', 'Prix de revient', 'Plus-value latente', 'Plus-value latente (%)'])];
    const pos = [H(['Compte', 'Ligne', 'Symbole', 'ISIN', 'Devise', 'Quantité', 'Prix de revient unitaire', 'Cours', 'Valeur (' + base + ')', 'Prix de revient (' + base + ')', 'Plus-value latente (' + base + ')', 'Plus-value (%)', 'Poids dans le compte'])];
    for (const a of Store.state.accounts) {
      const s = Portfolio.snapshot(a.id);
      if (!s.rows.length) continue;
      synth.push([a.name, a.type || '', M(s.totals.value), M(s.totals.cost), M(s.totals.pnl), isFinite(s.totals.pnlPct) ? P(s.totals.pnlPct) : '']);
      for (const r of s.rows) {
        const i = inst(r.key);
        pos.push([a.name, i.name || Store.label(r.key), i.symbol || '', i.isin || '', r.currency, Q(r.qty), M(r.pru), isFinite(r.price) ? M(r.price) : '',
          isFinite(r.valueBase) ? M(r.valueBase) : '', M(r.costBase), isFinite(r.pnlBase) ? M(r.pnlBase) : '', isFinite(r.pnlPct) ? P(r.pnlPct) : '', isFinite(r.weightValue) ? P(r.weightValue) : '']);
      }
    }
    // opérations
    const ops = [H(['Date', 'Compte', 'Type', 'Ligne', 'Symbole', 'ISIN', 'Quantité ou parité', 'Prix', 'Devise', 'Frais', 'Montant', 'Note'])];
    for (const t of Store.state.transactions.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))) {
      const i = inst(t.key), q = parseNum(t.qty), p = parseNum(t.price), f = parseNum(t.fees) || 0;
      const amount = t.type === 'split' ? '' : M(t.type === 'buy' ? q * p + f : q * p - f);
      ops.push([D(t.date), accName(t.account), TYPES[t.type] || t.type, i.name || Store.label(t.key), i.symbol || '', i.isin || '', Q(q), t.type === 'split' ? '' : M(p), i.currency || base, M(f), amount, t.note || '']);
    }
    // plus-values réalisées et dividendes (méthode du prix moyen pondéré, montants en devise de base au taux du jour de l'opération)
    const sales = [H(['Date', 'Compte', 'Ligne', 'Quantité', 'Prix de vente', 'Prix moyen d\'achat', 'Produit net (' + base + ')', 'Prix de revient (' + base + ')', 'Plus ou moins-value (' + base + ')'])];
    const divs = [H(['Date', 'Compte', 'Ligne', 'Montant (' + base + ')'])];
    const years = {};
    for (const a of Store.state.accounts) {
      const e = Tax.events(a);
      for (const s of e.sales) {
        sales.push([D(s.date), a.name, Store.label(s.key), Q(s.qty), M(s.price), M(s.pmp), M(s.proceeds), M(s.cost), M(s.gain)]);
        const y = years[s.date.slice(0, 4) + '|' + a.id] = years[s.date.slice(0, 4) + '|' + a.id] || { year: +s.date.slice(0, 4), acc: a.name, gains: 0, losses: 0, divs: 0 };
        if (s.gain >= 0) y.gains += s.gain; else y.losses += -s.gain;
      }
      for (const d of e.divs) {
        divs.push([D(d.date), a.name, Store.label(d.key), M(d.amount)]);
        const y = years[d.date.slice(0, 4) + '|' + a.id] = years[d.date.slice(0, 4) + '|' + a.id] || { year: +d.date.slice(0, 4), acc: a.name, gains: 0, losses: 0, divs: 0 };
        y.divs += d.amount;
      }
    }
    const byYear = [H(['Année', 'Compte', 'Plus-values', 'Moins-values', 'Net', 'Dividendes'])].concat(Object.values(years)
      .sort((x, y) => x.year - y.year || x.acc.localeCompare(y.acc, 'fr')).map(y => [y.year, y.acc, M(y.gains), M(-y.losses), M(y.gains - y.losses), M(y.divs)]));
    const chrono = rows => [rows[0]].concat(rows.slice(1).sort((x, y) => (x[0].v < y[0].v ? -1 : x[0].v > y[0].v ? 1 : 0))); // dates ISO
    return [
      { name: 'Synthèse', rows: synth, widths: [34, 16, 16, 16, 18, 20], freeze: 0 },
      { name: 'Positions', rows: pos, widths: [16, 38, 10, 14, 8, 12, 14, 12, 16, 16, 18, 12, 12] },
      { name: 'Opérations', rows: ops, widths: [11, 16, 11, 38, 10, 14, 12, 12, 8, 10, 14, 30] },
      { name: 'Plus-values réalisées', rows: chrono(sales), widths: [11, 16, 38, 10, 12, 14, 16, 16, 18] },
      { name: 'Par année', rows: byYear, widths: [8, 16, 14, 14, 14, 14] },
      { name: 'Dividendes', rows: chrono(divs), widths: [11, 16, 38, 16] },
    ];
  },

  exportXlsx() {
    if (!Store.state.transactions.length) { toast('Aucune opération à exporter.', 'info'); return; }
    const bytes = Xlsx.build(this.xlsxSheets());
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'apistock-' + todayISO() + '.xlsx' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Classeur Excel exporté : synthèse, positions, opérations, plus-values et dividendes.', 'success');
  },
});

App.on('view:shown', function (page) {
  if (this._xlsxBound) return;
  for (const id of ['#xlsxExport', '#xlsxExport2']) { const b = $(id); if (b) { b.addEventListener('click', () => this.exportXlsx()); this._xlsxBound = true; } }
});
