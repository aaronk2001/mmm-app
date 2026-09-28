import { describe, it, expect, vi } from 'vitest';
import {
  parseCSV, parseQIF, parseOFX, normalizeQifDate, normalizeDate, normalizeAmount,
  detectDateOrder, detectDecimalMark, normalizeRows,
} from '../server/money/parsers.js';

// Both fallbacks below force TZ west of UTC + a fake evening local time so
// `new Date().toISOString().slice(0, 10)` (UTC) and the LOCAL calendar day
// disagree — Sep 23, 8pm Phoenix local is already Sep 24 in UTC.
function withPhoenixEvening(fn) {
  const prevTZ = process.env.TZ;
  process.env.TZ = 'America/Phoenix';
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 23, 20, 0));
  try {
    return fn();
  } finally {
    vi.useRealTimers();
    if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  }
}

describe('parseCSV (papaparse)', () => {
  it('parses simple rows with default headers', () => {
    const rows = parseCSV('date,amount,payee,note\n2026-07-01,-42.50,Trader Joes,weekly');
    expect(rows).toEqual([{ date: '2026-07-01', amount: '-42.50', payee: 'Trader Joes', note: 'weekly' }]);
  });

  it('handles quoted fields containing commas', () => {
    const rows = parseCSV('date,amount,payee,note\n2026-07-01,100,"Payee, Inc",x');
    expect(rows[0].payee).toBe('Payee, Inc');
  });

  it('handles embedded newlines inside quoted fields', () => {
    const rows = parseCSV('date,amount,payee,note\n2026-07-01,100,Shop,"line 1\nline 2"');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toContain('line 1');
  });

  it('applies a custom column mapping', () => {
    const rows = parseCSV('Posted,Value,Merchant\n2026-07-02,-9.99,Spotify', { date: 'Posted', amount: 'Value', payee: 'Merchant' });
    expect(rows[0]).toMatchObject({ date: '2026-07-02', amount: '-9.99', payee: 'Spotify' });
  });

  it('capital-letter default headers still map', () => {
    const rows = parseCSV('Date,Amount,Payee\n2026-07-03,5,Refund');
    expect(rows[0]).toMatchObject({ date: '2026-07-03', amount: '5', payee: 'Refund' });
  });
});

describe('normalizeQifDate (Y2K pivot at 70)', () => {
  it.each([
    ['07/01/26', '2026-07-01'],
    ['07/01/69', '2069-07-01'],
    ['07/01/70', '1970-07-01'],
    ['07/01/85', '1985-07-01'],
    ['07/01/99', '1999-07-01'],
    ['7/4/2026', '2026-07-04'],
    ['2026-07-04', '2026-07-04'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeQifDate(input)).toBe(expected);
  });
});

// Deliberate change (finding #1): an unparseable or missing date used to be
// replaced with TODAY — silently re-dating the row. Now the row is rejected and
// reported. The Phoenix-evening harness stays to prove no "today" of either
// kind (local or UTC) sneaks back in.
describe('normalizeQifDate', () => {
  it('returns null — not today — for an unparseable date', () => {
    withPhoenixEvening(() => {
      expect(normalizeQifDate('not a date')).toBeNull();
    });
  });

  it("reads Quicken's space-padded day and apostrophe years", () => {
    expect(normalizeQifDate("1/ 5'26")).toBe('2026-01-05');
    expect(normalizeQifDate("12/31' 5")).toBe('2005-12-31');
    expect(normalizeQifDate('12/31/99')).toBe('1999-12-31');
  });
});

describe('normalizeDate', () => {
  it.each([
    ['2026-01-15', 'MDY', '2026-01-15'],
    ['2026-01-15T23:30:00-05:00', 'MDY', '2026-01-15'],
    ['2026/01/15', 'DMY', '2026-01-15'],
    ['20260115', 'MDY', '2026-01-15'],
    ['20260115120000.000[-5:EST]', 'MDY', '2026-01-15'],
    ['15-Jan-2026', 'MDY', '2026-01-15'],
    ['15 January 26', 'MDY', '2026-01-15'],
    ['Jan 15, 2026', 'DMY', '2026-01-15'],
    ['Sept 5 2026', 'MDY', '2026-09-05'],
    ['01/15/2026 10:30 AM', 'MDY', '2026-01-15'],
    ['31/01/2026', 'DMY', '2026-01-31'],
    ['05/01/2026', 'DMY', '2026-01-05'],
    ['05/01/2026', 'MDY', '2026-05-01'],
    ['5.1.2026', 'DMY', '2026-01-05'],
    ['26/01/15', 'YMD', '2026-01-15'],
  ])('%s (%s) -> %s', (input, order, expected) => {
    expect(normalizeDate(input, order)).toEqual({ value: expected });
  });

  it.each([
    ['31/01/2026', 'MDY'], // month 31
    ['02/30/2026', 'MDY'], // no Feb 30
    ['0026-10-01', 'MDY'], // 2-digit year typed into a date input
    ['01/15/2026', 'YMD'], // not year-first
    ['Foo 12 2026', 'MDY'],
    ['', 'MDY'],
  ])('rejects %s (%s) with a reason', (input, order) => {
    expect(normalizeDate(input, order).error).toMatch(/date/);
  });
});

describe('detectDateOrder', () => {
  it('reads a day above 12 as day-first for the whole file', () => {
    expect(detectDateOrder(['05/01/2026', '13/01/2026', '01/02/2026'])).toMatchObject({ order: 'DMY', guessed: false });
  });
  it('reads a second group above 12 as month-first', () => {
    expect(detectDateOrder(['05/01/2026', '01/13/2026'])).toMatchObject({ order: 'MDY', guessed: false });
  });
  it('says when it had to guess', () => {
    expect(detectDateOrder(['05/01/2026', '01/02/2026'])).toMatchObject({ order: 'MDY', guessed: true });
    expect(detectDateOrder(['2026-01-05'])).toMatchObject({ order: null, guessed: false });
  });
});

describe('normalizeAmount', () => {
  it.each([
    ['2,500.00', '.', '2500.00'],
    ['-1,850.00', '.', '-1850.00'],
    ['$4.50', '.', '4.50'],
    ['(12.34)', '.', '-12.34'],
    ['$(12.34)', '.', '-12.34'],
    ['-$56.78', '.', '-56.78'],
    ['$-56.78', '.', '-56.78'],
    ['12.34-', '.', '-12.34'],
    ['−12.34', '.', '-12.34'],
    ['45.00 DR', '.', '-45.00'],
    ['45.00 CR', '.', '45.00'],
    ['USD 1,234.56', '.', '1234.56'],
    ['1.234,56 €', ',', '1234.56'],
    ['1 234,56', ',', '1234.56'],
    ['12,50', ',', '12.50'],
    ["1'234.50", '.', '1234.50'],
    ['1,23,456.78', '.', '123456.78'],
    ['.50', '.', '0.50'],
    ['0', '.', '0'],
  ])('%s (decimal %s) -> %s', (input, mark, expected) => {
    expect(normalizeAmount(input, mark)).toEqual({ value: expected });
  });

  it.each([
    ['12,50', '.'], // decimal comma read with a period mark: rejected, not 1250
    ['1,234.56', ','],
    ['12abc', '.'],
    ['5e16', '.'],
    ['1.2.3', '.'],
    ['999999999999', '.'], // beyond the $100B bound
  ])('rejects %s (decimal %s)', (input, mark) => {
    expect(normalizeAmount(input, mark).error).toMatch(/amount/);
  });

  it('treats blank as blank and passes plain numbers through', () => {
    expect(normalizeAmount('', '.')).toEqual({ blank: true });
    expect(normalizeAmount(-12.5, '.')).toEqual({ value: '-12.5' });
  });
});

describe('detectDecimalMark', () => {
  it('decides once per file', () => {
    expect(detectDecimalMark(['1.234,56', '-12,50', '3'])).toMatchObject({ mark: ',', guessed: false });
    expect(detectDecimalMark(['1,234.56', '12.00'])).toMatchObject({ mark: '.', guessed: false });
  });
  it('reads a lone three-digit group as thousands, and says it guessed', () => {
    expect(detectDecimalMark(['1.234', '-2.500'])).toMatchObject({ mark: ',', guessed: true });
    expect(detectDecimalMark(['1,234'])).toMatchObject({ mark: '.', guessed: true });
  });
});

describe('normalizeRows', () => {
  it('skips a header row and reports bad rows without dropping good ones', () => {
    const out = normalizeRows([
      { date: 'Date', amount: 'Amount', payee: 'Description' },
      { date: '01/15/2026', amount: '$1,200.00', payee: 'Paycheck' },
      { date: 'garbage', amount: '-5', payee: 'Bad date' },
      { date: '01/16/2026', amount: 'n/a', payee: 'Bad amount' },
      { date: '01/17/2026', amount: '(40.00)', payee: '  Grocer  ' },
    ]);
    expect(out.headers).toBe(1);
    expect(out.rows.map((r) => [r.row, r.date, r.amount, r.payee])).toEqual([
      [2, '2026-01-15', '1200.00', 'Paycheck'],
      [5, '2026-01-17', '-40.00', 'Grocer'],
    ]);
    expect(out.errors).toEqual([
      { row: 3, reason: 'unrecognized date "garbage"' },
      { row: 4, reason: 'unrecognized amount "n/a"' },
    ]);
  });

  it('reads Debit/Credit columns as money out / money in', () => {
    const out = normalizeRows([
      { date: '2026-01-15', debit: '45.00', credit: '', payee: 'Grocer' },
      { date: '2026-01-16', debit: '0.00', credit: '1,000.00', payee: 'Paycheck' },
      { date: '2026-01-17', debit: '-12.00', payee: 'Signed debit' },
      { date: '2026-01-18', debit: '5.00', credit: '5.00', payee: 'Both' },
    ]);
    expect(out.rows.map((r) => r.amount)).toEqual(['-45.00', '1000.00', '-12.00']);
    expect(out.errors).toEqual([{ row: 4, reason: 'row has both a debit and a credit' }]);
  });

  it('applies the detected date order and decimal mark to every row', () => {
    const out = normalizeRows([
      { date: '05/01/2026', amount: '1.234,56', payee: 'a' },
      { date: '13/01/2026', amount: '-12,50', payee: 'b' },
    ]);
    expect(out.detected).toEqual({ dateFormat: 'DMY', dateFormatGuessed: false, decimal: ',', decimalGuessed: false });
    expect(out.rows.map((r) => [r.date, r.amount])).toEqual([['2026-01-05', '1234.56'], ['2026-01-13', '-12.50']]);
  });

  it('honours an explicit format over detection', () => {
    const out = normalizeRows([{ date: '05/01/2026', amount: '1,234', payee: 'a' }], { dateFormat: 'DMY', decimal: ',' });
    expect(out.rows[0]).toMatchObject({ date: '2026-01-05', amount: '1.234' });
  });

  it('never dates a row today because it had no date', () => {
    withPhoenixEvening(() => {
      const out = normalizeRows([{ amount: '10', payee: 'Mystery' }]);
      expect(out.rows).toEqual([]);
      expect(out.errors).toEqual([{ row: 1, reason: 'missing date' }]);
    });
  });
});

// Deliberate change: parseQIF / parseOFX now return RAW field strings (plus
// FITIDs and row numbers); normalizeRows reads them with the file's detected
// formats, so a European QIF ("T-1.234,56") parses like a US one.
describe('parseQIF', () => {
  it('parses records split by ^', () => {
    const qif = '!Type:Bank\nD07/01/26\nT-1200.00\nPRent Co\nMjuly\n^\nD07/02/26\nT2000\nPEmployer\n^\n';
    const rows = parseQIF(qif);
    expect(rows).toEqual([
      { row: 1, date: '07/01/26', amount: '-1200.00', payee: 'Rent Co', note: 'july' },
      { row: 2, date: '07/02/26', amount: '2000', payee: 'Employer' },
    ]);
    const out = normalizeRows(rows);
    expect(out.rows[0]).toMatchObject({ date: '2026-07-01', amount: '-1200.00', payee: 'Rent Co', note: 'july' });
    expect(out.rows[1]).toMatchObject({ date: '2026-07-02', amount: '2000' });
  });

  it('strips thousands separators from amounts', () => {
    expect(normalizeRows(parseQIF('D07/01/26\nT-1,234.56\nPBig Bill\n^\n')).rows[0].amount).toBe('-1234.56');
    expect(normalizeRows(parseQIF('D01/07/2026\nT-1.234,56\nPGroot\n^\nD13/07/2026\nT-5,00\nPKlein\n^\n')).rows
      .map((r) => [r.date, r.amount])).toEqual([['2026-07-01', '-1234.56'], ['2026-07-13', '-5.00']]);
  });

  it('skips account and category lists, and reports investment records', () => {
    const qif = [
      '!Account', 'NChecking', 'TBank', '^',
      '!Type:Cat', 'NGroceries', 'DFood', 'E', '^',
      '!Type:Bank', "D1/ 5'26", 'T-45.00', 'PElectric', '^',
      '!Type:Invst', 'D1/6/26', 'NBuy', 'YVTI', 'T-1000', '^',
    ].join('\n');
    const out = normalizeRows(parseQIF(qif));
    expect(out.rows.map((r) => [r.date, r.amount, r.payee])).toEqual([['2026-01-05', '-45.00', 'Electric']]);
    expect(out.errors).toEqual([{ row: 2, reason: 'investment (!Type:Invst) records are not imported' }]);
  });
});

describe('parseOFX', () => {
  it('parses STMTTRN blocks', () => {
    const ofx = '<OFX><STMTTRN><DTPOSTED>20260701120000<TRNAMT>-55.25<FITID>A1<NAME>Gas Station<MEMO>fuel</STMTTRN><STMTTRN><DTPOSTED>20260702<TRNAMT>1500.00<NAME>Payroll</STMTTRN></OFX>';
    const out = normalizeRows(parseOFX(ofx));
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ date: '2026-07-01', amount: '-55.25', payee: 'Gas Station', note: 'fuel', external_id: 'fitid:A1' });
    expect(out.rows[1]).toMatchObject({ date: '2026-07-02', amount: '1500.00', external_id: null });
  });

  it('reads a decimal-comma TRNAMT (allowed by the OFX spec) as decimal', () => {
    const ofx = '<STMTTRN><DTPOSTED>20260910<TRNAMT>-25,90<FITID>E1<NAME>Supermarkt</STMTTRN>';
    expect(normalizeRows(parseOFX(ofx)).rows[0].amount).toBe('-25.90'); // was -2590
  });

  it('keeps FITIDs distinct when a bank repeats one inside a file', () => {
    const block = '<STMTTRN><DTPOSTED>20260910<TRNAMT>-5.00<FITID>DUP<NAME>Coffee</STMTTRN>';
    expect(parseOFX(block + block).map((r) => r.external_id)).toEqual(['fitid:DUP', 'fitid:DUP#2']);
  });

  it('decodes XML entities in names', () => {
    expect(parseOFX('<STMTTRN><DTPOSTED>20260910<TRNAMT>-5<NAME>AT&amp;T</STMTTRN>')[0].payee).toBe('AT&T');
  });

  // Deliberate change: these used to be dropped (no amount) or dated TODAY (no
  // DTPOSTED). Both are now reported.
  it('reports blocks without an amount or a date instead of inventing one', () => {
    withPhoenixEvening(() => {
      const out = normalizeRows(parseOFX('<STMTTRN><DTPOSTED>20260701<NAME>Junk</STMTTRN><STMTTRN><TRNAMT>-10.00<NAME>Mystery</STMTTRN>'));
      expect(out.rows).toEqual([]);
      expect(out.errors).toEqual([{ row: 1, reason: 'missing amount' }, { row: 2, reason: 'missing date' }]);
    });
  });
});
