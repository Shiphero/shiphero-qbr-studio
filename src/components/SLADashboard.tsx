/**
 * SLADashboard.tsx
 * Flowspace SLA metrics dashboard — Phase 1 (file upload + visualization).
 * Phase 2 will add Gmail ingestion to automatically pull CSV attachments.
 *
 * Supported uploads:
 *  - Parcel Shipment Report     → transit / carrier SLA
 *  - Outbound Order Report      → ship-time SLA, error rate
 *  - Channel Analytics Report   → pre-aggregated channel performance
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  parseFlowspaceCSV,
  computeSLAKPIs,
  buildShipSLATimeSeries,
  buildTransitTimeSeries,
  buildChannelSLA,
  buildRecentOrders,
  type ParsedReport,
  type Granularity,
  type SLAOrderRow,
} from '../utils/slaParser';

// ─── Design tokens (mirrors rest of app) ─────────────────────────────────────
const NAVY    = '#252F3E';
const BLUE    = '#4472E8';
const GREEN   = '#22C55E';
const ORANGE  = '#F97316';
const RED     = '#EF4444';
const YELLOW  = '#F59E0B';
const GRAY    = '#6B7280';
const BG      = '#F0F1F3';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(n: number | null, decimals = 1): string {
  if (n === null) return '—';
  return `${n.toFixed(decimals)}%`;
}
function fmt(n: number | null, decimals = 1): string {
  if (n === null) return '—';
  return n.toFixed(decimals);
}
function currency(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toFixed(2)}`;
}

function statusColor(s: SLAOrderRow['shipStatus']): string {
  switch (s) {
    case 'same-day': return GREEN;
    case 'on-time':  return BLUE;
    case 'late':     return RED;
    case 'pending':  return YELLOW;
    default:         return GRAY;
  }
}
function statusLabel(s: SLAOrderRow['shipStatus']): string {
  switch (s) {
    case 'same-day': return 'Same-day';
    case 'on-time':  return 'On-time';
    case 'late':     return 'Late';
    case 'pending':  return 'Pending';
    default:         return 'Unknown';
  }
}

// Shorten channel labels for chart axes
function shortChannel(c: string): string {
  return c.replace(/^Shopify - /i, '').replace(/^Amazon - /i, '').replace(/^TikTok Shop/i, 'TikTok').slice(0, 22);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, color = NAVY, emoji,
}: {
  label: string; value: string; sub?: string; color?: string; emoji?: string;
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      border: '0.5px solid rgba(0,0,0,0.07)',
      padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 140,
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: GRAY, display: 'flex', gap: 5, alignItems: 'center' }}>
        {emoji && <span>{emoji}</span>}{label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: GRAY }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      border: '0.5px solid rgba(0,0,0,0.07)',
      padding: '20px 24px',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
    if (files.length) onFiles(files);
  }, [onFiles]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? BLUE : 'rgba(0,0,0,0.15)'}`,
        borderRadius: 12,
        padding: '36px 24px',
        textAlign: 'center',
        background: dragging ? 'rgba(68,114,232,0.04)' : '#fff',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: NAVY, marginBottom: 4 }}>
        Drop Flowspace CSV reports here
      </div>
      <div style={{ fontSize: 12, color: GRAY }}>
        Accepts: Parcel Shipment, Outbound Orders, Channel Analytics
      </div>
      <div style={{
        display: 'inline-block',
        marginTop: 14, padding: '7px 18px',
        borderRadius: 7, background: BLUE,
        color: '#fff', fontSize: 12, fontWeight: 500,
      }}>
        Browse files
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function SLADashboard() {
  const [reports, setReports]         = useState<ParsedReport[]>([]);
  const [loading, setLoading]         = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [activeTab, setActiveTab]     = useState<'overview' | 'transit' | 'channels' | 'orders'>('overview');
  const [tableFilter, setTableFilter] = useState<'all' | 'late' | 'issues'>('all');

  // ── File ingestion ─────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    setLoading(true);
    const newReports: ParsedReport[] = [];
    for (const file of files) {
      const text = await file.text();
      newReports.push(parseFlowspaceCSV(file.name, text));
    }
    setReports(prev => {
      // Dedupe by filename — newer upload wins
      const existing = prev.filter(r => !newReports.find(n => n.filename === r.filename));
      return [...existing, ...newReports];
    });
    setLoading(false);
  }, []);

  const removeReport = (filename: string) =>
    setReports(prev => prev.filter(r => r.filename !== filename));

  // ── Aggregate all parsed rows ──────────────────────────────────────────────
  const allParcel   = useMemo(() => reports.flatMap(r => r.parcelRows),   [reports]);
  const allOutbound = useMemo(() => reports.flatMap(r => r.outboundRows), [reports]);
  const allChannel  = useMemo(() => reports.flatMap(r => r.channelRows),  [reports]);

  // Date filter
  const filteredParcel = useMemo(() => {
    if (!dateFrom && !dateTo) return allParcel;
    return allParcel.filter(r => {
      const d = r.shippedAt || r.creationDate;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      return true;
    });
  }, [allParcel, dateFrom, dateTo]);

  const filteredOutbound = useMemo(() => {
    if (!dateFrom && !dateTo) return allOutbound;
    return allOutbound.filter(r => {
      const d = r.openDate || r.creationDate;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      return true;
    });
  }, [allOutbound, dateFrom, dateTo]);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const kpis      = useMemo(() => computeSLAKPIs(filteredParcel, filteredOutbound), [filteredParcel, filteredOutbound]);
  const shipSeries = useMemo(() => buildShipSLATimeSeries(filteredOutbound, granularity), [filteredOutbound, granularity]);
  const transitSeries = useMemo(() => buildTransitTimeSeries(filteredParcel, granularity), [filteredParcel, granularity]);
  const channelSLA = useMemo(() => buildChannelSLA(filteredOutbound), [filteredOutbound]);
  const recentOrders = useMemo(() => buildRecentOrders(filteredOutbound, 200), [filteredOutbound]);

  const filteredOrders = useMemo(() => {
    if (tableFilter === 'late')   return recentOrders.filter(r => r.shipStatus === 'late');
    if (tableFilter === 'issues') return recentOrders.filter(r => r.issueReported);
    return recentOrders;
  }, [recentOrders, tableFilter]);

  const hasData = allParcel.length > 0 || allOutbound.length > 0 || allChannel.length > 0;
  const hasOutbound = filteredOutbound.length > 0;
  const hasParcel   = filteredParcel.length > 0;

  // ── Period label helper ────────────────────────────────────────────────────
  const fmtPeriod = (p: string) => {
    if (granularity === 'week') {
      const d = new Date(p);
      return `${(d.getMonth() + 1)}/${d.getDate()}`;
    }
    return p;
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '28px 32px',
      fontFamily: "'Metropolis', sans-serif",
      background: BG,
      minHeight: '100%',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: NAVY, margin: 0 }}>SLA Dashboard</h1>
          <p style={{ fontSize: 13, color: GRAY, margin: '4px 0 0' }}>
            Flowspace fulfillment SLA metrics — upload scheduled reports or connect Gmail to auto-ingest
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Gmail Phase 2 pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            background: 'rgba(234,67,53,0.07)',
            border: '0.5px solid rgba(234,67,53,0.2)',
            color: '#D93025',
            fontSize: 11, fontWeight: 500,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Gmail auto-ingest · coming soon
          </div>
        </div>
      </div>

      {/* ── Upload + loaded files ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: hasData ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 24 }}>
        <UploadZone onFiles={handleFiles} />

        {hasData && (
          <Card>
            <SectionHeader title="Loaded reports" sub={`${reports.length} file${reports.length !== 1 ? 's' : ''} · ${allOutbound.length.toLocaleString()} outbound orders · ${allParcel.length.toLocaleString()} parcels`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reports.map(r => (
                <div key={r.filename} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 7,
                  background: '#F9FAFB', border: '0.5px solid rgba(0,0,0,0.06)',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: NAVY }}>{r.filename.replace(/^Flowspace_/, '').replace(/_\d{14}\.csv$/, '.csv')}</div>
                    <div style={{ fontSize: 11, color: GRAY }}>{r.type} · {r.rowCount.toLocaleString()} rows</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: r.type === 'Unknown' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                      color:      r.type === 'Unknown' ? RED : GREEN,
                    }}>
                      {r.type === 'Unknown' ? 'Unrecognised' : '✓ Parsed'}
                    </div>
                    <button
                      onClick={() => removeReport(r.filename)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: GRAY, fontSize: 14, padding: '2px 4px', lineHeight: 1 }}
                      title="Remove"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: GRAY, fontSize: 14 }}>Parsing CSVs…</div>
      )}

      {!hasData && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: GRAY }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: NAVY, marginBottom: 6 }}>No data loaded yet</div>
          <div style={{ fontSize: 13 }}>Upload a Flowspace Parcel Shipment or Outbound Order report to see SLA metrics.</div>
        </div>
      )}

      {hasData && !loading && (
        <>
          {/* ── Filters ──────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: GRAY }}>Date range:</div>
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.15)', fontFamily: 'inherit', background: '#fff' }}
            />
            <span style={{ color: GRAY, fontSize: 12 }}>to</span>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.15)', fontFamily: 'inherit', background: '#fff' }}
            />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                style={{ fontSize: 11, color: RED, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear
              </button>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {(['week', 'month'] as Granularity[]).map(g => (
                <button key={g} onClick={() => setGranularity(g)}
                  style={{
                    fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 6,
                    border: '0.5px solid',
                    borderColor: granularity === g ? BLUE : 'rgba(0,0,0,0.12)',
                    background:  granularity === g ? BLUE : '#fff',
                    color:       granularity === g ? '#fff' : GRAY,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {g === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>

          {/* ── KPI Cards ────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {hasOutbound && (
              <>
                <KPICard
                  emoji="✅" label="On-time ship rate"
                  value={pct(kpis.onTimeShipRate)}
                  sub={`${kpis.lateShipCount} late of ${kpis.totalOrdersWithSLA.toLocaleString()} orders`}
                  color={kpis.onTimeShipRate !== null && kpis.onTimeShipRate >= 95 ? GREEN : kpis.onTimeShipRate !== null && kpis.onTimeShipRate >= 85 ? ORANGE : RED}
                />
                <KPICard
                  emoji="⚡" label="Same-day ship rate"
                  value={pct(kpis.sameDayShipRate)}
                  sub="Shipped same day as received"
                  color={BLUE}
                />
                <KPICard
                  emoji="⚠️" label="Error / issue rate"
                  value={pct(kpis.issueRate)}
                  sub={`${kpis.issueCount} issues reported`}
                  color={kpis.issueRate !== null && kpis.issueRate > 5 ? RED : kpis.issueRate !== null && kpis.issueRate > 2 ? ORANGE : GREEN}
                />
              </>
            )}
            {hasParcel && (
              <>
                <KPICard
                  emoji="🚚" label="Avg transit time"
                  value={kpis.avgTransitDays !== null ? `${fmt(kpis.avgTransitDays)} days` : '—'}
                  sub="Carrier to door"
                  color={NAVY}
                />
                <KPICard
                  emoji="📦" label="Delivered within 2 days"
                  value={pct(kpis.pctDeliveredIn2)}
                  sub="Of delivered parcels"
                  color={kpis.pctDeliveredIn2 !== null && kpis.pctDeliveredIn2 >= 40 ? GREEN : ORANGE}
                />
                <KPICard
                  emoji="💸" label="Avg shipping cost"
                  value={currency(kpis.avgTransportCost)}
                  sub="Per parcel"
                  color={NAVY}
                />
              </>
            )}
          </div>

          {/* ── Sub-tab nav ───────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.07)', marginBottom: 20 }}>
            {([
              { key: 'overview',  label: 'Ship SLA'        },
              { key: 'transit',   label: 'Transit time'    },
              { key: 'channels',  label: 'By channel'      },
              { key: 'orders',    label: 'Order table'     },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                style={{
                  padding: '8px 18px', fontSize: 12, fontWeight: activeTab === key ? 500 : 400,
                  color:   activeTab === key ? BLUE : GRAY,
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: activeTab === key ? `2px solid ${BLUE}` : '2px solid transparent',
                  fontFamily: 'inherit',
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Ship SLA tab ─────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

              {/* On-time rate over time */}
              <Card>
                <SectionHeader
                  title="On-time ship rate over time"
                  sub="% of orders shipped on or before Required Ship Date"
                />
                {shipSeries.length === 0 ? (
                  <EmptyState msg="No outbound order data with Required Ship Date" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={shipSeries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="period" tickFormatter={fmtPeriod} tick={{ fontSize: 10, fill: GRAY }} />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip formatter={(v: number) => [`${v}%`, 'On-time']} labelFormatter={fmtPeriod} />
                      <ReferenceLine y={95} stroke={GREEN} strokeDasharray="4 3" label={{ value: '95%', position: 'right', fontSize: 9, fill: GREEN }} />
                      <Line type="monotone" dataKey="onTimeRate" stroke={BLUE} strokeWidth={2} dot={{ r: 2 }} name="On-time %" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Late vs On-time bar */}
              <Card>
                <SectionHeader title="On-time vs Late shipments" sub="Count by period" />
                {shipSeries.length === 0 ? (
                  <EmptyState msg="No outbound order data with Required Ship Date" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={shipSeries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="period" tickFormatter={fmtPeriod} tick={{ fontSize: 10, fill: GRAY }} />
                      <YAxis tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip labelFormatter={fmtPeriod} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="onTimeCount" name="On-time"  stackId="a" fill={BLUE}  radius={[0, 0, 0, 0]} />
                      <Bar dataKey="lateCount"   name="Late"     stackId="a" fill={RED}   radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Same-day ship rate */}
              <Card>
                <SectionHeader title="Same-day vs Next-day ship rate" sub="% of orders shipped within 0 or 1 day of receipt" />
                {shipSeries.length === 0 ? (
                  <EmptyState msg="No outbound order data" />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={(() => {
                        const byPeriod = new Map<string, { sameDay: number; nextDay: number; later: number }>();
                        for (const row of filteredOutbound) {
                          if (!row.openDate || !row.shippedDate) continue;
                          const gr = granularity === 'week'
                            ? (() => { const d = new Date(row.openDate); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); const m = new Date(d.setDate(diff)); return m.toISOString().slice(0, 10); })()
                            : row.openDate.slice(0, 7);
                          if (!byPeriod.has(gr)) byPeriod.set(gr, { sameDay: 0, nextDay: 0, later: 0 });
                          const b = byPeriod.get(gr)!;
                          const diff = Math.round((new Date(row.shippedDate).getTime() - new Date(row.openDate).getTime()) / 86_400_000);
                          if (diff === 0)      b.sameDay++;
                          else if (diff === 1) b.nextDay++;
                          else                 b.later++;
                        }
                        return Array.from(byPeriod.entries()).sort(([a],[b]) => a.localeCompare(b))
                          .map(([period, v]) => ({ period, ...v }));
                      })()}
                      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="period" tickFormatter={fmtPeriod} tick={{ fontSize: 10, fill: GRAY }} />
                      <YAxis tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip labelFormatter={fmtPeriod} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="sameDay" name="Same-day" stackId="a" fill={GREEN}  />
                      <Bar dataKey="nextDay" name="Next-day" stackId="a" fill={BLUE}   />
                      <Bar dataKey="later"   name="2+ days"  stackId="a" fill={ORANGE} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Summary stats table */}
              <Card>
                <SectionHeader title="Period summary" sub="On-time ship rate by reporting period" />
                {shipSeries.length === 0 ? (
                  <EmptyState msg="No outbound order data with Required Ship Date" />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                          {['Period', 'On-time', 'Late', 'Total', 'Rate'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: GRAY, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...shipSeries].reverse().map(row => (
                          <tr key={row.period} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.05)' }}>
                            <td style={{ padding: '6px 10px', color: NAVY, fontWeight: 500 }}>{fmtPeriod(row.period)}</td>
                            <td style={{ padding: '6px 10px', color: GREEN }}>{row.onTimeCount.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', color: RED }}>{row.lateCount.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px', color: GRAY }}>{row.totalOrders.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                background: row.onTimeRate >= 95 ? 'rgba(34,197,94,0.1)' : row.onTimeRate >= 85 ? 'rgba(249,115,22,0.1)' : 'rgba(239,68,68,0.1)',
                                color:      row.onTimeRate >= 95 ? GREEN : row.onTimeRate >= 85 ? ORANGE : RED,
                              }}>
                                {row.onTimeRate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ── Transit time tab ─────────────────────────────────────────────── */}
          {activeTab === 'transit' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

              <Card>
                <SectionHeader title="Average transit time" sub="Days from ship to delivery" />
                {transitSeries.length === 0 ? (
                  <EmptyState msg="No delivered parcel data" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={transitSeries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="period" tickFormatter={fmtPeriod} tick={{ fontSize: 10, fill: GRAY }} />
                      <YAxis tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip labelFormatter={fmtPeriod} />
                      <Line type="monotone" dataKey="avgDays" stroke={NAVY} strokeWidth={2} dot={{ r: 2 }} name="Avg days" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card>
                <SectionHeader title="Delivery speed breakdown" sub="% delivered within 2 / 3 / 4 / 5+ days" />
                {transitSeries.length === 0 ? (
                  <EmptyState msg="No delivered parcel data" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={transitSeries} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="period" tickFormatter={fmtPeriod} tick={{ fontSize: 10, fill: GRAY }} />
                      <YAxis unit="%" tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip labelFormatter={fmtPeriod} formatter={(v: number) => [`${v}%`]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="pctIn2"   name="≤2 days"  stackId="a" fill={GREEN}  />
                      <Bar dataKey="pctIn3"   name="3 days"   stackId="a" fill={BLUE}   />
                      <Bar dataKey="pctIn4"   name="4 days"   stackId="a" fill={YELLOW} />
                      <Bar dataKey="pct5plus" name="5+ days"  stackId="a" fill={RED}    radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Channel Analytics pre-computed data */}
              {allChannel.length > 0 && (
                <Card style={{ gridColumn: '1 / -1' }}>
                  <SectionHeader title="Channel-level transit performance" sub="From Flowspace Channel Analytics report" />
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                          {['Channel', 'Orders', 'Avg transit', '≤2 days', '≤3 days', '≤4 days', 'Avg ship cost', 'Avg fulfill cost', 'Avg zone'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: GRAY, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allChannel.map(row => (
                          <tr key={row.channel} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.05)' }}>
                            <td style={{ padding: '6px 10px', color: NAVY, fontWeight: 500, maxWidth: 200 }}>{shortChannel(row.channel)}</td>
                            <td style={{ padding: '6px 10px', color: GRAY }}>{row.ordersShipped.toLocaleString()}</td>
                            <td style={{ padding: '6px 10px' }}>{fmt(row.avgTransitDays)} d</td>
                            <td style={{ padding: '6px 10px', color: GREEN, fontWeight: 500 }}>{pct(row.pctWithin2, 1)}</td>
                            <td style={{ padding: '6px 10px', color: BLUE }}>{pct(row.pctWithin3, 1)}</td>
                            <td style={{ padding: '6px 10px' }}>{pct(row.pctWithin4, 1)}</td>
                            <td style={{ padding: '6px 10px' }}>${row.avgShipCostUnit.toFixed(2)}</td>
                            <td style={{ padding: '6px 10px' }}>${row.avgFulfillCostUnit.toFixed(2)}</td>
                            <td style={{ padding: '6px 10px' }}>{row.avgZone.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── By channel tab ───────────────────────────────────────────────── */}
          {activeTab === 'channels' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

              <Card style={{ gridColumn: '1 / -1' }}>
                <SectionHeader title="On-time ship rate by channel" sub="Based on Outbound Order report" />
                {channelSLA.length === 0 ? (
                  <EmptyState msg="No outbound order data with channel information" />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(200, channelSLA.length * 36)}>
                    <BarChart data={channelSLA} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 120 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: GRAY }} />
                      <YAxis type="category" dataKey="channel" tick={{ fontSize: 10, fill: NAVY }} width={120} />
                      <Tooltip formatter={(v: number) => [`${v}%`, 'On-time']} />
                      <ReferenceLine x={95} stroke={GREEN} strokeDasharray="4 3" />
                      <Bar dataKey="onTimeRate" name="On-time %" fill={BLUE} radius={[0, 4, 4, 0]}>
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card>
                <SectionHeader title="Orders per channel" sub="Total outbound orders (filtered period)" />
                {channelSLA.length === 0 ? (
                  <EmptyState msg="No channel data" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={channelSLA.slice(0, 10)} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="channel" tick={{ fontSize: 9, fill: GRAY }} angle={-30} textAnchor="end" />
                      <YAxis tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip />
                      <Bar dataKey="totalOrders" name="Orders" fill={NAVY} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card>
                <SectionHeader title="Issues by channel" sub="Reported issue count" />
                {channelSLA.length === 0 ? (
                  <EmptyState msg="No channel data" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={channelSLA.filter(c => c.issueCount > 0).slice(0, 10)} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="channel" tick={{ fontSize: 9, fill: GRAY }} angle={-30} textAnchor="end" />
                      <YAxis tick={{ fontSize: 10, fill: GRAY }} />
                      <Tooltip />
                      <Bar dataKey="issueCount" name="Issues" fill={ORANGE} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>
          )}

          {/* ── Order table tab ───────────────────────────────────────────────── */}
          {activeTab === 'orders' && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <SectionHeader
                  title="Recent orders"
                  sub={`Showing ${filteredOrders.length.toLocaleString()} of ${recentOrders.length.toLocaleString()} orders`}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  {([
                    { key: 'all',    label: 'All' },
                    { key: 'late',   label: '⚠ Late only' },
                    { key: 'issues', label: '🔴 Issues only' },
                  ] as const).map(({ key, label }) => (
                    <button key={key} onClick={() => setTableFilter(key)}
                      style={{
                        fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
                        border: '0.5px solid',
                        borderColor: tableFilter === key ? BLUE : 'rgba(0,0,0,0.12)',
                        background:  tableFilter === key ? BLUE : '#fff',
                        color:       tableFilter === key ? '#fff' : GRAY,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                      {['Order', 'Channel', 'Warehouse', 'Open', 'Required ship', 'Shipped', 'Days to ship', 'Status', 'Issues'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: GRAY, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.slice(0, 150).map(row => (
                      <tr key={row.order} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.04)' }}>
                        <td style={{ padding: '5px 10px', color: NAVY, fontFamily: 'monospace', fontSize: 11 }}>{row.order}</td>
                        <td style={{ padding: '5px 10px', color: GRAY, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortChannel(row.channel)}</td>
                        <td style={{ padding: '5px 10px', color: GRAY, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.warehouse.replace(/^"/, '').replace(/"$/, '').split(',')[0]}</td>
                        <td style={{ padding: '5px 10px', color: GRAY, whiteSpace: 'nowrap' }}>{row.openDate}</td>
                        <td style={{ padding: '5px 10px', color: GRAY, whiteSpace: 'nowrap' }}>{row.requiredDate || '—'}</td>
                        <td style={{ padding: '5px 10px', color: GRAY, whiteSpace: 'nowrap' }}>{row.shippedDate || '—'}</td>
                        <td style={{ padding: '5px 10px', color: GRAY }}>{row.daysToShip !== null ? `${row.daysToShip}d` : '—'}</td>
                        <td style={{ padding: '5px 10px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: `${statusColor(row.shipStatus)}18`,
                            color: statusColor(row.shipStatus),
                          }}>
                            {statusLabel(row.shipStatus)}
                          </span>
                        </td>
                        <td style={{ padding: '5px 10px' }}>
                          {row.issueReported ? (
                            <span style={{ color: RED, fontSize: 11 }} title={row.issueTypes || 'Issue reported'}>
                              ⚠ {row.issueTypes ? row.issueTypes.slice(0, 24) : 'Reported'}
                            </span>
                          ) : <span style={{ color: GRAY }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredOrders.length > 150 && (
                  <div style={{ padding: '10px 10px', fontSize: 11, color: GRAY }}>
                    Showing first 150 rows of {filteredOrders.length.toLocaleString()}. Apply a date filter to narrow down.
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: GRAY, fontSize: 12 }}>
      {msg}
    </div>
  );
}
