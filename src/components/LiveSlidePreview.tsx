import { useState, useRef, useCallback, useEffect } from 'react';
import { getIconDataUrl } from '../utils/deckIcons';
import type { DeckSectionKey, DeckSectionToggle } from './pdf/QBRDeckDocument';
import type { KPISummaryPDF, CustomerStatPDF, CostGapRowPDF, CarrierMixRowPDF, ZoneComparisonPDF } from './pdf/QBRDocument';
import type { MonthlyStatRow } from '../utils/statsParser';
import type { InventoryPDFData } from '../context/PDFContext';
import type { RecommendedAction } from '../utils/recommendedActions';
import type { Shipment } from '../types';
import { dedupeWarehouseRows } from '../utils/statsParser';
import { SECTION_LABELS } from '../context/DeckContext';
import { applyKpiFilter } from '../utils/kpiSlideStats';

// ─── Brand ────────────────────────────────────────────────────────────────────
const NAVY   = '#252F3E';
const ORANGE = '#EF5252';
const BLUE   = '#4472E8';
const FONT   = "'Metropolis', sans-serif";

// ─── Data bundle ──────────────────────────────────────────────────────────────
export interface SlidePreviewData {
  kpis:          KPISummaryPDF | null;
  customerStats: CustomerStatPDF[];
  costGapRows:   CostGapRowPDF[];
  carrierMix:    CarrierMixRowPDF[];
  zoneComparisons: ZoneComparisonPDF[];
  statsRows:     MonthlyStatRow[];
  inventoryData: InventoryPDFData | null;
  displayActions: RecommendedAction[];
  enabledSections: DeckSectionToggle[];
  rawShipments:  Shipment[];
  /** Prior period summary for prior quarter comparison slides */
  priorPeriod?:  import('../utils/periodComparison').PriorPeriodSummary | null;
}

export interface ContentOffset { dx: number; dy: number; scale?: number }

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtK  = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}`;
const fmtN  = (v: number) => v.toLocaleString();
const fmtP  = (v: number) => `${v.toFixed(1)}%`;

// ─── KPI tile grid ────────────────────────────────────────────────────────────
function KpiGrid({ tiles }: { tiles: { label: string; value: string; sub?: string; color?: string }[] }) {
  const cols = tiles.length <= 3 ? tiles.length : tiles.length <= 4 ? 2 : 3;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5, width: '100%' }}>
      {tiles.map((t, i) => (
        <div key={i} style={{ background: '#fff', borderRadius: 5, padding: '7px 9px', border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 8, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3, lineHeight: 1.2 }}>{t.label}</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: t.color ?? NAVY, lineHeight: 1 }}>{t.value}</div>
          {t.sub && <div style={{ fontSize: 8, color: '#9CA3AF', marginTop: 2 }}>{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Data table ───────────────────────────────────────────────────────────────
interface ColDef { key: string; label: string; width?: string; align?: 'left' | 'right'; fmt?: (v: unknown) => string }

function DataTable({ columns, rows, maxRows = 7 }: { columns: ColDef[]; rows: Record<string, unknown>[]; maxRows?: number }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: FONT }}>
      <thead>
        <tr style={{ background: NAVY }}>
          {columns.map(c => (
            <th key={c.key} style={{ padding: '4px 7px', color: '#fff', fontWeight: 700, textAlign: c.align ?? 'left', width: c.width, whiteSpace: 'nowrap' }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, maxRows).map((row, i) => (
          <tr key={i} style={{ background: i % 2 ? '#fff' : '#F8F9FB' }}>
            {columns.map(c => (
              <td key={c.key} style={{
                padding: '3px 7px', borderBottom: '1px solid #EDEEF2', color: NAVY,
                textAlign: c.align ?? 'left', whiteSpace: 'nowrap',
                overflow: 'hidden', maxWidth: c.width ?? '120px', textOverflow: 'ellipsis',
              }}>
                {c.fmt ? c.fmt(row[c.key]) : String(row[c.key] ?? '–')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Horizontal bar chart ─────────────────────────────────────────────────────
function HBarChart({ items, W }: { items: { label: string; value: number; color?: string; tag?: string }[]; W: number }) {
  const max = Math.max(...items.map(i => i.value), 1);
  const lblW = 84, tagW = 52, barW = W - lblW - tagW - 12;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
      {items.slice(0, 10).map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: lblW, fontSize: 9, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.label}</div>
          <div style={{ width: barW, height: 13, background: '#E5E7EB', borderRadius: 3, position: 'relative', flexShrink: 0 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(item.value / max) * 100}%`, background: item.color ?? BLUE, borderRadius: 3 }} />
          </div>
          <div style={{ width: tagW, fontSize: 9, color: '#6B7280', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.tag ?? fmtP(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── SVG area/line chart ──────────────────────────────────────────────────────
function AreaChart({ series, labels, W, H }: {
  series: { name: string; color: string; values: number[] }[];
  labels: string[];
  W: number; H: number;
}) {
  if (!series[0]?.values.length) return null;
  const n  = series[0].values.length;
  const hi = Math.max(...series.flatMap(s => s.values), 1);
  const pL = 4, pR = 4, pT = 6, pB = 18;
  const pw = W - pL - pR;
  const ph = H - pT - pB;
  const gx = (i: number) => pL + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const gy = (v: number) => pT + ph - (v / hi) * ph;
  // x-axis tick step: show ~7 ticks max
  const step = Math.ceil(n / 7);
  return (
    <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
      {/* Grid lines */}
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={pL} x2={pL + pw} y1={pT + (1 - f) * ph} y2={pT + (1 - f) * ph} stroke="#E5E7EB" strokeWidth={0.5} />
      ))}
      {/* Series */}
      {series.map(s => {
        const pts = s.values.map((v, i) => `${gx(i)},${gy(v)}`).join(' ');
        const areaD = `M${gx(0)},${pT + ph} ${s.values.map((v, i) => `L${gx(i)},${gy(v)}`).join(' ')} L${gx(n - 1)},${pT + ph}Z`;
        return (
          <g key={s.name}>
            <path d={areaD} fill={s.color} fillOpacity={0.1} />
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" />
          </g>
        );
      })}
      {/* X labels */}
      {labels.map((lbl, i) => i % step === 0 && (
        <text key={lbl} x={gx(i)} y={H - 3} textAnchor="middle" fontSize={7} fill="#9CA3AF" fontFamily={FONT}>
          {lbl.slice(5)}
        </text>
      ))}
      {/* Legend dots */}
      {series.map((s, i) => (
        <g key={s.name + '-legend'} transform={`translate(${pL + i * 60}, 2)`}>
          <circle cx={4} cy={4} r={3} fill={s.color} />
          <text x={9} y={8} fontSize={7} fill="#6B7280" fontFamily={FONT}>{s.name}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Per-slide content renderer ───────────────────────────────────────────────
export function SlideContent({ sectionKey, data, W, H, kpiFilter }: {
  sectionKey: DeckSectionKey;
  data: SlidePreviewData;
  W: number; H: number;
  kpiFilter?: string[];
}) {
  switch (sectionKey) {

    // ── Shipping KPIs / Account Overview ──────────────────────────────────────
    case 'accountOverview':
    case 'shippingKPIs': {
      const { kpis } = data;
      if (!kpis) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No shipment data loaded</div>;
      const allTiles = [
        { id: 'totalShipments', label: 'Total Shipments',  value: fmtN(kpis.totalShipments) },
        { id: 'totalLabelCost', label: 'Total Label Cost', value: fmtK(kpis.totalLabelCost) },
        { id: 'avgLabelCost',   label: 'Avg Label Cost',   value: `$${kpis.avgLabelCost.toFixed(2)}` },
        { id: 'accounts',       label: 'Accounts',         value: fmtN(kpis.uniqueAccounts) },
        ...(kpis.avgZone !== null ? [{ id: 'avgZone',    label: 'Avg Zone',     value: kpis.avgZone.toFixed(1) }] : []),
        ...(kpis.totalCharged > 0 ? [{ id: 'totalBilled', label: 'Total Billed', value: fmtK(kpis.totalCharged) }] : []),
      ];
      return <KpiGrid tiles={applyKpiFilter(allTiles, kpiFilter)} />;
    }

    // ── Account Detail Table ───────────────────────────────────────────────────
    case 'accountDetailTable':
      return <DataTable
        columns={[
          { key: 'customer',         label: 'Account',   width: '38%' },
          { key: 'orderCount',       label: 'Shipments', align: 'right', width: '18%', fmt: v => fmtN(v as number) },
          { key: 'volumePercent',    label: 'Vol %',     align: 'right', width: '14%', fmt: v => fmtP(v as number) },
          { key: 'avgShippingCost',  label: 'Avg Cost',  align: 'right', width: '15%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'avgZone',          label: 'Avg Zone',  align: 'right', width: '15%', fmt: v => (v as number) > 0 ? (v as number).toFixed(1) : '–' },
        ]}
        rows={data.customerStats as unknown as Record<string, unknown>[]}
      />;

    // ── Cost Gap ──────────────────────────────────────────────────────────────
    case 'costGap':
      return <DataTable
        columns={[
          { key: 'name',         label: 'Account',    width: '33%' },
          { key: 'labelCost',    label: 'Label Cost', align: 'right', width: '18%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'totalCharged', label: 'Charged',    align: 'right', width: '18%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'gap',          label: 'Gap',        align: 'right', width: '16%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'gapPct',       label: 'Gap %',      align: 'right', width: '15%', fmt: v => `${(v as number).toFixed(0)}%` },
        ]}
        rows={data.costGapRows as unknown as Record<string, unknown>[]}
      />;

    // ── Carrier Mix ───────────────────────────────────────────────────────────
    case 'carrierMix':
      return <HBarChart W={W} items={data.carrierMix.map(r => ({
        label: r.carrier,
        value: r.pctOfTotal,
        tag:   `${r.pctOfTotal.toFixed(1)}% · ${fmtN(r.shipments)}`,
      }))} />;

    // ── Zone Performance ──────────────────────────────────────────────────────
    case 'zonePerformance':
      return <DataTable
        columns={[
          { key: 'zone',          label: 'Zone',      width: '12%' },
          { key: 'shipmentCount', label: 'Shipments', align: 'right', width: '22%', fmt: v => fmtN(v as number) },
          { key: 'rateCardAvg',   label: 'MRC Avg',   align: 'right', width: '22%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'actualAvg',     label: 'Actual',    align: 'right', width: '22%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'deltaPercent',  label: 'Delta %',   align: 'right', width: '22%', fmt: v => `${(v as number) > 0 ? '+' : ''}${(v as number).toFixed(1)}%` },
        ]}
        rows={data.zoneComparisons as unknown as Record<string, unknown>[]}
        maxRows={8}
      />;

    // ── Expiry Alerts ─────────────────────────────────────────────────────────
    case 'expiryAlerts': {
      const rows = (data.inventoryData?.expiryAlerts ?? []) as unknown as Record<string, unknown>[];
      return <DataTable
        columns={[
          { key: 'sku',           label: 'SKU',     width: '24%' },
          { key: 'item',          label: 'Item',    width: '32%' },
          { key: 'client',        label: 'Client',  width: '20%' },
          { key: 'expDate',       label: 'Exp Date',width: '14%' },
          { key: 'units',         label: 'Units',   align: 'right', width: '10%', fmt: v => fmtN(v as number) },
        ]}
        rows={rows}
      />;
    }

    // ── Days on Hand ──────────────────────────────────────────────────────────
    case 'daysOnHand': {
      const rows = (data.inventoryData?.daysOnHand ?? []) as unknown as Record<string, unknown>[];
      return <DataTable
        columns={[
          { key: 'sku',          label: 'SKU',    width: '26%' },
          { key: 'client',       label: 'Client', width: '28%' },
          { key: 'currentUnits', label: 'Units',  align: 'right', width: '16%', fmt: v => fmtN(v as number) },
          { key: 'doh',          label: 'DOH',    align: 'right', width: '14%', fmt: v => v !== null ? (v as number).toFixed(0) : '–' },
          { key: 'status',       label: 'Status', width: '16%' },
        ]}
        rows={rows}
      />;
    }

    // ── Volume Trend ──────────────────────────────────────────────────────────
    case 'volumeTrend': {
      const deduped = dedupeWarehouseRows(data.statsRows);
      const byMonth = new Map<string, { orders: number; labels: number }>();
      for (const r of deduped) {
        const ex = byMonth.get(r.month) ?? { orders: 0, labels: 0 };
        byMonth.set(r.month, { orders: ex.orders + r.orderCount, labels: ex.labels + r.labelCount });
      }
      const months = [...byMonth.keys()].sort();
      if (!months.length) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No stats data loaded</div>;
      return <AreaChart W={W} H={H}
        series={[
          { name: 'Orders', color: BLUE,   values: months.map(m => byMonth.get(m)!.orders) },
          { name: 'Labels', color: ORANGE, values: months.map(m => byMonth.get(m)!.labels) },
        ]}
        labels={months}
      />;
    }

    // ── Carrier Spend vs GMV ──────────────────────────────────────────────────
    case 'carrierSpendGMV': {
      const deduped = dedupeWarehouseRows(data.statsRows);
      const byMonth = new Map<string, { spend: number; gmv: number }>();
      for (const r of deduped) {
        const ex = byMonth.get(r.month) ?? { spend: 0, gmv: 0 };
        byMonth.set(r.month, { spend: ex.spend + r.carrierSpend, gmv: ex.gmv + r.gmv });
      }
      const months = [...byMonth.keys()].sort();
      if (!months.length) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No stats data loaded</div>;
      return <AreaChart W={W} H={H}
        series={[
          { name: 'Carrier Spend', color: ORANGE, values: months.map(m => byMonth.get(m)!.spend) },
          { name: 'GMV',           color: BLUE,   values: months.map(m => byMonth.get(m)!.gmv) },
        ]}
        labels={months}
      />;
    }

    // ── Child Account Trends ──────────────────────────────────────────────────
    case 'childAccountTrends': {
      const allMonths = new Set<string>();
      const byAcct = new Map<string, Map<string, number>>();
      for (const r of data.statsRows) {
        const name = r.childAccountName || r.childAccountId || r.accountName || r.accountId;
        if (!byAcct.has(name)) byAcct.set(name, new Map());
        byAcct.get(name)!.set(r.month, (byAcct.get(name)!.get(r.month) ?? 0) + r.orderCount);
        allMonths.add(r.month);
      }
      const months = [...allMonths].sort();
      const COLORS = [BLUE, ORANGE, '#22C55E', '#8B5CF6', '#F59E0B'];
      const top5 = [...byAcct.entries()]
        .map(([name, m]) => ({ name, total: [...m.values()].reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map(({ name }) => name);
      if (!months.length) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No stats data loaded</div>;
      return <AreaChart W={W} H={H}
        series={top5.map((name, i) => ({
          name, color: COLORS[i % COLORS.length],
          values: months.map(m => byAcct.get(name)?.get(m) ?? 0),
        }))}
        labels={months}
      />;
    }

    // ── Fulfillment Mix ───────────────────────────────────────────────────────
    case 'fulfillmentMix': {
      const deduped = dedupeWarehouseRows(data.statsRows);
      const tot = { sib: 0, mib: 0, bulk: 0, other: 0 };
      for (const r of deduped) {
        tot.sib  += r.sibLabels;
        tot.mib  += r.mibLabels;
        tot.bulk += r.bulkLabels;
        tot.other += r.manualLabels + r.wholesaleLabels + r.unknownLabels;
      }
      const total = tot.sib + tot.mib + tot.bulk + tot.other;
      if (!total) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No stats data loaded</div>;
      return <HBarChart W={W} items={[
        { label: 'SIB (Shipped-In-Box)',  value: total ? (tot.sib  / total) * 100 : 0, color: BLUE },
        { label: 'MIB (Mailer-In-Bag)',   value: total ? (tot.mib  / total) * 100 : 0, color: ORANGE },
        { label: 'Bulk',                   value: total ? (tot.bulk / total) * 100 : 0, color: '#22C55E' },
        { label: 'Other',                  value: total ? (tot.other / total) * 100 : 0, color: '#9CA3AF' },
      ]} />;
    }

    // ── Service Level Mix ─────────────────────────────────────────────────────
    case 'serviceLevelMix': {
      const svcMap = new Map<string, number>();
      for (const s of data.rawShipments) {
        const svc = s.shippingMethod || 'Unknown';
        svcMap.set(svc, (svcMap.get(svc) ?? 0) + 1);
      }
      const total = data.rawShipments.length;
      if (!total) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No shipment data loaded</div>;
      const items = [...svcMap.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([label, count]) => ({ label, value: (count / total) * 100, tag: `${((count / total) * 100).toFixed(1)}% · ${fmtN(count)}` }));
      return <HBarChart W={W} items={items} />;
    }

    // ── Label Cost by Carrier ─────────────────────────────────────────────────
    case 'labelCostByCarrier': {
      const costMap = new Map<string, { total: number; count: number }>();
      for (const s of data.rawShipments) {
        const c = s.carrier || 'Unknown';
        const ex = costMap.get(c) ?? { total: 0, count: 0 };
        costMap.set(c, { total: ex.total + s.labelCost, count: ex.count + 1 });
      }
      if (!costMap.size) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No shipment data loaded</div>;
      const items = [...costMap.entries()]
        .sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count).slice(0, 10)
        .map(([label, v]) => {
          const avg = v.count > 0 ? v.total / v.count : 0;
          const max = Math.max(...[...costMap.values()].map(x => x.count > 0 ? x.total / x.count : 0));
          return { label, value: max > 0 ? (avg / max) * 100 : 0, tag: `$${avg.toFixed(2)}` };
        });
      return <HBarChart W={W} items={items} />;
    }

    // ── Shipments by State ────────────────────────────────────────────────────
    case 'shipmentsByState': {
      const stateMap = new Map<string, { count: number; cost: number }>();
      for (const s of data.rawShipments) {
        if (!s.state) continue;
        const ex = stateMap.get(s.state) ?? { count: 0, cost: 0 };
        stateMap.set(s.state, { count: ex.count + 1, cost: ex.cost + s.labelCost });
      }
      const total = data.rawShipments.length;
      if (!stateMap.size) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No shipment data loaded</div>;
      const rows = [...stateMap.entries()]
        .sort((a, b) => b[1].count - a[1].count).slice(0, 10)
        .map(([state, v]) => ({
          state, shipments: v.count,
          pct: total > 0 ? (v.count / total) * 100 : 0,
          avgCost: v.count > 0 ? v.cost / v.count : 0,
        }));
      return <DataTable
        columns={[
          { key: 'state',    label: 'State',     width: '14%' },
          { key: 'shipments',label: 'Shipments', align: 'right', width: '24%', fmt: v => fmtN(v as number) },
          { key: 'pct',      label: '% of Total',align: 'right', width: '24%', fmt: v => fmtP(v as number) },
          { key: 'avgCost',  label: 'Avg Cost',  align: 'right', width: '24%', fmt: v => `$${(v as number).toFixed(2)}` },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
      />;
    }

    // ── Account Health KPIs ────────────────────────────────────────────────────
    case 'accountHealthKPIs': {
      const deduped = dedupeWarehouseRows(data.statsRows);
      if (!deduped.length) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No stats data loaded</div>;
      const t = deduped.reduce((acc, r) => ({
        orders: acc.orders + r.orderCount,
        labels: acc.labels + r.labelCount,
        spend:  acc.spend  + r.carrierSpend,
        gmv:    acc.gmv    + r.gmv,
      }), { orders: 0, labels: 0, spend: 0, gmv: 0 });
      const allTiles = [
        { id: 'orders',       label: 'Total Orders',  value: fmtN(t.orders) },
        { id: 'labels',       label: 'Labels',         value: fmtN(t.labels) },
        { id: 'carrierSpend', label: 'Carrier Spend',  value: fmtK(t.spend) },
        { id: 'gmv',          label: 'GMV',            value: fmtK(t.gmv) },
      ];
      return <KpiGrid tiles={applyKpiFilter(allTiles, kpiFilter)} />;
    }

    // ── 3PL KPIs ──────────────────────────────────────────────────────────────
    case 'threePlKPIs': {
      const { kpis, customerStats } = data;
      if (!kpis) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No shipment data loaded</div>;
      const allTiles = [
        { id: '3plAccounts',    label: '3PL Accounts',    value: fmtN(kpis.uniqueAccounts) },
        { id: 'totalShipments', label: 'Total Shipments', value: fmtN(kpis.totalShipments) },
        { id: 'totalLabelCost', label: 'Total Label Cost', value: fmtK(kpis.totalLabelCost) },
        { id: 'avgLabelCost',   label: 'Avg Label Cost',  value: `$${kpis.avgLabelCost.toFixed(2)}` },
        ...(kpis.totalCharged > 0 ? [{ id: 'totalBilled', label: 'Total Billed', value: fmtK(kpis.totalCharged) }] : []),
        ...(customerStats[0] ? [{ id: 'topAccount', label: 'Top Account', value: customerStats[0].customer, sub: fmtN(customerStats[0].orderCount) + ' shipments' }] : []),
      ];
      return <KpiGrid tiles={applyKpiFilter(allTiles, kpiFilter)} />;
    }

    // ── Rate Card KPIs ────────────────────────────────────────────────────────
    case 'rateCardKPIs': {
      const { zoneComparisons } = data;
      if (!zoneComparisons.length) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>Requires Shipments CSV + warehouse ZIP</div>;
      const total    = zoneComparisons.reduce((a, b) => a + b.shipmentCount, 0);
      const mrcTotal = zoneComparisons.reduce((a, b) => a + b.rateCardAvg * b.shipmentCount, 0);
      const actTotal = zoneComparisons.reduce((a, b) => a + b.actualAvg   * b.shipmentCount, 0);
      const wDelta   = zoneComparisons.reduce((a, b) => a + b.delta * b.shipmentCount, 0) / (total || 1);
      const totalDelta = actTotal - mrcTotal;
      const allTiles = [
        { id: 'totalShipments', label: 'Shipments Analyzed', value: fmtN(total) },
        { id: 'mrcTotal',       label: 'ShipHero MRC Total', value: fmtK(mrcTotal) },
        { id: 'actualTotal',    label: 'Actual Total Paid',  value: fmtK(actTotal) },
        { id: 'totalDelta',     label: 'Total Delta',        value: `${totalDelta >= 0 ? '+' : ''}${fmtK(totalDelta)}`, color: totalDelta > 0.01 ? '#EF4444' : '#22C55E' },
        { id: 'zonesAnalyzed',  label: 'Zones Analyzed',     value: `${zoneComparisons.length}` },
        { id: 'avgRateDelta',   label: 'Avg Rate Delta',     value: `${wDelta >= 0 ? '+' : ''}$${wDelta.toFixed(2)}`, color: wDelta > 0 ? '#EF4444' : '#22C55E' },
        { id: 'zonesAboveMRC',  label: 'Zones Above MRC',    value: `${zoneComparisons.filter(z => z.delta > 0).length}` },
      ];
      return <KpiGrid tiles={applyKpiFilter(allTiles, kpiFilter)} />;
    }

    // ── Inventory KPIs ────────────────────────────────────────────────────────
    case 'inventoryKPIs': {
      const { inventoryData } = data;
      if (!inventoryData) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>Upload inventory CSVs on Inventory tab</div>;
      const loc = inventoryData.locRows ?? [];
      const skus = new Set(loc.map(r => `${r.client}::${r.sku}`));
      const totalUnits = loc.filter(r => r.pickable && r.sellable).reduce((s, r) => s + r.units, 0);
      const expiring90 = loc.filter(r => r.hasLot && r.daysToExpire !== null && r.daysToExpire <= 90).length;
      const movingDOH = inventoryData.daysOnHand.filter(r => r.doh !== null);
      const avgDOH = movingDOH.length ? Math.round(movingDOH.reduce((s, r) => s + r.doh!, 0) / movingDOH.length) : null;
      const manualAdj = inventoryData.manualAdjRows?.length ?? 0;
      const allTiles = [
        { id: 'activeSkus',  label: 'Active SKUs',         value: loc.length ? fmtN(skus.size) : '—' },
        { id: 'totalUnits',  label: 'Total Units on Hand',  value: loc.length ? fmtN(totalUnits) : '—' },
        { id: 'expiring90',  label: 'Expiring < 90 Days',  value: loc.length ? fmtN(expiring90) : '—', color: expiring90 > 0 ? '#EF4444' : NAVY },
        { id: 'avgDOH',      label: 'Avg Days on Hand',     value: avgDOH !== null ? `${avgDOH}d` : '—' },
        { id: 'manualAdj',   label: 'Manual Adjustments',   value: fmtN(manualAdj) },
      ];
      return <KpiGrid tiles={applyKpiFilter(allTiles, kpiFilter)} />;
    }

    // ── Child Account Scorecard ────────────────────────────────────────────────
    case 'childAccountScorecard': {
      const accts = new Map<string, { orders: number; labels: number; spend: number }>();
      for (const r of data.statsRows) {
        const n = r.childAccountName || r.childAccountId || r.accountName || r.accountId;
        const ex = accts.get(n) ?? { orders: 0, labels: 0, spend: 0 };
        accts.set(n, { orders: ex.orders + r.orderCount, labels: ex.labels + r.labelCount, spend: ex.spend + r.carrierSpend });
      }
      if (!accts.size) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>No stats data loaded</div>;
      const rows = [...accts.entries()].sort((a, b) => b[1].orders - a[1].orders).slice(0, 8)
        .map(([name, v]) => ({ name, ...v }));
      return <DataTable
        columns={[
          { key: 'name',   label: 'Account', width: '38%' },
          { key: 'orders', label: 'Orders',  align: 'right', width: '20%', fmt: v => fmtN(v as number) },
          { key: 'labels', label: 'Labels',  align: 'right', width: '20%', fmt: v => fmtN(v as number) },
          { key: 'spend',  label: 'Spend',   align: 'right', width: '22%', fmt: v => fmtK(v as number) },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
      />;
    }

    // ── Recommended Actions ───────────────────────────────────────────────────
    case 'recommendedActions':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.displayActions.slice(0, 5).map((act, i) => (
            <div key={act.id} style={{ display: 'flex', gap: 8, padding: '5px 8px', background: '#fff', borderRadius: 5, border: '1px solid #E5E7EB' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: ORANGE, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.title}</div>
                {act.body && <div style={{ fontSize: 9, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.body}</div>}
              </div>
            </div>
          ))}
        </div>
      );

    // ── Agenda ────────────────────────────────────────────────────────────────
    case 'agenda': {
      const items = data.enabledSections
        .filter(s => s.enabled && s.key !== 'agenda')
        .map(s => s.customLabel || SECTION_LABELS[s.key])
        .slice(0, 12);
      return (
        <div style={{ columns: 2, gap: 16 }}>
          {items.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, breakInside: 'avoid' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: NAVY, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ fontSize: 11, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
            </div>
          ))}
        </div>
      );
    }

    // ── Zone Map / Warehouse Insights (show zone table as proxy) ─────────────
    case 'zoneMap':
    case 'warehouseInsights':
      if (!data.zoneComparisons.length) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>Requires Shipments CSV + warehouse ZIP</div>;
      return <DataTable
        columns={[
          { key: 'zone',          label: 'Zone',      width: '15%' },
          { key: 'shipmentCount', label: 'Shipments', align: 'right', width: '28%', fmt: v => fmtN(v as number) },
          { key: 'actualAvg',     label: 'Avg Cost',  align: 'right', width: '28%', fmt: v => `$${(v as number).toFixed(2)}` },
          { key: 'deltaPercent',  label: 'vs MRC',    align: 'right', width: '29%', fmt: v => `${(v as number) > 0 ? '+' : ''}${(v as number).toFixed(1)}%` },
        ]}
        rows={data.zoneComparisons as unknown as Record<string, unknown>[]}
      />;

    // ── Prior Quarter KPIs ───────────────────────────────────────────────────
    case 'priorQuarterKPIs': {
      const { kpis, priorPeriod } = data;
      if (!priorPeriod || !kpis) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>Upload a prior-period CSV on the Prior Quarter tab</div>;
      const shipDelta  = kpis.totalShipments - priorPeriod.totalShipments;
      const spendDelta = kpis.totalLabelCost  - priorPeriod.totalSpend;
      const costDelta  = kpis.avgLabelCost    - priorPeriod.avgLabelCost;
      const pctStr = (d: number, base: number) => base === 0 ? '—' : `${d >= 0 ? '+' : ''}${((d / base) * 100).toFixed(1)}%`;
      const allTiles = [
        { id: 'shipmentsChange', label: 'Shipments Δ',  value: `${shipDelta >= 0 ? '+' : ''}${fmtN(shipDelta)}`,      sub: pctStr(shipDelta, priorPeriod.totalShipments),  color: shipDelta >= 0 ? '#22C55E' : '#EF4444' },
        { id: 'spendChange',     label: 'Spend Δ',      value: `${spendDelta >= 0 ? '+' : ''}${fmtK(spendDelta)}`,    sub: pctStr(spendDelta, priorPeriod.totalSpend),      color: spendDelta <= 0 ? '#22C55E' : '#EF4444' },
        { id: 'avgCostChange',   label: 'Avg Cost Δ',   value: `${costDelta >= 0 ? '+' : ''}$${costDelta.toFixed(2)}`, sub: pctStr(costDelta, priorPeriod.avgLabelCost),    color: costDelta <= 0 ? '#22C55E' : '#EF4444' },
        { id: 'priorPeriod',     label: 'Prior Period', value: priorPeriod.fileName.replace(/\.csv$/i, '').slice(0, 18) },
      ];
      return <KpiGrid tiles={applyKpiFilter(allTiles, kpiFilter)} />;
    }

    // ── Prior Quarter Carrier Mix ─────────────────────────────────────────────
    case 'priorQuarterCarrierMix': {
      const { priorPeriod, kpis } = data;
      if (!priorPeriod || !kpis) return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>Upload a prior-period CSV on the Prior Quarter tab</div>;
      const priorTotal = priorPeriod.totalShipments || 1;
      const currentTotal = kpis.totalShipments || 1;
      const carriers = Object.keys(priorPeriod.carrierBreakdown).slice(0, 4);
      const rows = carriers.map(c => ({
        carrier: c,
        prior: (priorPeriod.carrierBreakdown[c]?.count / priorTotal * 100).toFixed(1) + '%',
        current: 'n/a', // current carrier data not in kpis
        priorN: priorPeriod.carrierBreakdown[c]?.count ?? 0,
        currentTotal,
      }));
      return <DataTable
        columns={[
          { key: 'carrier', label: 'Carrier',        width: '35%' },
          { key: 'priorN',  label: 'Prior Shpmnts',  align: 'right', width: '32%', fmt: v => fmtN(v as number) },
          { key: 'prior',   label: 'Prior Mix %',    align: 'right', width: '33%' },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
      />;
    }

    // ── Introductions (placeholder grid) ──────────────────────────────────────
    case 'introductions':
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ flex: '0 0 calc(25% - 6px)', background: '#fff', borderRadius: 8, padding: '10px 8px', border: '1px solid #E5E7EB', textAlign: 'center' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: NAVY, margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="7" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>
              </div>
              <div style={{ height: 7, background: '#E5E7EB', borderRadius: 3, marginBottom: 4 }} />
              <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, width: '65%', margin: '0 auto' }} />
            </div>
          ))}
        </div>
      );

    default:
      return <div style={{ color: '#9CA3AF', fontSize: 11, padding: 8 }}>Preview not available for this slide type</div>;
  }
}

// ─── Scaled thumbnail wrapper ─────────────────────────────────────────────────
// Renders LiveSlidePreview at `nativeWidth` then CSS-scales to `displayWidth`.
// This ensures all hardcoded content font sizes scale proportionally.
export function ScaledSlidePreview({
  sectionKey, label, data, displayWidth, nativeWidth = 480, borderRadius = 6, kpiFilter,
}: {
  sectionKey: DeckSectionKey;
  label: string;
  data: SlidePreviewData;
  displayWidth: number;
  nativeWidth?: number;
  borderRadius?: number;
  kpiFilter?: string[];
}) {
  const scale = displayWidth / nativeWidth;
  const displayHeight = Math.round(displayWidth * 9 / 16);
  return (
    <div style={{ width: displayWidth, height: displayHeight, overflow: 'hidden', borderRadius, flexShrink: 0, position: 'relative' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
        <LiveSlidePreview sectionKey={sectionKey} label={label} data={data} width={nativeWidth} kpiFilter={kpiFilter} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export interface LiveSlidePreviewProps {
  sectionKey:     DeckSectionKey;
  label:          string;
  sectionLabel?:  string;
  data:           SlidePreviewData;
  contentOffset?: ContentOffset;
  onOffsetChange?: (offset: ContentOffset) => void;
  width?:          number;
  callout?:        { stat: string; headline: string; body?: string; icon?: string };
  /** Stat tile IDs to show — empty/undefined means show all */
  kpiFilter?:      string[];
}

export function LiveSlidePreview({
  sectionKey, label, sectionLabel, data,
  contentOffset, onOffsetChange, width = 480, callout, kpiFilter,
}: LiveSlidePreviewProps) {
  const H      = Math.round(width * 9 / 16);   // 270 at default width
  const sc     = width / 10;                    // px per PPTX inch = 48
  const sbW    = Math.round(0.3 * sc);          // sidebar width px
  const titleX = Math.round(0.78 * sc);         // title / content start X
  const titleY = Math.round(0.55 * sc);         // section label Y
  const bodyY  = Math.round(1.95 * sc);         // default content start Y

  // Interaction state
  const [localOff, setLocalOff] = useState<ContentOffset>(contentOffset ?? { dx: 0, dy: 0 });
  const offRef    = useRef(localOff);
  const dragRef   = useRef<{ mx: number; my: number; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered,  setHovered]  = useState(false);

  const contentScale = localOff.scale ?? 1;

  // Sync when prop changes externally
  useEffect(() => {
    const off = contentOffset ?? { dx: 0, dy: 0 };
    offRef.current = off;
    setLocalOff(off);
  }, [contentOffset?.dx, contentOffset?.dy, contentOffset?.scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onOffsetChange) return;
    e.preventDefault();
    setDragging(true);
    dragRef.current = { mx: e.clientX, my: e.clientY, dx: offRef.current.dx, dy: offRef.current.dy };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = Math.max(-4,   Math.min(4,   dragRef.current.dx + (ev.clientX - dragRef.current.mx) / sc));
      const dy = Math.max(-2.5, Math.min(3,   dragRef.current.dy + (ev.clientY - dragRef.current.my) / sc));
      const next = { ...offRef.current, dx, dy };
      offRef.current = next;
      setLocalOff(next);
    };
    const onUp = () => {
      setDragging(false);
      dragRef.current = null;
      onOffsetChange(offRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onOffsetChange, sc]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!onOffsetChange) return;
    e.preventDefault();
    const step  = e.deltaY > 0 ? -0.05 : 0.05;
    const next  = { ...offRef.current, scale: Math.max(0.3, Math.min(3, (offRef.current.scale ?? 1) + step)) };
    offRef.current = next;
    setLocalOff(next);
    onOffsetChange(next);
  }, [onOffsetChange]);

  const adjustScale = useCallback((delta: number) => {
    if (!onOffsetChange) return;
    const next = { ...offRef.current, scale: Math.max(0.3, Math.min(3, (offRef.current.scale ?? 1) + delta)) };
    offRef.current = next;
    setLocalOff(next);
    onOffsetChange(next);
  }, [onOffsetChange]);

  // Fixed content area — never changes with pan so charts don't reflow on drag.
  // Callout panel is subtracted so content shrinks when the panel is enabled.
  const calloutActive  = !!(callout && (callout.stat || callout.headline));
  const calloutPanelW  = calloutActive ? Math.round(width * 0.37) : 0;
  const baseW = Math.max(60, width - titleX - Math.round(0.2 * sc) - calloutPanelW);
  const baseH = Math.max(40, H - bodyY - Math.round(0.15 * sc));

  // Pan is a CSS translate on the inner div — no effect on container dimensions.
  const txPx = Math.round(localOff.dx * sc);
  const tyPx = Math.round(localOff.dy * sc);

  const hasOffset = Math.abs(localOff.dx) > 0.05 || Math.abs(localOff.dy) > 0.05 || Math.abs(contentScale - 1) > 0.02;
  const canDrag   = !!onOffsetChange;

  return (
    <div style={{
      width, height: H, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
      background: '#EDEEF2', position: 'relative', border: '1px solid #D1D5DB',
      fontFamily: FONT,
    }}>
      {/* ── Left navy sidebar ── */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: sbW, height: H, background: NAVY }} />
      {/* Hex dot */}
      <div style={{ position: 'absolute', left: 3, top: 4, width: Math.round(0.19 * sc), height: Math.round(0.19 * sc), background: ORANGE, borderRadius: '2px', transform: 'rotate(30deg)' }} />
      {/* Slide number dot */}
      <div style={{ position: 'absolute', left: 3, bottom: 6, fontSize: 6, color: '#94A3B8', fontWeight: 700, width: sbW - 6, textAlign: 'center' }}>1</div>

      {/* ── Section label + slide title + orange bar ── */}
      <div style={{ position: 'absolute', left: titleX, top: titleY, right: 8 }}>
        <div style={{ fontSize: Math.round(sc * 0.18), fontWeight: 700, color: BLUE, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1 }}>
          {sectionLabel ?? label.slice(0, 30).toUpperCase()}
        </div>
        <div style={{ fontSize: Math.round(sc * 0.35), fontWeight: 800, color: NAVY, lineHeight: 1.15, marginTop: Math.round(sc * 0.04) }}>
          {label}
        </div>
        <div style={{ width: Math.round(sc * 1.4), height: Math.max(1, Math.round(sc * 0.04)), background: ORANGE, borderRadius: 1, marginTop: Math.round(sc * 0.08) }} />
      </div>

      {/* ── Draggable + zoomable content area ── */}
      <div
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onWheel={handleWheel}
        style={{
          position: 'absolute', left: titleX, top: bodyY, width: baseW, height: baseH,
          cursor: dragging ? 'grabbing' : canDrag ? 'grab' : 'default',
          borderRadius: 4, overflow: 'hidden',
          outline: (hovered || dragging) && canDrag ? `1.5px dashed ${BLUE}` : 'none',
          outlineOffset: 2,
        }}
      >
        <div style={{ transform: `translate(${txPx}px, ${tyPx}px) scale(${contentScale})`, transformOrigin: 'top left', width: baseW, height: baseH }}>
          <SlideContent sectionKey={sectionKey} data={data} W={baseW} H={baseH} kpiFilter={kpiFilter} />
        </div>

        {/* Hint badge */}
        {canDrag && (hovered || dragging) && (
          <div style={{
            position: 'absolute', top: 3, right: 3,
            background: dragging ? BLUE : 'rgba(68,114,232,0.85)', color: '#fff',
            fontSize: 8, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
            pointerEvents: 'none', letterSpacing: '0.03em',
          }}>
            {dragging
              ? `↕↔ Moving… ${Math.round(contentScale * 100)}%`
              : '↕↔ Drag · Scroll to zoom'}
          </div>
        )}
      </div>

      {/* ── Scale + reset controls ── */}
      {canDrag && (hovered || dragging || hasOffset) && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 8, right: 8,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,255,255,0.95)', border: '1px solid #D1D5DB',
            borderRadius: 6, padding: '3px 6px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            fontFamily: FONT,
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); adjustScale(-0.1); }}
            style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >−</button>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#374151', minWidth: 30, textAlign: 'center' }}>
            {Math.round(contentScale * 100)}%
          </span>
          <button
            onClick={e => { e.stopPropagation(); adjustScale(0.1); }}
            style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >+</button>
          {hasOffset && (
            <>
              <div style={{ width: 1, height: 14, background: '#E5E7EB', margin: '0 2px' }} />
              <button
                onClick={e => { e.stopPropagation(); onOffsetChange!({ dx: 0, dy: 0, scale: 1 }); }}
                style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
              >↺ Reset</button>
            </>
          )}
        </div>
      )}

      {/* ── Bottom gradient bar (matching PPTX) ── */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.max(1, Math.round(sc * 0.04)), background: `linear-gradient(90deg, ${ORANGE}, ${BLUE})` }} />

      {/* ── Callout panel overlay ── */}
      {callout && (callout.stat || callout.headline) && (
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: Math.round(width * 0.37), height: H,
          background: NAVY,
          borderLeft: `${Math.max(2, Math.round(sc * 0.005))}px solid ${ORANGE}`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: `${Math.round(sc * 0.14)}px ${Math.round(sc * 0.12)}px`,
          gap: Math.round(sc * 0.1),
          boxSizing: 'border-box',
        }}>
          {callout.icon && (() => {
            const url = getIconDataUrl(callout.icon, '#ffffff', 100);
            const sz  = Math.round(sc * 0.55);
            return url ? <img src={url} alt="" style={{ width: sz, height: sz, opacity: 0.9 }} /> : null;
          })()}
          {callout.stat && (
            <div style={{ fontSize: Math.round(sc * 0.52), fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1, letterSpacing: '-0.02em' }}>
              {callout.stat}
            </div>
          )}
          {callout.headline && (
            <div style={{ fontSize: Math.round(sc * 0.155), fontWeight: 600, color: '#fff', textAlign: 'center', lineHeight: 1.3 }}>
              {callout.headline}
            </div>
          )}
          {callout.body && (
            <div style={{ fontSize: Math.round(sc * 0.11), color: '#94A3B8', textAlign: 'center', lineHeight: 1.35 }}>
              {callout.body}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
