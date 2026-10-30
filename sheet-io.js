// Export (xlsx / csv / Google Sheets paste) and import (csv / pasted cells)
// in the "Creator Collaboration – Approved List" layout.
import { buildXlsx, colName } from './xlsx.js';
import { extractHandles } from './parse.js';

export const COLS = [
  { key: 'sr', h: 'Sr. No.', w: 7, s: 'text' },
  { key: 'name', h: 'Name', w: 24, s: 'text' },
  { key: 'followers', h: 'Followers', w: 12, s: 'int' },
  { key: 'link', h: 'Link', w: 44, s: 'link' },
  { key: 'category', h: 'Category', w: 10, s: 'text' },
  { key: 'er', h: 'ER', w: 9, s: 'pct' },
  { key: 'avgViews', h: 'Average Views', w: 14, s: 'int' },
  { key: 'locations', h: 'Top 3 Locations', group: 'Audience location %', w: 28, s: 'wrap' },
  { key: 'a1317', h: '13-17', group: 'Audience Split', w: 9, s: 'pct' },
  { key: 'a1824', h: '18-24', group: 'Audience Split', w: 9, s: 'pct' },
  { key: 'a2534', h: '25-34', group: 'Audience Split', w: 9, s: 'pct' },
  { key: 'deliverables', h: 'Deliverables', w: 18, s: 'wrap' },
  { key: 'cost', h: 'Cost', w: 11, s: 'int' }
];

export function category(f) {
  if (!f) return '';
  if (f < 10000) return 'Nano';
  if (f < 100000) return 'Micro';
  if (f < 1000000) return 'Macro';
  return 'Mega';
}

const pctStr = (v) => (v == null || v === '' ? '' : `${Number(v).toFixed(2)}%`);
const toNum = (v) => {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/[₹$,\s]/g, ''));
  return isFinite(n) && String(v).trim() !== '' ? n : v;
};

export function locationsText(r) {
  if (r.cities && r.cities.length) return r.cities.slice(0, 3).map((c) => `${c.name} - ${Number(c.pct).toFixed(2).replace(/\.?0+$/, '')}%`).join('\n');
  return r.audience ? 'Unavailable at the moment' : '';
}

/** Plain values for one row (numbers stay numbers; percentages as 4.53 meaning 4.53%). */
export function rowValues(r, i) {
  const age = r.age || {};
  return {
    sr: i + 1,
    name: r.name || '',
    followers: r.followers ?? '',
    link: `https://www.instagram.com/${r.handle}/`,
    category: category(r.followers),
    er: r.er ?? '',
    avgViews: r.avgViews ?? '',
    locations: locationsText(r),
    a1317: age['13-17'] ?? '',
    a1824: age['18-24'] ?? '',
    a2534: age['25-34'] ?? '',
    deliverables: r.deliverables || '',
    cost: toNum(r.cost)
  };
}

const headerRows = (extraHeaders) => {
  const top = COLS.map((c) => c.group || c.h);
  const bottom = COLS.map((c) => (c.group ? c.h : ''));
  extraHeaders.forEach((h) => {
    top.push(h || 'Notes');
    bottom.push('');
  });
  return [top, bottom];
};

// ---------- Excel ----------
export function toXlsx(sheet) {
  const extras = sheet.extraHeaders || [];
  const [top, bottom] = headerRows(extras);
  const ncol = top.length;
  const merges = [];
  const rows = [top.map((v) => ({ v, s: 'header' })), bottom.map((v) => ({ v, s: 'header' }))];
  // Merge vertical headers; merge grouped headers horizontally.
  COLS.forEach((c, i) => {
    if (!c.group) merges.push(`${colName(i)}1:${colName(i)}2`);
  });
  const groups = {};
  COLS.forEach((c, i) => c.group && (groups[c.group] = groups[c.group] || []).push(i));
  for (const idx of Object.values(groups)) {
    if (idx.length > 1) merges.push(`${colName(idx[0])}1:${colName(idx[idx.length - 1])}1`);
    else rows[0][idx[0]] = { v: COLS[idx[0]].group, s: 'header' };
  }
  extras.forEach((_, j) => merges.push(`${colName(COLS.length + j)}1:${colName(COLS.length + j)}2`));

  const heights = [22, 22];
  sheet.rows.forEach((r, i) => {
    const vals = rowValues(r, i);
    const cells = COLS.map((c) => {
      let v = vals[c.key];
      if (c.s === "pct" && v !== "") v = +(Number(v) / 100).toFixed(6);
      if (c.s === 'int' && v !== '' && typeof v !== 'number') return { v, s: 'text' };
      return { v, s: c.s };
    });
    (r.extras || []).slice(0, extras.length).forEach((v) => cells.push({ v: v || '', s: 'wrap' }));
    while (cells.length < ncol) cells.push({ v: '', s: 'wrap' });
    rows.push(cells);
    const lines = Math.max(1, ...cells.map((c) => String(c.v ?? '').split('\n').length));
    heights.push(Math.max(18, lines * 15 + 3));
  });
  return buildXlsx({
    sheetName: sheet.title || 'Creators',
    rows,
    merges,
    widths: [...COLS.map((c) => c.w), ...extras.map(() => 30)],
    freezeRows: 2,
    heights
  });
}

// ---------- CSV ----------
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function displayRows(sheet) {
  const extras = sheet.extraHeaders || [];
  return sheet.rows.map((r, i) => {
    const vals = rowValues(r, i);
    const out = COLS.map((c) => (c.s === 'pct' ? pctStr(vals[c.key]) : vals[c.key]));
    extras.forEach((_, j) => out.push((r.extras || [])[j] || ''));
    return out;
  });
}
export function toCsv(sheet) {
  const [top, bottom] = headerRows(sheet.extraHeaders || []);
  const topRow = top.map((v, i) => (i < COLS.length && !COLS[i].group ? '' : v));
  // First group cell only, like the original sheet.
  const seen = new Set();
  topRow.forEach((v, i) => {
    if (COLS[i] && COLS[i].group) {
      if (seen.has(v)) topRow[i] = '';
      seen.add(v);
    }
  });
  const second = top.map((v, i) => (i < COLS.length ? COLS[i].h : v));
  return '﻿' + [topRow, second, ...displayRows(sheet)].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ---------- Google Sheets (paste) ----------
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function toHtmlTable(sheet) {
  const extras = sheet.extraHeaders || [];
  const groups = {};
  COLS.forEach((c) => c.group && (groups[c.group] = (groups[c.group] || 0) + 1));
  const done = new Set();
  let top = '';
  for (const c of COLS) {
    if (!c.group) top += `<th rowspan="2">${h(c.h)}</th>`;
    else if (!done.has(c.group)) {
      done.add(c.group);
      top += `<th colspan="${groups[c.group]}">${h(c.group)}</th>`;
    }
  }
  extras.forEach((x) => (top += `<th rowspan="2">${h(x || 'Notes')}</th>`));
  const second = COLS.filter((c) => c.group).map((c) => `<th>${h(c.h)}</th>`).join('');
  const body = displayRows(sheet)
    .map((r) => `<tr>${r.map((v) => `<td>${h(v).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
    .join('');
  return `<table><tr>${top}</tr><tr>${second}</tr>${body}</table>`;
}
export function toTsv(sheet) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const second = [...COLS.map((c) => c.h), ...(sheet.extraHeaders || []).map((x) => x || 'Notes')];
  return [second, ...displayRows(sheet)].map((r) => r.map(q).join('\t')).join('\n');
}

// ---------- Import ----------
export function parseDelimited(text, delim = ',') {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"' && f === '') q = true;
    else if (c === delim) {
      row.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  if (f !== '' || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.replace(/^﻿/, '')));
}

/**
 * Reads a sheet (rows of cells) and returns creators with your own columns kept:
 * {rows:[{handle, name, deliverables, cost, extras}], extraHeaders}
 */
export function importTable(table) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const isIG = (s) => /instagram\.com\/|instagr\.am\//i.test(String(s || ''));
  let hi = table.findIndex((r) => r.some((c) => /^link$|^instagram( link| url)?$|^profile( link| url)?$|^url$/.test(norm(c))));
  const header = hi >= 0 ? table[hi] : [];
  const findCol = (re) => header.findIndex((c) => re.test(norm(c)));
  const data = table.slice(hi + 1);

  let linkCol = findCol(/^link$|instagram|profile|^url$/);
  if (linkCol < 0) {
    let best = -1;
    let bestN = 0;
    const width = Math.max(0, ...data.map((r) => r.length));
    for (let c = 0; c < width; c++) {
      const n = data.filter((r) => isIG(r[c])).length;
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    linkCol = best;
  }
  const nameCol = findCol(/^name/);
  const delivCol = findCol(/deliverable/);
  const costCol = findCol(/^(cost|price|commercial|fee|rate card)/);

  // Your extra columns after Cost (notes etc.) are carried over.
  const extraStart = costCol >= 0 ? costCol + 1 : -1;
  const width = Math.max(0, ...data.map((r) => r.length));
  const extraCols = [];
  if (extraStart > 0) for (let c = extraStart; c < width; c++) if (data.some((r) => String(r[c] || '').trim())) extraCols.push(c);

  const rows = [];
  const seen = new Set();
  for (const r of data) {
    const cell = linkCol >= 0 ? r[linkCol] : r.join('\n');
    const handle = extractHandles(String(cell || ''), { allowBare: linkCol >= 0 })[0];
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    rows.push({
      handle,
      name: nameCol >= 0 ? String(r[nameCol] || '').trim() : '',
      deliverables: delivCol >= 0 ? String(r[delivCol] || '').trim() : '',
      cost: costCol >= 0 ? String(r[costCol] || '').trim() : '',
      extras: extraCols.map((c) => String(r[c] || '').trim())
    });
  }
  return { rows, extraHeaders: extraCols.map((c) => String(header[c] || '').trim()) };
}
