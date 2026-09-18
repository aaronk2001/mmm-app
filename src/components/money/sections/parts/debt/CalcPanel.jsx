import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../../../../lib/query';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import Money from '../../../shared/Money';

const DEBOUNCE_MS = 300;

// Every field maps 1:1 onto a POST /api/plan/* body key (server/tools/routes.js).
// `required` gates when we're allowed to fire — fields not in it are simply
// omitted from the body so the server's own defaults (down_payment_pct=20,
// term_years=30, term_months=60, ...) apply.
const CALC_CONFIG = {
  Mortgage: {
    endpoint: 'plan/mortgage',
    required: ['purchase_price', 'annual_rate'],
    fields: [
      ['purchase_price', 'Home price'],
      ['down_payment_pct', 'Down payment %', 'default 20'],
      ['annual_rate', 'Rate (%)'],
      ['term_years', 'Term (years)', 'default 30'],
    ],
  },
  'Auto Loan': {
    endpoint: 'plan/auto-loan',
    required: ['vehicle_price', 'annual_rate'],
    fields: [
      ['vehicle_price', 'Vehicle price'],
      ['down_payment', 'Down payment', 'default 0'],
      ['trade_in', 'Trade-in', 'default 0'],
      ['annual_rate', 'Rate (%)'],
      ['term_months', 'Term (months)', 'default 60'],
    ],
  },
  Refi: {
    endpoint: 'plan/refi',
    required: ['balance', 'current_rate', 'new_rate', 'years_remaining', 'closing_costs'],
    fields: [
      ['balance', 'Current balance'],
      ['current_rate', 'Current rate (%)'],
      ['new_rate', 'New rate (%)'],
      ['years_remaining', 'Years remaining'],
      ['closing_costs', 'Closing costs'],
    ],
  },
  DTI: {
    endpoint: 'plan/dti',
    required: [],
    fields: [
      ['gross_monthly_income', 'Monthly gross income'],
      ['monthly_debts', 'Monthly debt payments'],
    ],
  },
};

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>{children}</span>
    </div>
  );
}

// Color is always paired with an icon, never color alone.
function VerdictLine({ verdict }) {
  if (!verdict) return null;
  const strong = verdict.startsWith('STRONG YES') || verdict.startsWith('YES');
  const consider = verdict.startsWith('CONSIDER');
  const Icon = strong ? CheckCircle2 : consider ? AlertTriangle : XCircle;
  const color = strong ? 'var(--m-green)' : consider ? 'var(--m-amber)' : 'var(--m-red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color, fontSize: 13, fontWeight: 600 }}>
      <Icon size={15} aria-hidden="true" />
      <span>{verdict}</span>
    </div>
  );
}

function ReadinessLine({ band }) {
  if (!band) return null;
  const good = band === 'excellent' || band === 'good';
  const fair = band === 'fair';
  const Icon = good ? CheckCircle2 : fair ? AlertTriangle : XCircle;
  const color = good ? 'var(--m-green)' : fair ? 'var(--m-amber)' : 'var(--m-red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
      <Icon size={15} aria-hidden="true" />
      <span>{band}</span>
    </div>
  );
}

function AmortizationTable({ rows, show, onToggle }) {
  if (!rows?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={onToggle}>
        {show ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Yearly amortization
      </button>
      {show && (
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--m-ink-2)' }}>
                <th style={{ padding: '4px 6px' }}>Year</th>
                <th style={{ padding: '4px 6px' }}>Principal</th>
                <th style={{ padding: '4px 6px' }}>Interest</th>
                <th style={{ padding: '4px 6px' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year} style={{ borderTop: '1px solid var(--m-border)', color: 'var(--m-ink)' }}>
                  <td style={{ padding: '4px 6px' }}>{row.year}</td>
                  <td style={{ padding: '4px 6px' }}><Money value={row.principal_paid} decimals={0} /></td>
                  <td style={{ padding: '4px 6px' }}><Money value={row.interest_paid} decimals={0} /></td>
                  <td style={{ padding: '4px 6px' }}><Money value={row.balance} decimals={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultBody({ type, result, showAmort, setShowAmort }) {
  if (type === 'Mortgage') {
    return (
      <>
        <Row label="Monthly payment (P&I)"><Money value={result.monthly_pi} decimals={2} /></Row>
        <Row label="Monthly payment (P&I + PMI)"><Money value={result.monthly_payment} decimals={2} /></Row>
        <Row label="PMI estimate"><Money value={result.pmi_estimate} decimals={2} /></Row>
        <Row label="Loan amount"><Money value={result.loan_amount} decimals={0} /></Row>
        <Row label="Down payment"><Money value={result.down_payment} decimals={0} /></Row>
        <Row label="Total interest"><Money value={result.total_interest} decimals={0} /></Row>
        <Row label="Total cost"><Money value={result.total_cost} decimals={0} /></Row>
        <AmortizationTable rows={result.amortization} show={showAmort} onToggle={() => setShowAmort((s) => !s)} />
      </>
    );
  }
  if (type === 'Auto Loan') {
    return (
      <>
        <Row label="Monthly payment"><Money value={result.monthly_payment} decimals={2} /></Row>
        <Row label="Loan amount"><Money value={result.loan_amount} decimals={0} /></Row>
        <Row label="Total interest"><Money value={result.total_interest} decimals={0} /></Row>
        <Row label="Total cost"><Money value={result.total_cost} decimals={0} /></Row>
      </>
    );
  }
  if (type === 'Refi') {
    return (
      <>
        <Row label="Current payment"><Money value={result.current_monthly_payment} decimals={2} /></Row>
        <Row label="New payment"><Money value={result.new_monthly_payment} decimals={2} /></Row>
        <Row label="Monthly savings"><Money value={result.monthly_savings} decimals={2} /></Row>
        <Row label="Breakeven">
          {result.breakeven_months == null ? String.fromCharCode(8212) : `${result.breakeven_months} months (${result.breakeven_years}y)`}
        </Row>
        <Row label="Total savings"><Money value={result.total_savings} decimals={0} /></Row>
        <VerdictLine verdict={result.verdict} />
      </>
    );
  }
  // DTI
  return (
    <>
      <Row label="DTI ratio">{result.dti.toFixed(1)}%</Row>
      <ReadinessLine band={result.mortgage_readiness} />
      <Row label="Headroom at 43% DTI"><Money value={result.max_mortgage_payment} decimals={0} /></Row>
      {(result.notes || []).map((note, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>{note}</div>
      ))}
    </>
  );
}

export default function CalcPanel({ type }) {
  const config = CALC_CONFIG[type];
  const [v, setV] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAmort, setShowAmort] = useState(false);

  const timerRef = useRef(null);
  const seededRef = useRef(false);
  const skipNextRef = useRef(false);

  const n = (k) => {
    const x = parseFloat(v[k]);
    return Number.isFinite(x) ? x : undefined;
  };

  function buildBody() {
    const body = {};
    for (const [k] of config.fields) {
      const val = n(k);
      if (val !== undefined) body[k] = val;
    }
    return body;
  }

  const canFire = config.required.every((k) => n(k) !== undefined);

  async function run(body) {
    setLoading(true);
    setError(null);
    try {
      const data = await api(config.endpoint, { method: 'POST', body: JSON.stringify(body) });
      setResult(data);
      // DTI resolves real gross_monthly_income/monthly_debts from accounts on
      // an empty body — seed the fields once so the user sees (and can then
      // override) what the server actually used.
      if (type === 'DTI' && !seededRef.current) {
        seededRef.current = true;
        skipNextRef.current = true;
        setV({
          gross_monthly_income: String(data.gross_monthly_income ?? ''),
          monthly_debts: String(data.monthly_debts ?? ''),
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Debounced fetch on every field change (300ms) — never one request per
  // keystroke. DTI's required list is empty, so this also fires once on
  // mount with an empty body, which is how it gets its real-data prefill.
  useEffect(() => {
    if (!canFire) return undefined;
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return undefined;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => run(buildBody()), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(v)]);

  return (
    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        {config.fields.map(([k, label, placeholder]) => (
          <div key={k}>
            <label className="m-input-label">{label}</label>
            <input
              className="m-input"
              type="number"
              step="any"
              placeholder={placeholder || ''}
              value={v[k] ?? ''}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div style={{ background: 'var(--m-surface-2)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}>
        {error && <ErrorState message={error} onRetry={() => run(buildBody())} />}
        {!error && loading && <Skeleton height={140} />}
        {!error && !loading && result && (
          <ResultBody type={type} result={result} showAmort={showAmort} setShowAmort={setShowAmort} />
        )}
        {!error && !loading && !result && (
          <div style={{ fontSize: 13, color: 'var(--m-muted)' }}>Enter values to see your numbers.</div>
        )}
      </div>
    </div>
  );
}
