// Dev-only: how reliably does the local model emit a valid first tool call?
// Compares Ollama native tool-calling with the JSON (ReAct) fallback on 12
// fixed questions. Tools are never run — only the model's first step is
// scored — so nothing leaves the machine.
//
//   MMM_DATA_DIR=<temp dir> node scripts/measure-research-tools.mjs [model]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ollama = require('../server/money/ollama.js');
const llm = require('../server/research/llm.js');
const { TOOLS } = require('../server/research/tools.js');
const { researchSystemPrompt } = require('../server/research/persona.js');

const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const QUESTIONS = [
  'Is MSFT free cash flow growing?', 'What is AAPL trading at?', 'How profitable is NVDA?', 'Is KO revenue growing?',
  'Any news on GOOGL this week?', 'What is the price of TSLA?', 'Has AMZN capex gone up?', 'What is the P/E of JNJ?',
  'How has META revenue changed over 5 years?', 'Quote for BRK.B', 'What do people say about COST management?', 'What does V free cash flow look like?',
];

const st = await ollama.status(process.argv[2]);
if (!st.available) {
  console.log('Ollama not available — nothing measured.');
  process.exit(0);
}
const specs = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
const system = researchSystemPrompt({ tools: TOOLS, today: localToday() });

for (const [mode, make] of [['native', llm.ollamaNativeStep], ['json', llm.ollamaJsonStep]]) {
  const step = make(st.model, system);
  const isValid = (r) => {
    const c = r.calls[0];
    const tool = c && TOOLS.find((t) => t.name === c.name);
    if (!tool) return false;
    try { tool.validate(c.args); return true; } catch { return false; }
  };
  let first = 0;
  let nudged = 0;
  let ms = 0;
  for (const q of QUESTIONS) {
    const t0 = Date.now();
    try {
      const transcript = [{ role: 'user', content: q }];
      // eslint-disable-next-line no-await-in-loop
      const r = await step(transcript, specs, { timeoutMs: 40000 });
      if (isValid(r)) { first += 1; nudged += 1; } else if (!r.calls.length) {
        // Same single push-back server/research/agent.js gives.
        transcript.push({ role: 'user', content: 'Before answering, call one of the tools to fetch the data.' });
        // eslint-disable-next-line no-await-in-loop
        if (isValid(await step(transcript, specs, { timeoutMs: 40000 }))) nudged += 1;
      }
    } catch { /* a miss */ }
    ms += Date.now() - t0;
  }
  console.log(`${st.model} ${mode}: first call ${first}/${QUESTIONS.length}, within one nudge ${nudged}/${QUESTIONS.length}, avg ${Math.round(ms / QUESTIONS.length)} ms/question`);
}
