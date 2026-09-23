'use strict';

// Import-file parsers. CSV goes through papaparse (correct handling of quoted
// fields, embedded commas/newlines); OFX and QIF stay hand-rolled — the formats
// are simple and stable.

const Papa = require('papaparse');
const calc = require('./calc');

function parseCSV(csvText, mapping) {
  const result = Papa.parse(String(csvText).trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
    transform: (v) => String(v).trim(),
  });
  const rows = result.data || [];

  if (mapping) {
    return rows.map(row => ({
      date: row[mapping.date] || row['date'] || '',
      amount: row[mapping.amount] || row['amount'] || '',
      payee: row[mapping.payee] || row['payee'] || '',
      note: row[mapping.note] || row['note'] || '',
    }));
  }

  return rows.map(row => ({
    date: row.date || row['Date'] || '',
    amount: row.amount || row['Amount'] || '',
    payee: row.payee || row['Payee'] || '',
    note: row.note || row['Note'] || '',
  }));
}

// Two-digit years pivot at 70: 70-99 -> 19xx, 00-69 -> 20xx. (The previous
// pivot at >50 filed 2051-2069 dates into the 1950s-60s.)
function normalizeQifDate(s) {
  s = String(s).trim().replace(/'/g, '/');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) >= 70 ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return calc.localDate();
}

function parseQIF(content) {
  const rows = [];
  let cur = {};
  const flush = () => { if (cur.date || cur.amount !== undefined || cur.payee) rows.push(cur); cur = {}; };
  for (const raw of String(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!')) continue;
    const code = line[0];
    const val = line.slice(1).trim();
    if (code === '^') flush();
    else if (code === 'D') cur.date = normalizeQifDate(val);
    else if (code === 'T' || code === 'U') cur.amount = parseFloat(val.replace(/[, ]/g, ''));
    else if (code === 'P') cur.payee = val;
    else if (code === 'M') cur.note = val;
  }
  flush();
  return rows;
}

function parseOFX(content) {
  const rows = [];
  const blocks = String(content).split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const block = b.split(/<\/STMTTRN>/i)[0];
    const tag = (name) => {
      const m = block.match(new RegExp('<' + name + '>([^<\\r\\n]*)', 'i'));
      return m ? m[1].trim() : '';
    };
    const amt = tag('TRNAMT');
    if (!amt) continue;
    const dt = tag('DTPOSTED');
    const dm = String(dt).match(/^(\d{4})(\d{2})(\d{2})/);
    rows.push({
      date: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : calc.localDate(),
      amount: parseFloat(amt.replace(/[, ]/g, '')),
      payee: tag('NAME') || tag('PAYEE'),
      note: tag('MEMO'),
    });
  }
  return rows;
}

module.exports = { parseCSV, parseQIF, parseOFX, normalizeQifDate };
