import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, LayoutDashboard, Sliders, Bell, Edit3, Check, Moon, Sun, LogOut, User } from 'lucide-react';
import { Alert, ServiceHealth, MetricPoint, TimeRange } from './types';
import { HealthMap } from './components/HealthMap';
import { IncidentFeed } from './components/IncidentFeed';
import { AlertDrawer } from './components/AlertDrawer';
import { RulesManager } from './components/RulesManager';
import { SettingsManager } from './components/SettingsManager';
import { CustomizableDashboard } from './components/CustomizableDashboard';
import { ContainerOpsModal } from './components/ContainerOpsModal';
import { Toast, ToastMessage } from './components/Toast';
import { AuthScreen } from './components/AuthScreen';
import { TOKEN_KEY, UNAUTHORIZED_EVENT } from './api';

const RANGES: TimeRange[] = ['15m', '1h', '6h', '24h'];
type Tab = 'overview' | 'rules' | 'settings';

export function App() {
  // ── session ──
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY) || null);
  const [currentUser, setCurrentUser] = useState<{ username: string } | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  useEffect(() => {
    if (!authToken) {
      setAuthChecking(false);
      return;
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data.user && !data.user.must_change_password) {
          setCurrentUser(data.user);
        } else {
          setAuthToken(null);
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => setAuthToken(null))
      .finally(() => setAuthChecking(false));
  }, [authToken]);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setCurrentUser(null);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, clearSession);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, clearSession);
  }, [clearSession]);

  const handleLoginSuccess = (token: string, user: { username: string }) => {
    setAuthToken(token);
    setCurrentUser(user);
    localStorage.setItem(TOKEN_KEY, token);
  };

  const handleLogout = () => {
    if (authToken) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {});
    }
    clearSession();
  };

  // ── UI state ──
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isEditMode, setIsEditMode] = useState(false);
  const [range, setRange] = useState<TimeRange>(() => (localStorage.getItem('sentinelops_range') as TimeRange) || '15m');
  const [containerForOps, setContainerForOps] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('sentinelops_theme') as 'dark' | 'light') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sentinelops_theme', theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem('sentinelops_range', range); }, [range]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000); // keeps "2m ago" labels fresh
    return () => clearInterval(t);
  }, []);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = useCallback((text: string, type: 'success' | 'warning' | 'error' = 'success') => {
    const id = `t_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // ── live data ──
  const [connected, setConnected] = useState(false);
  const [agentStale, setAgentStale] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [availableEntities, setAvailableEntities] = useState<string[]>(['local-host']);
  const [availableMetrics, setAvailableMetrics] = useState<string[]>(['cpu_percent', 'memory_percent', 'disk_percent']);
  const [latestMetricValues, setLatestMetricValues] = useState<Record<string, number>>({});
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAlerts = useCallback(() => {
    fetch('/api/alerts').then((r) => r.json()).then((d) => setAlerts(d.alerts || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!authToken) return;
    refreshAlerts();
    fetch('/api/services').then((r) => r.json()).then((d) => setServices(d.services || [])).catch(() => {});
    fetch('/api/filters')
      .then((r) => r.json())
      .then((d) => {
        if (d.entities?.length) setAvailableEntities(d.entities.map((e: { id: string }) => e.id));
        if (d.metrics?.length) setAvailableMetrics(d.metrics);
      })
      .catch(() => {});
  }, [authToken, refreshAlerts]);

  useEffect(() => {
    if (!authToken) return;
    let ws: WebSocket | null = null;
    let unmounted = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(authToken)}`);
      ws.onopen = () => { if (!unmounted) setConnected(true); };
      ws.onmessage = (event) => {
        try {
          const p = JSON.parse(event.data);
          if (p.type !== 'TICK' && p.type !== 'SNAPSHOT') return;
          if (p.activeAlerts) setAlerts(p.activeAlerts);
          if (p.services) setServices(p.services);
          if (p.agent) setAgentStale(Boolean(p.agent.stale));
          if (p.latestMetrics) {
            // replace (not merge) so series that stopped reporting disappear
            const latest: Record<string, number> = {};
            p.latestMetrics.forEach((m: MetricPoint) => { latest[`${m.entity_id}:${m.metric_name}`] = m.metric_value; });
            setLatestMetricValues(latest);
          }
        } catch (err) { /* ignore malformed frame */ }
      };
      ws.onclose = (ev) => {
        if (ev.code === 4401) { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); return; }
        if (!unmounted) {
          setConnected(false);
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      unmounted = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      ws?.close();
    };
  }, [authToken]);

  const updateAlertStatus = useCallback(async (alert: Alert, status: 'active' | 'acknowledged' | 'resolved') => {
    setBusyAlertId(alert.id);
    try {
      const res = await fetch(`/api/alerts/${alert.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const verb = status === 'acknowledged' ? 'acknowledged'
          : status === 'resolved' ? 'resolved'
          : alert.state === 'resolved' ? 'reopened' : 'unacknowledged';
        showToast(`${alert.rule_name} on ${alert.entity_id} ${verb}`, 'success');
        if (data.alert) setAlerts((prev) => prev.map((a) => (a.id === alert.id ? data.alert : a)));
        refreshAlerts();
      } else {
        showToast(data.error || 'Could not update the alert', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyAlertId(null);
    }
  }, [showToast, refreshAlerts]);

  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) || null;
  const firingCount = alerts.filter((a) => a.state === 'firing').length;
  const containerIds = new Set(services.filter((s) => s.source === 'docker').map((s) => s.id));

  if (authChecking) {
    return <div className="center-screen muted">Checking your session…</div>;
  }
  if (!authToken) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="dashboard-container">
      <header className="app-header">
        <div className="brand">
          <Activity size={22} color="var(--color-accent-fg)" aria-hidden="true" />
          <span className="brand-name">SentinelOps</span>
          <span className="gh-badge badge-neutral">v0.2</span>
        </div>

        <div className="header-right">
          <span className={`status-pill ${connected ? 'ok' : 'bad'}`} title={connected ? 'Receiving live updates' : 'Live connection lost — reconnecting'}>
            <span className="dot" aria-hidden="true" /> {connected ? 'Live' : 'Reconnecting'}
          </span>
          {agentStale && (
            <span className="status-pill bad" title="No heartbeat from the collector agent for 30 s or more">
              <span className="dot" aria-hidden="true" /> Agent offline
            </span>
          )}
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="gh-btn icon-only" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {currentUser && (
            <span className="user-chip"><User size={13} aria-hidden="true" /> {currentUser.username}</span>
          )}
          <button onClick={handleLogout} className="gh-btn icon-only" aria-label="Sign out" title="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <nav className="gh-nav-tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === 'overview'} onClick={() => setActiveTab('overview')} className={`gh-nav-item ${activeTab === 'overview' ? 'active' : ''}`}>
          <LayoutDashboard size={16} /> Overview
          {firingCount > 0 && <span className="gh-counter counter-danger">{firingCount}</span>}
        </button>
        <button role="tab" aria-selected={activeTab === 'rules'} onClick={() => setActiveTab('rules')} className={`gh-nav-item ${activeTab === 'rules' ? 'active' : ''}`}>
          <Sliders size={16} /> Rules
        </button>
        <button role="tab" aria-selected={activeTab === 'settings'} onClick={() => setActiveTab('settings')} className={`gh-nav-item ${activeTab === 'settings' ? 'active' : ''}`}>
          <Bell size={16} /> Settings
        </button>
      </nav>

      {activeTab === 'overview' && (
        <>
          <HealthMap
            services={services}
            latestMetricValues={latestMetricValues}
            now={now}
            onOpenEntity={(id, source) => { if (source === 'docker') setContainerForOps(id); }}
          />

          <div className="overview-grid">
            <div>
              <div className="section-bar">
                <h2 className="section-title">Metrics</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="segmented" role="tablist" aria-label="Time range">
                    {RANGES.map((r) => (
                      <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setIsEditMode(!isEditMode)} className={`gh-btn ${isEditMode ? 'gh-btn-primary' : ''}`}>
                    {isEditMode ? <Check size={14} /> : <Edit3 size={14} />}
                    {isEditMode ? 'Done' : 'Edit layout'}
                  </button>
                </div>
              </div>
              <CustomizableDashboard
                isEditMode={isEditMode}
                availableEntities={availableEntities}
                availableMetrics={availableMetrics}
                latestMetricValues={latestMetricValues}
                range={range}
              />
            </div>

            <IncidentFeed
              key="incidents"
              alerts={alerts}
              now={now}
              selectedId={selectedAlertId}
              busyId={busyAlertId}
              onSelect={(a) => setSelectedAlertId(a.id)}
              onUpdateStatus={updateAlertStatus}
            />
          </div>
        </>
      )}

      {activeTab === 'rules' && <RulesManager />}
      {activeTab === 'settings' && <SettingsManager />}

      <AlertDrawer
        alert={selectedAlert}
        allAlerts={alerts}
        now={now}
        busy={busyAlertId === selectedAlert?.id}
        isContainer={selectedAlert ? containerIds.has(selectedAlert.entity_id) : false}
        onClose={() => setSelectedAlertId(null)}
        onUpdateStatus={updateAlertStatus}
        onOpenContainer={(id) => setContainerForOps(id)}
        onToast={showToast}
      />

      <ContainerOpsModal containerName={containerForOps} onClose={() => setContainerForOps(null)} />

      <Toast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

export default App;
