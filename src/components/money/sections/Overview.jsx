import { useState, useEffect, useRef } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Pencil, Check, RotateCcw, Plus, X, GripVertical, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchSettings, saveSettings, queryClient } from '../../../lib/query';
import { WIDGETS, DEFAULT_LAYOUT } from '../widgets';
import { WIDGET_SETTINGS } from '../widgets/settings';
import WidgetSettingsPopover from '../widgets/WidgetSettingsPopover';

const Grid = WidthProvider(Responsive);

export default function Overview() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [layout, setLayout] = useState(null);
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openGear, setOpenGear] = useState(null);
  const saveTimer = useRef(null);

  const widgetConfig = settings?.dashboards?.overview?.widgetConfig || {};

  // Initialize layout once settings arrive.
  useEffect(() => {
    if (settings && layout === null) {
      const saved = settings?.dashboards?.overview?.layout;
      setLayout(saved && saved.length ? saved : DEFAULT_LAYOUT);
    }
  }, [settings, layout]);

  function persist(next) {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const overview = { ...(settings?.dashboards?.overview || {}), layout: next };
      const dashboards = { ...(settings?.dashboards || {}), overview };
      saveSettings({ dashboards }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
    }, 400);
  }

  function persistWidgetConfig(id, cfg) {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const prevWc = settings?.dashboards?.overview?.widgetConfig || {};
      const overview = { ...(settings?.dashboards?.overview || {}), layout, widgetConfig: { ...prevWc, [id]: cfg } };
      const dashboards = { ...(settings?.dashboards || {}), overview };
      saveSettings({ dashboards }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
    }, 400);
  }

  function addWidget(id) {
    const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const def = WIDGETS[id].layout;
    const next = [...layout, { i: id, x: 0, y: maxY, w: def.w, h: def.h }];
    setLayout(next); persist(next); setAdding(false);
  }
  function removeWidget(id) {
    const next = layout.filter((l) => l.i !== id);
    setLayout(next); persist(next);
  }
  function resetLayout() {
    setLayout(DEFAULT_LAYOUT); persist(DEFAULT_LAYOUT);
  }

  if (!layout) return <div style={{ color: 'var(--m-muted)', padding: 24 }}>Loading dashboard…</div>;

  const active = new Set(layout.map((l) => l.i));
  const available = Object.keys(WIDGETS).filter((id) => !active.has(id));

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--m-ink)' }}>Overview</div>
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Your money at a glance{edit ? ' — drag, resize, add or remove cards' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          {edit && (
            <>
              <button className="m-btn m-btn-secondary" onClick={() => setAdding((v) => !v)} disabled={!available.length}>
                <Plus size={15} style={{ marginRight: 4 }} /> Add card
              </button>
              <button className="m-btn m-btn-secondary" onClick={resetLayout}>
                <RotateCcw size={15} style={{ marginRight: 4 }} /> Reset
              </button>
              {adding && (
                <div style={{ position: 'absolute', top: 40, right: 90, zIndex: 20, background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 10, boxShadow: 'var(--m-shadow)', padding: 6, minWidth: 200 }}>
                  {available.map((id) => {
                    const W = WIDGETS[id]; const Icon = W.icon;
                    return (
                      <button key={id} onClick={() => addWidget(id)} className="m-nav-item" style={{ width: '100%' }}>
                        <Icon size={16} className="m-nav-icon" /><span>{W.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
          <button className={`m-btn ${edit ? 'm-btn-primary' : 'm-btn-secondary'}`} onClick={() => { setEdit((v) => !v); setAdding(false); }}>
            {edit ? <><Check size={15} style={{ marginRight: 4 }} /> Done</> : <><Pencil size={15} style={{ marginRight: 4 }} /> Customize</>}
          </button>
        </div>
      </div>

      <Grid
        className="layout"
        layouts={{ lg: layout }}
        breakpoints={{ lg: 1100, md: 860, sm: 640, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={78}
        margin={[16, 16]}
        isDraggable={edit}
        isResizable={edit}
        draggableHandle=".m-widget-drag"
        draggableCancel=".m-no-drag"
        compactType="vertical"
        onLayoutChange={(l) => setLayout(l)}
        onDragStop={(l) => { setLayout(l); persist(l); }}
        onResizeStop={(l) => { setLayout(l); persist(l); }}
      >
        {layout.map((item) => {
          const W = WIDGETS[item.i];
          if (!W) return <div key={item.i} />;
          const Icon = W.icon;
          const Body = W.Component;
          return (
            <div key={item.i} className="m-card m-card-no-hover" style={{ display: 'flex', flexDirection: 'column', padding: 0, position: 'relative', overflow: openGear === item.i ? 'visible' : 'hidden' }}>
              <div className={edit ? 'm-widget-drag' : ''} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--m-border)', cursor: edit ? 'move' : 'default', flexShrink: 0 }}>
                {edit && <GripVertical size={14} style={{ color: 'var(--m-muted)' }} />}
                <Icon size={15} style={{ color: 'var(--m-accent)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', flex: 1 }}>{W.title}</span>
                {WIDGET_SETTINGS[item.i] && (
                  <button className="m-no-drag" onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpenGear(openGear === item.i ? null : item.i)} title="Settings" style={{ background: 'none', border: 'none', cursor: 'pointer', color: openGear === item.i ? 'var(--m-accent)' : 'var(--m-muted)', display: 'flex', padding: 2 }}>
                    <Settings size={14} />
                  </button>
                )}
                {edit && (
                  <button className="m-no-drag" onMouseDown={(e) => e.stopPropagation()} onClick={() => removeWidget(item.i)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 2 }}>
                    <X size={15} />
                  </button>
                )}
              </div>
              {openGear === item.i && (
                <WidgetSettingsPopover widgetId={item.i} config={widgetConfig[item.i] || {}} onChange={(next) => persistWidgetConfig(item.i, next)} />
              )}
              <div style={{ flex: 1, minHeight: 0, padding: 14, overflow: W.scroll ? 'auto' : 'hidden' }}>
                <Body config={widgetConfig[item.i]} />
              </div>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
