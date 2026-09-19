---
id: m1-burn-rate
module: M1
title: Burn Rate — What's Actually Draining Your Runway
est_minutes: 4
source_id: openstax-principles-of-finance-1e
license_note: "Original prose, informed by cash-flow concepts in OpenStax Principles of Finance, 1st ed. (CC BY 4.0). No verbatim text reproduced."
personalizes: [liquid, runway_days, recurring_monthly, largest_outflow]
requires_data: true
apply_action: set_category_budget
gate: false
---

Runway tells you how long your cash lasts. Burn rate tells you why — it's the pace you're spending
at, and it's made of two very different kinds of outflow: money you've committed to in advance,
and money you decide on transaction by transaction.

The committed part is easiest to see in your recurring bills: right now those add up to
**{{recurring_monthly.formatted}} per month**, showing up whether you think about them or not.
Everything else is discretionary — spending you actually choose each time.

Your largest single-payee outflow over the last 90 days is **{{largest_outflow.formatted}}**. That's worth knowing
by name, because a burn rate is not one undifferentiated number — it's dominated by a small number
of large items, and this is the largest one currently working against your {{runway_days.formatted}}-day runway.

:::worked
Two households both burn $4,000/month. One has $3,800 of that locked into recurring bills — rent,
insurance, a car payment — and $200 of discretionary spending. The other has $2,000 recurring and
$2,000 discretionary. Same runway today, very different amount of near-term control: the second
household can cut its burn rate fast if it needs to; the first mostly can't.
:::

:::faded
Your recurring load is {{recurring_monthly.formatted}}/mo. If you needed to cut your burn rate by
20% starting this month, could you get there mostly from recurring bills, or would you have to touch
discretionary spending too? ______________. Why: ______________.
:::

:::check
**Question:** Why does it matter whether burn is mostly recurring or mostly discretionary?
- A. It doesn't — a dollar burned is a dollar burned regardless of source
- B. Discretionary spending can typically be cut faster than recurring commitments, so its mix changes how quickly you could extend your runway
- C. Recurring bills always cost more than discretionary spending
**Correct answer:** B — the split determines how much of your burn rate you could realistically reduce on short notice.
:::

:::apply
**Apply — Set a category budget.** Put a budget on the category behind your largest outflow,
{{largest_outflow.formatted}}, so future spending there is visible against a limit instead of
drifting.
:::

:::reflect
Was your largest outflow the one you expected, or did {{largest_outflow.formatted}} surprise you?
:::
