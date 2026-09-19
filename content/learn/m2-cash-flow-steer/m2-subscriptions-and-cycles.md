---
id: m2-subscriptions-and-cycles
module: M2
title: Subscriptions and the Cycle Trap
est_minutes: 4
source_id: original-mmm
license_note: "Original content — no external source."
personalizes: [recurring_monthly]
requires_data: true
apply_action: add_recurring
gate: false
---

Subscriptions are dangerous to a budget for a specific, mechanical reason: they don't all bill on
the same cycle, so a monthly view of your ledger only ever shows part of the picture. A $12/month
streaming service and a $120/year membership both cost the same amount annually, but only one of
them shows up in every month's transaction list. The other looks free eleven months out of twelve.

The fix is cycle normalization: converting every recurring cost, regardless of how it bills, into a
common monthly figure so they can be compared and totaled honestly. Your recurring commitments,
normalized to a monthly basis, currently total **{{recurring_monthly.formatted}}** — that figure
already accounts for anything billing quarterly or annually, spread across its real cycle.

Without normalizing, an annual subscription renewing in a month you're not paying close attention
to is nearly invisible until it's already been charged.

:::worked
A $96/year software subscription normalizes to $8/month. On its own that looks negligible. Stacked
with four similarly "small" annual subscriptions at $60, $84, $120, and $150/year, the normalized
total is roughly $34.50/month — over $400/year — a number none of the individual line items made
obvious on its own.
:::

:::faded
List one subscription you pay for that does NOT bill monthly. Name: ______________. Billing cycle:
______________. Its normalized monthly cost: ______________ (annual cost ÷ 12, or quarterly ÷ 3).
:::

:::check
**Question:** Why can an annual subscription be easy to lose track of?
- A. Annual subscriptions are always more expensive than monthly ones
- B. It only appears in the ledger once a year, so a month-by-month view mostly shows it as absent
- C. Annual subscriptions can't be canceled
**Correct answer:** B — infrequent billing means the cost is invisible in most monthly snapshots even though it's still being paid.
:::

:::apply
**Apply — Add a recurring entry.** Add any subscription that isn't already tracked as recurring, so
it's included in {{recurring_monthly.formatted}} instead of surprising you on its next billing date.
:::

:::reflect
Do you know, right now, the full list of everything that will auto-renew in the next 90 days? If
not, that's the gap this lesson is pointing at.
:::
