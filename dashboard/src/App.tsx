import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import { Search, Sun, Moon, AreaChart as AreaIcon, LineChart as LineIcon, BarChart3, X, AlertTriangle, Lock, LogOut, Users, Crown, CheckCircle2, TrendingUp, Wrench, Grid3x3, Download, ChevronDown } from 'lucide-react';

//loaded from main.py for dashboard metrics view
interface DashboardMetrics {
  total_errors_24h: number;
  fix_adoption_rate: number;
  total_logs_ingested: number;
  total_fixes_applied: number;
}

//loaded from main.py for dashboard chart view
interface ChartData {
  time: string;
  errors: number;
  previousErrors?: number; // same hour, previous day — used for trend comparison
}

// Raw shape we tolerate from the backend before normalizing — field names/format
// may vary (e.g. "05:00" vs "5:00 AM"), so we parse defensively.
interface RawTrendPoint {
  time: string;
  errors: number;
  previousErrors?: number;
}

const BUSINESS_HOURS_24 = Array.from({ length: 10 }, (_, i) => i + 10); // 10..19 (10AM-7PM)

const formatHourLabel = (hour24: number): string => {
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12} ${period}`;
};

// Accepts "05:00", "17:00", "5:00 PM", etc. Returns 24h hour, or null if unparseable.
const parseHour24 = (timeStr: string): number | null => {
  if (!timeStr) return null;
  const ampmMatch = timeStr.match(/(\d{1,2})(?::\d{2})?\s*([AaPp][Mm])/);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10) % 12;
    if (ampmMatch[2].toLowerCase() === 'pm') hour += 12;
    return hour;
  }
  const h24Match = timeStr.match(/^(\d{1,2}):/);
  if (h24Match) return parseInt(h24Match[1], 10);
  return null;
};

// Always returns a fixed 10AM-7PM hourly grid so the chart title never lies about
// what's plotted, regardless of the time range/format the backend actually sends.
// If the backend doesn't supply a previousErrors value for an hour, that hour's
// previousErrors stays undefined — we never fabricate comparison data.
const normalizeChartData = (rawData: RawTrendPoint[]): ChartData[] => {
  const byHour: Record<number, { errors: number; previousErrors?: number }> = {};

  rawData.forEach((point) => {
    const hour = parseHour24(point.time);
    if (hour === null || hour < 10 || hour > 19) return;
    const bucket = byHour[hour] || { errors: 0 };
    bucket.errors += Number(point.errors) || 0;
    if (point.previousErrors !== undefined && point.previousErrors !== null) {
      bucket.previousErrors = (bucket.previousErrors || 0) + Number(point.previousErrors);
    }
    byHour[hour] = bucket;
  });

  return BUSINESS_HOURS_24.map((hour) => {
    const bucket = byHour[hour];
    return {
      time: formatHourLabel(hour),
      errors: bucket ? bucket.errors : 0,
      previousErrors: bucket?.previousErrors,
    };
  });
};

//loaded from main.py for dashboard error feed view
interface ErrorLog {
  id: number;
  error_message: string;
  stack_trace: string;
  ai_suggestion: string | null;
  file_path: string;
  tag: string;
  timestamp: string;
  // Added to track the developer name who applied the fix (Author Sanjay)
  developer_name?: string;
}

//loaded from main.py for dashboard leaderboard view
interface DeveloperStat {
  name: string;// Shape of one row in the "Team Telemetry" leaderboard.
  total: number;// total    = how many errors this developer has logged overall
  autoFixed: number;// autoFixed = how many of those were resolved by the autonomous auto-heal loop
  manual: number;// manual    = how many required a human to click "Apply Fix"
}

export default function App() {
  // --- SECURITY STATE ---
  const [token, setToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // --- DASHBOARD STATE ---
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('dark_mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  // Sync the toggle onto <html> itself (not just this component's wrapper div) and persist it.
  // Without this, the app's own div renders dark/light correctly, but the actual page
  // background (controlled separately in index.css) stays tied to the OS setting —
  // causing a visible seam wherever the div doesn't fully cover the document.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('dark_mode', String(isDarkMode));
  }, [isDarkMode]);

  // Developer tracking is now a live toggle (persisted) instead of a hardcoded build flag
  const [showDeveloperTracking, setShowDeveloperTracking] = useState<boolean>(
    () => localStorage.getItem('show_developer_tracking') === 'true'
  );
  const toggleDeveloperTracking = () => {
    setShowDeveloperTracking(prev => {
      const next = !prev;
      localStorage.setItem('show_developer_tracking', String(next));
      return next;
    });
  };
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('area');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'auto_detected' | 'manual_highlight'>('all');
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    total_errors_24h: 0,
    fix_adoption_rate: 0.0,
    total_logs_ingested: 0,
    total_fixes_applied: 0
  });

  // Default fallback data so the graph is ALWAYS visible
  const [chartData, setChartData] = useState<ChartData[]>
  ([
    { time: '10 AM', errors: 3, previousErrors: 5 },
    { time: '11 AM', errors: 6, previousErrors: 4 },
    { time: '12 PM', errors: 9, previousErrors: 7 },
    { time: '1 PM', errors: 5, previousErrors: 8 },
    { time: '2 PM', errors: 7, previousErrors: 6 },
    { time: '3 PM', errors: 4, previousErrors: 9 },
    { time: '4 PM', errors: 8, previousErrors: 5 },
    { time: '5 PM', errors: 11, previousErrors: 7 },
    { time: '6 PM', errors: 6, previousErrors: 10 },
    { time: '7 PM', errors: 3, previousErrors: 4 }
  ]);
  const [rawLogs, setRawLogs] = useState<ErrorLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null);

  // --- AUTHENTICATION ENGINE ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const response = await fetch('https://project-ai-75sc.onrender.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('admin_token', data.access_token);
        setToken(data.access_token);
      } else {
        setLoginError('Invalid credentials. Access denied.');
      }
    } catch {
      setLoginError('Server unreachable. Is the FastAPI backend running?');
    }
    setIsLoggingIn(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setToken(null);
  };

  // --- SECURE DATA FETCHING ---
  const fetchData = useCallback(async () => {
    if (!token) return; // Halt if no token

    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    try {
      const metricsRes = await fetch('https://project-ai-75sc.onrender.com/admin/metrics', { headers: authHeaders });
      if (metricsRes.ok) {
        setMetrics(await metricsRes.json());
      } else if (metricsRes.status === 401) {
        handleLogout(); // Auto-logout if token is expired or invalid
      }

      const trendRes = await fetch('https://project-ai-75sc.onrender.com/admin/error-trends', { headers: authHeaders });
      if (trendRes.ok) setChartData(normalizeChartData(await trendRes.json()));

      const logsRes = await fetch('https://project-ai-75sc.onrender.com/logs', { headers: authHeaders });
      if (logsRes.ok) setRawLogs(await logsRes.json());
    } catch (error) {
      console.error("Failed fetching telemetry data:", error);
    }
  }, [token]);

  useEffect(() => {
    // Intentional fetch-on-mount + poll pattern (standard React data-fetching approach).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchData is async; setState only runs after the await resolves, not synchronously in the effect body.
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]); // Re-run when token changes (fetchData is recreated when token changes)

  // True only when the backend actually supplied previous-day values — never fabricated.
  const hasPreviousDayData = useMemo(
    () => chartData.some((point) => point.previousErrors !== undefined),
    [chartData]
  );

  // Filter Engine — narrows rawLogs down to what the search box + tag filter allow
  const filteredLogs = useMemo(() => {
    return rawLogs.filter(log => {
      const matchesSearch = log.file_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.error_message.toLowerCase().includes(searchQuery.toLowerCase());

      // Safely normalize old logs to match the new 'manual_highlight' tag
      const logTag = (log.tag === 'manual' || !log.tag) ? 'manual_highlight' : log.tag;

      const matchesSource = sourceFilter === 'all' || logTag === sourceFilter;
      return matchesSearch && matchesSource;
    });
  }, [searchQuery, sourceFilter, rawLogs]);

  const [showExportMenu, setShowExportMenu] = useState(false);

  // Triggers a browser download for the given text content
  const downloadFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Exports exactly what's currently visible in the Live Error Inspector
  // (respects the active search query + Auto/Manual filter), not the full unfiltered log set.
  const exportAsJSON = () => {
    const payload = filteredLogs.map(({ id, error_message, file_path, tag, timestamp, developer_name }) => ({
      id, error_message, file_path, tag, timestamp, developer_name: developer_name || 'Unknown Developer'
    }));
    downloadFile(`error-logs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    setShowExportMenu(false);
  };

  const csvEscape = (value: string | number): string => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const exportAsCSV = () => {
    const headers = ['id', 'timestamp', 'tag', 'developer_name', 'file_path', 'error_message'];
    const rows = filteredLogs.map((log) => [
      log.id,
      log.timestamp,
      log.tag,
      log.developer_name || 'Unknown Developer',
      log.file_path,
      log.error_message,
    ].map(csvEscape).join(','));
    const csvContent = [headers.join(','), ...rows].join('\n');
    downloadFile(`error-logs-${new Date().toISOString().slice(0, 10)}.csv`, csvContent, 'text/csv');
    setShowExportMenu(false);
  };

//it is used here to show developer stat in dashboard
  const developerStats = useMemo<DeveloperStat[]>(() => {
    const statsByDeveloper: Record<string, DeveloperStat> = {};

    rawLogs.forEach(log => {
      const devName = log.developer_name || "Unknown Developer";

      // First time we've seen this developer — start their row at zero
      if (!statsByDeveloper[devName]) {
        statsByDeveloper[devName] = { name: devName, total: 0, autoFixed: 0, manual: 0 };
      }

      statsByDeveloper[devName].total += 1;

      if (log.tag === 'auto_detected') {
        statsByDeveloper[devName].autoFixed += 1;
      } else {
        statsByDeveloper[devName].manual += 1;
      }
    });

    // Sort so the developer with the most total crashes appears first (rank #1)
    return Object.values(statsByDeveloper).sort((a, b) => b.total - a.total);
  }, [rawLogs]);

  // Backend timestamps are intended to be UTC (see main.py's use of datetime.now(timezone.utc)),
  // but if the serialized string has no trailing "Z"/offset (a naive ISO string), the browser's
  // Date parser silently treats it as LOCAL time instead of UTC — shifting every log by the
  // viewer's timezone offset. This forces UTC interpretation regardless of which shape we get.
  const parseAsUTC = (timestamp: string): Date => {
    const hasTimezoneInfo = /Z$|[+-]\d{2}:?\d{2}$/.test(timestamp);
    return new Date(hasTimezoneInfo ? timestamp : `${timestamp}Z`);
  };

  // Business hours are assumed to be IST (UTC+5:30), matching the backend's
  // /admin/error-trends window and the team's location. Change this offset if wrong.
  const BUSINESS_TZ_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +5:30

  // Shifts a UTC instant so that reading its UTC-labeled fields (hours, calendar day)
  // actually gives you the IST wall-clock hour/day — avoids needing a full timezone library.
  const toBusinessLocal = (utcDate: Date): Date => new Date(utcDate.getTime() + BUSINESS_TZ_OFFSET_MS);

  // Error-volume heatmap: day x business-hour grid, computed client-side from the
  // most recent logs already in memory (no new backend endpoint needed for this).
  // Bucketed in IST to match /admin/error-trends. This reflects VOLUME intensity,
  // not true severity — the data model has no severity field.
  const heatmapData = useMemo(() => {
    const days: string[] = [];
    const todayLocal = toBusinessLocal(new Date());
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.UTC(todayLocal.getUTCFullYear(), todayLocal.getUTCMonth(), todayLocal.getUTCDate() - i));
      days.push(d.toISOString().slice(0, 10)); // "YYYY-MM-DD"
    }

    const grid: Record<string, Record<number, number>> = {};
    days.forEach((day) => {
      grid[day] = {};
      BUSINESS_HOURS_24.forEach((hour) => { grid[day][hour] = 0; });
    });

    rawLogs.forEach((log) => {
      const tsUtc = parseAsUTC(log.timestamp);
      if (isNaN(tsUtc.getTime())) return;
      const tsLocal = toBusinessLocal(tsUtc);
      const dayKey = tsLocal.toISOString().slice(0, 10);
      const hour = tsLocal.getUTCHours();
      if (grid[dayKey] && hour >= 10 && hour <= 19) {
        grid[dayKey][hour] += 1;
      }
    });

    let max = 0;
    days.forEach((day) => BUSINESS_HOURS_24.forEach((hour) => {
      max = Math.max(max, grid[day][hour]);
    }));

    return { days, grid, max };
  }, [rawLogs]);

  const heatmapCellStyle = (count: number, max: number): React.CSSProperties => {
    if (count === 0 || max === 0) return {};
    const intensity = count / max;
    const alpha = 0.25 + intensity * 0.65;
    return { backgroundColor: `rgba(99, 102, 241, ${alpha.toFixed(2)})`, borderColor: 'rgba(99, 102, 241, 0.4)' };
  };

  const formatDayLabel = (isoDate: string): string => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  // ==========================================
  // GATEWAY: THE LOGIN SCREEN OVERLAY
  // ==========================================
  if (!token) {
    return (
      <div className={`min-h-screen w-full flex items-center justify-center relative overflow-hidden ${isDarkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}`}>
        {/* Restrained ambient glow — the only "neon" moment on this screen */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-[120px]" />

        <div className="absolute top-4 right-4">
          <button type="button" onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
            {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-600" />}
          </button>
        </div>

        <div className="relative w-full max-w-md p-8 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4 border border-indigo-500/20 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
              <Lock className="w-6 h-6 text-indigo-500" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-center">System Locked</h1>
            <p className="text-xs text-zinc-500 mt-2 text-center">Authenticate to access the telemetry pipeline</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="text"
                placeholder="Admin Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow text-sm text-zinc-800 dark:text-zinc-200"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Access Protocol (Password)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow text-sm text-zinc-800 dark:text-zinc-200"
                required
              />
            </div>

            {loginError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-500 text-xs">
                <AlertTriangle className="w-4 h-4" />
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-all duration-200 text-sm disabled:opacity-50 hover:shadow-[0_0_20px_rgba(99,102,241,0.35)]"
            >
              {isLoggingIn ? 'Verifying...' : 'Initialize Uplink'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // THE SECURE DASHBOARD
  // ==========================================
  return (
    <div className={`min-h-screen w-full transition-colors duration-200 flex flex-col relative ${isDarkMode ? 'bg-zinc-950 text-zinc-100 dark' : 'bg-zinc-50 text-zinc-900'}`}>

      {/* Global Header */}
      <header className="border-b px-6 py-4 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <h1 className="text-xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">System Overview</h1>
            </div>
            <p className="text-xs text-zinc-500 mt-1">Real-time aggregate error and telemetry data</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleDeveloperTracking}
              title="Toggle Team Telemetry (developer stats)"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-200 ${
                showDeveloperTracking
                  ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                  : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Users className="w-4 h-4" />
              Team Stats: {showDeveloperTracking ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-600" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 hover:bg-rose-500/20 transition-colors text-xs font-semibold"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        </div>

        {/* Signature pulse strip — the one deliberate motif, kept restrained */}
        <svg className="w-full h-4 mt-3 text-indigo-400/50 dark:text-indigo-400/40" viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            className="pulse-line"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points="0,12 340,12 360,4 380,20 400,12 900,12 920,2 940,22 960,12 1200,12"
          />
        </svg>
      </header>

      <main className="flex-1 p-6 space-y-6 max-w-[1600px] w-full mx-auto">

        {/* KPI Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-rose-500/30 hover:shadow-[0_0_24px_rgba(244,63,94,0.12)]">
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-semibold text-zinc-400 tracking-wide uppercase">Errors (24h)</p>
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              </div>
            </div>
            <p className="font-mono text-4xl font-bold mt-3 text-rose-600 dark:text-rose-500 tabular-nums">{metrics.total_errors_24h}</p>
          </div>
          <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-emerald-500/30 hover:shadow-[0_0_24px_rgba(16,185,129,0.12)]">
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-semibold text-zinc-400 tracking-wide uppercase">Fix Adoption Rate</p>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
            <p className="font-mono text-4xl font-bold mt-3 text-zinc-900 dark:text-zinc-100 tabular-nums">{metrics.fix_adoption_rate}%</p>
          </div>
          <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-indigo-500/30 hover:shadow-[0_0_24px_rgba(99,102,241,0.12)]">
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-semibold text-zinc-400 tracking-wide uppercase">Logs Ingested</p>
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-indigo-500" />
              </div>
            </div>
            <p className="font-mono text-4xl font-bold mt-3 text-zinc-900 dark:text-zinc-100 tabular-nums">{metrics.total_logs_ingested}</p>
          </div>
          <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative overflow-hidden transition-all duration-300 hover:border-amber-500/30 hover:shadow-[0_0_24px_rgba(245,158,11,0.12)]">
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-semibold text-zinc-400 tracking-wide uppercase">Fixes Applied</p>
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Wrench className="w-4 h-4 text-amber-500" />
              </div>
            </div>
            <p className="font-mono text-4xl font-bold mt-3 text-zinc-900 dark:text-zinc-100 tabular-nums">{metrics.total_fixes_applied}</p>
          </div>
        </div>

        {/* Analytics Graph + Inspector Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Chart Wrapper */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 h-[450px] shadow-sm flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 mb-4">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-300">Exception Frequency (10AM–7PM IST)</h2>
              <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs">
                <button onClick={() => setChartType('area')} className={`p-1.5 rounded ${chartType === 'area' ? 'bg-white dark:bg-zinc-700 text-indigo-500 shadow-sm' : 'text-zinc-400'}`}><AreaIcon className="w-4 h-4" /></button>
                <button onClick={() => setChartType('line')} className={`p-1.5 rounded ${chartType === 'line' ? 'bg-white dark:bg-zinc-700 text-indigo-500 shadow-sm' : 'text-zinc-400'}`}><LineIcon className="w-4 h-4" /></button>
                <button onClick={() => setChartType('bar')} className={`p-1.5 rounded ${chartType === 'bar' ? 'bg-white dark:bg-zinc-700 text-indigo-500 shadow-sm' : 'text-zinc-400'}`}><BarChart3 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 w-full h-full min-h-[300px] mt-4">
              <ResponsiveContainer width="99%" height="100%">
                {chartType === 'area' ? (
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="currentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? "#3f3f46" : "#f4f4f5"} />
                    <XAxis dataKey="time" stroke={isDarkMode ? "#71717a" : "#a1a1aa"} tickLine={false} style={{ fontSize: '11px' }} />
                    <YAxis stroke={isDarkMode ? "#71717a" : "#a1a1aa"} tickLine={false} allowDecimals={false} style={{ fontSize: '11px' }} />
                    <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#27272a' : '#ffffff', borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7', color: isDarkMode ? '#fafafa' : '#18181b' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    {hasPreviousDayData && (
                      <Area type="monotone" name="Previous Day" dataKey="previousErrors" stroke="#a1a1aa" strokeDasharray="4 3" fill="transparent" strokeWidth={1.5} isAnimationActive animationDuration={700} animationEasing="ease-out" />
                    )}
                    <Area type="monotone" name="Today" dataKey="errors" stroke="#f43f5e" fill="url(#currentGradient)" strokeWidth={2.5} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                  </AreaChart>
                ) : chartType === 'line' ? (
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? "#3f3f46" : "#f4f4f5"} />
                    <XAxis dataKey="time" stroke={isDarkMode ? "#71717a" : "#a1a1aa"} tickLine={false} style={{ fontSize: '11px' }} />
                    <YAxis stroke={isDarkMode ? "#71717a" : "#a1a1aa"} tickLine={false} allowDecimals={false} style={{ fontSize: '11px' }} />
                    <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#27272a' : '#ffffff', borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7', color: isDarkMode ? '#fafafa' : '#18181b' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    {hasPreviousDayData && (
                      <Line type="monotone" name="Previous Day" dataKey="previousErrors" stroke="#a1a1aa" strokeDasharray="4 3" strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive animationDuration={700} animationEasing="ease-out" />
                    )}
                    <Line type="monotone" name="Today" dataKey="errors" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? "#3f3f46" : "#f4f4f5"} />
                    <XAxis dataKey="time" stroke={isDarkMode ? "#71717a" : "#a1a1aa"} tickLine={false} style={{ fontSize: '11px' }} />
                    <YAxis stroke={isDarkMode ? "#71717a" : "#a1a1aa"} tickLine={false} allowDecimals={false} style={{ fontSize: '11px' }} />
                    <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#27272a' : '#ffffff', borderColor: isDarkMode ? '#3f3f46' : '#e4e4e7', color: isDarkMode ? '#fafafa' : '#18181b' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    {hasPreviousDayData && (
                      <Bar name="Previous Day" dataKey="previousErrors" fill="#a1a1aa" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out" />
                    )}
                    <Bar name="Today" dataKey="errors" fill="#f43f5e" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Searchable Error Feed */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 h-[450px] shadow-sm flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-300">Live Error Inspector</h2>
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu((prev) => !prev)}
                  disabled={filteredLogs.length === 0}
                  title="Export the current filtered view"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showExportMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                    <div className="animate-panel-in absolute right-0 mt-1.5 w-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-20 overflow-hidden">
                      <button onClick={exportAsCSV} className="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                        Export as CSV
                      </button>
                      <button onClick={exportAsJSON} className="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-t border-zinc-100 dark:border-zinc-800">
                        Export as JSON
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search errors..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-9 pr-4 py-2 rounded border bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-500 text-zinc-800 dark:text-zinc-200"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setSourceFilter('all')} className={`flex-1 text-[10px] py-1 rounded font-bold uppercase ${sourceFilter === 'all' ? 'bg-indigo-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>All</button>
                <button onClick={() => setSourceFilter('auto_detected')} className={`flex-1 text-[10px] py-1 rounded font-bold uppercase ${sourceFilter === 'auto_detected' ? 'bg-indigo-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>Auto</button>
                <button onClick={() => setSourceFilter('manual_highlight')} className={`flex-1 text-[10px] py-1 rounded font-bold uppercase ${sourceFilter === 'manual_highlight' ? 'bg-indigo-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>Manual</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-zinc-400">No active stream</p>
                </div>
              ) : (
                filteredLogs.map((log, index) => (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
                    className="animate-feed-item flex flex-col text-left bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 transition-all duration-150 rounded p-3 text-xs cursor-pointer hover:border-indigo-400 hover:shadow-[0_0_10px_rgba(99,102,241,0.15)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col truncate">
                        <span className="font-bold text-rose-600 dark:text-rose-400 truncate">{log.error_message}</span>
                        {/* DEVELOPER TRACKING - toggle via header button (Team Stats) */}
                        {showDeveloperTracking && (
                          <span className="text-[9px] text-zinc-400 font-semibold mt-0.5">Dev: {log.developer_name || "Unknown"}</span>
                        )}
                      </div>
                      <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold shrink-0">
                        {log.tag || 'manual'}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 truncate mt-1">File: {log.file_path}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Error Volume Heatmap — gated behind the same Team Stats toggle as the leaderboard */}
        {showDeveloperTracking && (
        <div className="animate-panel-in bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Grid3x3 className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-300">Error Volume — Last 7 Days (10AM–7PM IST)</h2>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <span>Less</span>
              <div className="w-3 h-3 rounded-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/70" />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(99,102,241,0.25)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(99,102,241,0.5)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(99,102,241,0.8)' }} />
              <span>More</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Hour axis */}
              <div className="flex items-center gap-1 mb-1 pl-24">
                {BUSINESS_HOURS_24.map((hour) => (
                  <div key={hour} className="w-8 text-center text-[9px] text-zinc-400 font-mono">
                    {formatHourLabel(hour).replace(' ', '')}
                  </div>
                ))}
              </div>

              {/* Day rows */}
              <div className="space-y-1">
                {heatmapData.days.map((day) => (
                  <div key={day} className="flex items-center gap-1">
                    <div className="w-24 text-[10px] text-zinc-500 font-mono shrink-0 pr-2">{formatDayLabel(day)}</div>
                    {BUSINESS_HOURS_24.map((hour) => {
                      const count = heatmapData.grid[day]?.[hour] ?? 0;
                      return (
                        <div
                          key={hour}
                          title={`${formatDayLabel(day)}, ${formatHourLabel(hour)} — ${count} error${count === 1 ? '' : 's'}`}
                          className="heatmap-cell w-8 h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/70 flex items-center justify-center text-[9px] font-mono text-zinc-500 dark:text-zinc-400"
                          style={heatmapCellStyle(count, heatmapData.max)}
                        >
                          {count > 0 ? count : ''}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* DEVELOPER TRACKING - toggle via header button (Team Stats) */}
        {/* Developer Leaderboard — "Team Telemetry" */}
        {/* Ranks every developer by total crashes logged, and breaks each one
            down into how many were auto-healed vs. fixed by hand. */}
        {showDeveloperTracking && (
        <div className="animate-panel-in bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3 mb-4">
            <Users className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-300">Team Telemetry</h2>
          </div>

          {developerStats.length === 0 ? (
            <div className="py-8 flex items-center justify-center">
              <p className="text-xs text-zinc-400">No developer data yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {developerStats.map((stat, index) => (
                <div
                  key={stat.name}
                  className="flex items-center justify-between gap-4 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
                >
                  {/* Left side: rank badge / avatar initial + name + total count */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 shrink-0 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-sm font-bold text-indigo-500">
                      {index === 0 ? <Crown className="w-4 h-4 text-amber-400" /> : stat.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate">{stat.name}</p>
                      <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{stat.total} Total Crashes</p>
                    </div>
                  </div>

                  {/* Right side: auto-fixed vs manual fix breakdown */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      {stat.autoFixed} Auto-Fixed
                    </span>
                    <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700">
                      {stat.manual} Manual
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
        {/* END DEVELOPER TRACKING (FUTURE UPDATE) */}
      </main>

      {/* Deep-Dive Modal Overlay */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-modal">
          <div className="w-full max-w-3xl rounded-xl border bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-950/40 rounded-t-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">AI Resolution</h3>
              </div>
              <button onClick={() => setSelectedLog(null)} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">

              {/* DEVELOPER TRACKING - toggle via header button (Team Stats) */}
              {showDeveloperTracking && (
              <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs">
                <span className="text-zinc-400 font-bold uppercase tracking-wider">Assigned Developer:</span>
                <span className="font-mono px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded font-bold tracking-tight">
                  👤 {selectedLog.developer_name || "Unknown Developer"}
                </span>
              </div>
              )}
              {/* END DEVELOPER TRACKING (FUTURE UPDATE) */}

              <div>
                <h4 className="text-xs font-semibold text-rose-500 uppercase tracking-wide mb-2">Raw Traceback</h4>
                <pre className="bg-zinc-950 text-zinc-300 p-4 rounded-lg text-xs overflow-x-auto code-trace-block border border-zinc-800 shadow-inner">
                  {selectedLog.stack_trace}
                </pre>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-emerald-500 uppercase tracking-wide mb-2">AI Recommendation</h4>
                <div className="text-sm text-zinc-800 dark:text-zinc-200 prose prose-zinc dark:prose-invert max-w-none bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 p-5 rounded-lg shadow-inner font-sans">
                  {selectedLog.ai_suggestion ? (
                    <ReactMarkdown>{selectedLog.ai_suggestion}</ReactMarkdown>
                  ) : (
                    <p className="font-mono text-xs text-zinc-500">No AI fix available for this historical log</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}