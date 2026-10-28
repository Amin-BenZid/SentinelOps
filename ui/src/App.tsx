import { useState, useEffect, useRef } from 'react';
import { 
  Activity, Radio, LayoutDashboard, Sliders, Settings, 
  Edit3, Check, Moon, Sun, GitBranch, LogOut, User
} from 'lucide-react';
import { Alert, ServiceHealth, MetricPoint } from './types';
import { HealthMap } from './components/HealthMap';
import { AlertFeed } from './components/AlertFeed';
import { RulesManager } from './components/RulesManager';
import { SettingsManager } from './components/SettingsManager';
import { CustomizableDashboard } from './components/CustomizableDashboard';
import { ContainerOpsModal } from './components/ContainerOpsModal';
import { Toast, ToastMessage } from './components/Toast';
import { AuthScreen } from './components/AuthScreen';
import { TOKEN_KEY, UNAUTHORIZED_EVENT } from './api';

export function App() {
  // ── AUTHENTICATION STATE (GRAFANA PATTERN) ──
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY) || null;
  });
  const [currentUser, setCurrentUser] = useState<{ username: string } | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Verify session on app boot
  useEffect(() => {
    if (!authToken) {
      setAuthChecking(false);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.user && !data.user.must_change_password) {
          setCurrentUser(data.user);
        } else {
          // Token expired or invalid
          setAuthToken(null);
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => {
        setAuthToken(null);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, [authToken]);

  const handleLoginSuccess = (token: string, user: { username: string }) => {
    setAuthToken(token);
    setCurrentUser(user);
    localStorage.setItem(TOKEN_KEY, token);
  };

  const handleLogout = () => {
    if (authToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      }).catch(() => {});
    }
    setAuthToken(null);
    setCurrentUser(null);
    localStorage.removeItem(TOKEN_KEY);
  };

  // Any 401 from the API (expired/revoked session) -> back to the login screen
  useEffect(() => {
    const onUnauthorized = () => {
      setAuthToken(null);
      setCurrentUser(null);
      localStorage.removeItem(TOKEN_KEY);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const [agentStale, setAgentStale] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'rules' | 'settings'>('dashboard');
  const [connected, setConnected] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedContainerForOps, setSelectedContainerForOps] = useState<string | null>(null);

  // GitHub Theme Switcher
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('sentinelops_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sentinelops_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Toast Notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = (text: string, type: 'success' | 'warning' | 'error' = 'success') => {
    const id = `t_${Date.now()}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [availableEntities, setAvailableEntities] = useState<string[]>(['local-host']);
  const [availableMetrics, setAvailableMetrics] = useState<string[]>(['cpu_percent', 'memory_percent', 'disk_percent']);
  const [latestMetricValues, setLatestMetricValues] = useState<Record<string, number>>({});

  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = () => {
    fetch('/api/services')
      .then((res) => res.json())
      .then((data) => setServices(data.services || []))
      .catch(() => {});

    fetch('/api/alerts')
      .then((res) => res.json())
      .then((data) => setAlerts(data.alerts || []))
      .catch(() => {});

    fetch('/api/filters')
      .then((res) => res.json())
      .then((data) => {
        if (data.entities && data.entities.length > 0) {
          setAvailableEntities(data.entities.map((e: any) => e.id));
        }
        if (data.metrics && data.metrics.length > 0) {
          setAvailableMetrics(data.metrics);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (authToken) fetchData();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    let ws: WebSocket | null = null;
    let isUnmounted = false;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // token in the query string: browsers cannot set headers on a WebSocket
      ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(authToken)}`);

      ws.onopen = () => {
        if (!isUnmounted) setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'TICK' || payload.type === 'SNAPSHOT') {
            if (payload.activeAlerts) setAlerts(payload.activeAlerts);
            if (payload.agent) setAgentStale(Boolean(payload.agent.stale));

            if (payload.latestMetrics) {
              const latestMap: Record<string, number> = {};
              payload.latestMetrics.forEach((m: MetricPoint) => {
                latestMap[`${m.entity_id}:${m.metric_name}`] = m.metric_value;
              });
              setLatestMetricValues((prev) => ({ ...prev, ...latestMap }));
            }
          }
        } catch (err) {}
      };

      ws.onclose = (ev) => {
        if (ev.code === 4401) {
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
          return;
        }
        if (!isUnmounted) {
          setConnected(false);
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = () => {
        if (ws) ws.close();
      };
    };

    connectWebSocket();

    return () => {
      isUnmounted = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (ws) ws.close();
    };
  }, [authToken]);

  // Loading state
  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-canvas-default)', color: 'var(--color-fg-muted)' }}>
        Authenticating session...
      </div>
    );
  }

  // If unauthenticated: render Login / Change Credentials Screen
  if (!authToken) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="dashboard-container">
      {/* ── GITHUB TOP BAR ── */}
      <header className="gh-header">
        <div className="gh-breadcrumb">
          <Activity size={22} color={theme === 'dark' ? '#f0883e' : '#0969da'} />
          <span style={{ color: 'var(--color-fg-muted)' }}>sentinelops</span>
          <span className="slash">/</span>
          <span style={{ color: 'var(--color-fg-default)' }}>core-observability</span>
          <span className="gh-badge" style={{ backgroundColor: 'var(--color-canvas-subtle)', border: '1px solid var(--color-border-default)', fontSize: '0.7rem' }}>
            <GitBranch size={12} /> v0.2
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* User badge */}
          {currentUser && (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-fg-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <User size={13} /> {currentUser.username}
            </span>
          )}

          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            className="gh-btn"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? <Sun size={15} color="#d29922" /> : <Moon size={15} color="#656d76" />}
            <span style={{ textTransform: 'capitalize' }}>{theme}</span>
          </button>

          {/* Edit Mode Toggle */}
          {activeTab === 'dashboard' && (
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`gh-btn ${isEditMode ? 'gh-btn-primary' : ''}`}
            >
              {isEditMode ? <Check size={14} /> : <Edit3 size={14} />}
              {isEditMode ? 'Done' : 'Customize Layout'}
            </button>
          )}

          {/* Agent heartbeat */}
          {agentStale && (
            <span className="gh-badge gh-badge-danger" title="No heartbeat from the collector agent for 30s+">
              AGENT OFFLINE
            </span>
          )}

          {/* Live WS Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Radio size={13} color={connected ? 'var(--color-success-fg)' : 'var(--color-danger-fg)'} />
            <span className={`gh-badge ${connected ? 'gh-badge-success' : 'gh-badge-danger'}`}>
              {connected ? 'LIVE WS' : 'OFFLINE'}
            </span>
          </div>

          {/* Sign Out Button */}
          <button
            onClick={handleLogout}
            className="gh-btn gh-btn-danger"
            title="Sign out of SentinelOps"
            style={{ padding: '4px 8px' }}
          >
            <LogOut size={13} />
          </button>
        </div>
      </header>

      {/* ── GITHUB UNDERLINENAV TABS ── */}
      <nav className="gh-nav-tabs">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`gh-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <LayoutDashboard size={16} /> Overview
        </button>

        <button
          onClick={() => setActiveTab('rules')}
          className={`gh-nav-item ${activeTab === 'rules' ? 'active' : ''}`}
        >
          <Sliders size={16} /> Rules Engine
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`gh-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
        >
          <Settings size={16} /> Notifications & Integrations
        </button>
      </nav>

      {/* ── TAB 1: OVERVIEW ── */}
      {activeTab === 'dashboard' && (
        <>
          <HealthMap 
            services={services} 
            onOpenTerminal={(id) => setSelectedContainerForOps(id)}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
            <div>
              <CustomizableDashboard
                isEditMode={isEditMode}
                availableEntities={availableEntities}
                availableMetrics={availableMetrics}
                latestMetricValues={latestMetricValues}
                theme={theme}
              />
            </div>

            <div>
              <AlertFeed 
                alerts={alerts} 
                onRefreshAlerts={fetchData}
                onOpenTerminal={(id) => setSelectedContainerForOps(id)}
                onShowToast={showToast}
              />
            </div>
          </div>
        </>
      )}

      {/* ── TAB 2: RULES ENGINE ── */}
      {activeTab === 'rules' && <RulesManager />}

      {/* ── TAB 3: SETTINGS ── */}
      {activeTab === 'settings' && <SettingsManager />}

      {/* ── GLOBAL OPS TERMINAL MODAL ── */}
      <ContainerOpsModal
        containerName={selectedContainerForOps}
        onClose={() => setSelectedContainerForOps(null)}
      />

      {/* ── GLOBAL TOAST BANNER (DRY) ── */}
      <Toast 
        toasts={toasts} 
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} 
      />
    </div>
  );
}

export default App;