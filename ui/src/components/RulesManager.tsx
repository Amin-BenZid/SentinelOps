import React, { useState, useEffect } from 'react';
import { Sliders, Plus, Trash2, CheckCircle2, XCircle, Pencil, X, Save, AlertTriangle } from 'lucide-react';
import { MonitoringRule } from '../types';

export const RulesManager: React.FC = () => {
  const [rules, setRules] = useState<MonitoringRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<MonitoringRule | null>(null);

  const defaultFormState: Partial<MonitoringRule> = {
    id: '',
    metric_name: 'cpu_percent',
    operator: '>',
    threshold: 80,
    severity: 'warning',
    summary_template: 'Resource threshold exceeded'
  };

  const [form, setForm] = useState<Partial<MonitoringRule>>(defaultFormState);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const fetchRules = () => {
    fetch('/api/rules')
      .then((res) => res.json())
      .then((data) => {
        if (data.rules) setRules(data.rules);
      })
      .catch((err) => console.error('Failed to load rules:', err));
  };

  useEffect(() => {
    fetchRules();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ruleToDelete) setRuleToDelete(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ruleToDelete]);

  const handleStartEdit = (rule: MonitoringRule) => {
    setEditingId(rule.id);
    setForm({
      id: rule.id,
      metric_name: rule.metric_name,
      operator: rule.operator,
      threshold: rule.threshold,
      duration_seconds: rule.duration_seconds,
      severity: rule.severity,
      summary_template: rule.summary_template
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm(defaultFormState);
    setMsg(null);
  };

  // ── OPTIMISTIC SAVE & UPDATE ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id || !form.metric_name || form.threshold === undefined) return;

    const isEdit = Boolean(editingId);
    const savedRule: MonitoringRule = {
      id: String(form.id).trim(),
      metric_name: form.metric_name,
      operator: form.operator || '>',
      threshold: Number(form.threshold),
      duration_seconds: Number(form.duration_seconds || 60),
      severity: form.severity || 'warning',
      summary_template: form.summary_template || 'Threshold breach',
      is_active: 1
    };

    // Instant optimistic UI update
    setRules((prev) => {
      if (isEdit) {
        return prev.map((r) => (r.id === editingId ? savedRule : r));
      }
      return [savedRule, ...prev.filter((r) => r.id !== savedRule.id)];
    });

    handleCancelEdit();
    setMsg({ text: isEdit ? `Rule "${savedRule.id}" updated!` : `Rule "${savedRule.id}" created!`, isError: false });
    setTimeout(() => setMsg(null), 3000);

    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedRule)
      });
      if (!res.ok) {
        fetchRules();
      }
    } catch (err) {
      fetchRules();
    }
  };

  // ── OPTIMISTIC TOGGLE (0ms) ──
  const toggleRule = async (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_active: r.is_active ? 0 : 1 } : r))
    );
    await fetch(`/api/rules/${id}/toggle`, { method: 'PATCH' });
  };

// ── 0ms INSTANT OPTIMISTIC DELETE WITH URL-ENCODING ──
  const handleConfirmDelete = async () => {
    if (!ruleToDelete) return;
    const targetId = ruleToDelete.id;

    // 1. Instant 0ms optimistic removal
    setRules((prev) => prev.filter((r) => r.id !== targetId));
    setRuleToDelete(null);
    if (editingId === targetId) handleCancelEdit();

    setMsg({ text: `Rule "${targetId}" removed immediately.`, isError: false });
    setTimeout(() => setMsg(null), 2500);

    // 2. Perform backend deletion with URL encoding (handles spaces like "memory test")
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      if (!res.ok) {
        fetchRules();
        setMsg({ text: 'Failed to delete on server', isError: true });
      }
    } catch (err: any) {
      fetchRules();
      setMsg({ text: `Network error: ${err.message}`, isError: true });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Form Box */}
      <div className="gh-box">
        <div className="gh-box-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {editingId ? <Pencil size={16} color="var(--color-attention-fg)" /> : <Plus size={16} color="var(--color-accent-fg)" />}
            {editingId ? `Editing Rule: ${editingId}` : 'Create Rule Definition'}
          </span>
          {editingId && (
            <button onClick={handleCancelEdit} className="gh-btn" style={{ padding: '2px 8px' }}>
              <X size={12} /> Cancel
            </button>
          )}
        </div>

        <div className="gh-box-body">
          {msg && (
            <div style={{ color: msg.isError ? 'var(--color-danger-fg)' : 'var(--color-success-fg)', marginBottom: 12, fontWeight: 600, fontSize: '0.875rem' }}>
              {msg.text}
            </div>
          )}

          <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Rule ID {editingId && '(Locked)'}</label>
              <input
                type="text"
                required
                disabled={Boolean(editingId)}
                placeholder="e.g. host_cpu_critical"
                value={form.id || ''}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                className="gh-input mono"
                style={{ width: '100%', marginTop: 4, opacity: editingId ? 0.7 : 1 }}
              />
            </div>

            <div>
              <label style={labelStyle}>Telemetry Metric</label>
              <select
                value={form.metric_name || 'cpu_percent'}
                onChange={(e) => setForm({ ...form, metric_name: e.target.value })}
                className="gh-select"
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="cpu_percent">cpu_percent (Host CPU)</option>
                <option value="memory_percent">memory_percent (Host RAM)</option>
                <option value="disk_percent">disk_percent (Host Disk)</option>
                <option value="docker_memory_percent">docker_memory_percent (Container)</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Threshold Condition</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <select
                  value={form.operator || '>'}
                  onChange={(e) => setForm({ ...form, operator: e.target.value })}
                  className="gh-select"
                  style={{ width: 60 }}
                >
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value=">=">&gt;=</option>
                  <option value="<=">&lt;=</option>
                </select>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="85"
                  value={form.threshold ?? ''}
                  onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                  className="gh-input mono"
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Severity</label>
              <select
                value={form.severity || 'warning'}
                onChange={(e) => setForm({ ...form, severity: e.target.value as any })}
                className="gh-select"
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Alert Summary Text</label>
              <input
                type="text"
                placeholder="e.g. CPU load breached safety envelope"
                value={form.summary_template || ''}
                onChange={(e) => setForm({ ...form, summary_template: e.target.value })}
                className="gh-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="gh-btn gh-btn-primary">
                <Save size={14} /> {editingId ? 'Update Rule' : 'Save Rule'}
              </button>
              {editingId && (
                <button type="button" onClick={handleCancelEdit} className="gh-btn">
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Rules Table */}
      <div className="gh-box">
        <div className="gh-box-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sliders size={16} /> Active Protection & Monitoring Rules
          </span>
          <span className="gh-counter">{rules.length}</span>
        </div>

        {rules.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-fg-muted)' }}>
            No threshold rules configured.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-default)', color: 'var(--color-fg-muted)', backgroundColor: 'var(--color-canvas-subtle)' }}>
                  <th style={{ padding: '8px 14px' }}>Active</th>
                  <th style={{ padding: '8px 14px' }}>Rule ID</th>
                  <th style={{ padding: '8px 14px' }}>Metric</th>
                  <th style={{ padding: '8px 14px' }}>Condition</th>
                  <th style={{ padding: '8px 14px' }}>Severity</th>
                  <th style={{ padding: '8px 14px' }}>Summary</th>
                  <th style={{ padding: '8px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid var(--color-border-muted)',
                      backgroundColor: editingId === r.id ? 'var(--color-accent-subtle)' : 'transparent'
                    }}
                  >
                    <td style={{ padding: '8px 14px' }}>
                      <button onClick={() => toggleRule(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        {r.is_active ? <CheckCircle2 size={16} color="var(--color-success-fg)" /> : <XCircle size={16} color="var(--color-fg-subtle)" />}
                      </button>
                    </td>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }} className="mono">{r.id}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--color-accent-fg)' }} className="mono">{r.metric_name}</td>
                    <td style={{ padding: '8px 14px' }} className="mono">{r.operator} {r.threshold}</td>
                    <td style={{ padding: '8px 14px' }}>
                      <span className={`gh-badge ${r.severity === 'critical' ? 'gh-badge-danger' : 'gh-badge-attention'}`}>
                        {r.severity}
                      </span>
                    </td>
                    <td style={{ padding: '8px 14px', color: 'var(--color-fg-muted)' }}>{r.summary_template}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => handleStartEdit(r)} className="gh-btn" style={{ padding: '2px 8px' }}>
                          <Pencil size={12} /> Edit
                        </button>
                        <button onClick={() => setRuleToDelete(r)} className="gh-btn gh-btn-danger" style={{ padding: '2px 8px' }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {ruleToDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16
          }}
          onClick={() => setRuleToDelete(null)}
        >
          <div className="gh-box" style={{ maxWidth: 460, width: '100%', border: '1px solid var(--color-danger-emphasis)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div className="gh-box-header" style={{ color: 'var(--color-danger-fg)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} /> Delete Rule Confirmation
              </span>
            </div>
            <div className="gh-box-body">
              <p style={{ fontSize: '0.875rem', marginBottom: 16 }}>
                Are you sure you want to delete rule <strong className="mono" style={{ color: 'var(--color-danger-fg)' }}>{ruleToDelete.id}</strong>? All associated alerts will be automatically resolved.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setRuleToDelete(null)} className="gh-btn">
                  Cancel
                </button>
                <button type="button" onClick={handleConfirmDelete} className="gh-btn gh-btn-danger">
                  <Trash2 size={13} /> Delete Rule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-fg-muted)',
  fontWeight: 600
};