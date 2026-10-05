// Settings → Online & Keys rows. Only features with a consumer are listed:
// server/online/features.js also reserves youtube/telegram so previously
// stored settings and keys stay valid, but nothing reads them, and a toggle
// for them would be a lie.
//
// `free` is shown in the app under every row so the user can see the free
// option before turning anything on. Each claim was checked against the
// provider's own pricing/docs page on 2026-09-30 (FRED and LM Studio pages
// did not state it outright); re-check before changing a number.
export const FEATURES = [
  {
    key: 'market',
    label: 'Market data',
    hint: 'Quotes, charts, crypto, FX and macro series (Markets section), plus free quotes and financials for Research. FRED key optional.',
    free: { text: 'Yahoo, CoinGecko and Frankfurter need no key. A FRED key is free.', links: [{ label: 'Get a FRED key', url: 'https://fred.stlouisfed.org/docs/api/api_key.html' }] },
  },
  {
    key: 'news',
    label: 'News',
    hint: 'Market and per-ticker headlines from Marketaux (Intelligence section). Needs a key.',
    free: { text: 'Marketaux free plan: 100 requests/day.', links: [{ label: 'Marketaux', url: 'https://www.marketaux.com/pricing' }] },
  },
  {
    key: 'predictionMarkets',
    label: 'Prediction markets',
    hint: 'Polymarket, Kalshi, and Manifold prices (Betting section). No key needed.',
    free: { text: 'Free, no key needed.', links: [] },
  },
  {
    key: 'sportsOdds',
    label: 'Sports odds',
    hint: 'Sportsbook lines from The Odds API (Betting section). Needs a key.',
    free: { text: 'The Odds API free plan: 500 credits/month.', links: [{ label: 'The Odds API', url: 'https://the-odds-api.com' }] },
  },
  {
    key: 'finnhub',
    label: 'Research: live quotes, metrics & news',
    hint: 'Real-time quotes, valuation ratios and company headlines from finnhub.io (Research section). Needs a key.',
    free: { text: 'Finnhub free plan: 60 calls/minute.', links: [{ label: 'Get a Finnhub key', url: 'https://finnhub.io/register' }] },
  },
  {
    key: 'exa',
    label: 'Research: web search',
    hint: 'Exa web search for business context, not numbers. Sends your search query to api.exa.ai. Needs a key.',
    free: { text: 'Exa gives $10 in free credit at sign-up, then charges per search.', links: [{ label: 'Exa', url: 'https://dashboard.exa.ai' }] },
  },
  {
    key: 'financialDatasets',
    label: 'Research: Financial Datasets (optional)',
    hint: 'Statements and ratios from financialdatasets.ai, tried before Yahoo for financials and after Finnhub for metrics. Needs a key.',
    free: { text: 'Paid (from $20 for 1,000 requests). Free alternative: leave this off; Market data covers financials and Finnhub covers metrics.', links: [] },
  },
  {
    key: 'cloudLlm',
    label: 'Research: Claude (cloud AI, opt-in)',
    hint: "Lets you pick Claude for a question instead of local Ollama. Your question and the fetched data go to api.anthropic.com. Never used automatically.",
    free: { text: 'Paid per use. Free alternative: keep local Ollama, which costs nothing.', links: [] },
  },
  {
    key: 'openaiCompat',
    label: 'Research: OpenAI-compatible (cloud AI, opt-in)',
    hint: 'Any /chat/completions endpoint. Set the URL and model in Settings → Research. Never used automatically. Key optional for local servers.',
    free: {
      text: 'Free options: Google Gemini free tier, OpenRouter free models, or LM Studio on this PC (no key).',
      links: [
        { label: 'Gemini', url: 'https://aistudio.google.com' },
        { label: 'OpenRouter', url: 'https://openrouter.ai' },
        { label: 'LM Studio', url: 'https://lmstudio.ai' },
      ],
    },
  },
];

export const OPENAI_URL_HINT = 'https://…, or http://localhost for LM Studio. Groq: https://api.groq.com/openai/v1 · OpenRouter: https://openrouter.ai/api/v1 · Gemini: https://generativelanguage.googleapis.com/v1beta/openai/ · LM Studio: http://localhost:1234/v1';
