import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  MessageCircle,
  AlertCircle,
  AlertTriangle,
  InfoIcon,
  Send,
  Loader,
  TrendingUp,
  DollarSign,
  Target,
  Zap,
} from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';

const PERSONAS = [
  { id: 'balanced', label: 'MMM Balanced', description: 'Friendly, actionable guidance' },
  { id: 'ramsey', label: 'Dave Ramsey', description: 'Debt-destroyer energy' },
  { id: 'buffett', label: 'Warren Buffett', description: 'Long-term compounding wisdom' },
  { id: 'cuban', label: 'Mark Cuban', description: 'Cash flow + equity focus' },
];

const STARTER_QUESTIONS = [
  'Am I saving enough?',
  "How's my emergency fund?",
  'What should I pay off first?',
  'How can I reduce debt?',
  'Is my budget working?',
];

export default function Advisor() {
  const [nudges, setNudges] = useState([]);
  const [selectedPersona, setSelectedPersona] = useState('balanced');
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Load nudges on mount
  useEffect(() => {
    async function loadNudges() {
      try {
        const res = await fetch('/api/money/coach/nudges');
        if (res.ok) {
          const data = await res.json();
          setNudges(data.nudges || []);
        }
      } catch (err) {
        console.warn('[Advisor] Failed to load nudges:', err.message);
      } finally {
        setLoading(false);
      }
    }
    loadNudges();
  }, []);

  const handleSendMessage = async (msg = inputValue) => {
    if (!msg.trim()) return;

    // Add user message
    const userMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setSending(true);

    try {
      const res = await fetch('/api/money/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          persona: selectedPersona,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const assistantMsg = {
          role: 'assistant',
          content: data.reply,
          persona: data.persona,
          model: data.usedModel,
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to get coach response');
      }
    } catch (err) {
      console.error('[Advisor] Send failed:', err.message);
      setMessages(prev => [
        ...prev,
        {
          role: 'error',
          content: `Coach unavailable: ${err.message}. Check your API setup or try again.`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const getNudgeIcon = nudge => {
    const iconMap = {
      warn: <AlertTriangle size={18} />,
      info: <InfoIcon size={18} />,
    };
    return iconMap[nudge.level] || <InfoIcon size={18} />;
  };

  const getNudgeColor = nudge => {
    if (nudge.level === 'warn') return 'var(--m-red)';
    return 'var(--m-ink-2)';
  };

  if (loading) {
    return (
      <div>
        <SectionHeader icon={MessageCircle} title="Advisor" subtitle="Personalized financial guidance" />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-ink-2)', textAlign: 'center', padding: '24px' }}>
            Loading your advisor...
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader icon={MessageCircle} title="Advisor" subtitle="Personalized financial guidance" />

      {/* Educational disclaimer */}
      <Card
        className="m-card-sm"
        style={{
          marginBottom: '24px',
          background: 'var(--m-accent-soft)',
          border: 'none',
        }}
      >
        <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
          Your AI advisor provides <Term name="financial guidance">educational guidance</Term> based on
          your financial picture. This is not professional financial or legal advice. Always consult a
          qualified <Term name="financial advisor">financial advisor</Term> before major decisions.
        </div>
      </Card>

      {/* Nudge cards */}
      {nudges.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--m-muted)',
              textTransform: 'uppercase',
              marginBottom: '12px',
              letterSpacing: '0.05em',
            }}
          >
            💡 Insights for you
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {nudges.map((nudge, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
              >
                <Card
                  hoverable={false}
                  className="m-card-sm"
                  style={{
                    borderLeft: `4px solid ${getNudgeColor(nudge)}`,
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        color: getNudgeColor(nudge),
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      {getNudgeIcon(nudge)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'var(--m-ink)',
                          marginBottom: '4px',
                        }}
                      >
                        {nudge.title}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
                        {nudge.detail}
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Persona selector */}
      <div style={{ marginBottom: '24px' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--m-muted)',
            textTransform: 'uppercase',
            marginBottom: '12px',
            letterSpacing: '0.05em',
          }}
        >
          Choose your advisor
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '12px',
          }}
        >
          {PERSONAS.map(persona => (
            <button
              key={persona.id}
              onClick={() => setSelectedPersona(persona.id)}
              className={`m-btn ${
                selectedPersona === persona.id ? 'm-btn-primary' : 'm-btn-secondary'
              }`}
              style={{
                textAlign: 'left',
                height: 'auto',
                padding: '12px',
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px', wordWrap: 'break-word' }}>
                {persona.label}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color:
                    selectedPersona === persona.id ? 'var(--m-accent-soft)' : 'var(--m-ink-2)',
                  wordWrap: 'break-word',
                }}
              >
                {persona.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <Card
        className="m-card-sm"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '500px',
          marginBottom: '24px',
        }}
      >
        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ textAlign: 'center', color: 'var(--m-ink-2)' }}>
                <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                  Ask me anything about your finances.
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--m-muted)',
                  }}
                >
                  Start with one of the questions below, or type your own.
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '12px 16px',
                    borderRadius: 'var(--m-radius)',
                    background:
                      msg.role === 'user'
                        ? 'var(--m-accent)'
                        : msg.role === 'error'
                          ? 'rgba(220, 38, 38, 0.1)'
                          : 'var(--m-surface-2)',
                    color:
                      msg.role === 'user'
                        ? 'white'
                        : msg.role === 'error'
                          ? 'var(--m-red)'
                          : 'var(--m-ink)',
                    fontSize: '14px',
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                  {msg.role === 'assistant' && msg.model && (
                    <div
                      style={{
                        fontSize: '10px',
                        color:
                          msg.role === 'user'
                            ? 'rgba(255, 255, 255, 0.6)'
                            : 'var(--m-muted)',
                        marginTop: '4px',
                      }}
                    >
                      {msg.model === 'claude-api' ? '🧠 Claude API' : '💻 Local Ollama'}
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}
          {sending && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', justifyContent: 'flex-start' }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--m-radius)',
                  background: 'var(--m-surface-2)',
                  color: 'var(--m-ink-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Loader size={16} className="spin" />
                <span>Thinking...</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            paddingTop: '12px',
            borderTop: '1px solid var(--m-border)',
          }}
        >
          <input
            type="text"
            className="m-input"
            placeholder="Ask your advisor..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && inputValue.trim()) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={sending}
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: '14px',
            }}
          />
          <button
            className="m-btn m-btn-primary"
            onClick={() => handleSendMessage()}
            disabled={sending || !inputValue.trim()}
            style={{
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {sending ? <Loader size={16} /> : <Send size={16} />}
          </button>
        </div>
      </Card>

      {/* Starter questions */}
      {messages.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--m-muted)',
              textTransform: 'uppercase',
              marginBottom: '12px',
              letterSpacing: '0.05em',
            }}
          >
            Get started
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {STARTER_QUESTIONS.map((question, idx) => (
              <motion.button
                key={idx}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.05 }}
                onClick={() => handleSendMessage(question)}
                className="m-btn m-btn-secondary"
                style={{
                  textAlign: 'left',
                  fontSize: '14px',
                  padding: '12px 16px',
                }}
              >
                {question}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
