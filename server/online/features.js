'use strict';

// The known online-feature/provider names — the only strings the "online" seam
// (settings.online.*, secrets:set's provider field) ever accepts. Zero
// dependencies on purpose: electron.js's main process requires this file
// directly (to validate secrets:set's provider) and must never pull in
// server/db/connection.js by accident, which would run the data-dir guard in
// a process that has no MMM_DATA_DIR/MMM_ALLOW_DEV_DB of its own.
// exa, financialDatasets, finnhub and openaiCompat are Research providers
// (server/research/); cloudLlm is Research's opt-in Claude backend.
module.exports = [
  'market', 'news', 'youtube', 'predictionMarkets', 'sportsOdds', 'telegram', 'cloudLlm',
  'exa', 'financialDatasets', 'finnhub', 'openaiCompat',
];
