import { jsx, jsxs } from "react/jsx-runtime";
import { motion } from "motion/react";
import { Calendar, CheckCircle2, Edit2, Trash2, Target, Plus, AlertCircle } from "lucide-react";
import Card from "../../../shared/Card";
import Money from "../../../shared/Money";
import EmptyState from "../../../shared/EmptyState";
const parseDate = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return { year: y, month: m, day: d };
};
const monthsBetween = (fromStr, toStr) => {
  const from = parseDate(fromStr);
  const to = parseDate(toStr);
  return (to.year - from.year) * 12 + (to.month - from.month);
};
const addMonths = (dateStr, months) => {
  const d = parseDate(dateStr);
  let m = d.month + months;
  let y = d.year;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
};
const today = () => {
  const d = /* @__PURE__ */ new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
function GoalList({
  goalsList,
  accounts,
  showAddForm,
  setShowAddForm,
  handleEditStart,
  handleDeleteGoal
}) {
  const accountMap = {};
  if (accounts?.accounts) {
    accounts.accounts.forEach((acc) => {
      accountMap[acc.id] = acc;
    });
  }
  if (goalsList.length === 0) {
    return /* @__PURE__ */ jsx(
      EmptyState,
      {
        icon: Target,
        title: "No goals yet",
        message: "Set a savings goal to track progress toward your financial milestones.",
        action: !showAddForm && /* @__PURE__ */ jsxs(
          "button",
          {
            className: "m-btn m-btn-primary m-btn-sm",
            onClick: () => setShowAddForm(true),
            style: { display: "flex", alignItems: "center", gap: "6px" },
            children: [
              /* @__PURE__ */ jsx(Plus, { size: 16 }),
              "Create your first goal"
            ]
          }
        )
      }
    );
  }
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: "12px" }, children: goalsList.map((goal, idx) => {
    const linkedAccount = goal.linked_account_id ? accountMap[goal.linked_account_id] : null;
    const current = linkedAccount ? linkedAccount.balance : goal.current;
    const remaining = Math.max(0, goal.target - current);
    const pct = goal.target > 0 ? current / goal.target * 100 : 0;
    const monthsToTarget = goal.monthly_contribution && goal.monthly_contribution > 0 ? Math.ceil(remaining / goal.monthly_contribution) : null;
    const projectedDate = monthsToTarget ? addMonths(today(), monthsToTarget) : null;
    let paceStatus = null;
    if (goal.target_date && goal.monthly_contribution) {
      const monthsUntilTarget = monthsBetween(today(), goal.target_date);
      if (monthsUntilTarget > 0) {
        const neededMonthly = remaining / monthsUntilTarget;
        if (neededMonthly <= goal.monthly_contribution) {
          paceStatus = { type: "on-pace", color: "var(--m-green)" };
        } else {
          const behind = neededMonthly - goal.monthly_contribution;
          paceStatus = { type: "behind", amount: behind, color: "var(--m-amber)" };
        }
      }
    }
    return /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay: idx * 0.05 },
        children: /* @__PURE__ */ jsx(Card, { hoverable: false, className: "m-card-sm", children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }, children: [
          /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "8px"
                },
                children: [
                  /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", fontWeight: 600, color: "var(--m-ink)" }, children: goal.name || "Untitled Goal" }),
                  /* @__PURE__ */ jsxs("div", { style: { fontSize: "13px", fontWeight: 600, color: "var(--m-accent)" }, children: [
                    Math.round(pct),
                    "%"
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  height: "6px",
                  background: "var(--m-surface-2)",
                  borderRadius: "3px",
                  overflow: "hidden",
                  marginBottom: "8px"
                },
                children: /* @__PURE__ */ jsx(
                  motion.div,
                  {
                    initial: { width: 0 },
                    animate: { width: `${Math.min(pct, 100)}%` },
                    transition: { duration: 0.5, ease: "easeOut" },
                    style: {
                      height: "100%",
                      background: pct >= 100 ? "var(--m-green)" : "var(--m-accent)",
                      borderRadius: "3px"
                    }
                  }
                )
              }
            ),
            linkedAccount && /* @__PURE__ */ jsxs("div", { style: { fontSize: "12px", color: "var(--m-muted)", marginBottom: "6px" }, children: [
              "tracking ",
              linkedAccount.name
            ] }),
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "13px",
                  color: "var(--m-ink-2)"
                },
                children: [
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx(Money, { value: current, prefix: "$", decimals: 2 }),
                    " of",
                    " ",
                    /* @__PURE__ */ jsx(Money, { value: goal.target, prefix: "$", decimals: 2 })
                  ] }),
                  pct >= 100 && /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "4px", color: "var(--m-green)" }, children: [
                    /* @__PURE__ */ jsx(CheckCircle2, { size: 13 }),
                    /* @__PURE__ */ jsx("span", { children: "Complete" })
                  ] })
                ]
              }
            ),
            goal.monthly_contribution ? /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: "12px", marginTop: "6px" }, children: [
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsxs("div", { style: { color: "var(--m-muted)" }, children: [
                  /* @__PURE__ */ jsx(Money, { value: goal.monthly_contribution, prefix: "$", decimals: 2 }),
                  " / month"
                ] }),
                projectedDate && remaining > 0 && /* @__PURE__ */ jsxs("div", { style: { color: "var(--m-muted)", marginTop: "2px", fontSize: "11px" }, children: [
                  monthsToTarget,
                  " months \u2022 ",
                  projectedDate
                ] })
              ] }),
              paceStatus && /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "4px", color: paceStatus.color, fontWeight: 600 }, children: [
                /* @__PURE__ */ jsx(AlertCircle, { size: 12 }),
                /* @__PURE__ */ jsx("span", { children: paceStatus.type === "on-pace" ? "on pace" : `behind $${paceStatus.amount.toFixed(0)}/mo` })
              ] })
            ] }) : /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "var(--m-muted)", marginTop: "6px" }, children: "set a monthly contribution to project a date" })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "6px", flexShrink: 0 }, children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleEditStart(goal),
                style: {
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--m-accent)",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center"
                },
                children: /* @__PURE__ */ jsx(Edit2, { size: 16 })
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleDeleteGoal(goal.id),
                style: {
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--m-red)",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center"
                },
                children: /* @__PURE__ */ jsx(Trash2, { size: 16 })
              }
            )
          ] })
        ] }) })
      },
      goal.id
    );
  }) });
}
export {
  GoalList as default
};
