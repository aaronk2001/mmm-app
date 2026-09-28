'use strict';

// One way to turn a thrown error into a response. Route handlers used to send
// err.message with a 400 for everything, so "Account not found" came back as
// a 400 and SQLite's own wording ("FOREIGN KEY constraint failed", "NOT NULL
// constraint failed: accounts.type", "integer overflow") reached the UI.
//
// - err.status (set by e.g. server/money/amounts.js) wins.
// - Known SQLite failures become a plain-language message and a fitting code.
// - "... not found" is a 404.
// - Anything else keeps its message with the caller's fallback status; 5xx
//   are logged.

const SQLITE_ERRORS = [
  [/FOREIGN KEY constraint failed/i, 400, "That refers to an account or category that doesn't exist."],
  [/UNIQUE constraint failed/i, 409, 'That already exists.'],
  [/NOT NULL constraint failed/i, 400, 'A required field is missing.'],
  [/CHECK constraint failed/i, 400, 'A value is out of range.'],
  [/integer overflow/i, 400, 'An amount is too large to store.'],
];

function errorResponse(err, fallbackStatus = 400) {
  const message = String((err && err.message) || err || 'Unexpected error');
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600) return { status: err.status, message };
  for (const [re, status, text] of SQLITE_ERRORS) if (re.test(message)) return { status, message: text };
  if (/\bnot found\b/i.test(message)) return { status: 404, message };
  return { status: fallbackStatus, message };
}

function sendError(res, err, fallbackStatus = 400) {
  const { status, message } = errorResponse(err, fallbackStatus);
  if (status >= 500) console.error('[MMM error]', (err && err.stack) || err);
  if (!res.headersSent) res.status(status).json({ error: message });
}

module.exports = { errorResponse, sendError };
