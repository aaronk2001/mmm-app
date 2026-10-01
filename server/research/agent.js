'use strict';

// The bounded research loop: at most `maxCalls` tool calls inside a
// `budgetMs` wall-clock budget. The model never sees a tool it can't call, a
// bad call comes back to it as an error (and still counts toward the cap), and
// the final answer is checked against every number the tools returned.

const { checkGrounding } = require('./grounding');
const { runTool } = require('./tools');

const MAX_RESULT_CHARS = 4000;
// Below this, the forced final answer would only time out — stop instead.
const FINAL_STEP_MIN_MS = 5000;

async function runResearch({ question, step, tools, maxCalls = 6, budgetMs = 60000, now = Date.now }) {
  const deadline = now() + budgetMs;
  const transcript = [{ role: 'user', content: question }];
  const toolCalls = [];
  const results = [];
  const specs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  // An answer with no fetched data behind it has nothing to be grounded in —
  // even when it states no figures — so it's flagged noData, never grounded.
  const finish = (answer, stopped, error) => {
    if (answer === null) return { answer, toolCalls, stopped, grounded: null, ungrounded: [], noData: !results.length, ...(error ? { error } : {}) };
    if (!results.length) return { answer, toolCalls, stopped, grounded: false, ungrounded: [], noData: true };
    return { answer, toolCalls, stopped, ...checkGrounding(answer, results, question), noData: false };
  };
  let nudged = false;
  // A failed model call (timeout, bad key, refusal) ends the run but keeps the
  // tool results already fetched, so the user still sees the trace.
  const callStep = async (specsForStep, opts) => {
    try { return { turn: await step(transcript, specsForStep, opts) }; } catch (e) { return { failed: finish(null, 'error', e.message) }; }
  };

  while (toolCalls.length < maxCalls) {
    const left = deadline - now();
    if (left <= 0) return finish(null, 'budget');
    // eslint-disable-next-line no-await-in-loop
    const { turn, failed } = await callStep(specs, { timeoutMs: left });
    if (failed) return failed;
    if (!turn.calls.length) {
      // Small local models often answer from memory. Push back once.
      if (!results.length && !nudged) {
        nudged = true;
        transcript.push({ role: 'user', content: 'Before answering, call one of the tools to fetch the data.' });
        continue;
      }
      return finish(turn.content.trim(), 'answer');
    }
    transcript.push({ role: 'assistant', content: turn.content, calls: turn.calls, raw: turn.raw });
    for (const c of turn.calls) {
      // Cloud APIs require an answer for every call id in the turn.
      if (toolCalls.length >= maxCalls) {
        transcript.push({ role: 'tool', id: c.id, name: c.name, n: null, content: 'Result: {"error":"tool limit reached"}' });
        continue;
      }
      const n = toolCalls.length + 1;
      const tool = tools.find((t) => t.name === c.name);
      let record;
      let payload;
      try {
        if (!tool) throw new Error(`unknown tool ${c.name}`);
        const args = tool.validate(c.args || {});
        const dup = toolCalls.find((p) => p.tool === tool.name && JSON.stringify(p.args) === JSON.stringify(args));
        if (dup) throw new Error(`already called with these arguments, see result [${dup.n}]`);
        // eslint-disable-next-line no-await-in-loop
        const out = await runTool(tool, args);
        record = { n, tool: tool.name, args, source: out.source, cached_at: out.cached_at, offline: out.offline };
        payload = out.data == null ? { error: 'unavailable (offline or no data)' } : out.data;
        if (out.data != null) results.push(out.data);
      } catch (e) {
        record = { n, tool: c.name, args: c.args, source: null, cached_at: null, offline: false, error: e.message };
        payload = { error: e.message };
      }
      toolCalls.push(record);
      transcript.push({ role: 'tool', id: c.id, name: c.name, n, content: `Result [${n}]: ${JSON.stringify(payload).slice(0, MAX_RESULT_CHARS)}` });
    }
  }

  if (deadline - now() < FINAL_STEP_MIN_MS) return finish(null, 'budget');
  transcript.push({ role: 'user', content: 'Tool limit reached. Answer now using only the results above.' });
  // Specs still go along: cloud APIs reject tool_use/tool_result history
  // without tool definitions. final:true tells each adapter not to call tools.
  const { turn, failed } = await callStep(specs, { timeoutMs: deadline - now(), final: true });
  if (failed) return failed;
  return finish(turn.content.trim() || null, 'cap');
}

module.exports = { runResearch };
