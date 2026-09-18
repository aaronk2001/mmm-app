import { useEffect, useState } from 'react';
import { Wifi, KeyRound, CheckCircle2, XCircle } from 'lucide-react';
import { api, useApi, queryClient } from '../../../../../lib/query';

// Sprint A, Track 1 — the online seam ships no providers yet, so every
// feature here is a real toggle with nowhere (in this sprint) for the data
// to go. Track 2 wires the Markets section on top of `online.fetch`.
const FEATURES = [
  { key: 'market', label: 'Market data', hint: 'Quotes, indices, and charts (Markets section, Sprint B).' },
  { key: 'news', label: 'News', hint: 'Headlines tied to your watchlist and holdings.' },
  { key: 'youtube', label: 'YouTube', hint: 'Video commentary for tickers you follow.' },
  { key: 'predictionMarkets', label: 'Prediction markets', hint: 'Odds-style signals from prediction-market data.' },
  { key: 'sportsOdds', label: 'Sports odds', hint: 'Sports betting odds feeds.' },
  { key: 'telegram', label: 'Telegram', hint: 'Alerts delivered to a Telegram bot or channel.' },
  { key: 'cloudLlm', label: 'Cloud LLM', hint: 'An optional cloud model instead of local Ollama for the coach.' },
];

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className="m-no-drag"
      style={{
        width: 40, height: 23, borderRadius: 999, padding: 2, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        background: on ? 'var(--m-accent)' : 'var(--m-surface-2)',
        transition: 'background 150ms ease', display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
      }}
    >
      <span style={{ width: 19, height: 19, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
    </button>
  );
}

function FeatureRow({ feature, enabled, onToggle, hasKey, onSaveKey, onTest, testResult, busy }) {
  const [keyInput, setKeyInput] = useState('');
  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--m-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--m-ink)', fontWeight: 500 }}>{feature.label}</div>
          <div style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 2 }}>{feature.hint}</div>
        </div>
        <Toggle on={enabled} onChange={onToggle} disabled={busy} />
      </div>
      {enabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            type="password"
            className="m-input"
            placeholder={hasKey ? 'Key saved — enter a new value to replace it' : 'API key (optional for key-free providers)'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ flex: 1, minWidth: 200, fontSize: 13 }}
            autoComplete="off"
          />
          <button
            className="m-btn m-btn-secondary m-btn-sm"
            disabled={!keyInput}
            onClick={() => { onSaveKey(keyInput); setKeyInput(''); }}
          >
            <KeyRound size={13} style={{ marginRight: 6 }} /> Save key
          </button>
          <button className="m-btn m-btn-ghost m-btn-sm" onClick={onTest}>Test</button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: hasKey ? 'var(--m-green)' : 'var(--m-muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: hasKey ? 'var(--m-green)' : 'var(--m-muted)' }} />
            {hasKey ? 'Key saved' : 'No key saved'}
          </span>
        </div>
      )}
      {testResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: testResult.ok ? 'var(--m-green)' : 'var(--m-red)' }}>
          {testResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {testResult.message}
        </div>
      )}
    </div>
  );
}

export default function OnlinePanel() {
  const { data, isLoading } = useApi('online/settings');
  const online = data?.online || {};

  // Key presence is read straight from the Electron main process (which owns
  // keys.enc), and independently confirmed per feature via the server's own
  // /api/online/test — the Test button hits the SERVER's actual state, not
  // just this cached presence read, so a key that never reached the forked
  // server can't be reported as working (the bug NEXUS shipped).
  const bridge = typeof window !== 'undefined' ? window.mmm : null;
  const [presence, setPresence] = useState({});
  const [testResults, setTestResults] = useState({});
  const [busy, setBusy] = useState(null);

  async function refreshPresence() {
    if (bridge?.secrets?.get) setPresence(await bridge.secrets.get());
  }
  useEffect(() => { refreshPresence(); }, [bridge]);

  async function toggleFeature(key) {
    setBusy(key);
    try {
      const next = await api('online/settings', { method: 'PUT', body: JSON.stringify({ [key]: !online[key] }) });
      queryClient.setQueryData(['online/settings'], next);
    } finally { setBusy(null); }
  }

  async function saveKey(key, value) {
    if (!bridge?.secrets?.set) return;
    await bridge.secrets.set(key, value);
    await refreshPresence();
  }

  async function testFeature(key) {
    try {
      const res = await api('online/test', { method: 'POST', body: JSON.stringify({ feature: key }) });
      setTestResults((prev) => ({ ...prev, [key]: res }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [key]: { ok: false, message: e.message } }));
    }
  }

  if (!bridge) {
    // Web/dev-only render (no Electron bridge) — keys can't be saved without
    // the safeStorage-backed main process, so say so instead of pretending.
    return (
      <div className="m-card m-card-no-hover" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Online &amp; Keys</div>
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 8 }}>
          Available in the installed desktop app — key storage needs the OS credential store.
        </div>
      </div>
    );
  }

  return (
    <div className="m-card m-card-no-hover" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
        <Wifi size={18} style={{ color: 'var(--m-muted)', marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Online &amp; Keys</div>
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 2 }}>
            Everything below is off by default. Keys are encrypted with your OS credential store and never leave this device.
          </div>
        </div>
      </div>
      {isLoading ? (
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)', padding: '14px 0' }}>Loading…</div>
      ) : (
        FEATURES.map((f) => (
          <FeatureRow
            key={f.key}
            feature={f}
            enabled={!!online[f.key]}
            busy={busy === f.key}
            onToggle={() => toggleFeature(f.key)}
            hasKey={!!presence[f.key]}
            onSaveKey={(value) => saveKey(f.key, value)}
            onTest={() => testFeature(f.key)}
            testResult={testResults[f.key]}
          />
        ))
      )}
    </div>
  );
}
