import { jsx, jsxs } from "react/jsx-runtime";
import { motion } from "motion/react";
import { Zap } from "lucide-react";
import Card from "../../../shared/Card";
import Money from "../../../shared/Money";
import Term from "../../../shared/Term";
function FireWidget({ fr }) {
  if (!fr) return null;
  return /* @__PURE__ */ jsx(
    motion.div,
    {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.3, delay: 0.05 },
      style: { marginBottom: "24px" },
      children: /* @__PURE__ */ jsx(Card, { hoverable: false, className: "m-card-sm", children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }, children: [
            /* @__PURE__ */ jsx(Zap, { size: 18, style: { color: "var(--m-accent)" } }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", fontWeight: 600, color: "var(--m-ink)" }, children: /* @__PURE__ */ jsx(Term, { name: "FIRE", children: "FIRE Progress" }) })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { fontSize: "13px", color: "var(--m-ink-2)", lineHeight: 1.5, marginBottom: "12px" }, children: [
            "Your ",
            /* @__PURE__ */ jsx(Term, { name: "25x rule", children: "FIRE number" }),
            " is",
            " ",
            /* @__PURE__ */ jsx("strong", { children: /* @__PURE__ */ jsx(Money, { value: fr.fireNumber, prefix: "$", decimals: 0 }) }),
            ". ",
            fr.yearsToFire ? `~${fr.yearsToFire} years at current pace.` : "Increase savings to accelerate."
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
                  animate: { width: `${Math.min(fr.progressPct, 100)}%` },
                  transition: { duration: 0.5, ease: "easeOut" },
                  style: {
                    height: "100%",
                    background: "var(--m-accent)",
                    borderRadius: "4px"
                  }
                }
              )
            }
          ),
          /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                color: "var(--m-ink-2)",
                marginTop: "8px"
              },
              children: [
                /* @__PURE__ */ jsx(Money, { value: fr.currentNetWorth, prefix: "$", decimals: 0 }),
                /* @__PURE__ */ jsxs("div", { style: { fontWeight: 600, color: "var(--m-accent)" }, children: [
                  fr.progressPct,
                  "%"
                ] })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "12px",
              borderRadius: "8px",
              background: "var(--m-accent-soft)",
              whiteSpace: "nowrap"
            },
            children: [
              /* @__PURE__ */ jsxs("div", { style: { fontSize: "20px", fontWeight: 700, color: "var(--m-accent)" }, children: [
                fr.progressPct,
                "%"
              ] }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "var(--m-ink-2)", marginTop: "2px" }, children: "to FIRE" })
            ]
          }
        )
      ] }) })
    }
  );
}
export {
  FireWidget as default
};
