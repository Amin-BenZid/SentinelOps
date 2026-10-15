import React, { useState, useEffect, useRef } from 'react';
import { X, Terminal, RotateCw, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';

export interface ContainerOpsModalProps {
  containerName: string | null;
  onClose: () => void;
}

export const ContainerOpsModal: React.FC<ContainerOpsModalProps> = ({ containerName, onClose }) => {
  const [logs, setLogs] = useState<string>('Connecting to Docker daemon...');
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(true);
  const [isRestarting, setIsRestarting] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchLogs = () => {
    if (!containerName) return;
    setIsLoadingLogs(true);
    fetch(`/api/containers/${encodeURIComponent(containerName)}/logs?tail=120`)
      .then((res) => res.json())
      .then((data) => {
        if (data.logs) {
          setLogs(data.logs);
        } else {
          setLogs(data.error || 'No logs recorded for this container.');
        }
      })
      .catch((err) => {
        setLogs(`Failed to stream logs: ${err.message}`);
      })
      .finally(() => {
        setIsLoadingLogs(false);
      });
  };

  useEffect(() => {
    fetchLogs();
  }, [containerName]);

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  if (!containerName) return null;

  const handleRestart = async () => {
    if (!confirm(`Restart container "${containerName}"? This will cause brief service downtime.`)) return;

    setIsRestarting(true);
    setStatusMsg(null);

    try {
      const res = await fetch(`/api/containers/${encodeURIComponent(containerName)}/restart`, {
        method: 'POST'
      });
      const data = await res.json();

      if (res.ok) {
        setStatusMsg({ text: `Container "${containerName}" restarted successfully!`, isError: false });
        setTimeout(() => fetchLogs(), 2000);
      } else {
        setStatusMsg({ text: data.error || 'Restart failed', isError: true });
      }
    } catch (err: any) {
      setStatusMsg({ text: `Network error: ${err.message}`, isError: true });
    } finally {
      setIsRestarting(false);
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
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
      onClick={onClose}
    >
      <div
        className="gh-box"
        style={{
          maxWidth: 820,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          marginBottom: 0
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="gh-box-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={16} color="var(--color-accent-fg)" />
            <span style={{ fontWeight: 600 }}>Container Operations:</span>
            <span className="mono" style={{ color: 'var(--color-accent-fg)', fontWeight: 600 }}>
              {containerName}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleRestart}
              disabled={isRestarting}
              className="gh-btn gh-btn-danger"
              style={{ padding: '3px 10px', fontSize: '0.75rem' }}
            >
              <RotateCw size={13} className={isRestarting ? 'spin' : ''} />
              {isRestarting ? 'Restarting...' : 'Restart Container'}
            </button>

            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-fg-muted)', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {statusMsg && (
          <div
            style={{
              padding: '8px 16px',
              backgroundColor: statusMsg.isError ? 'var(--color-danger-subtle)' : 'var(--color-success-subtle)',
              color: statusMsg.isError ? 'var(--color-danger-fg)' : 'var(--color-success-fg)',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid var(--color-border-default)'
            }}
          >
            {statusMsg.isError ? <AlertTriangle size={15} /> : <Check size={15} />}
            {statusMsg.text}
          </div>
        )}

        {/* Terminal Controls Bar */}
        <div
          style={{
            padding: '6px 12px',
            backgroundColor: 'var(--color-canvas-subtle)',
            borderBottom: '1px solid var(--color-border-default)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.75rem',
            color: 'var(--color-fg-muted)'
          }}
        >
          <span>Live stdout / stderr logs (tail: 120 lines)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={fetchLogs} disabled={isLoadingLogs} className="gh-btn" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
              <RefreshCw size={12} className={isLoadingLogs ? 'spin' : ''} /> Refresh
            </button>
            <button onClick={handleCopyLogs} className="gh-btn" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
              {copied ? <Check size={12} color="var(--color-success-fg)" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy Logs'}
            </button>
          </div>
        </div>

        {/* Terminal Window */}
        <div
          ref={terminalRef}
          className="mono"
          style={{
            backgroundColor: 'var(--color-canvas-inset)',
            color: 'var(--color-fg-default)',
            padding: 14,
            height: '380px',
            overflowY: 'auto',
            fontSize: '0.8rem',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}
        >
          {logs}
        </div>
      </div>
    </div>
  );
};

export default ContainerOpsModal;