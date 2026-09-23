// A stored day key ('YYYY-MM-DD') as LOCAL midnight. new Date('YYYY-MM-DD')
// parses as UTC midnight — the previous evening anywhere west of Greenwich — so
// every date it formatted rendered one day early in Arizona. Use this for any
// day key that is displayed or compared; tests/localDate.test.mjs pins it.
export function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Today as a LOCAL 'YYYY-MM-DD' day key. `new Date().toISOString().slice(0, 10)`
// is UTC, so anywhere west of Greenwich (e.g. Arizona after 5pm) it returns
// TOMORROW's date. Use this for any "today" default that gets saved at rest.
export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
