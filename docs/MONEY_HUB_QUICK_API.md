# Money Hub — Quick API Reference

## Shared Primitives (Import Paths)

```jsx
// From any section component:
import Card from '../shared/Card';
import BigStat from '../shared/BigStat';
import Money from '../shared/Money';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';
import ComingSoon from '../shared/ComingSoon';
import SectionHeader from '../shared/SectionHeader';
```

---

## Component Props Quick Reference

### `<Card>`
```jsx
<Card hoverable={true} className="m-card-sm">...</Card>
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `hoverable` | bool | `true` | Hover state on/off |
| `className` | string | `''` | Additional classes |
| `children` | node | required | Content |
| `...props` | any | — | Spread to `<div>` |

---

### `<BigStat>`
```jsx
<BigStat value={125450} label="Net Worth" delta={3.2} prefix="$" />
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `value` | number \| string | required | Primary value |
| `label` | string | required | Label text |
| `delta` | number \| null | `null` | % change; adds color + sign |
| `prefix` | string | `''` | e.g., `$` |
| `suffix` | string | `''` | e.g., `%` |

---

### `<Money>`
```jsx
<Money value={1234.56} prefix="$" decimals={0} />
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `value` | number \| null | required | Amount to format |
| `prefix` | string | `'$'` | Currency symbol |
| `decimals` | number | `2` | Decimal places |
| `className` | string | `''` | Additional CSS |

**Output:** `<span class="num ...">$1,235</span>`

---

### `<Term>`
```jsx
<Term name="net worth">net worth</Term>
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `name` | string | required | Glossary key (e.g., "net worth") |
| `children` | node | required | Text to underline |
| `className` | string | `''` | Additional CSS |

**Behavior:**
- Dotted underline on the text
- On hover: Fetches definition from `GET /api/money/glossary?term=<name>`
- Shows tooltip with definition + "Learn more →" link
- Caches definitions to avoid duplicate fetches

---

### `<EmptyState>`
```jsx
<EmptyState
  title="No accounts"
  message="Add one to get started"
  icon={Wallet}
  action={<button>Add</button>}
/>
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `title` | string | required | Large title |
| `message` | string | required | Description |
| `icon` | component | `AlertCircle` | Lucide icon |
| `action` | node | `null` | Button/link to render |

---

### `<ComingSoon>`
```jsx
<ComingSoon title="Tax" description="Coming soon..." />
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `title` | string | required | Feature name |
| `description` | string | `"This section is coming soon."` | Explanation |

---

### `<SectionHeader>`
```jsx
<SectionHeader icon={Wallet} title="Accounts" subtitle="Your snapshot" />
```
| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `icon` | component | optional | Lucide icon (rendered in blue badge) |
| `title` | string | required | Section title |
| `subtitle` | string \| null | `null` | Smaller text below title |

---

## CSS Classes

### Layout
| Class | Purpose |
|-------|---------|
| `.m-card` | Card with white bg, border, shadow, 24px padding |
| `.m-card-sm` | Same card, 16px padding |
| `.m-card-no-hover` | Card without hover effect |
| `.m-scroll` | Container with vertical scroll + custom scrollbar |

### Buttons
| Class | Purpose |
|-------|---------|
| `.m-btn` | Base button (flex center, transitions) |
| `.m-btn-primary` | Blue button, white text, hover lift |
| `.m-btn-secondary` | Light button, dark text, border |
| `.m-btn-ghost` | Transparent, blue text, blue border |
| `.m-btn-sm` | Smaller padding & font |
| `.m-btn-icon` | 40×40 square button |

### Forms
| Class | Purpose |
|-------|---------|
| `.m-input` | Light input with focus ring |
| `.m-input-label` | Label for input |

### Spacing (4px grid)
| Class | Purpose |
|-------|---------|
| `.m-gap-1`, `.m-gap-2`, ... `.m-gap-6` | gap between flex children |
| `.m-p-1`, `.m-p-2`, ... `.m-p-6` | padding |
| `.m-mb-2`, `.m-mb-3`, `.m-mb-4`, `.m-mb-6` | margin-bottom |

### Typography
| Class | Purpose |
|-------|---------|
| `.num` | Monospace + tabular-nums (for numbers) |
| `.m-text-muted` | Muted color (#94a3b8) |
| `.m-text-secondary` | Secondary color (#475569) |
| `.m-text-accent` | Accent blue (#0071e3) |

---

## Color Tokens (CSS Variables)

All scoped under `.money-hub`:

```css
--m-bg           /* #f6f7f9 — canvas */
--m-surface      /* #ffffff — card base */
--m-surface-2    /* #f1f3f5 — secondary surface */
--m-ink          /* #0b1220 — primary text */
--m-ink-2        /* #475569 — secondary text */
--m-muted        /* #94a3b8 — muted text */
--m-border       /* #e6e8ec — border */
--m-accent       /* #0071e3 — blue */
--m-accent-soft  /* #e8f1fd — blue bg */
--m-green        /* #15a34a — positive */
--m-red          /* #dc2626 — negative */
--m-amber        /* #d97706 — warning */
--m-radius       /* 16px — border radius */
--m-shadow       /* light shadow */
--m-shadow-md    /* medium shadow */
--m-shadow-lg    /* large shadow */
```

---

## Section Component Template

```jsx
import { useEffect, useState } from 'react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import { <IconName> } from 'lucide-react';

/**
 * <SectionName> section.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/<endpoint>
 * - Renders UI + loading/error states
 */
export default function SectionName() {
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
      <SectionHeader icon={<IconName>} title="Section Title" subtitle="..." />
      
      {loading && <Card>Loading...</Card>}
      {error && <Card style={{ color: 'var(--m-red)' }}>Error: {error}</Card>}
      
      {!loading && data && (
        <Card>
          {/* Render data here */}
        </Card>
      )}
    </div>
  );
}
```

---

## Backend API Endpoints (Reference)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/money/overview` | GET | Net worth summary |
| `/api/money/accounts` | GET | List of accounts |
| `/api/money/transactions` | GET | Transaction list |
| `/api/money/cashflow` | GET | Income/expense breakdown |
| `/api/money/glossary?term=<name>` | GET | Glossary definition |
| `/api/money/seed-sample` | POST | Load sample data |
| `/api/money/reset` | POST | Clear all data |

---

## Lucide Icons (Available)

All lucide icons are pre-installed. Common ones for Money Hub:

```jsx
import {
  Wallet,        // Accounts
  TrendingDown,  // Spending
  Zap,           // Cash flow
  Target,        // Goals
  TrendingUp,    // Investments
  PieChart,      // Tax / allocation
  FileText,      // Reports
  MessageCircle, // Advisor
  Settings,      // Settings
  AlertCircle,   // Empty state
  HelpCircle,    // Help
} from 'lucide-react';
```

---

## Notes

- **All styles are scoped** under `.money-hub` — no CSS conflicts with dark terminal
- **Import money-theme.css only once** (already done in MoneyHub.jsx)
- **Section components are lazy-loaded** — code-split automatically
- **No prop drilling** — each section fetches its own data
- **Use TypeScript optional chaining** (`data?.property`) for safety
- **Always handle null/undefined** values in data

---

Generated: June 23, 2026
