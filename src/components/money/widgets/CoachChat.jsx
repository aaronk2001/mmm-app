import { useState, useRef, useEffect } from 'react';
import { Send, ShieldCheck } from 'lucide-react';
import { api } from '../../../lib/query';

const SUGGESTIONS = ['Where can I cut back?', 'Am I saving enough?', 'What should I pay off first?'];

// Grounded chat coach. Sends the conversation to POST /api/money/coach, which
// injects the user's exact numbers + rule findings and calls the local model.
// If the model isn't available it returns {available:false} and we fall back to
// pointing at the rule-based insights (which are always shown above this).
export default function CoachChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setUnavailable(false);
    try {
      const res = await api('money/coach', { method: 'POST', body: JSON.stringify({ messages: next }) });
      if (res && res.available && res.reply) {
        setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      } else {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--m-muted)' }}>
        <ShieldCheck size={12} style={{ color: 'var(--m-green)' }} /> Answers use only your MMM numbers — nothing leaves this device.
      </div>

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="m-no-drag"
          style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 2 }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                fontSize: 13,
                lineHeight: 1.5,
                padding: '8px 11px',
                borderRadius: 10,
                background: m.role === 'user' ? 'var(--m-accent)' : 'var(--m-surface-2)',
                color: m.role === 'user' ? '#fff' : 'var(--m-ink)',
                border: m.role === 'user' ? 'none' : '1px solid var(--m-border)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          ))}
          {loading && <div style={{ fontSize: 12, color: 'var(--m-muted)', alignSelf: 'flex-start' }}>Coach is thinking…</div>}
        </div>
      )}

      {unavailable && (
        <div style={{ fontSize: 12, color: 'var(--m-ink-2)', background: 'var(--m-surface-2)', border: '1px solid var(--m-border)', borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
          The chat coach needs <strong>Ollama</strong> running locally with <code style={{ fontSize: 11 }}>qwen2.5:1.5b</code>. Your rule-based insights above work with no AI — that's where the real advice lives.
        </div>
      )}

      {messages.length === 0 && !unavailable && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="m-no-drag"
              onClick={() => send(s)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--m-border)', background: 'var(--m-surface-2)', color: 'var(--m-ink-2)' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="m-input m-no-drag"
          value={input}
          placeholder="Ask your coach…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="m-btn m-btn-primary m-btn-sm m-no-drag"
          onClick={() => send()}
          disabled={loading || !input.trim()}
          title="Send"
          aria-label="Send"
          style={{ flexShrink: 0 }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
