'use strict';

// Background interval jobs that run inside the forked server process, apart
// from the daily backup scheduler (server/backup/scheduler.js). Currently
// just the market snapshot job (Sprint A, Track 2): opt-in, 30 min, market
// hours only, `.unref()`'d so it never holds the process open. The UI never
// triggers a fetch itself — this job (and the explicit Refresh route) are
// the only things that write into price_cache.

const online = require('./online');
const { refreshSnapshots } = require('./market/snapshots');

const INTERVAL_MS = 30 * 60 * 1000;

// US market hours (9:30am-4:00pm ET, Mon-Fri), computed via Intl so DST is
// handled automatically instead of a hardcoded UTC offset. This does NOT
// account for market holidays — a holiday just means the fetch returns the
// prior close, which is a harmless no-op cache write, not a UI-visible bug.
function isUsMarketHours(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const day = parts.weekday;
  if (day === 'Sat' || day === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

let timer = null;

function startMarketSnapshotJob() {
  const kickoff = () => {
    if (!online.enabled('market') || !isUsMarketHours()) return;
    refreshSnapshots().catch((e) => console.error('[MMM market] snapshot refresh failed:', e.message));
  };
  kickoff();
  timer = setInterval(kickoff, INTERVAL_MS);
  timer.unref();
  console.log('[MMM market] snapshot job started — every 30 min, market hours only, opt-in');
}

module.exports = { startMarketSnapshotJob, isUsMarketHours };
