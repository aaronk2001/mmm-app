import { useState, useRef, useEffect } from 'react';
import { Monitor, Sun, Moon, Check, ShieldCheck, RotateCcw, Database, Download, Upload, Globe, History, MonitorSmartphone } from 'lucide-react';
import {
  applyTheme, applyDensity, applyAccent, getTheme, getDensity, getAccent,
} from '../../../lib/theme';
import { api, saveSettings, queryClient, useApi } from '../../../lib/query';
import RulesManager from './RulesManager';
import CustomFieldsManager from './CustomFieldsManager';
import { confirmDialog } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';

const ACCENTS = [
  { name: 'Teal',   hex: '#2dd4bf' },
  { name: 'Mint',   hex: '#4ade80' },
  { name: 'Sky',    hex: '#38bdf8' },
  { name: 'Indigo', hex: '#818cf8' },
  { name: 'Violet', hex: '#a78bfa' },
  { name: 'Amber',  hex: '#fbbf24' },
  { name: 'Coral',  hex: '#fb7185' },
];
// '' = no override → the theme-aware default accent (teal) from theme.css wins.
const DEFAULT_ACCENT = '';

const THEMES = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light',  label: 'Light',  Icon: Sun },
  { id: 'dark',   label: 'Dark',   Icon: Moon },
];
const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact',     label: 'Compact' },
];

function Section({ title, subtitle, children }) {
  return (
    <div className="m-card m-card-no-hover" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderTop: '1px solid var(--m-border)' }}>
      <div>
        <div style={{ fontSize: 14, color: 'var(--m-ink)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--m-surface-2)', borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const active = o.id === value;
        const Icon = o.Icon;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className="m-no-drag"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 500, padding: '7px 14px', borderRadius: 8,
              border: 'none', cursor: 'pointer',
              background: active ? 'var(--m-surface)' : 'transparent',
              color: active ? 'var(--m-ink)' : 'var(--m-ink-2)',
              boxShadow: active ? 'var(--m-shadow)' : 'none',
            }}
          >
            {Icon && <Icon size={15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, disabled, onChange }) {
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

export default function Settings() {
  const [theme, setTheme] = useState(getTheme);
  const [density, setDensity] = useState(getDensity);
  const [accent, setAccent] = useState(() => getAccent() || DEFAULT_ACCENT);

  const { data: ccfg } = useApi('money/currency');
  const [baseCurrency, setBaseCurrency] = useState(null);
  const currency = baseCurrency ?? ccfg?.baseCurrency ?? 'USD';
  const currencyList = ccfg?.availableCurrencies || ['USD'];
  function pickCurrency(cur) {
    setBaseCurrency(cur);
    saveSettings({ baseCurrency: cur }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['money/overview'] });
    queryClient.invalidateQueries({ queryKey: ['money/metrics'] });
    queryClient.invalidateQueries({ queryKey: ['money/currency'] });
  }

  // Persist the appearance triple to the server (mirrors localStorage, which the
  // no-flash boot reads). Best-effort — the live UI already updated via the apply* call.
  function persist(next) {
    saveSettings({ appearance: { theme, density, accent, ...next } }).catch(() => {});
  }

  function pickTheme(id)   { setTheme(id);   applyTheme(id);   persist({ theme: id }); }
  function pickDensity(id) { setDensity(id); applyDensity(id); persist({ density: id }); }
  function pickAccent(hex) { setAccent(hex); applyAccent(hex); persist({ accent: hex }); }

  function resetDefaults() {
    setTheme('system'); applyTheme('system');
    setDensity('comfortable'); applyDensity('comfortable');
    setAccent(DEFAULT_ACCENT); applyAccent(DEFAULT_ACCENT);
    saveSettings({ appearance: { theme: 'system', density: 'comfortable', accent: DEFAULT_ACCENT } }).catch(() => {});
  }

  // Coach preferences (proactive nudges + weekly digest). Defaults are ON.
  const { data: allSettings } = useApi('settings');
  const [coach, setCoach] = useState(null);
  useEffect(() => { if (allSettings && coach === null) setCoach(allSettings.coach || {}); }, [allSettings, coach]);
  const c = coach || {};
  function saveCoach(patch) {
    const next = { ...(coach || {}), ...patch };
    setCoach(next);
    saveSettings({ coach: next }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
  }

  const fileRef = useRef(null);
  const [backupMsg, setBackupMsg] = useState(null);

  // Desktop prefs (only meaningful inside the Electron shell — window.mmm bridge).
  const bridge = typeof window !== 'undefined' ? window.mmm : null;
  const [desktop, setDesktop] = useState(null); // { closeToTray, launchOnBoot, canLaunchOnBoot }
  useEffect(() => {
    if (bridge?.getPrefs) bridge.getPrefs().then(setDesktop).catch(() => {});
  }, [bridge]);
  async function toggleLaunchOnBoot() {
    if (!bridge?.setLaunchOnBoot) return;
    const v = await bridge.setLaunchOnBoot(!desktop.launchOnBoot);
    setDesktop((d) => ({ ...d, launchOnBoot: v }));
    toast.success(`Launch on startup ${v ? 'on' : 'off'}.`);
  }
  async function toggleCloseToTray() {
    if (!bridge?.setCloseToTray) return;
    const v = await bridge.setCloseToTray(!desktop.closeToTray);
    setDesktop((d) => ({ ...d, closeToTray: v }));
    toast.success(`Close to tray ${v ? 'on' : 'off'}.`);
  }

  const { data: backupsRes } = useApi('money/backups');
  const backups = backupsRes?.backups || [];
  const lastBackup = backups[0] || null;
  const [backupBusy, setBackupBusy] = useState(false);

  async function backupNow() {
    setBackupBusy(true);
    try {
      const out = await api('money/backups/run', { method: 'POST' });
      toast.success(`Backed up (${out.date}).`);
      queryClient.invalidateQueries({ queryKey: ['money/backups'] });
    } catch (e) {
      toast.error(`Backup failed: ${e.message}`);
    } finally { setBackupBusy(false); }
  }

  async function restoreFrom(date) {
    if (!(await confirmDialog({
      title: `Restore backup from ${date}?`,
      message: 'Your current data will be replaced by that snapshot.',
      confirmLabel: 'Restore',
    }))) return;
    try {
      const out = await api('money/backups/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }),
      });
      toast.success(`Restored ${out.counts.accounts} accounts and ${out.counts.transactions} transactions from ${date}.`);
      queryClient.invalidateQueries();
    } catch (e) {
      toast.error(`Restore failed: ${e.message}`);
    }
  }

  async function exportData() {
    try {
      const data = await api('money/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mmm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg({ ok: true, text: 'Backup downloaded.' });
    } catch (e) {
      setBackupMsg({ ok: false, text: 'Export failed: ' + (e.message || 'unknown error') });
    }
  }

  async function startFresh() {
    if (!(await confirmDialog({
      title: 'Erase all data and start fresh?',
      message: 'This permanently deletes every account, transaction, budget, and goal on this device. A backup is saved first, but this cannot be undone in-app.',
      confirmLabel: 'Erase everything',
    }))) return;
    try {
      await api('money/backups/run', { method: 'POST' }); // safety snapshot first
      await api('money/reset', { method: 'POST' });
      toast.success('Data erased — add your accounts to begin.');
      queryClient.clear();
      // Enter the (now empty) app after reload instead of the welcome card, so
      // the user can start filling in their own data right away.
      try { sessionStorage.setItem('mmm-entered', '1'); } catch { /* private mode */ }
      setTimeout(() => window.location.assign('#/accounts'), 300);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      toast.error(`Couldn't reset: ${e.message}`);
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const out = await api('money/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      setBackupMsg({ ok: true, text: `Imported ${out.counts.accounts} accounts and ${out.counts.transactions} transactions.` });
      queryClient.invalidateQueries();
    } catch (err) {
      setBackupMsg({ ok: false, text: 'Import failed: ' + (err.message || 'invalid file') });
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--m-ink)' }}>Settings &amp; Privacy</div>
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Make MMM yours — and keep your money on your machine.</div>
      </div>

      <Section title="Appearance" subtitle="Theme, accent color, and layout density apply instantly.">
        <Row label="Theme" hint="Match your system or lock it in.">
          <Segmented options={THEMES} value={theme} onChange={pickTheme} />
        </Row>
        <Row label="Accent" hint="Used for highlights, charts, and the active state.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              title="Default (adapts to theme)"
              onClick={() => pickAccent('')}
              className="m-no-drag"
              style={{
                height: 26, padding: '0 10px', borderRadius: 999, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: accent ? 'var(--m-surface-2)' : 'var(--m-accent-soft)',
                color: accent ? 'var(--m-ink-2)' : 'var(--m-accent)',
                border: '1px solid var(--m-border)',
              }}
            >
              Auto
            </button>
            {ACCENTS.map((a) => {
              const active = a.hex.toLowerCase() === (accent || '').toLowerCase();
              return (
                <button
                  key={a.hex}
                  title={a.name}
                  onClick={() => pickAccent(a.hex)}
                  className="m-no-drag"
                  style={{
                    width: 26, height: 26, borderRadius: 999, cursor: 'pointer',
                    background: a.hex,
                    border: '2px solid var(--m-surface)',
                    outline: active ? `2px solid ${a.hex}` : '2px solid transparent',
                    outlineOffset: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {active && <Check size={14} color="#fff" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="Density" hint="Compact fits more on screen.">
          <Segmented options={DENSITIES} value={density} onChange={pickDensity} />
        </Row>
        <Row label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Globe size={14} style={{ color: 'var(--m-muted)' }} /> Display currency</span>} hint="Net worth and metrics convert to this currency.">
          <select className="m-input" value={currency} onChange={(e) => pickCurrency(e.target.value)} style={{ minWidth: 110 }}>
            {currencyList.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <div style={{ paddingTop: 14, borderTop: '1px solid var(--m-border)' }}>
          <button className="m-btn m-btn-ghost m-btn-sm m-no-drag" onClick={resetDefaults}>
            <RotateCcw size={14} style={{ marginRight: 6 }} /> Reset to defaults
          </button>
        </div>
      </Section>

      <RulesManager />

      <CustomFieldsManager />

      <Section title="Coach" subtitle="Proactive nudges and your weekly money digest — all computed locally, no cloud.">
        <Row label="Proactive nudges" hint="On launch, surface the top 1–2 things worth acting on.">
          <Toggle on={c.nudgesEnabled !== false} onChange={() => saveCoach({ nudgesEnabled: !(c.nudgesEnabled !== false) })} />
        </Row>
        {c.nudgesEnabled !== false && (
          <Row label="Nudge level" hint="How much the coach speaks up.">
            <div style={{ display: 'flex', gap: 4 }}>
              {[['capped', 'Top 1–2'], ['critical', 'Critical only']].map(([val, lbl]) => {
                const active = (c.nudgeLevel || 'capped') === val;
                return (
                  <button
                    key={val}
                    onClick={() => saveCoach({ nudgeLevel: val })}
                    style={{
                      fontSize: 12, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                      border: '1px solid var(--m-border)',
                      background: active ? 'var(--m-accent)' : 'var(--m-surface-2)',
                      color: active ? '#fff' : 'var(--m-ink-2)', fontWeight: active ? 600 : 500,
                    }}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </Row>
        )}
        <Row label="Weekly digest" hint="A once-a-week summary of how your money moved.">
          <Toggle on={c.digestEnabled !== false} onChange={() => saveCoach({ digestEnabled: !(c.digestEnabled !== false) })} />
        </Row>
      </Section>

      {desktop && (
        <Section title="Desktop" subtitle="How MMM behaves as a desktop app.">
          <Row label="Launch on startup" hint={desktop.canLaunchOnBoot ? 'Open MMM automatically when you sign in.' : 'Available in the installed app.'}>
            <Toggle on={!!desktop.launchOnBoot} disabled={!desktop.canLaunchOnBoot} onChange={toggleLaunchOnBoot} />
          </Row>
          <Row label="Close to tray" hint="Keep MMM running in the system tray when you close the window.">
            <Toggle on={!!desktop.closeToTray} onChange={toggleCloseToTray} />
          </Row>
        </Section>
      )}

      <Section title="Privacy &amp; Data" subtitle="MMM is local-first by design.">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '4px 0' }}>
          <ShieldCheck size={20} style={{ color: 'var(--m-green)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.55 }}>
            Your accounts, transactions, budgets, and goals live in a local SQLite database on this device.
            Nothing is sent to the cloud — MMM runs fully offline.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0 4px', borderTop: '1px solid var(--m-border)', marginTop: 8 }}>
          <History size={20} style={{ color: 'var(--m-muted)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.55, marginBottom: 12 }}>
              MMM snapshots your data automatically every day and keeps the last 30
              {lastBackup
                ? ` — most recent: ${lastBackup.date} (${(lastBackup.size / 1024).toFixed(0)} KB).`
                : ' — no automatic backup yet.'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="m-btn m-btn-secondary m-btn-sm" onClick={backupNow} disabled={backupBusy}>
                <Database size={14} style={{ marginRight: 6 }} /> {backupBusy ? 'Backing up…' : 'Back up now'}
              </button>
            </div>
            {backups.length > 0 && (
              <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                {backups.slice(0, 5).map((b) => (
                  <div key={b.date} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--m-ink-2)' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{b.date}</span>
                    <span style={{ color: 'var(--m-muted)', fontVariantNumeric: 'tabular-nums' }}>{(b.size / 1024).toFixed(0)} KB</span>
                    <button
                      className="m-btn m-btn-ghost m-btn-sm"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => restoreFrom(b.date)}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0 4px', borderTop: '1px solid var(--m-border)', marginTop: 8 }}>
          <Database size={20} style={{ color: 'var(--m-muted)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.55, marginBottom: 12 }}>
              Save everything to a single file, or restore from one. Import replaces your current data.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="m-btn m-btn-secondary m-btn-sm" onClick={exportData}>
                <Download size={14} style={{ marginRight: 6 }} /> Export backup
              </button>
              <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload size={14} style={{ marginRight: 6 }} /> Import backup
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} style={{ display: 'none' }} />
            </div>
            {backupMsg && (
              <div style={{ fontSize: 12, marginTop: 10, color: backupMsg.ok ? 'var(--m-green)' : 'var(--m-red)' }}>
                {backupMsg.text}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0 4px', borderTop: '1px solid var(--m-border)', marginTop: 8 }}>
          <RotateCcw size={20} style={{ color: 'var(--m-red)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.55, marginBottom: 12 }}>
              Clear all accounts, transactions, budgets, and goals to begin with a blank slate.
              A backup is taken automatically first.
            </div>
            <button
              className="m-btn m-btn-sm"
              onClick={startFresh}
              style={{ border: '1px solid var(--m-red)', color: 'var(--m-red)', background: 'transparent' }}
            >
              <RotateCcw size={14} style={{ marginRight: 6 }} /> Start fresh (erase all data)
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
