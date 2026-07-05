import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import Card from '../../../shared/Card';
import CustomFieldInputs from '../CustomFieldInputs';

const TEMPLATES = {
  emergency_fund: { name: 'Emergency Fund', target: '15000', monthly_contribution: '300', template: 'emergency_fund' },
  roth_ira: { name: 'Roth IRA', target: '7000', monthly_contribution: '500', template: 'roth_ira' },
  fire: { name: 'FIRE Number', target: '1000000', monthly_contribution: '2000', template: 'fire' },
};

export default function GoalForm({
  showAddForm,
  setShowAddForm,
  editingGoalId,
  formData,
  setFormData,
  handleSaveGoal,
  handleCancel,
  cfSettings,
}) {
  if (!showAddForm) {
    return (
      <div style={{ marginBottom: '24px' }}>
        <button
          className="m-btn m-btn-primary m-btn-sm"
          onClick={() => setShowAddForm(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Plus size={16} />
          Add goal
        </button>
      </div>
    );
  }

  const applyTemplate = (templateName) => {
    if (TEMPLATES[templateName]) {
      setFormData({ ...formData, ...TEMPLATES[templateName] });
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="m-card-sm" style={{ marginBottom: '16px' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '8px' }}>
              {editingGoalId ? 'Edit Goal' : 'New Goal'}
            </div>

            {!editingGoalId && (
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <button
                  className="m-btn m-btn-secondary m-btn-sm"
                  onClick={() => applyTemplate('emergency_fund')}
                  style={{ fontSize: '12px' }}
                >
                  Emergency Fund
                </button>
                <button
                  className="m-btn m-btn-secondary m-btn-sm"
                  onClick={() => applyTemplate('roth_ira')}
                  style={{ fontSize: '12px' }}
                >
                  Roth IRA
                </button>
                <button
                  className="m-btn m-btn-secondary m-btn-sm"
                  onClick={() => applyTemplate('fire')}
                  style={{ fontSize: '12px' }}
                >
                  FIRE
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gap: '12px' }}>
              <input
                type="text"
                className="m-input"
                placeholder="Goal name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={{ fontSize: '13px' }}
              />
              <input
                type="number"
                className="m-input"
                placeholder="Target amount"
                value={formData.target}
                onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                style={{ fontSize: '13px' }}
              />
              <input
                type="number"
                className="m-input"
                placeholder="Current saved"
                value={formData.current}
                onChange={(e) => setFormData({ ...formData, current: e.target.value })}
                style={{ fontSize: '13px' }}
              />
              <input
                type="number"
                className="m-input"
                placeholder="Monthly contribution"
                value={formData.monthly_contribution}
                onChange={(e) => setFormData({ ...formData, monthly_contribution: e.target.value })}
                style={{ fontSize: '13px' }}
              />
              <input
                type="date"
                className="m-input"
                value={formData.target_date}
                onChange={(e) => setFormData({ ...formData, target_date: e.target.value })}
                style={{ fontSize: '13px' }}
              />
              <CustomFieldInputs entity="goal" value={formData.custom} onChange={(c) => setFormData({ ...formData, custom: c })} />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="m-btn m-btn-primary m-btn-sm" onClick={handleSaveGoal} style={{ fontSize: '12px' }}>
                Save
              </button>
              <button className="m-btn m-btn-secondary m-btn-sm" onClick={handleCancel} style={{ fontSize: '12px' }}>
                Cancel
              </button>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
