---
id: m0-reading-the-overview
module: M0
title: How to Read the Overview
est_minutes: 4
source_id: original-mmm
license_note: "Original content — no external source."
personalizes: [runway_days, liquid, monthly_surplus]
requires_data: false
apply_action: create_goal
gate: false
---

The Overview page is three questions answered in order: how long does my cash last, what's coming
in versus going out, and what am I actually worth. You don't have to visit three different reports
to get that — it's the front page for a reason.

Right now, your own answers to those three questions are:

- Cash lasts **{{runway_days.formatted}}** days at your recent pace (evidence grade {{runway_days.grade}}).
- You currently hold **{{liquid.formatted}}** in liquid cash — money you could spend today without
  selling anything or waiting on a transfer.
- Your monthly surplus (income minus expenses) is **{{monthly_surplus.formatted}}**.

If any of those three numbers surprised you, that's useful information, not a problem — it means
the Overview is telling you something your gut wasn't tracking. That's the entire job of this page:
compress a ledger with hundreds of rows into three load-bearing numbers you can check at a glance.

:::worked
A runway of 45 days and a monthly surplus of $0 describe two different problems. Runway alone
tells you how long you'd survive with no income at all. Surplus tells you whether your current
income is even enough to keep pace with your current spending. You need both, together, to know
whether you're stable or just currently solvent.
:::

:::faded
Look at your own {{runway_days.formatted}} days and {{monthly_surplus.formatted}} surplus side by
side. If your surplus is positive, your runway is (growing / shrinking / flat): ______________.
If it's negative, which direction is your runway heading without a change: ______________.
:::

:::check
**Question:** If your monthly surplus is negative, what happens to your runway over time, all else equal?
- A. It stays the same
- B. It grows, because unspent cash accumulates
- C. It shrinks, because you're drawing down liquid cash faster than income replaces it
**Correct answer:** C — a negative surplus means you're spending down your liquid balance, which is the numerator of runway.
:::

:::apply
**Apply — Create a goal.** Turn one of the three Overview numbers into a target: a runway goal, a
liquid-cash goal, or a monthly-surplus goal. Pick whichever one you were least happy to see above.
:::

:::reflect
Which of the three numbers — runway, liquid, or surplus — do you check most often in your head
already, without looking at any app? That's probably the one to watch first.
:::

