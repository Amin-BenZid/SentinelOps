import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error';
  text: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 380,
        width: '100%'
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="gh-box"
          style={{
            marginBottom: 0,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            backgroundColor: 'var(--color-canvas-subtle)',
            borderColor:
              t.type === 'success'
                ? 'var(--color-success-fg)'
                : t.type === 'error'
                ? 'var(--color-danger-fg)'
                : 'var(--color-attention-fg)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t.type === 'success' && <CheckCircle2 size={16} color="var(--color-success-fg)" />}
            {t.type === 'error' && <XCircle size={16} color="var(--color-danger-fg)" />}
            {t.type === 'warning' && <AlertTriangle size={16} color="var(--color-attention-fg)" />}
            <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-fg-default)' }}>
              {t.text}
            </span>
          </div>

          <button
            onClick={() => onDismiss(t.id)}
            style={{ background: 'none', border: 'none', color: 'var(--color-fg-muted)', cursor: 'pointer' }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};