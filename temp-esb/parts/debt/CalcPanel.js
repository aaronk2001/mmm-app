import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
const f$ = (x) => "$" + Math.round(Number(x) || 0).toLocaleString();
function pmt(P, annualRatePct, months) {
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  if (months <= 0 || P <= 0) return 0;
  return r === 0 ? P / months : P * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
}
const CALC_FIELDS = {
  Mortgage: [["price", "Home price"], ["down", "Down payment"], ["rate", "Rate (%)"], ["term", "Term (years)"]],
  "Auto Loan": [["price", "Vehicle price"], ["down", "Down payment"], ["rate", "Rate (%)"], ["term", "Term (months)"]],
  Refi: [["bal", "Current balance"], ["curRate", "Current rate (%)"], ["curMonths", "Months remaining"], ["newRate", "New rate (%)"], ["newMonths", "New term (months)"], ["cost", "Closing costs"]],
  DTI: [["income", "Monthly gross income"], ["debt", "Monthly debt payments"]]
};
function CalcPanel({ type, debts }) {
  const [v, setV] = useState({});
  const n = (k, d = 0) => {
    const x = parseFloat(v[k]);
    return Number.isFinite(x) ? x : d;
  };
  let out = [];
  if (type === "Mortgage" || type === "Auto Loan") {
    const P = n("price") - n("down");
    const months = type === "Mortgage" ? n("term", 30) * 12 : n("term", 60);
    const m = pmt(P, n("rate", 7), months);
    const total = m * months;
    out = [["Monthly payment", f$(m)], ["Total interest", f$(total - P)], ["Total paid", f$(total)]];
  } else if (type === "Refi") {
    const bal = n("bal");
    const oldM = pmt(bal, n("curRate", 7), n("curMonths", 1));
    const newM = pmt(bal, n("newRate", 6), n("newMonths", 1));
    const save = oldM - newM;
    out = [["Old payment", f$(oldM)], ["New payment", f$(newM)], ["Monthly savings", f$(save)]];
    if (n("cost") > 0 && save > 0) out.push(["Break-even", Math.ceil(n("cost") / save) + " months"]);
  } else if (type === "DTI") {
    const income = n("income");
    const debtDefault = (debts || []).reduce((s, d) => s + (Number(d.min_payment) || 0), 0);
    const debt = v.debt !== void 0 && v.debt !== "" ? n("debt") : debtDefault;
    const dti = income > 0 ? debt / income * 100 : 0;
    out = [["Monthly debt", f$(debt)], ["DTI ratio", dti.toFixed(1) + "%"], ["Assessment", dti <= 36 ? "Healthy" : dti <= 43 ? "Manageable" : "High"]];
  }
  const debtSum = (debts || []).reduce((s, d) => s + (Number(d.min_payment) || 0), 0);
  return /* @__PURE__ */ jsxs("div", { style: { marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }, children: [
    /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 10 }, children: (CALC_FIELDS[type] || []).map(([k, label]) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("label", { className: "m-input-label", children: label }),
      /* @__PURE__ */ jsx(
        "input",
        {
          className: "m-input",
          type: "number",
          step: "any",
          placeholder: type === "DTI" && k === "debt" ? `auto: ${f$(debtSum)}` : "",
          value: v[k] ?? "",
          onChange: (e) => setV({ ...v, [k]: e.target.value })
        }
      )
    ] }, k)) }),
    /* @__PURE__ */ jsx("div", { style: { background: "var(--m-surface-2)", borderRadius: 8, padding: 16, display: "grid", gap: 10, alignContent: "start" }, children: out.map(([label, val], i) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" }, children: [
      /* @__PURE__ */ jsx("span", { style: { fontSize: 13, color: "var(--m-ink-2)" }, children: label }),
      /* @__PURE__ */ jsx("span", { style: { fontSize: 15, fontWeight: 600, color: "var(--m-ink)", fontVariantNumeric: "tabular-nums" }, children: val })
    ] }, i)) })
  ] });
}
export {
  CalcPanel as default
};
