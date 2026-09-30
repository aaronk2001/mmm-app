'use strict';

// The server binds to 127.0.0.1, but that alone does not keep web pages out:
// any site open in the user's browser can send requests to localhost.
//   - DNS rebinding: a hostile domain re-resolved to 127.0.0.1 is same-origin
//     with us and could READ every endpoint. Browsers still send the attacker's
//     hostname in Host, so only loopback hostnames are accepted.
//   - Cross-site writes: CORS stops a page reading responses, not sending a
//     "simple" POST (no preflight). POST /api/money/reset takes no body at all.
//     Browsers always attach Origin to cross-origin writes, so unsafe methods
//     must come from an allowed origin or from a non-browser client (no Origin).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostname(host) {
  if (!host) return '';
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1).toLowerCase();
  return host.split(':')[0].toLowerCase();
}

function localGuard(allowedOrigins) {
  const origins = new Set(allowedOrigins);
  return (req, res, next) => {
    if (!LOOPBACK_HOSTS.has(hostname(req.headers.host))) {
      return res.status(403).json({ error: 'Forbidden host' });
    }
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !origins.has(origin))) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }
    next();
  };
}

module.exports = { localGuard };
