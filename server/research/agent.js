'use strict';

// The bounded research loop: at most `maxCalls` tool calls inside a
// `budgetMs` wall-clock budget. The model never sees a tool it can't call, a
// bad call comes back to it as an error (and still counts toward the cap), and
// the final answer is checked against every number the tools returned.

const { checkGrounding } = require('./grounding');
const { runTool } = require('./tools');

const MAX_RESULT_CHARS = 4000;

async function runResearch({ question, step, tools, maxCalls = 6, budgetMs = 60000, now = Date.now }) {
  const deadline = now() + budgetMs;
  const transcript = [{ role: 'user', content: question }];
  const toolCalls = [];
  const results = [];
  const specs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const finish = (answer, stopped) => ({
    answer,
    toolCalls,
    stopped,
    ...(answer === null ? { grounded: null, ungrounded: [] } : checkGrounding(answer, results, question)),
  });

  while (toolCalls.length < maxCalls) {
    const left = deadline - now();
    if (left <= 0) return finish(null, 'budget');
    // eslint-disable-next-line no-await-in-loop
    const turn = await step(transcript, specs, { timeoutMs: left });
    if (!turn.calls.length) return finish(turn.content.trim(), 'answer');
    transcript.push({ role: 'assistant', content: turn.content, calls: turn.calls, raw: turn.raw });
    for (const c of turn.calls) {
      if (toolCalls.length >= maxCalls) break;
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

  if (deadline - now() <= 0) return finish(null, 'budget');
  transcript.push({ role: 'user', content: 'Tool limit reached. Answer now using only the results above.' });
  const last = await step(transcript, [], { timeoutMs: deadline - now() });
  return finish(last.content.trim() || null, 'cap');
}

module.exports = { runResearch };
