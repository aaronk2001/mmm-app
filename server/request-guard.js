'use strict';

// Browser-facing guard for the local API. Binding 127.0.0.1 keeps other
// machines out, and CORS stops other origins from READING responses — but
// neither stops a web page open in the user's browser from SENDING requests:
//
//  - A cross-site <form method=POST> (or sendBeacon, or a no-cors fetch) is a
//    "simple request": no preflight, so it reaches the handler. A body-less
//    POST /api/money/reset from any website wiped the database.
//  - DNS rebinding: attacker.example re-resolves to 127.0.0.1, after which the
//    attacker's page is same-origin with this server and CORS no longer
//    applies at all — full read/write of the ledger.
//
// Three checks close both:
//  1. Host allowlist. A rebound request still carries the attacker's hostname
//     in Host, so anything but 127.0.0.1/localhost/[::1] on our port is a 421.
//  2. Unsafe methods must carry X-MMM-Client. Browsers can't attach a custom
//     header cross-origin without a CORS preflight, and cors() refuses the
//     preflight for any origin outside the allowlist — so the forged request
//     is never sent. The SPA's api() helper adds the header to every call.
//  3. Belt and braces for unsafe methods: refuse Sec-Fetch-Site: cross-site
//     and any Origin outside the allowlist (including the opaque "null").

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CLIENT_HEADER = 'x-mmm-client';

function createRequestGuard({ port, origins = [] }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = new Set([
    ...origins,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);

  return function requestGuard(req, res, next) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!hosts.has(host)) {
      return res.status(421).json({ error: 'Misdirected request.' });
    }
    if (SAFE_METHODS.has(req.method) || !req.path.startsWith('/api/')) return next();

    if (req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: 'Cross-site request refused.' });
    }
    const origin = req.get('origin');
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }
    if (req.get(CLIENT_HEADER) !== '1') {
      return res.status(403).json({ error: 'Missing X-MMM-Client header.' });
    }
    return next();
  };
}

module.exports = { createRequestGuard, CLIENT_HEADER };
