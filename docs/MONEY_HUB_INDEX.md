# NEXUS Money Hub — Complete Index

## 📋 Documentation

- **[MONEY_HUB_DESIGN_FOUNDATION.md](./MONEY_HUB_DESIGN_FOUNDATION.md)** — Complete design system, theme tokens, component API, backend contract, and implementation guide
- **[MONEY_HUB_QUICK_API.md](./MONEY_HUB_QUICK_API.md)** — Quick reference: import paths, prop tables, CSS classes, color tokens, section template

## 📁 File Structure

```
src/
├── components/money/
│   ├── MoneyHub.jsx                          # Main hub shell (navigation, onboarding)
│   ├── shared/
│   │   ├── Card.jsx                          # Card container (hoverable)
│   │   ├── BigStat.jsx                       # Large metric display (value + label + delta)
│   │   ├── Money.jsx                         # Currency formatter
│   │   ├── Term.jsx                          # Glossary term tooltip (on hover)
│   │   ├── EmptyState.jsx                    # Empty state placeholder
│   │   ├── ComingSoon.jsx                    # Coming soon placeholder
│   │   └── SectionHeader.jsx                 # Section header (icon + title + subtitle)
│   └── sections/
│       ├── AccountsNetWorth.jsx              # MVP: Net worth + accounts
│       ├── Transactions.jsx                  # MVP: Transaction list
│       └── Budget.jsx                        # MVP: Cash flow / budget
└── styles/
    └── money-theme.css                       # Light theme tokens + utility classes
```

## 🎨 Design System

**Theme:** Light, Monarch-style, Apple/Copilot-inspired
**Scope:** All styles scoped under `.money-hub` wrapper (no interference with dark terminal)
**Colors:** Blue accent (#0071e3), green positive (#15a34a), red negative (#dc2626), amber warning (#d97706)
**Spacing:** 4px grid (tokens: --m-gap-1 through --m-gap-6, --m-p-1 through --m-p-6)
**Typography:** Inter sans-serif, JetBrains Mono for numerals (tabular-nums)
**Radius:** 16px default, 8px for inputs/buttons

## 🧩 Shared Primitives

| Component | Purpose | Props |
|-----------|---------|-------|
| `<Card>` | Card container | `hoverable`, `className`, `children`, `...props` |
| `<BigStat>` | Large number display | `value`, `label`, `delta?`, `prefix?`, `suffix?` |
| `<Money>` | Currency formatter | `value`, `prefix?`, `decimals?`, `className?` |
| `<Term>` | Glossary tooltip | `name`, `children`, `className?` |
| `<EmptyState>` | Empty state card | `title`, `message`, `icon?`, `action?` |
| `<ComingSoon>` | Coming soon placeholder | `title`, `description?` |
| `<SectionHeader>` | Section header | `icon?`, `title`, `subtitle?` |

## 📍 Section Components

Each section is:
- **Default export** (no props required)
- **Self-contained** (fetches own data from `/api/money/*`)
- **Lazy-loaded** (code-split by MoneyHub)
- **Location:** `src/components/money/sections/<SectionName>.jsx`

### Current MVP (3 sections)

1. **AccountsNetWorth** → `GET /api/money/accounts`, `GET /api/money/overview`
   - Displays: Net worth summary, account list
   
2. **Transactions** → `GET /api/money/transactions`
   - Displays: Transaction list, category breakdown
   
3. **Budget** → `GET /api/money/cashflow`
   - Displays: Income/expense breakdown, budget progress

### Coming Soon (6 sections)

4. Goals → Target tracking, savings milestones
5. Investments → Portfolio, asset allocation
6. Tax → Income summary, deductions
7. Reports → Financial reports, export
8. Advisor → AI guidance
9. Settings → Preferences, privacy, data management

## 🔌 Backend API Contract

All endpoints return JSON. No params required except `term` on glossary endpoint.

```
GET /api/money/overview          → { netWorth, ... }
GET /api/money/accounts          → { accounts: [...] }
GET /api/money/transactions      → { transactions: [...] }
GET /api/money/cashflow          → { income, expenses, ... }
GET /api/money/glossary?term=foo → { definition: "..." }
POST /api/money/seed-sample      → Success (populate with demo data)
POST /api/money/reset            → Success (clear all data)
```

## 🚀 Getting Started for Section Agents

### 1. Import the shared primitives

```jsx
import Card from '../shared/Card';
import BigStat from '../shared/BigStat';
import Money from '../shared/Money';
import Term from '../shared/Term';
import SectionHeader from '../shared/SectionHeader';
import { <LucideIcon> } from 'lucide-react';
```

### 2. Create your section component

```jsx
export default function MySection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/money/<endpoint>');
        if (res.ok) setData(await res.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div>
      <SectionHeader icon={<Icon>} title="My Section" />
      {loading && <Card>Loading...</Card>}
      {error && <Card>Error: {error}</Card>}
      {!loading && data && (
        // Render your UI here using shared primitives
      )}
    </div>
  );
}
```

### 3. Use shared primitives liberally

```jsx
<Card>
  <BigStat value={12345} label="Total" delta={3.2} prefix="$" />
  
  <div style={{ display: 'flex', gap: '24px', marginTop: '24px' }}>
    <Money value={1234.56} />
    <Term name="asset allocation">asset allocation</Term>
  </div>
</Card>
```

### 4. No CSS required

All `.m-*` classes are already available. Use:
- `.m-card`, `.m-card-sm`, `.m-card-no-hover`
- `.m-btn`, `.m-btn-primary`, `.m-btn-secondary`, `.m-btn-ghost`, `.m-btn-sm`, `.m-btn-icon`
- `.m-input`, `.m-input-label`
- `.m-gap-*`, `.m-p-*`, `.m-mb-*`
- `.m-text-muted`, `.m-text-secondary`, `.m-text-accent`

## 📐 CSS Classes Quick Lookup

### Color Semantics
- **Positive:** Use `--m-green` + up-arrow icon
- **Negative:** Use `--m-red` + down-arrow icon
- **Warning:** Use `--m-amber` + alert icon
- **Primary:** Use `--m-accent` (#0071e3)

### Spacing
All based on 4px grid:
- `--m-gap-1` = 4px, `--m-gap-2` = 8px, `--m-gap-3` = 12px, `--m-gap-4` = 16px, `--m-gap-6` = 24px
- Padding: `.m-p-1` through `.m-p-6`
- Margin-bottom: `.m-mb-2`, `.m-mb-3`, `.m-mb-4`, `.m-mb-6`

### Typography
- `.num` for numerics (tabular-nums, monospace)
- `.m-text-muted`, `.m-text-secondary`, `.m-text-accent` for colors

## 💡 Best Practices

1. **Always handle loading/error states** — users should never see a blank screen
2. **Use `<Term>` for jargon** — explain financial terms inline
3. **Color + icon always** — never use color alone (accessibility)
4. **No cursor-pointer on static cards** — only on interactive buttons/links
5. **Fetch on mount, not prop-driven** — each section owns its data
6. **Lazy-load images/charts** — keep initial render fast
7. **Test in isolation first** — Money Hub doesn't affect the rest of the app
8. **Reuse shared primitives** — they're small, tested, and consistent

## 🔗 Import Paths (from a section component)

```jsx
// Shared primitives (relative imports work because sections are in src/components/money/sections/)
import Card from '../shared/Card';
import BigStat from '../shared/BigStat';
import Money from '../shared/Money';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';
import ComingSoon from '../shared/ComingSoon';
import SectionHeader from '../shared/SectionHeader';

// React + motion
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

// Icons
import { <IconName> } from 'lucide-react';
```

## 🎯 Validation Checklist

Before submitting a section component:

- [ ] Exports as default function (no props required)
- [ ] Fetches data from correct `/api/money/*` endpoint
- [ ] Handles loading state (shows card or spinner)
- [ ] Handles error state (shows error message)
- [ ] Uses `<SectionHeader>` with icon + title
- [ ] Uses shared primitives (`<Card>`, `<BigStat>`, `<Money>`, `<Term>`)
- [ ] Uses `.m-*` CSS classes (no custom CSS needed)
- [ ] No color-blind issues (color + icon always)
- [ ] No cursor-pointer on static cards
- [ ] Imports from correct paths
- [ ] JSX is valid (no syntax errors)
- [ ] Component renders without console errors

## 📞 Questions?

- **Design tokens?** → See `MONEY_HUB_DESIGN_FOUNDATION.md` § Theme Tokens
- **Prop signatures?** → See `MONEY_HUB_QUICK_API.md` § Component Props
- **Backend API?** → See `MONEY_HUB_DESIGN_FOUNDATION.md` § Backend API Contract
- **CSS utilities?** → See `MONEY_HUB_QUICK_API.md` § CSS Classes
- **Section template?** → See `MONEY_HUB_QUICK_API.md` § Section Component Template

---

**Status:** ✅ Design Foundation Complete
**MVP Sections:** 3 (AccountsNetWorth, Transactions, Budget)
**Coming Soon:** 6 (Goals, Investments, Tax, Reports, Advisor, Settings)
**Total Primitives:** 7 shared components
**Documentation:** 3 guides (Foundation, Quick API, Index)

Generated: June 23, 2026
