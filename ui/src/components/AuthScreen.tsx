import React, { useState } from 'react';
import { Activity, ShieldCheck, KeyRound, ArrowRight, Lock, User, AlertCircle } from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (token: string, user: { username: string; must_change_password: boolean }) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const [step, setStep] = useState<'login' | 'force_change'>('login');
  
  // Login fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // Force change fields
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [authToken, setAuthToken] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 1. Initial Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Invalid credentials');
        return;
      }

      setAuthToken(data.token);

      // If user must change credentials (first login with the generated password)
      if (data.user.must_change_password) {
        setStep('force_change');
        setNewUsername(data.user.username);
      } else {
        onLoginSuccess(data.token, data.user);
      }
    } catch (err: any) {
      setErrorMsg(`Network error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Force Change Credentials (Grafana Flow)
  const handleChangeCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/change-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          new_username: newUsername,
          new_password: newPassword
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to update credentials');
        return;
      }

      onLoginSuccess(authToken, { username: newUsername, must_change_password: false });
    } catch (err: any) {
      setErrorMsg(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: 'var(--color-canvas-default)'
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: 'var(--color-canvas-subtle)',
            border: '1px solid var(--color-border-default)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12
          }}
        >
          <Activity size={26} color="var(--color-accent-fg)" />
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--color-fg-default)', margin: 0 }}>
          {step === 'login' ? 'Sign in to SentinelOps' : 'Set Up New Credentials'}
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)', marginTop: 4 }}>
          {step === 'login' ? 'Unified Observability & Alert Correlation' : 'First-time setup: configure your custom administrator password'}
        </p>
      </div>

      <div
        className="gh-box"
        style={{
          width: '100%',
          maxWidth: 360,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          padding: 20
        }}
      >
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--color-danger-subtle)',
              border: '1px solid var(--color-danger-fg)',
              borderRadius: 6,
              color: 'var(--color-danger-fg)',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16
            }}
          >
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {step === 'login' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Username</label>
              <div style={{ position: 'relative', marginTop: 4 }}>
                <User size={14} color="var(--color-fg-muted)" style={{ position: 'absolute', left: 10, top: 10 }} />
                <input
                  type="text"
                  required
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="gh-input"
                  style={{ width: '100%', paddingLeft: 32 }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative', marginTop: 4 }}>
                <Lock size={14} color="var(--color-fg-muted)" style={{ position: 'absolute', left: 10, top: 10 }} />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="gh-input"
                  style={{ width: '100%', paddingLeft: 32 }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="gh-btn gh-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '8px 16px', marginTop: 4 }}
            >
              <span>{isLoading ? 'Verifying...' : 'Sign in'}</span>
              <ArrowRight size={14} />
            </button>

            <div
              style={{
                marginTop: 12,
                padding: '8px 10px',
                backgroundColor: 'var(--color-canvas-subtle)',
                border: '1px dashed var(--color-border-default)',
                borderRadius: 6,
                fontSize: '0.75rem',
                color: 'var(--color-fg-muted)',
                textAlign: 'center'
              }}
            >
              First boot: user <strong className="mono">admin</strong>, password printed once in the dashboard logs
              (<span className="mono">docker compose logs dashboard</span>) or set via <span className="mono">ADMIN_PASSWORD</span>
            </div>
          </form>
        ) : (
          <form onSubmit={handleChangeCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                padding: '8px 10px',
                backgroundColor: 'var(--color-accent-subtle)',
                borderRadius: 6,
                fontSize: '0.75rem',
                color: 'var(--color-accent-fg)',
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <ShieldCheck size={16} />
              <span>Default password must be updated before accessing telemetry.</span>
            </div>

            <div>
              <label style={labelStyle}>New Username</label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="gh-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <div>
              <label style={labelStyle}>New Secure Password</label>
              <input
                type="password"
                required
                placeholder="Min 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="gh-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <div>
              <label style={labelStyle}>Confirm New Password</label>
              <input
                type="password"
                required
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="gh-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="gh-btn gh-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '8px 16px', marginTop: 4 }}
            >
              <KeyRound size={14} />
              <span>{isLoading ? 'Saving...' : 'Save & Enter Dashboard'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-fg-muted)',
  fontWeight: 600
};