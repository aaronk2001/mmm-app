import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import Card from '../../../shared/Card';
import CustomFieldInputs from '../CustomFieldInputs';
import { api } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';

export default function AccountForm({ showAddForm, setShowAddForm, onAccountAdded, cfSettings }) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'cash',
    balance: '',
    institution: '',
    status: 'active',
    custom: {},
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleAddAccount(e) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);

    try {
      const payload = {
        name: formData.name,
        type: formData.type,
        balance: parseFloat(formData.balance),
        institution: formData.institution || undefined,
        status: formData.status,
        custom: formData.custom || {},
      };

      await api('money/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setFormData({
        name: '',
        type: 'cash',
        balance: '',
        institution: '',
        status: 'active',
        custom: {},
      });
      setShowAddForm(false);
      onAccountAdded();
      toast.success('Account created');
    } catch (err) {
      setFormError(err.message);
      toast.error(`Create failed: ${err.message}`);
    } finally {
      setFormLoading(false);
    }
  }

  if (!showAddForm) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ marginBottom: '24px' }}
      >
        <button
          className="m-btn m-btn-primary"
          onClick={() => setShowAddForm(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Plus size={16} /> Add Account
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{ marginBottom: '24px' }}
    >
      <Card>
        <form onSubmit={handleAddAccount} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', margin: 0 }}>New Account</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <label className="m-input-label">Account Name *</label>
              <input
                type="text"
                className="m-input"
                placeholder="e.g. Chase Checking"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="m-input-label">Type *</label>
              <select
                className="m-input"
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value })}
                style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
              >
                <optgroup label="Assets">
                  <option value="cash">Cash & Checking</option>
                  <option value="brokerage">Brokerage</option>
                  <option value="retirement">Retirement</option>
                  <option value="crypto">Cryptocurrency</option>
                  <option value="real_estate">Real Estate</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="other">Other</option>
                </optgroup>
                <optgroup label="Liabilities">
                  <option value="credit">Credit Card</option>
                  <option value="loan">Loan</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className="m-input-label">Balance ($) *</label>
              <input
                type="number"
                step="0.01"
                className="m-input"
                placeholder="0.00"
                value={formData.balance}
                onChange={e => setFormData({ ...formData, balance: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="m-input-label">Institution (optional)</label>
              <input
                type="text"
                className="m-input"
                placeholder="e.g. Chase Bank"
                value={formData.institution}
                onChange={e => setFormData({ ...formData, institution: e.target.value })}
              />
            </div>
            <CustomFieldInputs entity="account" value={formData.custom} onChange={(c) => setFormData({ ...formData, custom: c })} />
          </div>

          {formError && (
            <div style={{ padding: '12px', background: 'rgba(220, 38, 38, 0.05)', borderRadius: '8px', color: 'var(--m-red)', fontSize: '14px' }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="submit" className="m-btn m-btn-primary" disabled={formLoading}>
              {formLoading ? 'Creating...' : 'Create Account'}
            </button>
            <button
              type="button"
              className="m-btn m-btn-secondary"
              onClick={() => setShowAddForm(false)}
              disabled={formLoading}
            >
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </motion.div>
  );
}
