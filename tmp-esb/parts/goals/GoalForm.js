import { jsx, jsxs } from "react/jsx-runtime";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import Card from "../../../shared/Card";
import CustomFieldInputs from "../CustomFieldInputs";
const TEMPLATES = {
  emergency_fund: { name: "Emergency Fund", target: "15000", monthly_contribution: "300", template: "emergency_fund" },
  roth_ira: { name: "Roth IRA", target: "7000", monthly_contribution: "500", template: "roth_ira" },
  fire: { name: "FIRE Number", target: "1000000", monthly_contribution: "2000", template: "fire" }
};
function GoalForm({
  showAddForm,
  setShowAddForm,
  editingGoalId,
  formData,
  setFormData,
  handleSaveGoal,
  handleCancel,
  cfSettings,
  accounts
}) {
  if (!showAddForm) {
    return /* @__PURE__ */ jsx("div", { style: { marginBottom: "24px" }, children: /* @__PURE__ */ jsxs(
      "button",
      {
        className: "m-btn m-btn-primary m-btn-sm",
        onClick: () => setShowAddForm(true),
        style: { display: "flex", alignItems: "center", gap: "6px" },
        children: [
          /* @__PURE__ */ jsx(Plus, { size: 16 }),
          "Add goal"
        ]
      }
    ) });
  }
  const applyTemplate = (templateName) => {
    if (TEMPLATES[templateName]) {
      setFormData({ ...formData, ...TEMPLATES[templateName] });
    }
  };
  return /* @__PURE__ */ jsx("div", { style: { marginBottom: "24px" }, children: /* @__PURE__ */ jsx(
    motion.div,
    {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.2 },
      children: /* @__PURE__ */ jsx(Card, { className: "m-card-sm", style: { marginBottom: "16px" }, children: /* @__PURE__ */ jsxs("div", { style: { marginBottom: "16px" }, children: [
        /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", fontWeight: 600, color: "var(--m-ink)", marginBottom: "8px" }, children: editingGoalId ? "Edit Goal" : "New Goal" }),
        !editingGoalId && /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              gap: "8px",
              marginBottom: "12px"
            },
            children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  className: "m-btn m-btn-secondary m-btn-sm",
                  onClick: () => applyTemplate("emergency_fund"),
                  style: { fontSize: "12px" },
                  children: "Emergency Fund"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  className: "m-btn m-btn-secondary m-btn-sm",
                  onClick: () => applyTemplate("roth_ira"),
                  style: { fontSize: "12px" },
                  children: "Roth IRA"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  className: "m-btn m-btn-secondary m-btn-sm",
                  onClick: () => applyTemplate("fire"),
                  style: { fontSize: "12px" },
                  children: "FIRE"
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: "12px" }, children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "text",
              className: "m-input",
              placeholder: "Goal name",
              value: formData.name,
              onChange: (e) => setFormData({ ...formData, name: e.target.value }),
              style: { fontSize: "13px" }
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              className: "m-input",
              placeholder: "Target amount",
              value: formData.target,
              onChange: (e) => setFormData({ ...formData, target: e.target.value }),
              style: { fontSize: "13px" }
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              className: "m-input",
              placeholder: "Current saved",
              value: formData.current,
              onChange: (e) => setFormData({ ...formData, current: e.target.value }),
              style: { fontSize: "13px" }
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "number",
              className: "m-input",
              placeholder: "Monthly contribution",
              value: formData.monthly_contribution,
              onChange: (e) => setFormData({ ...formData, monthly_contribution: e.target.value }),
              style: { fontSize: "13px" }
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "date",
              className: "m-input",
              value: formData.target_date,
              onChange: (e) => setFormData({ ...formData, target_date: e.target.value }),
              style: { fontSize: "13px" }
            }
          ),
          /* @__PURE__ */ jsxs(
            "select",
            {
              className: "m-input",
              value: formData.linked_account_id || "",
              onChange: (e) => setFormData({ ...formData, linked_account_id: e.target.value || null }),
              style: { fontSize: "13px" },
              children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "Track with account (optional)" }),
                accounts?.accounts?.map((acc) => /* @__PURE__ */ jsx("option", { value: acc.id, children: acc.name }, acc.id))
              ]
            }
          ),
          /* @__PURE__ */ jsx(CustomFieldInputs, { entity: "goal", value: formData.custom, onChange: (c) => setFormData({ ...formData, custom: c }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "8px", marginTop: "12px" }, children: [
          /* @__PURE__ */ jsx("button", { className: "m-btn m-btn-primary m-btn-sm", onClick: handleSaveGoal, style: { fontSize: "12px" }, children: "Save" }),
          /* @__PURE__ */ jsx("button", { className: "m-btn m-btn-secondary m-btn-sm", onClick: handleCancel, style: { fontSize: "12px" }, children: "Cancel" })
        ] })
      ] }) })
    }
  ) });
}
export {
  GoalForm as default
};
