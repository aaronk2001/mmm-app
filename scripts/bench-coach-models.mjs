// Benchmark local Ollama models for the MMM finance coach on THIS machine.
//
//   node scripts/bench-coach-models.mjs
//   BENCH_MODELS="qwen2.5:1.5b-instruct,llama3.2:1b" node scripts/bench-coach-models.mjs
//
// Measures, per model: load success, tokens/sec (CPU), latency, and how often the
// model returns valid JSON for a tool-call-shaped prompt (the coach needs this).
// Pick the winner by tokens/sec × json-validity that still LOADS under app load.
// Run it while MMM + a browser are open to reflect real memory pressure — on the
// laptop in memory (i5-1240P / 16GB / 4GB VRAM) only ~1.5B reliably loads under load.

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODELS = (process.env.BENCH_MODELS ||
  'qwen2.5:1.5b-instruct,llama3.2:1b,llama3.2:3b,qwen2.5:3b-instruct,gemma2:2b,qwen3:1.7b'
).split(',').map((s) => s.trim()).filter(Boolean);

const PROMPTS = [
  'My net worth is $24,400 with $20,850 in debt. What should I prioritize?',
  'I spend $4,236/month. How big should my emergency fund be?',
  'Compare paying off a 20% APR credit card vs investing at 8%.',
  'I save 12% of income. Is that enough? What is a good target?',
  'My runway is 4 months. How do I extend it to 6?',
  'Should I do avalanche or snowball with a $2,350 card (20%) and an $18,500 auto loan (7%)?',
  'How much house can I afford on $65,000 salary?',
  'Give me 3 concrete money moves for this month.',
];

const JSON_PROMPT =
  'Return ONLY JSON: {"summary": string, "actions": string[]} for a user paying down 20% APR debt. No prose.';

async function ollama(path, body, timeoutMs = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return false;
  try { JSON.parse(m[0]); return true; } catch { return false; }
}

async function benchModel(model) {
  const row = { model, loaded: false, avgTokPerSec: 0, avgLatencyMs: 0, jsonValidPct: 0, error: '' };
  try {
    // warm load
    const start = Date.now();
    await ollama('/api/generate', { model, prompt: 'hi', stream: false, options: { num_predict: 8 } }, 120000);
    row.loaded = true;
    row.loadMs = Date.now() - start;

    let totTok = 0, totSec = 0, totLat = 0, n = 0;
    for (const p of PROMPTS) {
      const t0 = Date.now();
      const r = await ollama('/api/generate', {
        model, prompt: p, stream: false,
        system: 'You are a concise personal-finance coach. Answer in 2-4 sentences.',
        options: { num_predict: 160, temperature: 0.6 },
      });
      const lat = Date.now() - t0;
      const evalCount = r.eval_count || 0;
      const evalSec = (r.eval_duration || 0) / 1e9;
      if (evalSec > 0) { totTok += evalCount; totSec += evalSec; }
      totLat += lat; n++;
    }
    row.avgTokPerSec = totSec > 0 ? +(totTok / totSec).toFixed(1) : 0;
    row.avgLatencyMs = n > 0 ? Math.round(totLat / n) : 0;

    let jsonOk = 0, jsonN = 3;
    for (let i = 0; i < jsonN; i++) {
      const r = await ollama('/api/generate', { model, prompt: JSON_PROMPT, stream: false, options: { num_predict: 200, temperature: 0.2 } });
      if (extractJson(r.response || '')) jsonOk++;
    }
    row.jsonValidPct = Math.round((jsonOk / jsonN) * 100);
  } catch (e) {
    row.error = e.message || String(e);
  }
  return row;
}

(async () => {
  console.log(`Ollama: ${OLLAMA}`);
  console.log(`Models: ${MODELS.join(', ')}\n`);
  const rows = [];
  for (const m of MODELS) {
    process.stdout.write(`Benchmarking ${m} … `);
    const row = await benchModel(m);
    console.log(row.loaded ? `${row.avgTokPerSec} tok/s, ${row.jsonValidPct}% JSON` : `FAILED (${row.error})`);
    rows.push(row);
  }
  console.log('\n=== RESULTS ===');
  console.table(rows.map((r) => ({
    model: r.model, loaded: r.loaded ? 'yes' : 'NO',
    'tok/s': r.avgTokPerSec, 'latency(ms)': r.avgLatencyMs, 'json%': r.jsonValidPct, error: r.error || '',
  })));
  const winner = rows.filter((r) => r.loaded).sort((a, b) => (b.avgTokPerSec * (b.jsonValidPct + 1)) - (a.avgTokPerSec * (a.jsonValidPct + 1)))[0];
  if (winner) console.log(`\nWinner (speed × JSON validity, loads under load): ${winner.model}`);
  else console.log('\nNo model loaded. On the 16GB laptop under app load, try qwen2.5:1.5b-instruct (the proven fallback).');
})();
