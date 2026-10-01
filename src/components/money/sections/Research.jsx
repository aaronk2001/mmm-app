import { useEffect, useState } from 'react';
import { Microscope, Send, ChevronDown, AlertTriangle, WifiOff } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import { api, useApi } from '../../../lib/query';
import { pickerOptions, citationParts, failureCopy } from './parts/research/logic';

// Linda, the research agent (server/research/). Every figure in an answer is
// cited as [n] → a chip naming the tool result it came from; the server's
// grounding check flags any figure no tool returned.

const NOT_ADVICE = 'This is research, not financial advice.';
const OFFLINE_COPY = {
  'tools-off': 'Research has no data sources turned on. Enable Market data (free, no key) or a Research source in Settings → Online & Keys.',
  'no-model': 'Local model not found. Start Ollama with the model set in Settings → Coach, or pick a cloud model if you enabled one.',
  'backend-off': "That model isn't set up. Enable it and add its key in Settings → Online & Keys, plus the URL and model in Settings → Research.",
  error: 'The research run failed. Try again, or check that Ollama is running.',
};

const card = { marginTop: 12 };
const muted = { color: 'var(--m-muted)', fontSize: 13 };

function Chip({ call }) {
  return (
    <span
      title={`${call.tool} ${JSON.stringify(call.args)}${call.cached_at ? ` · ${call.cached_at}` : ''}`}
      style={{
        display: 'inline-block', margin: '0 2px', padding: '0 6px', borderRadius: 999, fontSize: 11,
        background: 'var(--m-surface-2)', color: 'var(--m-muted)', border: '1px solid var(--m-border)',
      }}
    >
      {call.n} · {call.source || call.tool}
    </span>
  );
}

// A citation that points at no tool call stays visible, in the warning colour.
function Answer({ text, calls }) {
  return (
    <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--m-ink)', whiteSpace: 'pre-wrap', margin: 0 }}>
      {citationParts(text, calls).map((p, i) => {
        if (p.call) return <Chip key={i} call={p.call} />;
        if (p.missing) return <span key={i} title="Cites a result that does not exist" style={{ color: 'var(--m-amber)' }}>[{p.missing}?]</span>;
        return p.text;
      })}
    </p>
  );
}

function Warning({ children }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--m-amber)' }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{children}</span>
    </div>
  );
}

function Trace({ result }) {
  const n = result.toolCalls.length;
  return (
    <details>
      <summary style={{ fontSize: 12, color: 'var(--m-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <ChevronDown size={12} /> {n} tool call{n === 1 ? '' : 's'} · {result.model}
      </summary>
      <ol style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 8, paddingLeft: 18 }}>
        {result.toolCalls.map((c) => (
          <li key={c.n}>
            {c.tool} {JSON.stringify(c.args)} — {c.error
              ? `error: ${c.error}`
              : `${c.source || 'no source'}${c.offline ? ' (offline / cached)' : ''}${c.cached_at ? ` · ${c.cached_at}` : ''}`}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function Research() {
  const { data: status } = useApi('research/status', { staleTime: 0 });
  const [question, setQuestion] = useState('');
  const [ticker, setTicker] = useState('');
  const [backend, setBackend] = useState('ollama');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const options = pickerOptions(status?.backends);
  const toolsOff = !!status && !status.tools.length;
  // If the picked cloud backend is turned off, fall back to the explicit default.
  useEffect(() => {
    if (backend !== 'ollama' && !options.some((o) => o.id === backend && !o.disabled)) setBackend('ollama');
  }, [options, backend]);

  async function submit(e) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await api('research/ask', {
        method: 'POST',
        body: JSON.stringify({ question, ticker: ticker.trim() || undefined, backend }),
      }));
    } catch (err) {
      setResult({ available: false, reason: 'error', error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader icon={Microscope} title="Research" subtitle="Ask about a company. Every figure links to the data it came from." />

      {toolsOff && (
        <div className="m-card m-card-no-hover" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', ...muted }}>
          <WifiOff size={16} style={{ flexShrink: 0 }} /> {OFFLINE_COPY['tools-off']}
        </div>
      )}

      <form className="m-card m-card-no-hover" onSubmit={submit} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...card }}>
        <input
          className="m-input" placeholder="Ticker (optional)" aria-label="Ticker" value={ticker} maxLength={10}
          onChange={(e) => setTicker(e.target.value.toUpperCase())} style={{ width: 130 }}
        />
        <input
          className="m-input" placeholder="e.g. Is MSFT's free cash flow growing?" aria-label="Question" value={question} maxLength={500}
          onChange={(e) => setQuestion(e.target.value)} style={{ flex: 1, minWidth: 220 }}
        />
        {options.length > 0 && (
          <select className="m-input" aria-label="Model" value={backend} onChange={(e) => setBackend(e.target.value)} style={{ width: 240 }}>
            {options.map((b) => (
              <option key={b.id} value={b.id} disabled={b.disabled}>
                {b.label}{b.model ? ` — ${b.model}` : ''}{b.disabled ? ' (not running)' : ''}
              </option>
            ))}
          </select>
        )}
        <button className="m-btn m-btn-primary" type="submit" disabled={busy || !question.trim() || toolsOff}>
          <Send size={14} style={{ marginRight: 6 }} /> {busy ? 'Researching…' : 'Ask'}
        </button>
      </form>

      {busy && (
        <div className="m-card m-card-no-hover" style={{ ...card, ...muted }}>
          Linda is pulling data and thinking. On a local model this can take up to a minute.
        </div>
      )}

      {result && !result.available && (
        <div className="m-card m-card-no-hover" style={{ ...card, ...muted }}>
          {OFFLINE_COPY[result.reason] || OFFLINE_COPY.error}
        </div>
      )}

      {result && result.available && (
        <div className="m-card m-card-no-hover" style={{ ...card, display: 'grid', gap: 12 }}>
          {result.answer && <Answer text={result.answer} calls={result.toolCalls} />}
          {!result.answer && result.stopped === 'error' && <Warning>{failureCopy(result)}</Warning>}
          {!result.answer && result.stopped !== 'error' && (
            <p style={{ ...muted, margin: 0 }}>Ran out of time before an answer. Try a narrower question.</p>
          )}
          {result.noData && result.answer && (
            <Warning>No data was fetched for this answer, so nothing in it is verified.</Warning>
          )}
          {!result.noData && result.grounded === false && (
            <Warning>Unverified figures (not in any fetched data): {result.ungrounded.join(', ')}</Warning>
          )}
          <Trace result={result} />
          <div style={{ fontSize: 11, color: 'var(--m-muted)' }}>{NOT_ADVICE}</div>
        </div>
      )}
    </div>
  );
}
