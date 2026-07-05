import { describe, it, expect } from 'vitest';
import { parseCSV, parseQIF, parseOFX, normalizeQifDate } from '../server/money/parsers.js';

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

describe('parseQIF', () => {
  it('parses records split by ^', () => {
    const qif = '!Type:Bank\nD07/01/26\nT-1200.00\nPRent Co\nMjuly\n^\nD07/02/26\nT2000\nPEmployer\n^\n';
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-07-01', amount: -1200, payee: 'Rent Co', note: 'july' });
    expect(rows[1]).toMatchObject({ date: '2026-07-02', amount: 2000, payee: 'Employer' });
  });

  it('strips thousands separators from amounts', () => {
    const rows = parseQIF('D07/01/26\nT-1,234.56\nPBig Bill\n^\n');
    expect(rows[0].amount).toBe(-1234.56);
  });
});

describe('parseOFX', () => {
  it('parses STMTTRN blocks', () => {
    const ofx = '<OFX><STMTTRN><DTPOSTED>20260701120000<TRNAMT>-55.25<NAME>Gas Station<MEMO>fuel</STMTTRN><STMTTRN><DTPOSTED>20260702<TRNAMT>1500.00<NAME>Payroll</STMTTRN></OFX>';
    const rows = parseOFX(ofx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-07-01', amount: -55.25, payee: 'Gas Station', note: 'fuel' });
    expect(rows[1]).toMatchObject({ date: '2026-07-02', amount: 1500 });
  });

  it('skips blocks without an amount', () => {
    expect(parseOFX('<STMTTRN><DTPOSTED>20260701<NAME>Junk</STMTTRN>')).toHaveLength(0);
  });
});
