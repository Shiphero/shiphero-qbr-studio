import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ResponsiveContainer, Cell,
  Area, AreaChart,
} from 'recharts';
import { parseStatsCSV, dedupeWarehouseRows, formatMonth, MonthlyStatRow } from '../utils/statsParser';
import ExportButton from './ExportButton';
import { useData } from '../context/DataContext';
import { inferServiceKey, SERVICE_LABELS } from '../data/shipheroRates';
import { safeGetItem, STORAGE_KEYS } from '../utils/storageUtils';
import InsightGate from './InsightGate';

// ─── Palette ──────────────────────────────────────────────────────────────────
const PALETTE = [
  '#4472E8', '#EF5252', '#22C55E', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#EC4899', '#14B8A6', '#A78BFA',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBig$(n: number) {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function fmtN(n: number) { return n.toLocaleString(); }
function pct(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }

type HealthStatus = 'growing' | 'declining' | 'at-risk' | 'stable' | 'new';

interface ChildSummary {
  childId: string;
  months: string[];
  labelsByMonth: Record<string, number>;
  ordersByMonth: Record<string, number>;
  spendByMonth: Record<string, number>;
  totalLabels: number;
  totalOrders: number;
  totalSpend: number;
  latestLabels: number;
  latestOrders: number;
  prevLabels: number;
  prevOrders: number;
  momOrderPct: number;
  status: HealthStatus;
}

// ─── Health scoring ───────────────────────────────────────────────────────────
function scoreHealth(summary: Omit<ChildSummary, 'status'>, allMonths: string[]): HealthStatus {
  const monthCount = Object.keys(summary.ordersByMonth).length;
  if (monthCount <= 2) return 'new';

  const last3 = allMonths.slice(-3);
  const vals = last3.map((m) => summary.ordersByMonth[m] ?? 0);
  const isDecreasingConsistently = vals[0] > vals[1] && vals[1] > vals[2] && vals[2] > 0;
  if (isDecreasingConsistently) return 'at-risk';

  if (summary.momOrderPct > 10) return 'growing';
  if (summary.momOrderPct < -10) return 'declining';
  return 'stable';
}

const STATUS_CONFIG: Record<HealthStatus, { label: string; bg: string; text: string; border: string }> = {
  growing:   { label: '🚀 Growing',   bg: 'rgba(34,197,94,0.1)',   text: '#15803D', border: 'rgba(34,197,94,0.3)' },
  stable:    { label: '✅ Stable',    bg: 'rgba(68,114,232,0.1)',  text: '#1d4ed8', border: 'rgba(68,114,232,0.3)' },
  declining: { label: '📉 Declining', bg: 'rgba(239,68,68,0.08)', text: '#b91c1c', border: 'rgba(239,68,68,0.3)' },
  'at-risk': { label: '⚠️ At Risk',   bg: 'rgba(245,166,35,0.1)', text: '#92650a', border: 'rgba(245,166,35,0.3)' },
  new:       { label: '🆕 New',       bg: 'rgba(139,92,246,0.1)', text: '#6d28d9', border: 'rgba(139,92,246,0.3)' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function KPICard({
  label, value, sub, accent, delta,
}: {
  label: string; value: string; sub?: string; accent?: string; delta?: number;
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-black" style={{ color: accent || '#252F3E' }}>{value}</div>
      <div className="flex items-center gap-2">
        {sub && <div className="text-xs text-gray-400">{sub}</div>}
        {delta !== undefined && (
          <span className="text-xs font-bold" style={{ color: delta >= 0 ? '#22C55E' : '#EF4444' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% MoM
          </span>
        )}
      </div>
    </div>
  );
}


// ─── Tooltip helpers ──────────────────────────────────────────────────────────
const LineTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm" style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: 160 }}>
      <div className="font-bold text-white mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold text-white">{typeof p.value === 'number' ? fmtN(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

const SpendTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm" style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: 160 }}>
      <div className="font-bold text-white mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold text-white">{fmtBig$(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export default function AccountHealthTab({ onManageWarehouses }: { onManageWarehouses?: () => void } = {}) {
  const [parseError, setParseError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'totalOrders' | 'latestOrders' | 'prevOrders' | 'momOrderPct' | 'totalSpend' | 'status'>('totalOrders');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [scorecardExpanded, setScorecardExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<HealthStatus>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const {
    rawShipments, setStatsLoaded, pendingStatsFile, setPendingStatsFile,
    filteredStatsRows: rows, setStatsRows, statsFileName: fileName, setStatsFileName,
    statsLoaded, warehouses,
  } = useData();
  const excludedWarehouses = warehouses.filter(w => w.excluded);
  const hasShippingData = rawShipments.length > 0;

  // Restore from localStorage on mount (fallback — IDB is handled in DataContext)
  useEffect(() => {
    if (statsLoaded) return; // already restored from IDB or DataContext
    const cached = safeGetItem<{ rows: MonthlyStatRow[]; fileName: string }>(STORAGE_KEYS.STATS_CACHE);
    if (cached?.rows?.length) {
      setStatsRows(cached.rows);
      setStatsFileName(cached.fileName);
      setStatsLoaded(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    try {
      const parsed = await parseStatsCSV(file);
      setStatsRows(parsed);
      setStatsFileName(file.name);
      setStatsLoaded(true);
      // Stats are persisted in IDB by DataContext's auto-save effect — no localStorage write needed.
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse CSV');
    }
  }, [setStatsLoaded, setStatsRows, setStatsFileName]);

  // Auto-process file queued from modal or Setup tab.
  // Guard ref prevents double-invocation from React StrictMode / tab re-mount.
  const processingStatsRef = useRef(false);
  useEffect(() => {
    if (pendingStatsFile && !processingStatsRef.current) {
      processingStatsRef.current = true;
      handleFile(pendingStatsFile).then(() => {
        setPendingStatsFile(null);
        processingStatsRef.current = false;
      });
    }
  }, [pendingStatsFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasData = rows.length > 0;

  // ── Close filter dropdown on outside click ────────────────────────────────
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  // ── Sorted months ─────────────────────────────────────────────────────────
  const allMonths = useMemo(() =>
    [...new Set(rows.map((r) => r.month))].sort(), [rows]);

  const latestMonth = allMonths[allMonths.length - 1] ?? '';
  const prevMonth = allMonths[allMonths.length - 2] ?? '';

  // ── Parent-level KPIs (deduplicated billing per month) ────────────────────
  const billingByMonth = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (!seen.has(r.month)) seen.set(r.month, r.stripeBilling);
    }
    return seen;
  }, [rows]);

  // ── Warehouse-level deduped rows (for fulfillment mix) ────────────────────
  const warehouseRows = useMemo(() => dedupeWarehouseRows(rows), [rows]);

  // ── Fulfillment mix per month ─────────────────────────────────────────────
  const fulfillmentByMonth = useMemo(() => {
    const map = new Map<string, { mib: number; sib: number; bulk: number; wholesale: number; manual: number; unknown: number }>();
    for (const r of warehouseRows) {
      const existing = map.get(r.month) ?? { mib: 0, sib: 0, bulk: 0, wholesale: 0, manual: 0, unknown: 0 };
      map.set(r.month, {
        mib: existing.mib + r.mibLabels,
        sib: existing.sib + r.sibLabels,
        bulk: existing.bulk + r.bulkLabels,
        wholesale: existing.wholesale + r.wholesaleLabels,
        manual: existing.manual + r.manualLabels,
        unknown: existing.unknown + r.unknownLabels,
      });
    }
    return map;
  }, [warehouseRows]);

  // ── Monthly aggregates (for KPIs and trend chart) ─────────────────────────
  const monthlyTotals = useMemo(() => {
    const map = new Map<string, { orders: number; labels: number; spend: number; gmv: number }>();
    for (const r of rows) {
      const ex = map.get(r.month) ?? { orders: 0, labels: 0, spend: 0, gmv: 0 };
      map.set(r.month, {
        orders: ex.orders + r.orderCount,
        labels: ex.labels + r.labelCount,
        spend: ex.spend + r.carrierSpend,
        gmv: ex.gmv,
      });
    }
    // Fill in warehouse-level GMV (deduplicated)
    for (const r of warehouseRows) {
      const ex = map.get(r.month);
      if (ex) map.set(r.month, { ...ex, gmv: ex.gmv + r.gmv });
    }
    return map;
  }, [rows, warehouseRows]);

  // ── KPI summary ───────────────────────────────────────────────────────────
  const latestTotals = monthlyTotals.get(latestMonth);
  const prevTotals = monthlyTotals.get(prevMonth);

  const momOrders = latestTotals && prevTotals && prevTotals.orders > 0
    ? ((latestTotals.orders - prevTotals.orders) / prevTotals.orders) * 100 : undefined;
  const momSpend = latestTotals && prevTotals && prevTotals.spend > 0
    ? ((latestTotals.spend - prevTotals.spend) / prevTotals.spend) * 100 : undefined;
  const momGMV = latestTotals && prevTotals && prevTotals.gmv > 0
    ? ((latestTotals.gmv - prevTotals.gmv) / prevTotals.gmv) * 100 : undefined;

  // ── Per-child summaries ───────────────────────────────────────────────────
  const childSummaries = useMemo<ChildSummary[]>(() => {
    const map = new Map<string, {
      labelsByMonth: Record<string, number>;
      ordersByMonth: Record<string, number>;
      spendByMonth: Record<string, number>;
    }>();

    for (const r of rows) {
      const ex = map.get(r.childAccountId) ?? { labelsByMonth: {}, ordersByMonth: {}, spendByMonth: {} };
      ex.labelsByMonth[r.month] = (ex.labelsByMonth[r.month] ?? 0) + r.labelCount;
      ex.ordersByMonth[r.month] = (ex.ordersByMonth[r.month] ?? 0) + r.orderCount;
      ex.spendByMonth[r.month] = (ex.spendByMonth[r.month] ?? 0) + r.carrierSpend;
      map.set(r.childAccountId, ex);
    }

    return Array.from(map.entries()).map(([childId, data]) => {
      const totalLabels = Object.values(data.labelsByMonth).reduce((s, v) => s + v, 0);
      const totalOrders = Object.values(data.ordersByMonth).reduce((s, v) => s + v, 0);
      const totalSpend = Object.values(data.spendByMonth).reduce((s, v) => s + v, 0);
      const latestLabels = data.labelsByMonth[latestMonth] ?? 0;
      const latestOrders = data.ordersByMonth[latestMonth] ?? 0;
      const prevLabels = data.labelsByMonth[prevMonth] ?? 0;
      const prevOrders = data.ordersByMonth[prevMonth] ?? 0;
      const momOrderPct = prevOrders > 0 ? ((latestOrders - prevOrders) / prevOrders) * 100 : 0;
      const months = Object.keys(data.ordersByMonth).sort();

      const base = {
        childId, months,
        labelsByMonth: data.labelsByMonth,
        ordersByMonth: data.ordersByMonth,
        spendByMonth: data.spendByMonth,
        totalLabels, totalOrders, totalSpend,
        latestLabels, latestOrders, prevLabels, prevOrders, momOrderPct,
      };
      return { ...base, status: scoreHealth(base, allMonths) };
    });
  }, [rows, latestMonth, prevMonth, allMonths]);

  // ── Sort + filter child summaries ────────────────────────────────────────
  const STATUS_ORDER: HealthStatus[] = ['growing', 'stable', 'new', 'at-risk', 'declining'];
  const ALL_STATUSES = Object.keys(STATUS_CONFIG) as HealthStatus[];
  const sortedChildren = useMemo(() => {
    // statusFilter is a "visible" set — empty means show all
    const filtered = statusFilter.size === 0
      ? childSummaries
      : childSummaries.filter(c => statusFilter.has(c.status));
    return [...filtered].sort((a, b) => {
      if (sortKey === 'status') {
        const ai = STATUS_ORDER.indexOf(a.status);
        const bi = STATUS_ORDER.indexOf(b.status);
        return sortDir === 'asc' ? ai - bi : bi - ai;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [childSummaries, sortKey, sortDir, statusFilter]);

  // ── Volume trend chart data ───────────────────────────────────────────────
  const volumeTrendData = useMemo(() =>
    allMonths
      .filter(m => (monthlyTotals.get(m)?.orders ?? 0) > 0 || (monthlyTotals.get(m)?.labels ?? 0) > 0)
      .map((m) => ({
        month: formatMonth(m),
        Orders: monthlyTotals.get(m)?.orders ?? 0,
        Labels: monthlyTotals.get(m)?.labels ?? 0,
      })), [allMonths, monthlyTotals]);

  // ── Carrier spend trend ───────────────────────────────────────────────────
  const spendTrendData = useMemo(() =>
    allMonths
      .filter(m => (monthlyTotals.get(m)?.spend ?? 0) > 0 || (monthlyTotals.get(m)?.gmv ?? 0) > 0)
      .map((m) => ({
        month: formatMonth(m),
        'Carrier Spend': monthlyTotals.get(m)?.spend ?? 0,
        GMV: monthlyTotals.get(m)?.gmv ?? 0,
      })), [allMonths, monthlyTotals]);

  // ── Fulfillment mix chart data ────────────────────────────────────────────
  const mixChartData = useMemo(() =>
    allMonths
      .filter(m => {
        const f = fulfillmentByMonth.get(m);
        if (!f) return false;
        return (f.mib + f.sib + f.bulk + f.wholesale + f.manual + f.unknown) > 0;
      })
      .map((m) => {
        const f = fulfillmentByMonth.get(m)!;
        const total = f.mib + f.sib + f.bulk + f.wholesale + f.manual + f.unknown;
        return {
          month: formatMonth(m),
          SIB: Math.round((f.sib / total) * 100),
          MIB: Math.round((f.mib / total) * 100),
          'Bulk Ship': Math.round((f.bulk / total) * 100),
          Manual: Math.round((f.manual / total) * 100),
          Wholesale: Math.round((f.wholesale / total) * 100),
        };
      }), [allMonths, fulfillmentByMonth]);

  // ── Per-child trend chart (top 6 by volume) ───────────────────────────────
  const top6Children = useMemo(() =>
    [...childSummaries].sort((a, b) => b.totalOrders - a.totalOrders).slice(0, 6),
    [childSummaries]);

  const childTrendData = useMemo(() =>
    allMonths
      .filter(m => top6Children.some(c => (c.ordersByMonth[m] ?? 0) > 0))
      .map((m) => {
        const point: Record<string, number | string> = { month: formatMonth(m) };
        for (const c of top6Children) {
          point[`#${c.childId}`] = c.ordersByMonth[m] ?? 0;
        }
        return point;
      }), [allMonths, top6Children]);

  // ── Carrier mix (from shipping CSV) ──────────────────────────────────────
  const carrierMixData = useMemo(() => {
    if (!hasShippingData) return [];
    const counts = new Map<string, number>();
    for (const s of rawShipments) {
      const c = s.carrier || 'Unknown';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const total = rawShipments.length;
    return [...counts.entries()]
      .map(([carrier, count]) => ({ carrier, Shipments: count, '% of Total': parseFloat(((count / total) * 100).toFixed(1)) }))
      .sort((a, b) => b.Shipments - a.Shipments)
      .slice(0, 8);
  }, [rawShipments, hasShippingData]);

  // ── Service level mix (from shipping CSV) ─────────────────────────────────
  const serviceMixData = useMemo(() => {
    if (!hasShippingData) return [];
    const counts = new Map<string, number>();
    for (const s of rawShipments) {
      const key = inferServiceKey(s.shippingMethod);
      const label = key ? SERVICE_LABELS[key] : (s.shippingMethod?.slice(0, 30) || 'Unknown');
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const total = rawShipments.length;
    return [...counts.entries()]
      .map(([service, count]) => ({ service, Shipments: count, '% of Total': parseFloat(((count / total) * 100).toFixed(1)) }))
      .sort((a, b) => b.Shipments - a.Shipments)
      .slice(0, 8);
  }, [rawShipments, hasShippingData]);

  // ── Avg label cost by carrier (from shipping CSV) ─────────────────────────
  const carrierCostData = useMemo(() => {
    if (!hasShippingData) return [];
    const map = new Map<string, { total: number; count: number }>();
    for (const s of rawShipments) {
      const c = s.carrier || 'Unknown';
      const ex = map.get(c) ?? { total: 0, count: 0 };
      map.set(c, { total: ex.total + s.labelCost, count: ex.count + 1 });
    }
    return [...map.entries()]
      .map(([carrier, { total, count }]) => ({
        carrier,
        'Avg Label Cost': parseFloat((total / count).toFixed(2)),
        Shipments: count,
      }))
      .sort((a, b) => b.Shipments - a.Shipments)
      .slice(0, 8);
  }, [rawShipments, hasShippingData]);

  // ── Label cost vs total charged gap by carrier ────────────────────────────
  const costGapData = useMemo(() => {
    if (!hasShippingData) return [];
    const map = new Map<string, { labelTotal: number; chargedTotal: number; count: number }>();
    for (const s of rawShipments) {
      if (s.totalShippingCharged <= 0) continue;
      const c = s.carrier || 'Unknown';
      const ex = map.get(c) ?? { labelTotal: 0, chargedTotal: 0, count: 0 };
      map.set(c, {
        labelTotal: ex.labelTotal + s.labelCost,
        chargedTotal: ex.chargedTotal + s.totalShippingCharged,
        count: ex.count + 1,
      });
    }
    return [...map.entries()]
      .map(([carrier, { labelTotal, chargedTotal, count }]) => ({
        carrier,
        'Label Cost': parseFloat((labelTotal / count).toFixed(2)),
        'Total Charged': parseFloat((chargedTotal / count).toFixed(2)),
      }))
      .filter((r) => r['Total Charged'] > 0)
      .sort((a, b) => b['Total Charged'] - a['Total Charged'])
      .slice(0, 8);
  }, [rawShipments, hasShippingData]);

  const hasCostGapData = costGapData.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-screen-2xl mx-auto" style={{ fontFamily: "'Metropolis', sans-serif", color: '#252F3E' }}>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black" style={{ color: '#252F3E' }}>Account Health</h1>
        <p className="text-sm text-gray-500 mt-1">
          Monthly volume trends, fulfillment mix, carrier spend, and child account health signals.
        </p>
      </div>

      {/* Excluded-warehouse notice */}
      {excludedWarehouses.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', marginBottom: 16, borderRadius: 8,
          background: 'rgba(239,82,82,0.06)', border: '1px solid rgba(239,82,82,0.15)',
          fontSize: 12, color: '#EF5252',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          <span>
            <strong>{excludedWarehouses.length} warehouse{excludedWarehouses.length > 1 ? 's' : ''} excluded from shipment data:</strong>{' '}
            {excludedWarehouses.map(w => w.name).join(', ')}.{' '}
            Statistics CSV data is unaffected.
          </span>
          {onManageWarehouses && (
            <button
              onClick={onManageWarehouses}
              style={{ marginLeft: 'auto', flexShrink: 0, background: 'none', border: '1px solid rgba(239,82,82,0.3)', borderRadius: 6, padding: '3px 10px', fontSize: 11, color: '#EF5252', cursor: 'pointer', fontWeight: 600 }}
            >
              Manage →
            </button>
          )}
        </div>
      )}

      {!hasData && (
        <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(68,114,232,0.04)', border: '1px dashed rgba(68,114,232,0.3)' }}>
          <div className="text-3xl mb-2">📈</div>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Upload the QuickSight Statistics CSV in the <strong>Setup</strong> tab to unlock 12-month volume trends, fulfillment mix breakdown, carrier spend, and child account health scoring.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* Account name + period */}
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg px-3 py-1.5 text-sm font-bold" style={{ background: 'rgba(68,114,232,0.1)', color: '#4472E8' }}>
              {rows[0]?.accountName}
            </div>
            <div className="text-xs text-gray-400">
              {formatMonth(allMonths[0])} – {formatMonth(latestMonth)} · {allMonths.length} months · {childSummaries.length} child accounts
            </div>
          </div>

          {/* KPI Cards */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Account Health Summary</span>
            <InsightGate sectionKey="accountHealthKPIs" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <KPICard
              label={`Orders (${formatMonth(latestMonth)})`}
              value={fmtN(latestTotals?.orders ?? 0)}
              sub="latest month"
              accent="#4472E8"
              delta={momOrders}
            />
            <KPICard
              label={`Labels (${formatMonth(latestMonth)})`}
              value={fmtN(latestTotals?.labels ?? 0)}
              sub="shipping labels"
            />
            <KPICard
              label="Carrier Spend"
              value={fmtBig$(latestTotals?.spend ?? 0)}
              sub="latest month"
              accent="#EF5252"
              delta={momSpend}
            />
            <KPICard
              label="GMV"
              value={fmtBig$(latestTotals?.gmv ?? 0)}
              sub="gross merch. value"
              accent="#22C55E"
              delta={momGMV}
            />
            <KPICard
              label="Platform Billing"
              value={fmtBig$(billingByMonth.get(latestMonth) ?? 0)}
              sub="Stripe billing"
              accent="#8B5CF6"
            />
          </div>

          {/* Row 1: Volume trend + Per-child trends */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            {/* Overall volume trend */}
            <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Total Volume Trend</h3>
                <div className="flex items-center gap-2">
                  <InsightGate sectionKey="volumeTrend" />
                  <ExportButton data={volumeTrendData} filename="volume_trend" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">Monthly orders and labels — all child accounts combined</p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={volumeTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
                  <defs>
                    <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4472E8" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#4472E8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="labelsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF5252" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#EF5252" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#6B7280' }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={fmtN} />
                  <RTooltip content={<LineTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Orders" stroke="#4472E8" strokeWidth={2} fill="url(#ordersGrad)" dot={{ r: 3 }} />
                  <Area type="monotone" dataKey="Labels" stroke="#EF5252" strokeWidth={2} fill="url(#labelsGrad)" dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Per-child account trends */}
            <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Child Account Order Trends</h3>
                <div className="flex items-center gap-2">
                  <InsightGate sectionKey="childAccountTrends" />
                  <ExportButton data={childTrendData} filename="child_account_order_trends" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">Monthly orders for top 6 accounts by total volume</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={childTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#6B7280' }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={fmtN} />
                  <RTooltip content={<LineTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {top6Children.map((c, i) => (
                    <Line
                      key={c.childId}
                      type="monotone"
                      dataKey={`#${c.childId}`}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 2: Carrier spend + Fulfillment mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            {/* Carrier spend trend */}
            <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Carrier Spend vs GMV</h3>
                <div className="flex items-center gap-2">
                  <InsightGate sectionKey="carrierSpendGMV" />
                  <ExportButton data={spendTrendData} filename="carrier_spend_vs_gmv" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">Monthly carrier spend and gross merchandise value</p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={spendTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
                  <defs>
                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22C55E" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#6B7280' }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => fmtBig$(v)} />
                  <RTooltip content={<SpendTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Carrier Spend" stroke="#EF4444" strokeWidth={2} fill="url(#spendGrad)" dot={{ r: 3 }} />
                  <Area type="monotone" dataKey="GMV" stroke="#22C55E" strokeWidth={2} fill="url(#gmvGrad)" dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Fulfillment mix */}
            <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Fulfillment Mix</h3>
                <div className="flex items-center gap-2">
                  <InsightGate sectionKey="fulfillmentMix" />
                  <ExportButton data={mixChartData} filename="fulfillment_mix" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">SIB / MIB / Manual / Bulk / Wholesale breakdown by month (%)</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={mixChartData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#6B7280' }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => `${v}%`} />
                  <RTooltip formatter={(v: number) => `${v}%`} contentStyle={{ background: '#252F3E', border: 'none', borderRadius: 12, color: '#fff', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="SIB" stackId="a" fill="#4472E8" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="MIB" stackId="a" fill="#EF5252" />
                  <Bar dataKey="Manual" stackId="a" fill="#EF4444" />
                  <Bar dataKey="Bulk Ship" stackId="a" fill="#22C55E" />
                  <Bar dataKey="Wholesale" stackId="a" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Child Account Health Table */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap" style={{ borderBottom: '1px solid #e5e7eb' }}>
              <div>
                <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Child Account Health Scorecard</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Latest month vs prior month · auto-flagged by trend
                  {statusFilter.size > 0 && (
                    <span className="ml-2 font-semibold" style={{ color: '#4472E8' }}>
                      · {statusFilter.size} status{statusFilter.size > 1 ? 'es' : ''} hidden
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ExportButton
                  data={sortedChildren.map((c) => ({
                    'Child Account': `#${c.childId}`,
                    'Months Active': c.months.length,
                    'Total Orders': c.totalOrders,
                    'Total Labels': c.totalLabels,
                    [`Orders (${formatMonth(latestMonth)})`]: c.latestOrders,
                    [`Orders (${formatMonth(prevMonth)})`]: c.prevOrders,
                    'MoM Change %': c.prevOrders > 0 ? parseFloat(c.momOrderPct.toFixed(1)) : '',
                    'Total Carrier Spend': parseFloat(c.totalSpend.toFixed(2)),
                    'Status': STATUS_CONFIG[c.status].label.replace(/[^\w\s]/g, '').trim(),
                  }))}
                  filename="account_health_scorecard"
                />
                <InsightGate sectionKey="childAccountScorecard" />

                {/* Sort & Filter button + dropdown */}
                <div className="relative" ref={filterRef}>
                  <button
                    onClick={() => setFilterOpen(o => !o)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{
                      background: (filterOpen || statusFilter.size > 0 || sortKey !== 'totalOrders' || sortDir !== 'desc') ? '#4472E8' : '#F5F5F0',
                      color: (filterOpen || statusFilter.size > 0 || sortKey !== 'totalOrders' || sortDir !== 'desc') ? '#fff' : '#252F3E',
                      border: (filterOpen || statusFilter.size > 0 || sortKey !== 'totalOrders' || sortDir !== 'desc') ? '1px solid #4472E8' : '1px solid #E5E7EB',
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                    Sort &amp; Filter
                    {statusFilter.size > 0 && (
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-black"
                        style={{ background: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                        {statusFilter.size}
                      </span>
                    )}
                  </button>

                  {filterOpen && (
                    <div
                      className="absolute right-0 z-50 rounded-xl overflow-hidden"
                      style={{
                        top: 'calc(100% + 6px)',
                        width: 260,
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      }}
                    >
                      {/* Filter by Status section */}
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-black uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Filter by Status</div>
                          <button
                            onClick={() => {
                              const allSelected = ALL_STATUSES.every(s => statusFilter.has(s));
                              setStatusFilter(allSelected ? new Set() : new Set(ALL_STATUSES));
                            }}
                            className="text-xs font-semibold"
                            style={{ color: '#4472E8' }}
                          >
                            {statusFilter.size === 0 || ALL_STATUSES.every(s => statusFilter.has(s)) ? 'Deselect all' : 'Select all'}
                          </button>
                        </div>
                        <div className="flex flex-col gap-1">
                          {(Object.entries(STATUS_CONFIG) as [HealthStatus, typeof STATUS_CONFIG[HealthStatus]][]).map(([status, cfg]) => {
                            const checked = statusFilter.size === 0 || statusFilter.has(status);
                            return (
                              <label
                                key={status}
                                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-all"
                                style={{ background: checked ? cfg.bg : '#F9FAFB' }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setStatusFilter(prev => {
                                      // If currently showing all (size === 0), start with all selected then toggle one off
                                      const base = prev.size === 0 ? new Set(ALL_STATUSES) : new Set(prev);
                                      if (base.has(status)) base.delete(status); else base.add(status);
                                      // If all are selected, normalize back to empty (means "show all")
                                      if (ALL_STATUSES.every(s => base.has(s))) return new Set<HealthStatus>();
                                      return base;
                                    });
                                  }}
                                  className="rounded"
                                  style={{ accentColor: '#4472E8', width: 14, height: 14 }}
                                />
                                <span className="text-xs font-bold" style={{ color: checked ? cfg.text : '#9CA3AF' }}>
                                  {cfg.label}
                                </span>
                                <span className="ml-auto text-xs" style={{ color: '#9CA3AF' }}>
                                  {childSummaries.filter(c => c.status === status).length}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        {statusFilter.size > 0 && statusFilter.size < ALL_STATUSES.length && (
                          <button
                            onClick={() => setStatusFilter(new Set())}
                            className="mt-2 w-full text-xs font-bold py-1.5 rounded-lg transition-all"
                            style={{ background: '#FEE2E2', color: '#b91c1c', border: '1px solid #FECACA' }}
                          >
                            Show all statuses
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: '760px' }}>
                <thead>
                  <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide" style={{ color: '#252F3E' }}>Child Account</th>
                    {([
                      { key: 'totalOrders',  label: 'Total Orders',  align: 'right' },
                      { key: 'latestOrders', label: 'Latest Mo.',    align: 'right' },
                      { key: 'prevOrders',   label: 'Prior Mo.',     align: 'right' },
                      { key: 'momOrderPct',  label: 'MoM Change',    align: 'right' },
                      { key: 'totalSpend',   label: 'Carrier Spend', align: 'right' },
                      { key: 'status',       label: 'Status',        align: 'center' },
                    ] as const).map(({ key, label, align }) => {
                      const active = sortKey === key;
                      return (
                        <th
                          key={key}
                          className={`px-4 py-3 text-${align} text-xs font-bold uppercase tracking-wide cursor-pointer select-none`}
                          style={{ color: active ? '#4472E8' : '#252F3E', whiteSpace: 'nowrap' }}
                          onClick={() => {
                            if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                            else { setSortKey(key); setSortDir('desc'); }
                          }}
                        >
                          <span className="inline-flex items-center gap-1" style={{ justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}>
                            {label}
                            <span style={{ fontSize: 10, opacity: active ? 1 : 0.3 }}>
                              {active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                            </span>
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(scorecardExpanded ? sortedChildren : sortedChildren.slice(0, 5)).map((c, idx) => {
                    const cfg = STATUS_CONFIG[c.status];
                    const momColor = c.momOrderPct > 0 ? '#22C55E' : c.momOrderPct < 0 ? '#EF4444' : '#6B7280';
                    return (
                      <tr key={c.childId} style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)', borderBottom: '1px solid #f3f4f6' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[idx % PALETTE.length] }} />
                            <span className="font-bold" style={{ color: '#252F3E' }}>#{c.childId}</span>
                            <span className="text-xs text-gray-400">{c.months.length} mo.</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: '#252F3E' }}>{fmtN(c.totalOrders)}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: '#4472E8' }}>{fmtN(c.latestOrders)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{fmtN(c.prevOrders)}</td>
                        <td className="px-4 py-3 text-right font-bold" style={{ color: momColor }}>
                          {c.prevOrders > 0 ? pct(c.momOrderPct) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: '#EF5252' }}>{fmtBig$(c.totalSpend)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                            style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Expand / collapse */}
            {sortedChildren.length > 5 && (
              <div className="py-2.5 text-center" style={{ borderTop: '1px solid #f3f4f6' }}>
                <button
                  onClick={() => setScorecardExpanded(e => !e)}
                  className="text-xs font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-80"
                  style={{ background: '#F5F5F0', color: '#4472E8', border: '1px solid #e5e7eb' }}
                >
                  {scorecardExpanded ? '↑ Show less' : `↓ Show all ${sortedChildren.length} accounts`}
                </button>
              </div>
            )}

            {/* Legend */}
            <div className="px-5 py-3 flex flex-wrap gap-3" style={{ borderTop: '1px solid #f3f4f6', background: '#FAFAF8' }}>
              {Object.entries(STATUS_CONFIG).map(([, cfg]) => (
                <span key={cfg.label} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                  {cfg.label}
                </span>
              ))}
              <span className="text-xs text-gray-400 ml-2 self-center">
                · Growing/Declining: &gt;±10% MoM orders · At Risk: declining 3 consecutive months
              </span>
            </div>
          </div>

          {/* ── Shipping Intelligence ─────────────────────────────────────── */}
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-black" style={{ color: '#252F3E' }}>Shipping Intelligence</h2>
              {hasShippingData ? (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(34,197,94,0.1)', color: '#15803D', border: '1px solid rgba(34,197,94,0.3)' }}>
                  {rawShipments.length.toLocaleString()} shipments loaded
                </span>
              ) : (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(245,166,35,0.08)', color: '#92650a', border: '1px solid rgba(245,166,35,0.3)' }}>
                  Upload a Shipping CSV on the Network Optimization tab to unlock
                </span>
              )}
            </div>

            {!hasShippingData ? (
              <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(68,114,232,0.04)', border: '1px dashed rgba(68,114,232,0.3)' }}>
                <div className="text-3xl mb-2">🚚</div>
                <p className="text-sm text-gray-400 max-w-md mx-auto">
                  Carrier mix, service level breakdown, and shipping cost analysis will appear here once you upload a shipping CSV on the Network Optimization tab.
                </p>
              </div>
            ) : (
              <>
                {/* Row 1: Carrier Mix + Service Level Mix */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

                  {/* Carrier Mix */}
                  <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Carrier Mix</h3>
                      <div className="flex items-center gap-2">
                        <InsightGate sectionKey="carrierMix" />
                        <ExportButton data={carrierMixData} filename="carrier_mix" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Shipment volume by carrier</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={carrierMixData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={fmtN} />
                        <YAxis type="category" dataKey="carrier" tick={{ fontSize: 10, fill: '#6B7280' }} width={80} />
                        <RTooltip
                          formatter={(v: number, name: string) => [name === 'Shipments' ? fmtN(v) : v + '%', name]}
                          contentStyle={{ background: '#252F3E', border: 'none', borderRadius: 12, color: '#fff', fontSize: 12 }}
                        />
                        <Bar dataKey="Shipments" fill="#4472E8" radius={[0, 4, 4, 0]}>
                          {carrierMixData.map((_, i) => (
                            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Service Level Mix */}
                  <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Service Level Mix</h3>
                      <div className="flex items-center gap-2">
                        <InsightGate sectionKey="serviceLevelMix" />
                        <ExportButton data={serviceMixData} filename="service_level_mix" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Shipment volume by service type</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={serviceMixData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={fmtN} />
                        <YAxis type="category" dataKey="service" tick={{ fontSize: 10, fill: '#6B7280' }} width={120} />
                        <RTooltip
                          formatter={(v: number, name: string) => [name === 'Shipments' ? fmtN(v) : v + '%', name]}
                          contentStyle={{ background: '#252F3E', border: 'none', borderRadius: 12, color: '#fff', fontSize: 12 }}
                        />
                        <Bar dataKey="Shipments" radius={[0, 4, 4, 0]}>
                          {serviceMixData.map((_, i) => (
                            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Row 2: Avg Label Cost by Carrier + Cost Gap */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Avg Label Cost by Carrier */}
                  <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Avg Label Cost by Carrier</h3>
                      <div className="flex items-center gap-2">
                        <InsightGate sectionKey="labelCostByCarrier" />
                        <ExportButton data={carrierCostData} filename="avg_label_cost_by_carrier" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Average per-shipment label cost across carriers</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={carrierCostData} margin={{ top: 4, right: 8, left: 8, bottom: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="carrier" tick={{ fontSize: 10, fill: '#6B7280' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => '$' + v.toFixed(0)} />
                        <RTooltip
                          formatter={(v: number) => ['$' + v.toFixed(2), 'Avg Label Cost']}
                          contentStyle={{ background: '#252F3E', border: 'none', borderRadius: 12, color: '#fff', fontSize: 12 }}
                        />
                        <Bar dataKey="Avg Label Cost" radius={[4, 4, 0, 0]}>
                          {carrierCostData.map((_, i) => (
                            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Label Cost vs Total Charged (surcharge gap) */}
                  {hasCostGapData ? (
                    <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Label Cost vs Total Charged</h3>
                        <div className="flex items-center gap-2">
                          <InsightGate sectionKey="costGap" />
                          <ExportButton data={costGapData} filename="label_cost_vs_total_charged" />
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mb-4">Avg label cost vs what customers were charged — gap reveals surcharges</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={costGapData} margin={{ top: 4, right: 8, left: 8, bottom: 16 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="carrier" tick={{ fontSize: 10, fill: '#6B7280' }} />
                          <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => '$' + v.toFixed(0)} />
                          <RTooltip
                            formatter={(v: number) => '$' + v.toFixed(2)}
                            contentStyle={{ background: '#252F3E', border: 'none', borderRadius: 12, color: '#fff', fontSize: 12 }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="Label Cost" fill="#4472E8" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Total Charged" fill="#EF5252" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="rounded-xl p-5 flex flex-col items-center justify-center text-center"
                      style={{ background: '#fafafa', border: '1px dashed #e5e7eb' }}>
                      <div className="text-2xl mb-2">💡</div>
                      <p className="text-sm font-semibold text-gray-500">Surcharge Gap</p>
                      <p className="text-xs text-gray-400 mt-1 max-w-xs">
                        Requires a <code className="bg-gray-100 px-1 rounded">Total Shipping Charged</code> column in your shipping CSV to compare label cost vs customer billed amount.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
