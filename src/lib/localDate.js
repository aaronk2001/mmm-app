// A stored day key ('YYYY-MM-DD') as LOCAL midnight. new Date('YYYY-MM-DD')
// parses as UTC midnight — the previous evening anywhere west of Greenwich — so
// every date it formatted rendered one day early in Arizona. Use this for any
// day key that is displayed or compared; tests/localDate.test.mjs pins it.
export function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
