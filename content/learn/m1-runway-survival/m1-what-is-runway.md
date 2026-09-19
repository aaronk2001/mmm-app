---
id: m1-what-is-runway
module: M1
title: What Runway Actually Measures
est_minutes: 4
source_id: openstax-principles-of-finance-1e
license_note: "Original prose, informed by liquidity-management concepts in OpenStax Principles of Finance, 1st ed. (CC BY 4.0). No verbatim text reproduced."
personalizes: [runway_days, runway_date, liquid]
requires_data: true
apply_action: create_goal
gate: false
---

Runway is a single question made numeric: if every source of income stopped today, how long could
you keep paying for your life using only what you already have in cash? It's a term borrowed from
startups sizing how long they can operate before running out of money, and it applies just as
literally to a household.

The mechanics are simple: take your liquid cash and divide it by what you actually spend per
period. No forecasting, no assumptions about a raise or a new job — just the cash you can already
touch, against your recent real spending.

Right now, your own numbers say:

- Liquid cash on hand: **{{liquid.formatted}}**
- Runway at your recent pace: **{{runway_days.formatted}} days**
- Which puts the date your cash runs out, if nothing changed, at **{{runway_date.formatted}}**

That date is not a prediction that anything bad will happen — it's the honest answer to "how much
slack do I have," which is a very different (and more useful) question than "am I doing okay."

:::worked
Someone with $9,000 liquid and $3,000/mo in spending has 3.0 months of runway — $9,000 ÷ $3,000.
Change nothing about their life except their spending and the runway number moves; change nothing
about their spending except their liquid cash and it also moves. It's a ratio, not a verdict.
:::

:::faded
Using your own {{liquid.formatted}} liquid and your {{runway_days.formatted}}-day runway: if your
liquid cash dropped by half tomorrow (an unplanned expense, say), would your runway also roughly
halve? ______________ (yes / no). Why: ______________.
:::

:::check
**Question:** Runway is calculated from which two inputs?
- A. Your credit score and your income
- B. Your liquid cash and your recent spending rate
- C. Your net worth and your age
**Correct answer:** B — runway is strictly a ratio of what you can access now to what you actually spend, not a broader wealth or credit measure.
:::

:::apply
**Apply — Create a goal.** Set a runway goal — a target number of days or months you want to reach
— using {{runway_days.formatted}} as your starting point.
:::

:::reflect
Before this lesson, did you have a gut-feel number for "how long my cash lasts"? How close was it
to {{runway_days.formatted}} days?
:::
