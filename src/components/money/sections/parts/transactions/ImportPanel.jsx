import { Upload } from 'lucide-react';

export default function ImportPanel({
  accounts,
  csvAccount,
  importFormat,
  csvText,
  csvMapping,
  csvPreview,
  csvImporting,
  csvError,
  csvResult,
  fileName,
  fileContent,
  onAccountChange,
  onFormatChange,
  onFilePick,
  onCsvTextChange,
  onMappingChange,
  onImport,
  onCancel,
}) {
  const canImport = csvAccount && (
    (importFormat === 'csv' && csvText.trim()) ||
    (importFormat !== 'csv' && fileContent)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <label className="m-input-label">Select Account *</label>
        <select
          className="m-input"
          value={csvAccount}
          onChange={e => onAccountChange(e.target.value)}
          style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
        >
          <option value="">Select account</option>
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>{acc.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="m-input-label">Format</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {['csv', 'ofx', 'qif'].map(fmt => (
            <button key={fmt} type="button" onClick={() => onFormatChange(fmt)}
              className={`m-btn m-btn-sm ${importFormat === fmt ? 'm-btn-primary' : 'm-btn-secondary'}`}>
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {importFormat !== 'csv' && (
        <div>
          <label className="m-input-label">{importFormat.toUpperCase()} file</label>
          <input type="file" accept={importFormat === 'ofx' ? '.ofx,.qfx' : '.qif'} onChange={onFilePick} className="m-input" style={{ padding: 8 }} />
          {fileName && <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 6 }}>Loaded: {fileName}{fileContent ? '' : ' (reading…)'}</div>}
        </div>
      )}

      {importFormat === 'csv' && (
        <>
          <div>
            <label className="m-input-label">Column Mapping</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '12px', color: 'var(--m-muted)' }}>Date column (0-based)</span>
                <input
                  type="number"
                  className="m-input"
                  min="0"
                  value={csvMapping.date}
                  onChange={e => onMappingChange({ ...csvMapping, date: parseInt(e.target.value) })}
                  style={{ marginTop: '4px' }}
                />
              </div>
              <div>
                <span style={{ fontSize: '12px', color: 'var(--m-muted)' }}>Amount column</span>
                <input
                  type="number"
                  className="m-input"
                  min="0"
                  value={csvMapping.amount}
                  onChange={e => onMappingChange({ ...csvMapping, amount: parseInt(e.target.value) })}
                  style={{ marginTop: '4px' }}
                />
              </div>
              <div>
                <span style={{ fontSize: '12px', color: 'var(--m-muted)' }}>Payee column</span>
                <input
                  type="number"
                  className="m-input"
                  min="0"
                  value={csvMapping.payee}
                  onChange={e => onMappingChange({ ...csvMapping, payee: parseInt(e.target.value) })}
                  style={{ marginTop: '4px' }}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="m-input-label">CSV Data (comma-separated)</label>
            <textarea
              className="m-input"
              placeholder="2024-06-21,50.00,Whole Foods&#10;2024-06-20,-25.00,Uber&#10;..."
              value={csvText}
              onChange={e => onCsvTextChange(e.target.value)}
              rows="6"
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          {csvPreview.length > 0 && (
            <div style={{ padding: '12px', background: 'var(--m-surface-2)', borderRadius: '8px', fontSize: '12px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--m-ink)' }}>Preview (first 5 rows):</div>
              {csvPreview.map((row, idx) => (
                <div key={idx} style={{ marginBottom: '4px', color: 'var(--m-ink-2)' }}>
                  {row.date} | {row.amount} | {row.payee}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {csvError && (
        <div style={{ padding: '12px', background: 'var(--m-red-bg)', borderRadius: '8px', color: 'var(--m-red)', fontSize: '14px' }}>
          {csvError}
        </div>
      )}

      {csvResult && (
        <div style={{ padding: '12px', background: 'var(--m-green-bg)', borderRadius: '8px', color: 'var(--m-green)', fontSize: '14px' }}>
          <div style={{ fontWeight: 600 }}>✓ Imported {csvResult.imported} transactions</div>
          {csvResult.sample && csvResult.sample.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--m-ink-2)' }}>
              {csvResult.sample.slice(0, 3).map((s, idx) => (
                <div key={idx}>{s.payee} → {s.category_name || 'Other'}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          className="m-btn m-btn-primary"
          onClick={onImport}
          disabled={csvImporting || !canImport}
        >
          {csvImporting ? 'Importing...' : 'Import Transactions'}
        </button>
        <button
          type="button"
          className="m-btn m-btn-secondary"
          onClick={onCancel}
          disabled={csvImporting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
