import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  TrendingDown,
  DollarSign,
  AlertCircle,
  Plus,
  Percent
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from "recharts";
import { api } from "../../../lib/query";
import { toast } from "../../../lib/toast";
import SectionHeader from "../shared/SectionHeader";
import Card from "../shared/Card";
import Money from "../shared/Money";
import Term from "../shared/Term";
import BigStat from "../shared/BigStat";
import EmptyState from "../shared/EmptyState";
import CalcPanel from "./parts/debt/CalcPanel";
function Debt() {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [strategy, setStrategy] = useState("avalanche");
  const [monthlyExtra, setMonthlyExtra] = useState(0);
  const [payoffResult, setPayoffResult] = useState(null);
  const [showCalculators, setShowCalculators] = useState(false);
  const [activeCalculator, setActiveCalculator] = useState(null);
  useEffect(() => {
    loadDebts();
  }, []);
  async function loadDebts() {
    try {
      setLoading(true);
      setError(null);
      const data = await api("money/debt");
      setDebts(data.debts || []);
    } catch (err) {
      setError(err.message);
      toast.error("Failed to load debt data");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (debts.length > 0) {
      computePayoff();
    }
  }, [strategy, monthlyExtra, debts]);
  async function computePayoff() {
    try {
      const result = await api("money/debt/payoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy,
          monthly_extra: monthlyExtra
        })
      });
      setPayoffResult(result);
    } catch (err) {
      toast.error("Failed to compute payoff strategy");
    }
  }
  if (loading) {
    return /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx(
        SectionHeader,
        {
          icon: TrendingDown,
          title: "Debt Payoff",
          subtitle: "Strategy and timeline"
        }
      ),
      /* @__PURE__ */ jsx(Card, { className: "m-card-sm", children: /* @__PURE__ */ jsx("div", { style: { color: "var(--m-ink-2)" }, children: "Loading debt data..." }) })
    ] });
  }
  if (error) {
    return /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx(
        SectionHeader,
        {
          icon: TrendingDown,
          title: "Debt Payoff",
          subtitle: "Strategy and timeline"
        }
      ),
      /* @__PURE__ */ jsx(Card, { className: "m-card-sm", children: /* @__PURE__ */ jsxs("div", { style: { color: "var(--m-red)" }, children: [
        "Error: ",
        error
      ] }) })
    ] });
  }
  if (debts.length === 0) {
    return /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx(
        SectionHeader,
        {
          icon: TrendingDown,
          title: "Debt Payoff",
          subtitle: "Strategy and timeline"
        }
      ),
      /* @__PURE__ */ jsx(
        EmptyState,
        {
          title: "No debts to track",
          message: "Add a loan or credit card account to see payoff strategies and timelines.",
          icon: AlertCircle
        }
      )
    ] });
  }
  const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
  const totalMinPayment = debts.reduce((sum, d) => sum + d.min_payment, 0);
  const chartData = payoffResult?.schedule?.map((point) => ({
    month: point.month,
    total: point.balances.reduce((sum, b) => sum + b.remaining, 0),
    ...Object.fromEntries(point.balances.map((b) => [b.name, b.remaining]))
  })) || [];
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx(
      SectionHeader,
      {
        icon: TrendingDown,
        title: "Debt Payoff",
        subtitle: "Strategy and timeline"
      }
    ),
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "24px" }, children: [
      /* @__PURE__ */ jsx(
        motion.div,
        {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3 },
          children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
            BigStat,
            {
              label: "Total Debt",
              value: /* @__PURE__ */ jsx(Money, { value: totalDebt })
            }
          ) })
        }
      ),
      payoffResult && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(
          motion.div,
          {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.3, delay: 0.05 },
            children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
              BigStat,
              {
                label: `Debt-Free in ${payoffResult.monthsToFree} months`,
                value: `${Math.floor(payoffResult.monthsToFree / 12)}y ${payoffResult.monthsToFree % 12}m`
              }
            ) })
          }
        ),
        /* @__PURE__ */ jsx(
          motion.div,
          {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.3, delay: 0.1 },
            children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
              BigStat,
              {
                label: "Total Interest",
                value: /* @__PURE__ */ jsx(Money, { value: payoffResult.totalInterest }),
                suffix: " (paid)"
              }
            ) })
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay: 0.15 },
        children: /* @__PURE__ */ jsxs(Card, { children: [
          /* @__PURE__ */ jsxs("div", { style: { marginBottom: "20px" }, children: [
            /* @__PURE__ */ jsx("h3", { style: { fontSize: "16px", fontWeight: 600, color: "var(--m-ink)", marginBottom: "4px" }, children: "Your Debts" }),
            /* @__PURE__ */ jsxs("p", { style: { fontSize: "13px", color: "var(--m-ink-2)" }, children: [
              debts.length,
              " active debt",
              debts.length !== 1 ? "s" : "",
              ". Minimum total payment: ",
              /* @__PURE__ */ jsx(Money, { value: totalMinPayment })
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: "12px" }, children: debts.map((debt, idx) => /* @__PURE__ */ jsxs(
            motion.div,
            {
              initial: { opacity: 0, x: -8 },
              animate: { opacity: 1, x: 0 },
              transition: { duration: 0.2, delay: idx * 0.05 },
              style: {
                padding: "12px",
                background: "var(--m-surface-2)",
                borderRadius: "8px",
                border: "1px solid var(--m-border)"
              },
              children: [
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px", minWidth: 0 }, children: [
                  /* @__PURE__ */ jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [
                    /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", fontWeight: 600, color: "var(--m-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: debt.name }),
                    /* @__PURE__ */ jsxs("div", { style: { fontSize: "13px", color: "var(--m-ink-2)", marginTop: "2px" }, children: [
                      debt.type === "credit" ? "Credit Card" : "Loan",
                      " at ",
                      /* @__PURE__ */ jsx(Percent, { size: 12, style: { display: "inline" } }),
                      " ",
                      (debt.apr * 100).toFixed(1),
                      "% APR"
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxs("div", { style: { textAlign: "right", flexShrink: 0, marginLeft: "12px" }, children: [
                    /* @__PURE__ */ jsx("div", { style: { fontSize: "15px", fontWeight: 600, color: "var(--m-ink)", fontVariantNumeric: "tabular-nums" }, children: /* @__PURE__ */ jsx(Money, { value: debt.balance }) }),
                    /* @__PURE__ */ jsxs("div", { style: { fontSize: "12px", color: "var(--m-muted)", marginTop: "2px" }, children: [
                      "Min: ",
                      /* @__PURE__ */ jsx(Money, { value: debt.min_payment, decimals: 0 })
                    ] })
                  ] })
                ] }),
                /* @__PURE__ */ jsx("div", { style: {
                  width: "100%",
                  height: "6px",
                  background: "var(--m-border)",
                  borderRadius: "3px",
                  overflow: "hidden"
                }, children: /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      height: "100%",
                      width: `${Math.min(100, debt.balance / totalDebt * 100)}%`,
                      background: "var(--m-accent)",
                      transition: "width 150ms ease"
                    }
                  }
                ) })
              ]
            },
            idx
          )) })
        ] })
      }
    ),
    /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay: 0.2 },
        children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs("div", { style: { marginBottom: "20px" }, children: [
          /* @__PURE__ */ jsx("h3", { style: { fontSize: "16px", fontWeight: 600, color: "var(--m-ink)", marginBottom: "12px" }, children: "Payoff Strategy" }),
          /* @__PURE__ */ jsxs("p", { style: { fontSize: "13px", color: "var(--m-ink-2)", marginBottom: "16px" }, children: [
            "Choose ",
            /* @__PURE__ */ jsx(Term, { name: "debt avalanche", children: "debt avalanche" }),
            " (highest APR first) or ",
            /* @__PURE__ */ jsx(Term, { name: "snowball method", children: "snowball" }),
            " (smallest balance first)."
          ] }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: "8px", marginBottom: "20px" }, children: ["avalanche", "snowball"].map((s) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setStrategy(s),
              style: {
                flex: 1,
                padding: "10px 16px",
                borderRadius: "8px",
                border: "1px solid var(--m-border)",
                background: strategy === s ? "var(--m-accent)" : "var(--m-surface)",
                color: strategy === s ? "#fff" : "var(--m-ink)",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 150ms ease"
              },
              children: s === "avalanche" ? "Avalanche (APR)" : "Snowball (Balance)"
            },
            s
          )) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("label", { style: { display: "block", fontSize: "13px", fontWeight: 500, color: "var(--m-ink-2)", marginBottom: "8px" }, children: [
              "Extra Monthly Payment: ",
              /* @__PURE__ */ jsx(Money, { value: monthlyExtra, prefix: "" })
            ] }),
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "range",
                min: "0",
                max: "2000",
                step: "50",
                value: monthlyExtra,
                onChange: (e) => setMonthlyExtra(Number(e.target.value)),
                style: {
                  width: "100%",
                  height: "6px",
                  borderRadius: "3px",
                  background: "var(--m-border)",
                  outline: "none",
                  accentColor: "var(--m-accent)",
                  cursor: "pointer"
                }
              }
            ),
            /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "var(--m-muted)", marginTop: "6px" }, children: "Adjust the slider to see how extra payments speed up debt freedom." })
          ] })
        ] }) })
      }
    ),
    payoffResult && payoffResult.order.length > 0 && /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay: 0.25 },
        children: /* @__PURE__ */ jsxs(Card, { children: [
          /* @__PURE__ */ jsxs("div", { style: { marginBottom: "16px" }, children: [
            /* @__PURE__ */ jsx("h3", { style: { fontSize: "16px", fontWeight: 600, color: "var(--m-ink)", marginBottom: "4px" }, children: "Payoff Order" }),
            /* @__PURE__ */ jsxs("p", { style: { fontSize: "13px", color: "var(--m-ink-2)" }, children: [
              "Based on ",
              strategy === "avalanche" ? "highest APR first" : "smallest balance first",
              " strategy."
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: "8px" }, children: payoffResult.order.map((name, idx) => /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 12px",
                background: "var(--m-surface-2)",
                borderRadius: "6px"
              },
              children: [
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      background: "var(--m-accent)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: 700,
                      flexShrink: 0
                    },
                    children: idx + 1
                  }
                ),
                /* @__PURE__ */ jsx("span", { style: { fontSize: "14px", fontWeight: 500, color: "var(--m-ink)" }, children: name })
              ]
            },
            idx
          )) })
        ] })
      }
    ),
    chartData.length > 0 && /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay: 0.3 },
        children: /* @__PURE__ */ jsxs(Card, { children: [
          /* @__PURE__ */ jsx("h3", { style: { fontSize: "16px", fontWeight: 600, color: "var(--m-ink)", marginBottom: "16px" }, children: "Payoff Timeline" }),
          /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height: 300, children: /* @__PURE__ */ jsxs(LineChart, { data: chartData, children: [
            /* @__PURE__ */ jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "var(--m-border)" }),
            /* @__PURE__ */ jsx(
              XAxis,
              {
                dataKey: "month",
                stroke: "var(--m-ink-2)",
                style: { fontSize: "12px" },
                label: { value: "Months", position: "insideBottomRight", offset: -5 }
              }
            ),
            /* @__PURE__ */ jsx(
              YAxis,
              {
                stroke: "var(--m-ink-2)",
                style: { fontSize: "12px" },
                label: { value: "Remaining Balance", angle: -90, position: "insideLeft" }
              }
            ),
            /* @__PURE__ */ jsx(
              Tooltip,
              {
                contentStyle: {
                  background: "var(--m-surface)",
                  border: "1px solid var(--m-border)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "12px"
                },
                formatter: (value) => `$${value?.toLocaleString("en-US", { maximumFractionDigits: 0 }) || "0"}`,
                labelFormatter: (label) => `Month ${label}`
              }
            ),
            /* @__PURE__ */ jsx(
              Line,
              {
                type: "monotone",
                dataKey: "total",
                stroke: "var(--m-accent)",
                dot: false,
                strokeWidth: 2,
                isAnimationActive: true
              }
            )
          ] }) }),
          /* @__PURE__ */ jsxs("div", { style: { fontSize: "12px", color: "var(--m-muted)", marginTop: "12px", textAlign: "center" }, children: [
            "Assumes consistent ",
            strategy,
            " strategy with ",
            /* @__PURE__ */ jsx(Money, { value: monthlyExtra, prefix: "" }),
            " extra payment per month."
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay: 0.35 },
        children: /* @__PURE__ */ jsxs(Card, { children: [
          /* @__PURE__ */ jsx("div", { style: { marginBottom: "16px" }, children: /* @__PURE__ */ jsx("h3", { style: { fontSize: "16px", fontWeight: 600, color: "var(--m-ink)" }, children: "Loan Calculators" }) }),
          !showCalculators ? /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => setShowCalculators(true),
              style: {
                width: "100%",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid var(--m-border)",
                background: "var(--m-accent-soft)",
                color: "var(--m-accent)",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "all 150ms ease"
              },
              children: [
                /* @__PURE__ */ jsx(Plus, { size: 16 }),
                "Show Calculators"
              ]
            }
          ) : /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }, children: ["Mortgage", "Auto Loan", "Refi", "DTI"].map((calc) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setActiveCalculator(activeCalculator === calc ? null : calc),
              style: {
                padding: "10px 12px",
                borderRadius: "6px",
                border: "1px solid var(--m-border)",
                background: activeCalculator === calc ? "var(--m-accent)" : "var(--m-surface-2)",
                color: activeCalculator === calc ? "#fff" : "var(--m-ink)",
                fontWeight: 500,
                cursor: "pointer",
                fontSize: "13px",
                transition: "all 150ms ease"
              },
              children: calc
            },
            calc
          )) }),
          activeCalculator && /* @__PURE__ */ jsx(CalcPanel, { type: activeCalculator, debts })
        ] })
      }
    ),
    /* @__PURE__ */ jsx(
      motion.div,
      {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.3, delay: 0.4 },
        style: { marginTop: "24px", fontSize: "12px", color: "var(--m-ink-2)", textAlign: "center" },
        children: "\u{1F4A1} Tip: Add loans and credit cards as accounts to see them here. Set APR and minimum payment in account details."
      }
    )
  ] });
}
export {
  Debt as default
};
