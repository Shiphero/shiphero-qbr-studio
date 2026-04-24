import { useMemo, useState } from 'react';
import InsightGate from './InsightGate';
import SortFilterButton from './SortFilterButton';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useData } from '../context/DataContext';
import { getZoneFromOriginToState } from '../utils/uspsZones';
import ExportButton from './ExportButton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerStats {
  customer: string;
  orderCount: number;
  volumePercent: number;
  avgWeight: number;
  avgOrderValue: number;
  avgShippingCost: number;
  avgZone: number;
  totalShippingCost: number;
  totalOrderValue: number;
}

type SortKey = keyof Omit<CustomerStats, 'customer'>;
type SortDir = 'asc' | 'desc';
type GapSortKey = 'fullName' | 'shipments' | 'Label Cost' | 'Total Charged' | 'gap' | 'gapPct';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toYearMonth(dateStr: string): string {
  if (!dateStr) return '';
  const iso = dateStr.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const us = dateStr.match(/^(\d{1,2})\/\d+\/(\d{4})/);
  if (us) return `${us[2]}-${us[1].padStart(2, '0')}`;
  return '';
}

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(month) - 1]} ${year.slice(2)}`;
}

function fmt$(n: number) {
  return '$' + n.toFixed(2);
}
function fmtBig$(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function fmtN(n: number) {
  return n.toLocaleString();
}

const PALETTE = [
  '#4472E8', '#EF5252', '#22C55E', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#EC4899', '#14B8A6', '#A78BFA',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-black" style={{ color: accent || '#252F3E' }}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-gray-300">↕</span>;
  return <span className="ml-1" style={{ color: '#4472E8' }}>{dir === 'desc' ? '↓' : '↑'}</span>;
}

const CustomBarTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl p-3 shadow-xl text-sm"
      style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: '150px' }}
    >
      <div className="font-bold text-white mb-1 truncate" style={{ maxWidth: 180 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-gray-300">
          {p.name}: <span className="text-white font-semibold">{typeof p.value === 'number' && p.name.includes('$') ? fmtBig$(p.value) : fmtN(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ThreePLTab() {
  const { rawShipments, warehouses } = useData();
  const [sortKey, setSortKey] = useState<SortKey>('orderCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tableExpanded, setTableExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const primaryWarehouse = warehouses[0];
  const originZip = primaryWarehouse?.zip?.trim() || '';

  const hasData = rawShipments.length > 0;

  // Determine if data has 3PL customer field
  const has3PLField = useMemo(() => {
    return rawShipments.some(s => s.customer3pl && s.customer3pl !== '');
  }, [rawShipments]);

  // Build per-customer stats
  const customerStats = useMemo<CustomerStats[]>(() => {
    if (!hasData) return [];

    const map = new Map<string, {
      count: number;
      totalWeight: number;
      totalOrderValue: number;
      totalShippingCost: number;
      totalZone: number;
      zoneCount: number;
    }>();

    const totalShipments = rawShipments.length;

    for (const s of rawShipments) {
      const key = s.customer3pl || '(Unassigned)';
      const existing = map.get(key) || {
        count: 0, totalWeight: 0, totalOrderValue: 0,
        totalShippingCost: 0, totalZone: 0, zoneCount: 0,
      };

      let zone = 0;
      if (originZip && s.state) {
        zone = getZoneFromOriginToState(originZip, s.state);
      }

      map.set(key, {
        count: existing.count + 1,
        totalWeight: existing.totalWeight + s.weight,
        totalOrderValue: existing.totalOrderValue + s.totalShippingCharged,
        totalShippingCost: existing.totalShippingCost + s.labelCost,
        totalZone: existing.totalZone + (zone > 0 ? zone : 0),
        zoneCount: existing.zoneCount + (zone > 0 ? 1 : 0),
      });
    }

    const results: CustomerStats[] = [];
    map.forEach((v, customer) => {
      results.push({
        customer,
        orderCount: v.count,
        volumePercent: totalShipments > 0 ? (v.count / totalShipments) * 100 : 0,
        avgWeight: v.count > 0 ? v.totalWeight / v.count : 0,
        avgOrderValue: v.count > 0 ? v.totalOrderValue / v.count : 0,
        avgShippingCost: v.count > 0 ? v.totalShippingCost / v.count : 0,
        avgZone: v.zoneCount > 0 ? v.totalZone / v.zoneCount : 0,
        totalShippingCost: v.totalShippingCost,
        totalOrderValue: v.totalOrderValue,
      });
    });

    return results;
  }, [rawShipments, hasData, originZip]);

  // Monthly volume trends per customer (top 5 by order count)
  const volumeTrends = useMemo(() => {
    if (!hasData || !has3PLField) return { chartData: [], topCustomers: [] };

    const top5 = [...customerStats]
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 5)
      .map(c => c.customer);

    // Build month → customer → count map
    const map: Record<string, Record<string, number>> = {};
    for (const s of rawShipments) {
      const cust = s.customer3pl || '(Unassigned)';
      if (!top5.includes(cust)) continue;
      const month = toYearMonth(s.orderDate);
      if (!month) continue;
      if (!map[month]) map[month] = {};
      map[month][cust] = (map[month][cust] || 0) + 1;
    }

    const allMonths = Object.keys(map).sort();
    const chartData = allMonths.map(m => {
      const point: Record<string, string | number> = { month: formatMonth(m) };
      for (const c of top5) point[c] = map[m]?.[c] ?? 0;
      return point;
    });

    return { chartData, topCustomers: top5 };
  }, [rawShipments, customerStats, hasData, has3PLField]);

  // Totals for summary cards
  const totals = useMemo(() => {
    if (customerStats.length === 0) return null;
    return {
      customers: customerStats.length,
      shipments: customerStats.reduce((s, c) => s + c.orderCount, 0),
      totalShippingCost: customerStats.reduce((s, c) => s + c.totalShippingCost, 0),
      totalOrderValue: customerStats.reduce((s, c) => s + c.totalOrderValue, 0),
      avgZone: (() => {
        const zones = customerStats.filter(c => c.avgZone > 0);
        return zones.length > 0 ? zones.reduce((s, c) => s + c.avgZone, 0) / zones.length : 0;
      })(),
    };
  }, [customerStats]);

  // Sorting
  const handleSort = (key: SortKey) => {
    setTableExpanded(false);
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    const filtered = search.trim()
      ? customerStats.filter(c => c.customer.toLowerCase().includes(search.toLowerCase()))
      : customerStats;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [customerStats, sortKey, sortDir, search]);

  // Top 10 by order count for bar chart
  const top10 = useMemo(() => {
    return [...customerStats]
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 10)
      .map(c => ({
        name: c.customer.length > 20 ? c.customer.slice(0, 18) + '…' : c.customer,
        fullName: c.customer,
        Orders: c.orderCount,
      }));
  }, [customerStats]);

  // Top 10 by avg shipping cost
// Label cost vs total charged per account
  const costGapByAccount = useMemo(() => {
    return customerStats
      .filter(c => c.totalOrderValue > 0)
      .map(c => ({
        name: c.customer.length > 24 ? c.customer.slice(0, 22) + '…' : c.customer,
        fullName: c.customer,
        'Label Cost': parseFloat(c.avgShippingCost.toFixed(2)),
        'Total Charged': parseFloat(c.avgOrderValue.toFixed(2)),
        gap: parseFloat((c.avgOrderValue - c.avgShippingCost).toFixed(2)),
        gapPct: c.avgShippingCost > 0
          ? parseFloat((((c.avgOrderValue - c.avgShippingCost) / c.avgShippingCost) * 100).toFixed(1))
          : 0,
        shipments: c.orderCount,
      }));
  }, [customerStats]);

  const hasCostGapData = costGapByAccount.length > 0;
  const [gapTableExpanded, setGapTableExpanded] = useState(false);
  const [gapSortKey, setGapSortKey] = useState<GapSortKey>('gap');
  const [gapSortDir, setGapSortDir] = useState<SortDir>('asc');

  const handleGapSort = (key: GapSortKey) => {
    setGapTableExpanded(false);
    if (gapSortKey === key) setGapSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setGapSortKey(key); setGapSortDir('asc'); }
  };

  const sortedGapData = useMemo(() => {
    return [...costGapByAccount].sort((a, b) => {
      const av = a[gapSortKey as keyof typeof a] as string | number;
      const bv = b[gapSortKey as keyof typeof b] as string | number;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return gapSortDir === 'asc' ? cmp : -cmp;
    });
  }, [costGapByAccount, gapSortKey, gapSortDir]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!hasData) {
    return (
      <div className="p-6" style={{ fontFamily: "'Metropolis', sans-serif" }}>
        <h1 className="text-2xl font-black mb-2" style={{ color: '#252F3E' }}>3PL Child Account Breakdown</h1>
        <p className="text-sm text-gray-500 mb-6">Per-customer volume, cost, and shipping analytics.</p>
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)' }}
        >
          <div className="text-3xl mb-2">📦</div>
          <p className="text-sm font-semibold" style={{ color: '#92650a' }}>
            Upload a ShipHero CSV report on the Network Optimization tab first.
          </p>
        </div>
      </div>
    );
  }

  if (!has3PLField) {
    return (
      <div className="p-6" style={{ fontFamily: "'Metropolis', sans-serif" }}>
        <h1 className="text-2xl font-black mb-2" style={{ color: '#252F3E' }}>3PL Child Account Breakdown</h1>
        <p className="text-sm text-gray-500 mb-6">Per-customer volume, cost, and shipping analytics.</p>
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        >
          <div className="text-3xl mb-2">🔍</div>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            No <strong>3PL Customer</strong> column detected in this CSV. This tab requires a ShipHero 3PL export
            that includes a customer or brand identifier column
            (e.g. <code className="bg-gray-100 px-1 rounded">3PL Customer</code>, <code className="bg-gray-100 px-1 rounded">Brand</code>,&nbsp;
            <code className="bg-gray-100 px-1 rounded">Account</code>).
          </p>
          <p className="text-xs text-gray-400 mt-3">
            {rawShipments.length.toLocaleString()} shipments loaded — all appear to share a single account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-screen-2xl mx-auto" style={{ fontFamily: "'Metropolis', sans-serif", color: '#252F3E' }}>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black" style={{ color: '#252F3E' }}>3PL Child Account Breakdown</h1>
        <p className="text-sm text-gray-500 mt-1">
          Per-customer volume, package size, shipping cost, and zone analytics.
        </p>
      </div>

      {/* Summary KPIs */}
      {totals && (
        <>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-400">3PL Account Summary</span>
          <InsightGate sectionKey="threePlKPIs" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <SummaryCard
            label="3PL Customers"
            value={fmtN(totals.customers)}
            sub="unique accounts"
            accent="#4472E8"
          />
          <SummaryCard
            label="Total Shipments"
            value={fmtN(totals.shipments)}
            sub="across all accounts"
          />
          <SummaryCard
            label="Total Label Cost"
            value={fmtBig$(totals.totalShippingCost)}
            sub="sum of label costs"
            accent="#EF5252"
          />
          <SummaryCard
            label="Total Billed"
            value={fmtBig$(totals.totalOrderValue)}
            sub="total shipping charged"
            accent="#22C55E"
          />
          <SummaryCard
            label="Overall Avg Zone"
            value={totals.avgZone > 0 ? totals.avgZone.toFixed(1) : '—'}
            sub={originZip ? `from ZIP ${originZip}` : 'configure warehouse ZIP'}
            accent="#8B5CF6"
          />
        </div>
        </>
      )}

      {/* Order Volume Trends */}
      {volumeTrends.chartData.length > 0 && (
        <div
          className="rounded-xl p-5 mb-6"
          style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
        >
          <div className="flex items-start justify-between mb-1">
            <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Order Volume Trends</h3>
            <div className="flex items-center gap-2">
              <InsightGate sectionKey="volumeTrend" />
              <ExportButton data={volumeTrends.chartData} filename="order_volume_trends" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">Monthly shipment count for top 5 accounts</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={volumeTrends.chartData} margin={{ top: 4, right: 16, left: 0, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}
                angle={-20}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <RechartsTooltip
                contentStyle={{ background: '#252F3E', border: 'none', borderRadius: 12, color: '#fff', fontSize: 12, fontFamily: "'Metropolis', sans-serif" }}
                labelStyle={{ fontWeight: 'bold', marginBottom: 4 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Metropolis', sans-serif" }} />
              {volumeTrends.topCustomers.map((cust, i) => (
                <Line
                  key={cust}
                  type="monotone"
                  dataKey={cust}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Volume by customer */}
        <div
          className="rounded-xl p-5"
          style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
        >
          <div className="flex items-start justify-between mb-1">
            <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Top Accounts by Order Volume</h3>
            <div className="flex items-center gap-2">
              <InsightGate sectionKey="accountOverview" />
              <ExportButton
                data={top10.map((r) => ({ Account: r.fullName, Orders: r.Orders }))}
                filename="top_accounts_by_volume"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">Shipment count per customer (top 10)</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => fmtN(v)}
                tick={{ fontSize: 10, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 10, fill: '#252F3E', fontFamily: "'Metropolis', sans-serif" }}
              />
              <RechartsTooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const item = top10.find(t => t.name === label);
                  return (
                    <div className="rounded-xl p-3 shadow-xl text-sm" style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)' }}>
                      <div className="font-bold text-white mb-1">{item?.fullName || label}</div>
                      <div className="text-gray-300">Orders: <span className="text-white font-semibold">{fmtN(payload[0].value as number)}</span></div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="Orders" radius={[0, 4, 4, 0]}>
                {top10.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* Label Cost vs Total Charged — all child accounts */}
      {hasCostGapData && (
        <div
          className="rounded-xl overflow-hidden mb-6"
          style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
        >
          {/* Panel header */}
          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap" style={{ borderBottom: '1px solid #e5e7eb' }}>
            <div>
              <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Label Cost vs Total Charged</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Avg label cost (what the 3PL pays) vs avg amount billed to customer — gap reflects surcharges &amp; margin
              </p>
            </div>
            <div className="flex items-center gap-2">
              <InsightGate sectionKey="costGap" />
              <ExportButton
                data={costGapByAccount.map(r => ({
                  Account: r.fullName,
                  Shipments: r.shipments,
                  'Avg Label Cost ($)': r['Label Cost'],
                  'Avg Total Charged ($)': r['Total Charged'],
                  'Avg Gap ($)': r.gap,
                  'Gap %': r.gapPct,
                }))}
                filename="label_cost_vs_total_charged"
              />
              <SortFilterButton
                sortKey={gapSortKey}
                sortDir={gapSortDir}
                defaultSortKey="gap"
                defaultSortDir="asc"
                onSort={(k, d) => { setGapSortKey(k as GapSortKey); setGapSortDir(d); setGapTableExpanded(false); }}
                options={[
                  { key: 'fullName',       label: 'Account',         descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'shipments',      label: 'Shipments',       descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'Label Cost',     label: 'Avg Label Cost',  descLabel: '↓ High', ascLabel: '↑ Low' },
                  { key: 'Total Charged',  label: 'Avg Total Charged', descLabel: '↓ High', ascLabel: '↑ Low' },
                  { key: 'gap',            label: 'Avg Gap',         descLabel: '↓ High', ascLabel: '↑ Low' },
                  { key: 'gapPct',         label: 'Gap %',           descLabel: '↓ High', ascLabel: '↑ Low' },
                ]}
              />
            </div>
          </div>

          {/* Data table */}
          <div className="overflow-x-auto" style={{ borderTop: '1px solid #f3f4f6' }}>
            <table className="w-full text-sm" style={{ minWidth: '640px' }}>
              <thead>
                <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                  {([
                    { key: 'fullName' as GapSortKey, label: 'Account', align: 'left' },
                    { key: 'shipments' as GapSortKey, label: 'Shipments', align: 'right' },
                    { key: 'Label Cost' as GapSortKey, label: 'Avg Label Cost', align: 'right', color: '#4472E8' },
                    { key: 'Total Charged' as GapSortKey, label: 'Avg Total Charged', align: 'right', color: '#EF5252' },
                    { key: 'gap' as GapSortKey, label: 'Avg Gap', align: 'right' },
                    { key: 'gapPct' as GapSortKey, label: 'Gap %', align: 'right' },
                  ]).map(({ key, label, align, color }) => (
                    <th
                      key={key}
                      onClick={() => handleGapSort(key)}
                      className={`px-4 py-2.5 text-${align} text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap`}
                      style={{ color: gapSortKey === key ? '#4472E8' : (color ?? '#252F3E') }}
                    >
                      {label}
                      <SortIcon active={gapSortKey === key} dir={gapSortDir} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(gapTableExpanded ? sortedGapData : sortedGapData.slice(0, 5)).map((r, idx) => (
                  <tr
                    key={r.fullName}
                    style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)', borderBottom: '1px solid #f3f4f6' }}
                  >
                    <td className="px-4 py-2.5 font-bold" style={{ color: '#252F3E' }}>{r.fullName}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 font-semibold">{fmtN(r.shipments)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold" style={{ color: '#4472E8' }}>{fmt$(r['Label Cost'])}</td>
                    <td className="px-4 py-2.5 text-right font-semibold" style={{ color: '#EF5252' }}>{fmt$(r['Total Charged'])}</td>
                    <td className="px-4 py-2.5 text-right font-bold" style={{ color: r.gap >= 0 ? '#22C55E' : '#EF4444' }}>
                      {r.gap >= 0 ? '+' : ''}{fmt$(r.gap)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-bold"
                        style={{
                          background: r.gapPct >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)',
                          color: r.gapPct >= 0 ? '#15803D' : '#b91c1c',
                          border: `1px solid ${r.gapPct >= 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                        }}
                      >
                        {r.gapPct >= 0 ? '+' : ''}{r.gapPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {costGapByAccount.length > 5 && (
            <div className="py-2.5 text-center" style={{ borderTop: '1px solid #f3f4f6' }}>
              <button
                onClick={() => setGapTableExpanded(e => !e)}
                className="text-xs font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-80"
                style={{ background: '#F5F5F0', color: '#4472E8', border: '1px solid #e5e7eb' }}
              >
                {gapTableExpanded ? '↑ Show less' : `↓ Show all ${costGapByAccount.length} accounts`}
              </button>
            </div>
          )}

          {/* Note */}
          <div className="px-5 py-3" style={{ borderTop: '1px solid #f3f4f6', background: '#FAFAF8' }}>
            <p className="text-xs text-gray-400">
              <span className="font-semibold text-gray-500">Note: </span>
              Gap = Total Charged − Label Cost. A positive gap means the customer was billed more than the carrier charged (surcharges, markup). Requires a <code className="bg-gray-100 px-1 rounded">Total Shipping Charged</code> column in the CSV.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
      >
        {/* Table header */}
        <div
          className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ borderBottom: '1px solid #e5e7eb' }}
        >
          <div>
            <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Account Detail Table</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {sorted.length} of {customerStats.length} accounts
              {search && <span className="ml-1 font-semibold" style={{ color: '#4472E8' }}>· filtered</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InsightGate sectionKey="accountDetailTable" />
            <ExportButton
              data={sorted.map((c) => ({
                Account: c.customer,
                'Order Count': c.orderCount,
                '% of Volume': parseFloat(c.volumePercent.toFixed(1)),
                'Avg Package Size (lb)': parseFloat(c.avgWeight.toFixed(2)),
                'Avg Shipping Cost ($)': parseFloat(c.avgShippingCost.toFixed(2)),
                'Avg Zone': c.avgZone > 0 ? parseFloat(c.avgZone.toFixed(1)) : '',
              }))}
              filename="3pl_account_detail"
            />
            <SortFilterButton
              sortKey={sortKey}
              sortDir={sortDir}
              defaultSortKey="orderCount"
              defaultSortDir="desc"
              hasActiveFilter={!!search}
              onSort={(k, d) => { setSortKey(k as SortKey); setSortDir(d); setTableExpanded(false); }}
              options={[
                { key: 'orderCount',      label: '# Orders',      descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                { key: 'volumePercent',   label: '% Volume',      descLabel: '↓ High', ascLabel: '↑ Low' },
                { key: 'avgWeight',       label: 'Avg Pkg Size',  descLabel: '↓ Heavy', ascLabel: '↑ Light' },
                { key: 'avgShippingCost', label: 'Avg Ship Cost', descLabel: '↓ High', ascLabel: '↑ Low' },
                { key: 'avgZone',         label: 'Avg Zone',      descLabel: '↓ Far', ascLabel: '↑ Near' },
              ]}
              extraContent={
                <div>
                  <div className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#9CA3AF' }}>
                    Search
                  </div>
                  <input
                    type="text"
                    placeholder="Filter accounts..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setTableExpanded(false); }}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: '#F5F5F0',
                      border: '1.5px solid #E5E7EB',
                      color: '#252F3E',
                      outline: 'none',
                    }}
                  />
                  {search && (
                    <button
                      onClick={() => { setSearch(''); setTableExpanded(false); }}
                      className="mt-1.5 w-full text-xs font-bold py-1 rounded-lg transition-all"
                      style={{ background: '#FEE2E2', color: '#b91c1c', border: '1px solid #FECACA' }}
                    >
                      Clear search
                    </button>
                  )}
                </div>
              }
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '860px' }}>
            <thead>
              <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide sticky left-0" style={{ background: '#F5F5F0', color: '#252F3E', minWidth: '160px' }}>
                  Account
                </th>
                {(
                  [
                    { key: 'orderCount', label: '# Orders' },
                    { key: 'volumePercent', label: '% Volume' },
                    { key: 'avgWeight', label: 'Avg Pkg Size' },
                    { key: 'avgShippingCost', label: 'Avg Ship Cost' },
                    { key: 'avgZone', label: 'Avg Zone' },
                  ] as { key: SortKey; label: string }[]
                ).map(col => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                    style={{ color: sortKey === col.key ? '#4472E8' : '#252F3E' }}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    <SortIcon active={sortKey === col.key} dir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(tableExpanded ? sorted : sorted.slice(0, 5)).map((c, idx) => {
                const color = PALETTE[
                  customerStats
                    .sort((a, b) => b.orderCount - a.orderCount)
                    .findIndex(x => x.customer === c.customer) % PALETTE.length
                ];
                return (
                  <tr
                    key={c.customer}
                    style={{
                      background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    {/* Account name */}
                    <td className="px-4 py-3 sticky left-0" style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)' }}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: color }}
                        />
                        <span className="font-bold text-sm" style={{ color: '#252F3E' }}>{c.customer}</span>
                      </div>
                    </td>

                    {/* # Orders */}
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#252F3E' }}>
                      {fmtN(c.orderCount)}
                    </td>

                    {/* % Volume — inline bar */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${Math.min(c.volumePercent, 100)}%`, background: color }}
                          />
                        </div>
                        <span className="font-bold text-xs w-10 text-right" style={{ color: '#252F3E' }}>
                          {c.volumePercent.toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    {/* Avg Pkg Size (weight) */}
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#374151' }}>
                      {c.avgWeight.toFixed(2)} lb
                    </td>

                    {/* Avg Shipping Cost (label cost) */}
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#EF5252' }}>
                      {fmt$(c.avgShippingCost)}
                    </td>

                    {/* Avg Zone */}
                    <td className="px-4 py-3 text-right">
                      {c.avgZone > 0 ? (
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-black"
                          style={{
                            background: c.avgZone <= 3 ? 'rgba(34,197,94,0.1)' : c.avgZone <= 5 ? 'rgba(245,166,35,0.1)' : 'rgba(239,68,68,0.1)',
                            color: c.avgZone <= 3 ? '#15803D' : c.avgZone <= 5 ? '#92650a' : '#b91c1c',
                            border: `1px solid ${c.avgZone <= 3 ? 'rgba(34,197,94,0.3)' : c.avgZone <= 5 ? 'rgba(245,166,35,0.3)' : 'rgba(239,68,68,0.3)'}`,
                          }}
                        >
                          {c.avgZone.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-8 text-sm text-gray-400">
            No accounts match your search.
          </div>
        )}

        {sorted.length > 5 && (
          <div className="py-2.5 text-center" style={{ borderTop: '1px solid #f3f4f6' }}>
            <button
              onClick={() => setTableExpanded(e => !e)}
              className="text-xs font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-80"
              style={{ background: '#F5F5F0', color: '#4472E8', border: '1px solid #e5e7eb' }}
            >
              {tableExpanded ? '↑ Show less' : `↓ Show all ${sorted.length} accounts`}
            </button>
          </div>
        )}

        {/* Footer note */}
        <div className="px-5 py-3" style={{ borderTop: '1px solid #f3f4f6', background: '#FAFAF8' }}>
          <p className="text-xs text-gray-400">
            <span className="font-semibold text-gray-500">Column definitions: </span>
            <strong>Avg Pkg Size</strong> = avg shipment weight (lbs) ·{' '}
            <strong>Avg Ship Cost</strong> = avg label cost paid ·{' '}
            <strong>Avg Zone</strong> = avg USPS zone from primary warehouse
            {!originZip && <span className="text-amber-600"> (configure warehouse ZIP on Network tab for zone data)</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
