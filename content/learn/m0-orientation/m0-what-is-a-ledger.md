---
id: m0-what-is-a-ledger
module: M0
title: What a Ledger Is
est_minutes: 3
source_id: original-mmm
license_note: "Original content — no external source."
personalizes: []
requires_data: false
apply_action: create_rule
gate: false
---

A ledger is a complete, dated record of every transaction: what moved, how much, and where. Not a
summary — the underlying rows a summary is built from. "I spent about $600 on food last month" is
a summary. Forty-one dated rows of $8 to $70 with a merchant name on each one is a ledger.

The difference matters because summaries hide the thing you'd actually act on. A summary tells you
food cost $600. A ledger tells you $180 of that was one merchant, on a recurring schedule, that you
forgot you were still paying for. You can't find that in a summary — you can only find it by
category, because a ledger lets you group and filter its rows.

That's what **categories** and **rules** are for: a category is a label on a row ("Groceries",
"Subscriptions"); a rule is a standing instruction — "when a transaction from this merchant
appears, categorize it as X automatically." Rules are what keep a ledger from becoming forty hours
of manual categorizing a month.

:::worked
Two transactions arrive: "SQ *BLUE BOTTLE" for $6.25 and "SQ *BLUE BOTTLE" for $5.75, a week apart.
Categorized once by hand as "Coffee," a rule on the merchant "Blue Bottle" means every future
transaction from that merchant lands in "Coffee" without you touching it again.
:::

:::faded
Think of a merchant that charges you repeatedly — a gym, a streaming service, a coffee shop near
you. Merchant: ______________. Category you'd give it: ______________. That pair is a rule.
:::

:::check
**Question:** What's the key difference between a summary and a ledger?
- A. A ledger only covers one month
- B. A summary is a total; a ledger is the individual dated rows it was built from
- C. There is no difference
**Correct answer:** B — a summary can't be filtered or drilled into further; the underlying rows can.
:::

:::apply
**Apply — Create a rule.** Pick one merchant you recognize in your ledger and create a rule that
auto-categorizes it going forward, so the next time it appears you don't have to touch it.
:::

:::reflect
Is there a category in your ledger right now that feels like a catch-all — a place transactions
land when you're not sure where else to put them? That's usually the first place a rule pays off.
:::
