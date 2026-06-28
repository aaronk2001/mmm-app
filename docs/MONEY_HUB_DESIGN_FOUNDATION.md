# NEXUS Money Hub — Design Foundation

## Overview

The Money Hub is a light-themed financial dashboard scoped entirely under `.money-hub` wrapper. This prevents any interference with the existing OLED-dark terminal UI. The design is Apple/Monarch/Copilot-inspired: calm, friendly, guidance-forward, accessibility-first.

## Theme Tokens

All tokens are prefixed with `--m-` and scoped under `.money-hub`:

```css
--m-bg: #f6f7f9;           /* Background canvas */
--m-surface: #ffffff;       /* Card/surface base */
--m-surface-2: #f1f3f5;     /* Secondary surface */
--m-ink: #0b1220;           /* Primary text */
--m-ink-2: #475569;         /* Secondary text */
--m-muted: #94a3b8;         /* Muted/tertiary text */
--m-border: #e6e8ec;        /* Border color */
--m-accent: #0071e3;        /* Apple blue */
--m-accent-soft: #e8f1fd;   /* Accent background */
--m-green: #15a34a;         /* Positive sentiment */
--m-red: #dc2626;           /* Negative sentiment */
--m-amber: #d97706;         /* Warning sentiment */
--m-radius: 16px;           /* Rounded corner radius */
```

## Shared Primitives API

### Card.jsx
**Location:** `src/components/money/shared/Card.jsx`

```jsx
<Card
  children?          // React nodes
  className?         // Additional CSS classes
  variant?           // 'default' (unused, for future variants)
  hoverable?         // boolean, default true
  ...props          // Spread to div
/>
```

**Example:**
```jsx
<Card hoverable={false} style={{ marginBottom: '24px' }}>
  Content here
</Card>
```

---

### BigStat.jsx
**Location:** `src/components/money/shared/BigStat.jsx`

Renders a large primary metric with label, value, and optional delta.

```jsx
<BigStat
  value          // number or string
  label          // string, e.g. "Net Worth"
  delta?         // number or null, e.g. +5.23 or -2.15 (will add % and color)
  prefix?        // string, default ''
  suffix?        // string, default ''
/>
```

**Example:**
```jsx
<BigStat 
  value={125450.50}
  label="Total Net Worth"
  delta={3.2}
  prefix="$"
/>
```

---

### Money.jsx
**Location:** `src/components/money/shared/Money.jsx`

Lightweight currency formatter component. Renders with `tabular-nums` for alignment.

```jsx
<Money
  value          // number or null
  prefix?        // string, default '$'
  decimals?      // number, default 2
  className?     // string, additional CSS
/>
```

**Example:**
```jsx
<Money value={1234.56} decimals={0} />  {/* $1,235 */}
```

---

### Term.jsx
**Location:** `src/components/money/shared/Term.jsx`

Renders a `<Term>` wrapper around financial jargon with dotted underline. On hover, fetches and displays a glossary definition in a small tooltip card.

```jsx
<Term
  name       // string, glossary term key (e.g. "net worth", "asset allocation")
  children   // React nodes (the underlined text)
  className? // string, additional CSS
/>
```

**How it works:**
- First hover on a `<Term>` triggers a fetch to `GET /api/money/glossary?term=<name>`
- Response: `{ definition: "plain-language explanation" }`
- Definitions are cached in a module-level Map to avoid duplicate fetches
- Tooltip includes a "Learn more →" link to `#/money/glossary?term=<name>` (future feature)

**Example:**
```jsx
<p>
  Your <Term name="net worth">net worth</Term> is your total assets minus liabilities.
</p>
```

**Backend contract:**
```
GET /api/money/glossary?term=<term_name>
Response: { definition: string }
```

---

### EmptyState.jsx
**Location:** `src/components/money/shared/EmptyState.jsx`

Displays a friendly empty state card with icon, title, message, and optional action button.

```jsx
<EmptyState
  title      // string
  message    // string
  icon?      // React component (lucide icon), default: AlertCircle
  action?    // React node (e.g., a button)
/>
```

**Example:**
```jsx
<EmptyState
  title="No accounts yet"
  message="Create your first account to get started."
  icon={Wallet}
  action={<button className="m-btn m-btn-primary">Add Account</button>}
/>
```

---

### ComingSoon.jsx
**Location:** `src/components/money/shared/ComingSoon.jsx`

Full-height placeholder for sections not yet implemented. Shows emoji ⚡, title, and description.

```jsx
<ComingSoon
  title       // string
  description? // string, default: "This section is coming soon."
/>
```

**Example:**
```jsx
<ComingSoon title="Tax" description="Prepare for tax season with income summary, deductions, and estimated tax." />
```

---

### SectionHeader.jsx
**Location:** `src/components/money/shared/SectionHeader.jsx`

Renders a consistent header for each section: icon badge + title + optional subtitle.

```jsx
<SectionHeader
  icon?      // lucide React component
  title      // string
  subtitle?  // string or null
/>
```

**Example:**
```jsx
<SectionHeader icon={Wallet} title="Accounts" subtitle="Your financial snapshot" />
```

---

## Section Component Contract

Each section (Accounts, Transactions, Budget, etc.) must:

1. **Export as default** a React functional component that takes **no required props**:
   ```jsx
   export default function SectionName() { ... }
   ```

2. **Fetch its own data** from dedicated `/api/money/*` endpoints on mount:
   - `GET /api/money/accounts` — for accounts section
   - `GET /api/money/transactions` — for transactions section
   - `GET /api/money/cashflow` — for budget/cash flow section
   - `GET /api/money/overview` — for net worth summary

3. **Handle loading and error states** internally using `useState` and `useEffect`

4. **Import utilities as needed** from `./shared/` (relative imports work from sections/)

5. **Use `.money-hub` scoped CSS** — all classNames like `.m-btn`, `.m-card` are automatically scoped

6. **Use lucide-react icons** (already available in the app)

7. **Lazy-loaded from MoneyHub.jsx** (via `lazy(() => import(...))`)

### Current MVP Sections

**AccountsNetWorth**
```
Location: src/components/money/sections/AccountsNetWorth.jsx
API Endpoint: GET /api/money/accounts, GET /api/money/overview
Displays: Net worth summary + account list
```

**Transactions**
```
Location: src/components/money/sections/Transactions.jsx
API Endpoint: GET /api/money/transactions
Displays: Transaction list, category breakdown, filters
```

**Budget**
```
Location: src/components/money/sections/Budget.jsx
API Endpoint: GET /api/money/cashflow
Displays: Income/expense breakdown, budget progress
```

---

## CSS Classes & Utilities

### Cards & Containers
- `.m-card` — White card with border, shadow, rounded corners, 24px padding, hover effect
- `.m-card-sm` — Same as `.m-card` but 16px padding
- `.m-card-no-hover` — Card that doesn't change on hover

### Buttons
- `.m-btn` — Base button (flex, cursor-pointer, transitions)
- `.m-btn-primary` — Blue background (#0071e3), white text, hover lift + glow
- `.m-btn-secondary` — Light background, dark text, border
- `.m-btn-ghost` — Transparent, blue text, blue border
- `.m-btn-sm` — Smaller padding & font (8px, 13px)
- `.m-btn-icon` — Square button (40x40), padding: 0

### Forms
- `.m-input` — Light input field with focus ring
- `.m-input-label` — Label above input

### Spacing Utilities (4px grid)
- `.m-gap-1`, `.m-gap-2`, `.m-gap-3`, `.m-gap-4`, `.m-gap-6` — Gap between flex children
- `.m-p-1` through `.m-p-6` — Padding
- `.m-mb-2`, `.m-mb-3`, `.m-mb-4`, `.m-mb-6` — Margin-bottom

### Typography
- `.num` — Monospace font with `tabular-nums` for alignment (use with Money component)
- `.m-text-muted`, `.m-text-secondary`, `.m-text-accent` — Color utilities

### Layout
- `.m-scroll` — Container with overflow-y: auto, custom scrollbar

---

## Design Principles

### No Cursor-Pointer on Non-Interactive Cards
Interactive buttons/links get `cursor-pointer`. Cards and static content do NOT get it (Aaron dislikes the corny look). Use only background/border changes on hover.

### Color-Blind Safe
Always pair color with an icon or label. Never use color alone to convey meaning.
- Green ✓ positive + up-arrow icon
- Red ✓ negative + down-arrow icon
- Amber ✓ warning + alert icon

### Generous Whitespace
Cards: 20-24px padding. Section gaps: 24px. Subtle breathing room throughout.

### Subtle Motion
- Fade-in/slide-up on initial render (motion/react)
- Smooth hover transitions (150ms, cubic-bezier easing)
- No attention-grabbing animations; this is a serious finance tool

### Accessible Glossary
Use `<Term>` liberally to explain jargon. Definitions are fetched on-demand and cached. "Learn more" links point to a dedicated glossary page (future feature).

---

## Onboarding Flow

When MoneyHub mounts:
1. Fetch `GET /api/money/overview`
2. If empty or error, show onboarding card with two options:
   - **"Load Sample Data"** → `POST /api/money/seed-sample` → Refresh UI
   - **"Start Fresh (Empty)"** → `POST /api/money/reset` → Refresh UI
3. If data exists, render the active section (default: "accounts")

---

## Backend API Contract (for reference)

### GET /api/money/overview
Returns overview summary (net worth, etc.)
```json
{ "netWorth": 125450.50 }
```

### GET /api/money/accounts
Returns list of accounts
```json
{ "accounts": [...] }
```

### GET /api/money/transactions
Returns list of transactions
```json
{ "transactions": [...] }
```

### GET /api/money/cashflow
Returns income/expense breakdown
```json
{ "income": 5000, "expenses": 2300, ... }
```

### POST /api/money/seed-sample
Populates database with sample data. Returns success.

### POST /api/money/reset
Clears all Money Hub data. Returns success.

### GET /api/money/glossary?term=<name>
Returns glossary definition for a term.
```json
{ "definition": "plain-language explanation" }
```

---

## File Structure

```
src/
├── components/money/
│   ├── MoneyHub.jsx                 (Main hub shell, navigation, onboarding)
│   ├── shared/
│   │   ├── Card.jsx                 (Card wrapper)
│   │   ├── BigStat.jsx              (Large number display)
│   │   ├── Money.jsx                (Currency formatter)
│   │   ├── Term.jsx                 (Glossary term tooltip)
│   │   ├── EmptyState.jsx           (Empty state card)
│   │   ├── ComingSoon.jsx           (Coming soon placeholder)
│   │   └── SectionHeader.jsx        (Section header with icon)
│   └── sections/
│       ├── AccountsNetWorth.jsx     (MVP)
│       ├── Transactions.jsx         (MVP)
│       └── Budget.jsx               (MVP)
└── styles/
    └── money-theme.css              (All light-theme tokens + utility classes)
```

---

## Imports for Section Agents

When building a section, import like this:

```jsx
import { useEffect, useState } from 'react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import BigStat from '../shared/BigStat';
import Money from '../shared/Money';
import Term from '../shared/Term';
import { <LucideIcon> } from 'lucide-react';

export default function MySection() {
  // Component code
}
```

All Money Hub styles (`.m-card`, `.m-btn`, etc.) are already in scope because the MoneyHub wrapper imports `money-theme.css`.

---

## Notes for Future Agents

- **Do NOT modify** `src/App.jsx`, `src/styles/theme.css`, or any existing dark-themed components
- **Do import** `money-theme.css` only in MoneyHub.jsx (already done)
- **Do scope** all new components under the `.money-hub` wrapper (all are within MoneyHub tree)
- **Do test** in the Money Hub in isolation; it doesn't affect the rest of the app
- **Do use** the shared primitives — they're small, fast, and consistent
- **Do fetch** data on component mount; avoid prop-drilling
- **Do handle** loading/error states gracefully
- **Don't** use the dark-theme color vars (`--accent`, `--bg-surface`, etc.); use only `--m-*` vars

---

## Next Steps

1. **Backend agents:** Implement `/api/money/*` endpoints and database schema
2. **Section agents:** Populate AccountsNetWorth, Transactions, Budget with full UI
3. **Additional sections:** Goals, Investments, Tax, Reports, Advisor, Settings
4. **Glossary endpoint:** Implement `/api/money/glossary` with definitions
5. **Testing:** Verify in-app; test onboarding flow

---

Generated: June 23, 2026
Design System: NEXUS Money Hub (Light)
