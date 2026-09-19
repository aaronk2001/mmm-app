---
id: m0-evidence-grades
module: M0
title: What an Evidence Grade Means
est_minutes: 3
source_id: original-mmm
license_note: "Original content — no external source."
personalizes: [runway_days]
requires_data: false
apply_action: add_recurring
gate: true
---

Every number this app shows you carries a small letter badge — A, B, or C. That's the evidence
grade, and it's answering a question you should always be allowed to ask: "how sure is the app
that this number is right?"

- **A** — computed from your real, recorded transactions. High confidence.
- **B** — estimated from recurring bills or a thin history. Reasonable, but built on less.
- **C** — a rough guess, usually because there isn't enough data yet to do better.

Your current runway of {{runway_days.formatted}} days carries a grade of **{{runway_days.grade}}**.
That grade isn't a judgment on you — it's a judgment on the data behind the number. A grade of C
doesn't mean "your finances are bad"; it means "the app doesn't have enough recorded history to be
confident yet," and the fix is almost always the same: add the recurring bills and income you
already know about, so the app stops guessing and starts computing.

This matters because a wrong number stated with total confidence is worse than no number at all —
and a grade is how the app is honest about that difference instead of hiding it.

:::worked
Two users both see "Runway: 4.2 months." One's grade is A, built from six months of categorized
transactions. The other's is C, built from a guess because they joined last week. Same number,
very different amount of trust it should earn — and the grade is the only thing that tells you which is which.
:::

:::faded
Find one number on your Overview page right now and check its grade. Number: ______________.
Grade: ______________. If it's a C, what's one recurring bill or paycheck you could add today
that would move it toward a B? ______________.
:::

:::check
**Question:** A metric shows grade C. What does that tell you?
- A. The number is definitely wrong
- B. The number is a rough estimate because there isn't enough recorded data behind it yet
- C. The app is broken
**Correct answer:** B — a C grade flags low confidence from thin data, not a broken calculation or a guaranteed error.
:::

:::apply
**Apply — Add a recurring bill or paycheck.** Add one recurring item you know is real but haven't
entered yet. This is usually the single fastest way to move a metric from grade C to grade B.
:::

:::reflect
You've finished M0. You know what this app is, what a ledger is, how to read the Overview, and how
much to trust any given number on it. M1 puts all four of those to work on one specific question:
how long does your money actually last?
:::
