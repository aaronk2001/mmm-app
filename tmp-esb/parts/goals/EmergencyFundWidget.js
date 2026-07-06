import { jsx, jsxs } from "react/jsx-runtime";
import { motion } from "motion/react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import Card from "../../../shared/Card";
import Money from "../../../shared/Money";
import Term from "../../../shared/Term";
function EmergencyFundWidget({ em }) {
  if (!em) return null;
  const statusColor = em.adequacy === "good" ? "var(--m-green)" : em.adequacy === "ok" ? "var(--m-amber)" : "var(--m-red)";
  const statusBg = em.adequacy === "good" ? "rgba(21, 163, 74, 0.1)" : em.adequacy === "ok" ? "rgba(217, 119, 6, 0.1)" : "rgba(220, 38, 38, 0.1)";
  const statusLabel = em.adequacy === "good" ? "Protected" : em.adequacy === "ok" ? "Moderate" : "At Risk";
  return /* @__PURE__ */ jsx(
    motion.div,
    {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.3 },
      style: { marginBottom: "24px" },
      children: /* @__PURE__ */ jsx(Card, { hoverable: false, className: "m-card-sm", children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }, children: [
            /* @__PURE__ */ jsx(AlertCircle, { size: 18, style: { color: statusColor } }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", fontWeight: 600, color: "var(--m-ink)" }, children: /* @__PURE__ */ jsx(Term, { name: "emergency fund", children: "Emergency Fund" }) })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { fontSize: "13px", color: "var(--m-ink-2)", lineHeight: 1.5, marginBottom: "12px" }, children: [
            "You have ",
            /* @__PURE__ */ jsx("strong", { children: em.monthsCovered }),
            " months covered. Target is",
            " ",
            /* @__PURE__ */ jsx("strong", { children: em.targetMonths }),
            " months."
          ] }),
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                height: "8px",
                background: "var(--m-surface-2)",
                borderRadius: "4px",
                overflow: "hidden"
              },
              children: /* @__PURE__ */ jsx(
                motion.div,
                {
                  initial: { width: 0 },
                  animate: { width: `${Math.min(em.currentSaved / em.targetAmount * 100, 100)}%` },
                  transition: { duration: 0.5, ease: "easeOut" },
                  style: {
                    height: "100%",
                    background: statusColor,
                    borderRadius: "4px"
                  }
                }
              )
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: { fontSize: "13px", color: "var(--m-ink-2)", marginTop: "8px" }, children: [
            /* @__PURE__ */ jsx(Money, { value: em.currentSaved, prefix: "$", decimals: 0 }),
            " of",
            " ",
            /* @__PURE__ */ jsx(Money, { value: em.targetAmount, prefix: "$", decimals: 0 })
          ] })
        ] }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              borderRadius: "8px",
              background: statusBg,
              whiteSpace: "nowrap"
            },
            children: [
              em.adequacy === "good" ? /* @__PURE__ */ jsx(CheckCircle2, { size: 16, style: { color: statusColor } }) : /* @__PURE__ */ jsx(AlertCircle, { size: 16, style: { color: statusColor } }),
              /* @__PURE__ */ jsx(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: statusColor
                  },
                  children: statusLabel
                }
              )
            ]
          }
        )
      ] }) })
    }
  );
}
export {
  EmergencyFundWidget as default
};
