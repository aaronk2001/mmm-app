import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import SectionHeader from "../shared/SectionHeader";
import Card from "../shared/Card";
import CustomFieldFilters from "./parts/CustomFieldFilters";
import { api, useApi } from "../../../lib/query";
import { toast } from "../../../lib/toast";
import { confirmDialog } from "../../../lib/confirm";
import { fieldsFor, matchesFilter } from "../../../lib/customFields";
import EmergencyFundWidget from "./parts/goals/EmergencyFundWidget";
import FireWidget from "./parts/goals/FireWidget";
import GoalForm from "./parts/goals/GoalForm";
import GoalList from "./parts/goals/GoalList";
function Goals() {
  const [goals, setGoals] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    target: "",
    current: "",
    monthly_contribution: "",
    target_date: "",
    template: "",
    linked_account_id: null,
    custom: {}
  });
  const [cfFilters, setCfFilters] = useState({});
  const { data: cfSettings } = useApi("settings");
  useEffect(() => {
    async function loadData() {
      try {
        const [goalsData, accountsData, insightsData] = await Promise.all([
          api("money/goals"),
          api("money/accounts"),
          api("money/goals/insights")
        ]);
        setGoals(goalsData);
        setAccounts(accountsData);
        setInsights(insightsData);
      } catch (err) {
        setError(err.message);
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);
  const handleSaveGoal = async () => {
    try {
      const payload = {
        name: formData.name || null,
        target: parseFloat(formData.target) || 0,
        current: parseFloat(formData.current) || 0,
        monthly_contribution: formData.monthly_contribution ? parseFloat(formData.monthly_contribution) : null,
        target_date: formData.target_date || null,
        template: formData.template || null,
        linked_account_id: formData.linked_account_id || null,
        custom: formData.custom || {}
      };
      if (editingGoalId) {
        await api(`money/goals/${editingGoalId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        await api("money/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      const goalsData = await api("money/goals");
      setGoals(goalsData);
      setFormData({ name: "", target: "", current: "", monthly_contribution: "", target_date: "", template: "", linked_account_id: null, custom: {} });
      setShowAddForm(false);
      setEditingGoalId(null);
      toast.success(editingGoalId ? "Goal updated" : "Goal created");
    } catch (err) {
      toast.error(err.message);
    }
  };
  const handleDeleteGoal = async (goalId) => {
    const confirmed = await confirmDialog({
      message: "Delete this goal?",
      confirmLabel: "Delete"
    });
    if (!confirmed) return;
    try {
      await api(`money/goals/${goalId}`, { method: "DELETE" });
      const goalsData = await api("money/goals");
      setGoals(goalsData);
      toast.success("Goal deleted");
    } catch (err) {
      toast.error(err.message);
    }
  };
  const handleEditStart = (goal) => {
    setEditingGoalId(goal.id);
    setFormData({
      name: goal.name || "",
      target: String(goal.target || ""),
      current: String(goal.current || ""),
      monthly_contribution: String(goal.monthly_contribution || ""),
      target_date: goal.target_date || "",
      template: goal.template || "",
      linked_account_id: goal.linked_account_id || null,
      custom: goal.custom || {}
    });
    setShowAddForm(true);
  };
  const handleCancel = () => {
    setShowAddForm(false);
    setEditingGoalId(null);
    setFormData({ name: "", target: "", current: "", monthly_contribution: "", target_date: "", template: "", linked_account_id: null, custom: {} });
  };
  if (loading) {
    return /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx(SectionHeader, { icon: Target, title: "Goals & Savings", subtitle: "Track goals and financial milestones" }),
      /* @__PURE__ */ jsx(Card, { className: "m-card-sm", children: /* @__PURE__ */ jsx("div", { style: { color: "var(--m-ink-2)" }, children: "Loading goals..." }) })
    ] });
  }
  if (error) {
    return /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx(SectionHeader, { icon: Target, title: "Goals & Savings", subtitle: "Track goals and financial milestones" }),
      /* @__PURE__ */ jsxs(Card, { className: "m-card-sm", style: { color: "var(--m-red)" }, children: [
        "Error: ",
        error
      ] })
    ] });
  }
  const goalsList = (goals?.goals || []).filter((g) => fieldsFor(cfSettings, "goal").every((f) => matchesFilter(g, f, cfFilters[f.id])));
  const em = insights?.emergencyFund || null;
  const fr = insights?.fire || null;
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx(SectionHeader, { icon: Target, title: "Goals & Savings", subtitle: "Track goals and financial milestones" }),
    /* @__PURE__ */ jsx(EmergencyFundWidget, { em }),
    /* @__PURE__ */ jsx(FireWidget, { fr }),
    /* @__PURE__ */ jsx(
      GoalForm,
      {
        showAddForm,
        setShowAddForm,
        editingGoalId,
        formData,
        setFormData,
        handleSaveGoal,
        handleCancel,
        cfSettings,
        accounts
      }
    ),
    fieldsFor(cfSettings, "goal").length > 0 && /* @__PURE__ */ jsx(Card, { className: "m-card-sm", style: { marginBottom: "16px" }, children: /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }, children: /* @__PURE__ */ jsx(CustomFieldFilters, { entity: "goal", value: cfFilters, onChange: setCfFilters }) }) }),
    /* @__PURE__ */ jsx(
      GoalList,
      {
        goalsList,
        accounts,
        showAddForm,
        setShowAddForm,
        handleEditStart,
        handleDeleteGoal
      }
    )
  ] });
}
export {
  Goals as default
};
