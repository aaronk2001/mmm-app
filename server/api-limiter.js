'use strict';

// Sprint E measurement: one section mount fires 4-13 GETs and a mutation
// refetches 3-4 more, so an ordinary tour of the app plus a few edits crossed
// 120/min and surfaced as error toasts (the client has no 429 handling). The
// server binds 127.0.0.1, so limiting local reads protects nothing. Writes stay
// limited, and so do /market and /online reads, which can reach the network
// (e.g. GET /market/quote/:symbol). `path` is relative to the /api mount.
const NETWORK_READS = /^\/(market|online)\//;

function skipApiLimiter(req) {
  return req.method === 'GET' && !NETWORK_READS.test(req.path);
}

module.exports = { skipApiLimiter };
