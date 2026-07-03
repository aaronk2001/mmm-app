import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// Class component — error boundaries have no hook equivalent. Wraps each lazy
// section so a crash in one section can't black-screen the whole app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[MMM] section crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: '48px 24px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <AlertTriangle size={28} style={{ color: 'var(--m-red)', marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 6 }}>
            This section hit an error
          </div>
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5, marginBottom: 16 }}>
            The rest of the app is fine. Retry, or switch sections and come back.
          </div>
          <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={14} style={{ marginRight: 6 }} /> Retry
          </button>
          <details style={{ marginTop: 16, textAlign: 'left', fontSize: 12, color: 'var(--m-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>Error details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 180, marginTop: 8 }}>
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
