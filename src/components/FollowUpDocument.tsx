/**
 * FollowUpDocument.tsx
 * Client-facing QBR follow-up document — WYSIWYG page layout, print-to-PDF export.
 *
 * Structure:
 *  1. Document header  — branding, client, period
 *  2. Executive summary — editable rich text
 *  3. Key metrics       — auto KPI tiles
 *  4. Performance charts — carrier mix + zone distribution (recharts)
 *  5. Top accounts table — editable rows
 *  6. Cost gap table     — editable rows (if charged data available)
 *  7. Recommended actions — editable priority cards
 *  8. Next steps          — editable bullet list
 *  9. Document footer     — CSM contact
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { useData } from '../context/DataContext';
import { usePDF } from '../context/PDFContext';
import { useDeck } from '../context/DeckContext';
import { getZoneFromOriginToState } from '../utils/uspsZones';
import { generateRecommendedActions, type RecommendedAction } from '../utils/recommendedActions';

// ─── Design tokens ────────────────────────────────────────────────────────────
const NAVY   = '#252F3E';
const BLUE   = '#4472E8';
const ORANGE = '#EF5252';
const GREEN  = '#22C55E';
const GRAY   = '#6B7280';
const LIGHT  = '#F9FAFB';
const BORDER = 'rgba(0,0,0,0.07)';

const CARRIER_COLORS = ['#4472E8','#22C55E','#F97316','#8B5CF6','#EF4444','#0891B2','#F59E0B','#6B7280'];
const ZONE_COLORS   = ['#4472E8','#22C55E','#F97316','#EF4444','#8B5CF6','#0891B2','#F59E0B','#6B7280'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n: number, dec = 2) => n.toFixed(dec);
const usd  = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct  = (n: number, dec = 1) => `${n.toFixed(dec)}%`;
const num  = (n: number) => n.toLocaleString('en-US');

// ─── ContentEditable helper ───────────────────────────────────────────────────
function Editable({
  value, onChange, style, placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  // tag prop accepted but ignored — always renders div for TS simplicity
  tag?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);

  useEffect(() => {
    if (ref.current && ref.current.innerText !== value && value !== lastValue.current) {
      ref.current.innerText = value;
    }
  }, [value]);

  const handleInput = () => {
    const text = ref.current?.innerText ?? '';
    lastValue.current = text;
    onChange(text);
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onBlur={handleInput}
      data-placeholder={placeholder}
      className={className}
      style={{ outline: 'none', cursor: 'text', borderRadius: 4, minHeight: '1.2em', ...style }}
    >
      {value}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({
  title, children, noprint,
}: {
  title?: string;
  children: React.ReactNode;
  noprint?: boolean;
}) {
  return (
    <div
      className={noprint ? 'no-print' : ''}
      style={{ marginBottom: 32 }}
    >
      {title && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 14,
        }}>
          <div style={{ width: 3, height: 18, borderRadius: 2, background: NAVY, flexShrink: 0 }} />
          <span style={{
            fontSize: 11, fontWeight: 700, color: NAVY,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {title}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

// ─── KPI tile ─────────────────────────────────────────────────────────────────
function KPITile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 120,
      padding: '16px 18px',
      borderRadius: 8,
      border: `1px solid ${BORDER}`,
      background: '#fff',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: GRAY, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: NAVY, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: GRAY, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FollowUpDocument() {
  const {
    rawShipments, reportingPeriod: ctxPeriod, clientName: ctxClient, clientLogo,
  } = useData();
  const { inventoryData } = usePDF();
  // Exec summary is shared with the Deck Builder cover panel via DeckContext
  const { execSummary, setExecSummary } = useDeck();

  // ── Editable meta fields ───────────────────────────────────────────────────
  const [clientName,      setClientName]      = useState(() => ctxClient || '');
  const [period,          setPeriod]          = useState(() => ctxPeriod || '');
  const [reportDate,      setReportDate]      = useState(() => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
  const [csmName,         setCsmName]         = useState('');
  const [csmEmail,        setCsmEmail]        = useState('');
  const [nextSteps,       setNextSteps]       = useState<string[]>(['', '', '']);

  // ── Compute origin zip for zone lookups ───────────────────────────────────
  const originZip = useMemo(() => {
    const zips = rawShipments.map(s => s.zip).filter(Boolean);
    if (!zips.length) return '';
    const freq = new Map<string, number>();
    for (const z of zips) freq.set(z, (freq.get(z) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }, [rawShipments]);

  const hasShipping = rawShipments.length > 0;

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!hasShipping) return null;
    const total      = rawShipments.reduce((s, r) => s + r.labelCost, 0);
    const charged    = rawShipments.reduce((s, r) => s + r.totalShippingCharged, 0);
    let zoneSum = 0, zoneCount = 0;
    if (originZip) {
      for (const s of rawShipments) {
        if (s.state) { const z = getZoneFromOriginToState(originZip, s.state); if (z > 0) { zoneSum += z; zoneCount++; } }
      }
    }
    return {
      totalShipments: rawShipments.length,
      totalLabelCost: total,
      totalCharged:   charged,
      avgLabelCost:   rawShipments.length > 0 ? total / rawShipments.length : 0,
      avgZone:        zoneCount > 0 ? zoneSum / zoneCount : null,
      uniqueAccounts: new Set(rawShipments.map(s => s.customer3pl || '(Unassigned)')).size,
    };
  }, [rawShipments, hasShipping, originZip]);

  // ── Customer stats ─────────────────────────────────────────────────────────
  const customerStats = useMemo(() => {
    if (!hasShipping) return [];
    const map = new Map<string, { count: number; totalCost: number; totalCharged: number; totalZone: number; zoneCount: number }>();
    for (const s of rawShipments) {
      const key = s.customer3pl || '(Unassigned)';
      const ex = map.get(key) ?? { count: 0, totalCost: 0, totalCharged: 0, totalZone: 0, zoneCount: 0 };
      const zone = originZip && s.state ? getZoneFromOriginToState(originZip, s.state) : 0;
      map.set(key, { count: ex.count + 1, totalCost: ex.totalCost + s.labelCost, totalCharged: ex.totalCharged + s.totalShippingCharged, totalZone: ex.totalZone + (zone > 0 ? zone : 0), zoneCount: ex.zoneCount + (zone > 0 ? 1 : 0) });
    }
    const total = rawShipments.length;
    return [...map.entries()]
      .map(([customer, v]) => ({
        customer,
        orderCount:      v.count,
        volumePct:       total > 0 ? (v.count / total) * 100 : 0,
        avgLabelCost:    v.count > 0 ? v.totalCost / v.count : 0,
        avgCharged:      v.count > 0 ? v.totalCharged / v.count : 0,
        avgZone:         v.zoneCount > 0 ? v.totalZone / v.zoneCount : 0,
      }))
      .sort((a, b) => b.orderCount - a.orderCount);
  }, [rawShipments, hasShipping, originZip]);

  // Editable top accounts rows
  const [accountRows, setAccountRows] = useState<typeof customerStats>([]);
  useEffect(() => { setAccountRows(customerStats.slice(0, 8)); }, [customerStats]);

  // ── Carrier mix ────────────────────────────────────────────────────────────
  const carrierData = useMemo(() => {
    if (!hasShipping) return [];
    const map = new Map<string, { count: number; totalCost: number }>();
    for (const s of rawShipments) {
      const key = s.carrier || s.shippingMethod || 'Unknown';
      const ex = map.get(key) ?? { count: 0, totalCost: 0 };
      map.set(key, { count: ex.count + 1, totalCost: ex.totalCost + s.labelCost });
    }
    const total = rawShipments.length;
    return [...map.entries()]
      .map(([name, v]) => ({ name, shipments: v.count, pct: total > 0 ? (v.count / total) * 100 : 0, avgCost: v.count > 0 ? v.totalCost / v.count : 0 }))
      .sort((a, b) => b.shipments - a.shipments)
      .slice(0, 8);
  }, [rawShipments, hasShipping]);

  // ── Zone distribution ──────────────────────────────────────────────────────
  const zoneData = useMemo(() => {
    if (!hasShipping || !originZip) return [];
    const map = new Map<number, number>();
    for (const s of rawShipments) {
      if (!s.state) continue;
      const z = getZoneFromOriginToState(originZip, s.state);
      if (z >= 1 && z <= 8) map.set(z, (map.get(z) ?? 0) + 1);
    }
    const total = rawShipments.length;
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([zone, count]) => ({ name: `Zone ${zone}`, count, pct: total > 0 ? (count / total) * 100 : 0 }));
  }, [rawShipments, hasShipping, originZip]);

  // ── Recommended actions ────────────────────────────────────────────────────
  const [actions, setActions] = useState<RecommendedAction[]>(() =>
    generateRecommendedActions(rawShipments, undefined, undefined)
  );

  // ── Print handler ──────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ── Exec summary placeholder ───────────────────────────────────────────────
  const summaryPlaceholder = `During ${period || 'this quarter'}, ${clientName || 'your team'} shipped ${hasShipping ? num(rawShipments.length) + ' orders' : 'a strong volume of orders'} through ShipHero. This document summarizes performance highlights, areas of focus, and agreed next steps from our QBR.`;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Print styles ────────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #followup-print-root { display: block !important; }
          .no-print { display: none !important; }
          .followup-page {
            box-shadow: none !important;
            margin: 0 !important;
            border-radius: 0 !important;
          }
          [contenteditable]::after { display: none !important; }
          @page { margin: 0.6in 0.7in; size: letter portrait; }
        }
        [contenteditable]:empty::after {
          content: attr(data-placeholder);
          color: #9CA3AF;
          pointer-events: none;
        }
        [contenteditable]:hover {
          background: rgba(68,114,232,0.04);
          border-radius: 3px;
        }
        [contenteditable]:focus {
          background: rgba(68,114,232,0.06);
          border-radius: 3px;
        }
        .action-card:hover { border-color: rgba(68,114,232,0.3) !important; }
      `}</style>

      {/* ── Outer shell ─────────────────────────────────────────────────────── */}
      <div style={{
        background: '#E5E7EB',
        minHeight: '100%',
        padding: '24px 24px 48px',
        fontFamily: "'Metropolis', sans-serif",
      }}>

        {/* ── Toolbar (no-print) ──────────────────────────────────────────── */}
        <div className="no-print" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20, maxWidth: 816, marginLeft: 'auto', marginRight: 'auto',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>Follow-Up Document</div>
            <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
              Click any text to edit · Charts auto-populate from loaded data
            </div>
          </div>
          <button
            onClick={handlePrint}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 8,
              background: NAVY, color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              fontFamily: 'inherit',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Export PDF
          </button>
        </div>

        {/* ── Document page ───────────────────────────────────────────────── */}
        <div id="followup-print-root">
          <div className="followup-page" style={{
            maxWidth: 816, margin: '0 auto',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}>

            {/* ── 1. Document header ───────────────────────────────────────── */}
            <div style={{ background: NAVY, padding: '32px 48px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
                {/* Left: ShipHero brand + doc type */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                      <rect width="40" height="40" rx="8" fill={BLUE}/>
                      <path d="M8 20L20 8L32 20M14 26V20L20 14L26 20V26" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
                      ShipHero <span style={{ fontWeight: 400, opacity: 0.6 }}>QBR Studio</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4, letterSpacing: '-0.02em' }}>
                    Quarterly Business Review
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,0.55)' }}>
                    Follow-Up Summary &amp; Action Plan
                  </div>
                </div>

                {/* Right: client info */}
                <div style={{ textAlign: 'right' }}>
                  {clientLogo && (
                    <img src={clientLogo} alt="" style={{ height: 36, maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: '4px 8px', marginBottom: 10 }} />
                  )}
                  <div style={{ marginBottom: 4 }}>
                    <Editable
                      value={clientName}
                      onChange={setClientName}
                      tag="div"
                      placeholder="Client Name"
                      style={{ fontSize: 16, fontWeight: 700, color: '#fff', textAlign: 'right' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Editable
                      value={period}
                      onChange={setPeriod}
                      tag="span"
                      placeholder="Q1 2026"
                      style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.08)', padding: '3px 10px', borderRadius: 4 }}
                    />
                    <Editable
                      value={reportDate}
                      onChange={setReportDate}
                      tag="span"
                      placeholder="April 19, 2026"
                      style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.08)', padding: '3px 10px', borderRadius: 4 }}
                    />
                  </div>
                </div>
              </div>

              {/* Orange accent bar */}
              <div style={{ height: 3, background: ORANGE, borderRadius: 2, marginTop: 24, width: 48 }} />
            </div>

            {/* ── Document body ────────────────────────────────────────────── */}
            <div style={{ padding: '40px 48px' }}>

              {/* ── 2. Executive summary ──────────────────────────────────── */}
              <Section title="Executive Summary">
                <div style={{
                  background: LIGHT, borderRadius: 8,
                  padding: '18px 20px',
                  border: `1px solid ${BORDER}`,
                }}>
                  <Editable
                    value={execSummary || summaryPlaceholder}
                    onChange={setExecSummary}
                    tag="p"
                    placeholder={summaryPlaceholder}
                    style={{ fontSize: 13, color: '#374151', lineHeight: 1.75, margin: 0 }}
                  />
                </div>
              </Section>

              {/* ── 3. Key metrics ────────────────────────────────────────── */}
              {kpis && (
                <Section title="Key Metrics">
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <KPITile
                      label="Total Shipments"
                      value={num(kpis.totalShipments)}
                      sub={`${kpis.uniqueAccounts} accounts`}
                    />
                    <KPITile
                      label="Avg Label Cost"
                      value={usd(kpis.avgLabelCost)}
                      sub="per shipment"
                    />
                    {kpis.totalCharged > 0 && (
                      <KPITile
                        label="Avg Billed"
                        value={usd(kpis.totalCharged / kpis.totalShipments)}
                        sub="per shipment"
                      />
                    )}
                    {kpis.avgZone !== null && (
                      <KPITile
                        label="Avg Shipping Zone"
                        value={fmt(kpis.avgZone, 1)}
                        sub="lower = better"
                      />
                    )}
                    <KPITile
                      label="Total Label Cost"
                      value={usd(kpis.totalLabelCost)}
                      sub={period || 'this period'}
                    />
                  </div>
                </Section>
              )}

              {/* ── 4. Performance charts ─────────────────────────────────── */}
              {(carrierData.length > 0 || zoneData.length > 0) && (
                <Section title="Performance Overview">
                  <div style={{ display: 'grid', gridTemplateColumns: zoneData.length > 0 ? '1fr 1fr' : '1fr', gap: 20 }}>

                    {/* Carrier mix pie */}
                    {carrierData.length > 0 && (
                      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px', background: '#fff' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: GRAY, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Carrier Mix</div>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={carrierData}
                              dataKey="shipments"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={70}
                              label={({ name, pct: p }) => `${name.slice(0,10)} ${p.toFixed(0)}%`}
                              labelLine={false}
                            >
                              {carrierData.map((_, i) => (
                                <Cell key={i} fill={CARRIER_COLORS[i % CARRIER_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => [num(v), 'Shipments']} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Zone distribution bar */}
                    {zoneData.length > 0 && (
                      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px', background: '#fff' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: GRAY, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Zone Distribution</div>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={zoneData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: GRAY }} />
                            <YAxis tick={{ fontSize: 10, fill: GRAY }} />
                            <Tooltip formatter={(v: number) => [num(v), 'Shipments']} />
                            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                              {zoneData.map((_, i) => (
                                <Cell key={i} fill={ZONE_COLORS[i % ZONE_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* ── 5. Top accounts table ─────────────────────────────────── */}
              {accountRows.length > 0 && (
                <Section title="Account Summary">
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: NAVY }}>
                          {['Account', 'Shipments', 'Volume %', 'Avg Label Cost', 'Avg Billed', 'Avg Zone'].map(h => (
                            <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accountRows.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 1 ? LIGHT : '#fff' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: NAVY, maxWidth: 180 }}>
                              <Editable value={row.customer} onChange={v => setAccountRows(prev => prev.map((r, j) => j === i ? { ...r, customer: v } : r))} tag="span" style={{ display: 'inline-block', minWidth: 60 }} />
                            </td>
                            <td style={{ padding: '8px 12px', color: GRAY }}>{num(row.orderCount)}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ height: 6, width: `${Math.max(4, row.volumePct * 0.8)}px`, background: BLUE, borderRadius: 3, maxWidth: 60 }} />
                                <span style={{ color: GRAY, fontSize: 11 }}>{pct(row.volumePct, 1)}</span>
                              </div>
                            </td>
                            <td style={{ padding: '8px 12px', color: GRAY }}>{usd(row.avgLabelCost)}</td>
                            <td style={{ padding: '8px 12px', color: row.avgCharged > row.avgLabelCost ? '#DC2626' : GRAY }}>{row.avgCharged > 0 ? usd(row.avgCharged) : '—'}</td>
                            <td style={{ padding: '8px 12px', color: GRAY }}>{row.avgZone > 0 ? fmt(row.avgZone, 1) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* ── 6. Recommended actions ────────────────────────────────── */}
              {actions.length > 0 && (
                <Section title="Recommended Actions">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {actions.map((action, i) => (
                      <div
                        key={action.id}
                        className="action-card"
                        style={{
                          display: 'flex', gap: 14, alignItems: 'flex-start',
                          padding: '14px 16px', borderRadius: 8,
                          border: `1px solid ${BORDER}`,
                          background: '#fff',
                          transition: 'border-color 0.15s',
                        }}
                      >
                        {/* Priority badge */}
                        <select
                          value={action.priority}
                          onChange={e => setActions(prev => prev.map((a, j) => j === i ? { ...a, priority: e.target.value as RecommendedAction['priority'] } : a))}
                          className="no-print"
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '3px 7px',
                            borderRadius: 4, border: 'none', cursor: 'pointer',
                            background: action.priority === 'high' ? '#FEE2E2' : action.priority === 'medium' ? '#FEF3C7' : '#F0FDF4',
                            color:      action.priority === 'high' ? '#DC2626' : action.priority === 'medium' ? '#D97706' : '#16A34A',
                            fontFamily: 'inherit', flexShrink: 0,
                          }}
                        >
                          <option value="high">HIGH</option>
                          <option value="medium">MED</option>
                          <option value="low">LOW</option>
                        </select>
                        {/* Print-only priority badge */}
                        <span className="print-only" style={{
                          display: 'none',
                          fontSize: 10, fontWeight: 700, padding: '3px 7px',
                          borderRadius: 4,
                          background: action.priority === 'high' ? '#FEE2E2' : action.priority === 'medium' ? '#FEF3C7' : '#F0FDF4',
                          color:      action.priority === 'high' ? '#DC2626' : action.priority === 'medium' ? '#D97706' : '#16A34A',
                          flexShrink: 0,
                        }}>
                          {action.priority.toUpperCase()}
                        </span>

                        <div style={{ flex: 1 }}>
                          <Editable
                            value={action.title}
                            onChange={v => setActions(prev => prev.map((a, j) => j === i ? { ...a, title: v } : a))}
                            tag="div"
                            style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 3 }}
                          />
                          <Editable
                            value={action.body}
                            onChange={v => setActions(prev => prev.map((a, j) => j === i ? { ...a, body: v } : a))}
                            tag="div"
                            placeholder="Add detail…"
                            style={{ fontSize: 12, color: GRAY, lineHeight: 1.6 }}
                          />
                        </div>

                        <button
                          className="no-print"
                          onClick={() => setActions(prev => prev.filter((_, j) => j !== i))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', fontSize: 16, padding: '2px 4px', lineHeight: 1, flexShrink: 0 }}
                          title="Remove"
                        >✕</button>
                      </div>
                    ))}

                    {/* Add action */}
                    <button
                      className="no-print"
                      onClick={() => setActions(prev => [...prev, { id: `custom-${Date.now()}`, category: 'general', priority: 'medium', title: 'New action item', body: '', edited: true }])}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 14px', borderRadius: 8,
                        border: `1.5px dashed rgba(0,0,0,0.15)`,
                        background: 'none', cursor: 'pointer', color: GRAY,
                        fontSize: 12, fontFamily: 'inherit',
                        alignSelf: 'flex-start',
                      }}
                    >
                      <span style={{ fontSize: 15 }}>+</span> Add action item
                    </button>
                  </div>
                </Section>
              )}

              {/* ── 7. Next steps ─────────────────────────────────────────── */}
              <Section title="Next Steps">
                <div style={{
                  border: `1px solid ${BORDER}`, borderRadius: 8,
                  padding: '16px 20px', background: '#fff',
                }}>
                  {nextSteps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: i < nextSteps.length - 1 ? 10 : 0 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: BLUE, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1,
                      }}>
                        {i + 1}
                      </div>
                      <Editable
                        value={step}
                        onChange={v => setNextSteps(prev => prev.map((s, j) => j === i ? v : s))}
                        tag="div"
                        placeholder={`Step ${i + 1}…`}
                        style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, flex: 1, paddingTop: 2 }}
                      />
                      <button
                        className="no-print"
                        onClick={() => setNextSteps(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', fontSize: 14, padding: '2px 4px', lineHeight: 1, flexShrink: 0, marginTop: 2 }}
                        title="Remove"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    className="no-print"
                    onClick={() => setNextSteps(prev => [...prev, ''])}
                    style={{
                      marginTop: nextSteps.length > 0 ? 12 : 0,
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 6,
                      border: `1.5px dashed rgba(0,0,0,0.12)`,
                      background: 'none', cursor: 'pointer', color: GRAY,
                      fontSize: 12, fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>+</span> Add step
                  </button>
                </div>
              </Section>

              {/* ── 8. Footer ─────────────────────────────────────────────── */}
              <div style={{
                borderTop: `1px solid ${BORDER}`,
                paddingTop: 24, marginTop: 8,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                gap: 24,
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: GRAY, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Your Customer Success Manager</div>
                  <Editable value={csmName} onChange={setCsmName} tag="div" placeholder="CSM Name" style={{ fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 2 }} />
                  <Editable value={csmEmail} onChange={setCsmEmail} tag="div" placeholder="csm@shiphero.com" style={{ fontSize: 12, color: BLUE }} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: GRAY, marginBottom: 4 }}>Prepared by</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <svg width="16" height="16" viewBox="0 0 40 40" fill="none">
                      <rect width="40" height="40" rx="8" fill={BLUE}/>
                      <path d="M8 20L20 8L32 20M14 26V20L20 14L26 20V26" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>ShipHero QBR Studio</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>shiphero.com</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
