import { fieldsFor, matchesFilter } from '../../../../../lib/customFields';
import CustomFieldFilters from '../CustomFieldFilters';

export default function FiltersBar({
  accounts,
  categories,
  filterAccount,
  filterCategory,
  filterFromDate,
  filterToDate,
  cfFilters,
  settings,
  onAccountChange,
  onCategoryChange,
  onFromDateChange,
  onToDateChange,
  onCfFiltersChange,
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
      <div>
        <label className="m-input-label">Account</label>
        <select
          className="m-input"
          value={filterAccount}
          onChange={e => onAccountChange(e.target.value)}
          style={{ paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px', appearance: 'none' }}
        >
          <option value="all">All accounts</option>
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>{acc.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="m-input-label">Category</label>
        <select
          className="m-input"
          value={filterCategory}
          onChange={e => onCategoryChange(e.target.value)}
          style={{ paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px', appearance: 'none' }}
        >
          <option value="all">All categories</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="m-input-label">From</label>
        <input
          type="date"
          className="m-input"
          value={filterFromDate}
          onChange={e => onFromDateChange(e.target.value)}
        />
      </div>

      <div>
        <label className="m-input-label">To</label>
        <input
          type="date"
          className="m-input"
          value={filterToDate}
          onChange={e => onToDateChange(e.target.value)}
        />
      </div>

      <CustomFieldFilters entity="transaction" value={cfFilters} onChange={onCfFiltersChange} />
    </div>
  );
}
