import { useState, useMemo, useRef } from 'react';
import { useData } from '../context/DataContext';
import { computeDeltas, formatDeltaPct, deltaDirection } from '../utils/periodComparison';
import InsightGate from './InsightGate';
import ExportButton from './ExportButton';
import SortFilterButton from './SortFilterButton';
import type { SortOption } from './SortFilterButton';

// ─── Palette ──────────────────────────────────────────────────────────────────
const BLUE   = '#4472E8';
const GREEN  = '#22C55E';
const RED    = '#EF5252';
const NAVY   = '#252F3E';
const FONT   = "'Metropolis', sans-serif";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtN(n: number) { return n.toLocaleString(); }
function fmtBig$(n: number) {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function fmtFixed$(n: number) { return '$' + n.toFixed(2); }
function fmtLb(n: number) { return n.toFixed(2) + ' lb'; }

// ─── DeltaBadge ───────────────────────────────────────────────────────────────
function DeltaBadge({ pct, invert = false }: { pct: number; invert?: boolean }) {
  const dir = deltaDirection(pct);
  const isGood = invert ? dir === 'down' : dir === 'up';
  const isFlat = dir === 'flat';
  const color = isFlat ? '#9CA3AF' : isGood ? GREEN : RED;
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 600, color,
      background: isFlat ? 'rgba(0,0,0,0.04)' : isGood ? 'rgba(34,197,94,0.08)' : 'rgba(239,82,82,0.08)',
      padding: '2px 7px', borderRadius: 5,
    }}>
      {arrow} {formatDeltaPct(pct)}
    </span>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({
  title, children, actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ padding: '10px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.06)', background: '#FAFAFA', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ─── Table header row ─────────────────────────────────────────────────────────
function TableHeader({ priorLabel, currentLabel }: { priorLabel: string; currentLabel: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 1fr',
      padding: '7px 16px',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      background: '#F9FAFB',
    }}>
      {['Metric', `Prior — ${priorLabel}`, `Current — ${currentLabel}`, 'Change'].map((h, i) => (
        <div key={i} style={{ fontSize: 10, fontWeight: 600, color: i === 2 ? BLUE : '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
      ))}
    </div>
  );
}

// ─── Metric detail row ────────────────────────────────────────────────────────
function MetricRow({ label, prior, current, pct, invert }: { label: string; prior: string; current: string; pct?: number; invert?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'center', padding: '9px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#6B7280' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{prior}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{current}</div>
      <div>{pct !== undefined && <DeltaBadge pct={pct} invert={invert} />}</div>
    </div>
  );
}

// ─── Upload dropzone ──────────────────────────────────────────────────────────
function UploadZone({ onFile, uploading }: { onFile: (f: File) => void; uploading: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `1.5px dashed ${dragging ? BLUE : 'rgba(0,0,0,0.12)'}`,
        borderRadius: 12, padding: '36px 32px', textAlign: 'center',
        cursor: 'pointer', background: dragging ? 'rgba(68,114,232,0.04)' : '#FAFAFA',
        transition: 'all 0.15s', fontFamily: FONT,
      }}
    >
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ''; } }} />
      {uploading ? (
        <div style={{ fontSize: 14, color: '#6B7280' }}>Parsing CSV…</div>
      ) : (
        <>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(68,114,232,0.08)', border: '0.5px solid rgba(68,114,232,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Drop prior-quarter Shipments CSV here</div>
          <div style={{ fontSize: 12, color: '#9CA3AF' }}>or click to browse — same format as current-period CSV</div>
        </>
      )}
    </div>
  );
}

// ─── Carrier bar (visual) ─────────────────────────────────────────────────────
function CarrierBar({ carrier, priorPct, currentPct }: { carrier: string; priorPct: number; currentPct: number }) {
  const diff = currentPct - priorPct;
  const color = diff > 2 ? GREEN : diff < -2 ? RED : '#94A3B8';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: NAVY }}>{carrier}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>{priorPct.toFixed(1)}% →</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{currentPct.toFixed(1)}%</span>
          <span style={{ fontSize: 11, fontWeight: 600, color }}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp</span>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#F1F5F9', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${priorPct}%`, background: 'rgba(148,163,184,0.5)', borderRadius: 3 }} />
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${currentPct}%`, background: BLUE, borderRadius: 3, opacity: 0.75 }} />
      </div>
    </div>
  );
}

// ─── Sort options ─────────────────────────────────────────────────────────────
const CARRIER_SORT_OPTIONS: SortOption[] = [
  { key: 'carrier',      label: 'Carrier name',      descLabel: '↓ Z→A', ascLabel: '↑ A→Z' },
  { key: 'currentCount', label: 'Current shipments',  descLabel: '↓ High', ascLabel: '↑ Low' },
  { key: 'priorCount',   label: 'Prior shipments',    descLabel: '↓ High', ascLabel: '↑ Low' },
  { key: 'currentSpend', label: 'Current spend',      descLabel: '↓ High', ascLabel: '↑ Low' },
  { key: 'countDiff',    label: 'Volume change',      descLabel: '↓ Biggest gain', ascLabel: '↑ Biggest drop' },
  { key: 'spendDiff',    label: 'Spend change',       descLabel: '↓ Highest', ascLabel: '↑ Lowest' },
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function PriorQuarterTab() {
  const {
    rawShipments, reportingPeriod,
    priorPeriod, uploadPriorCSV, clearPriorPeriod, isLoading,
  } = useData();

  const [uploading, setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Sort/filter state — carrier table ────────────────────────────────────
  const [carrierSortKey, setCarrierSortKey] = useState<string>('currentCount');
  const [carrierSortDir, setCarrierSortDir] = useState<'asc' | 'desc'>('desc');
  const [carrierSearch, setCarrierSearch]   = useState('');

  // ── Current-period summary ────────────────────────────────────────────────
  const currentSummary = useMemo(() => {
    if (!rawShipments.length) return null;
    let totalSpend = 0, totalWeight = 0, totalRevenue = 0;
    let minDate = '', maxDate = '';
    const carriers: Record<string, { count: number; spend: number }> = {};
    for (const s of rawShipments) {
      totalSpend   += s.labelCost;
      totalWeight  += s.weight;
      totalRevenue += s.totalShippingCharged;
      if (!minDate || s.orderDate < minDate) minDate = s.orderDate;
      if (!maxDate || s.orderDate > maxDate) maxDate = s.orderDate;
      const c = s.carrier || 'Unknown';
      if (!carriers[c]) carriers[c] = { count: 0, spend: 0 };
      carriers[c].count++;
      carriers[c].spend += s.labelCost;
    }
    return {
      totalShipments: rawShipments.length,
      totalSpend,
      avgLabelCost: totalSpend / rawShipments.length,
      avgWeight: totalWeight / rawShipments.length,
      totalRevenue,
      carrierBreakdown: carriers,
      dateRange: { min: minDate, max: maxDate },
    };
  }, [rawShipments]);

  // ── Deltas ────────────────────────────────────────────────────────────────
  const deltas = useMemo(() => {
    if (!currentSummary || !priorPeriod) return null;
    return computeDeltas(currentSummary, priorPeriod);
  }, [currentSummary, priorPeriod]);

  // ── Warehouse breakdown rows ───────────────────────────────────────────────
  const warehouseRows = useMemo(() => {
    if (!currentSummary || !priorPeriod?.warehouseBreakdown) return [];
    // Build current warehouse breakdown from rawShipments
    const currWH: Record<string, { count: number; spend: number }> = {};
    for (const s of rawShipments) {
      const wh = s.warehouse || 'Unknown';
      if (!currWH[wh]) currWH[wh] = { count: 0, spend: 0 };
      currWH[wh].count++;
      currWH[wh].spend += s.labelCost;
    }
    const allKeys = new Set([...Object.keys(currWH), ...Object.keys(priorPeriod.warehouseBreakdown)]);
    const priorTotal   = priorPeriod.totalShipments || 1;
    const currentTotal = rawShipments.length || 1;
    return [...allKeys].map(wh => {
      const p = priorPeriod.warehouseBreakdown![wh] ?? { count: 0, spend: 0 };
      const c = currWH[wh] ?? { count: 0, spend: 0 };
      return {
        warehouse: wh,
        priorCount: p.count, priorPct: (p.count / priorTotal) * 100, priorSpend: p.spend,
        currentCount: c.count, currentPct: (c.count / currentTotal) * 100, currentSpend: c.spend,
        countDiff: c.count - p.count,
        countPctDiff: p.count > 0 ? ((c.count - p.count) / p.count) * 100 : 0,
      };
    }).sort((a, b) => b.currentCount - a.currentCount);
  }, [rawShipments, currentSummary, priorPeriod]);

  // ── Service breakdown rows ────────────────────────────────────────────────
  const serviceRows = useMemo(() => {
    if (!priorPeriod?.serviceBreakdown) return [];
    const currSvc: Record<string, { count: number; spend: number }> = {};
    for (const s of rawShipments) {
      const svc = s.shippingMethod || 'Unknown';
      if (!currSvc[svc]) currSvc[svc] = { count: 0, spend: 0 };
      currSvc[svc].count++;
      currSvc[svc].spend += s.labelCost;
    }
    const allKeys = new Set([...Object.keys(currSvc), ...Object.keys(priorPeriod.serviceBreakdown)]);
    const priorTotal   = priorPeriod.totalShipments || 1;
    const currentTotal = rawShipments.length || 1;
    return [...allKeys].map(svc => {
      const p = priorPeriod.serviceBreakdown![svc] ?? { count: 0, spend: 0 };
      const c = currSvc[svc] ?? { count: 0, spend: 0 };
      return {
        service: svc,
        priorCount: p.count, priorPct: (p.count / priorTotal) * 100,
        currentCount: c.count, currentPct: (c.count / currentTotal) * 100,
        countDiff: c.count - p.count,
        countPctDiff: p.count > 0 ? ((c.count - p.count) / p.count) * 100 : 0,
      };
    }).sort((a, b) => b.currentCount - a.currentCount).slice(0, 15); // top 15
  }, [rawShipments, priorPeriod]);

  // ── Carrier rows (sorted + filtered) ──────────────────────────────────────
  const allCarrierRows = useMemo(() => {
    if (!currentSummary || !priorPeriod) return [];
    const allCarriers = new Set([
      ...Object.keys(currentSummary.carrierBreakdown),
      ...Object.keys(priorPeriod.carrierBreakdown),
    ]);
    const priorTotal   = priorPeriod.totalShipments   || 1;
    const currentTotal = currentSummary.totalShipments || 1;
    return [...allCarriers].map(carrier => {
      const p = priorPeriod.carrierBreakdown[carrier]    ?? { count: 0, spend: 0 };
      const c = currentSummary.carrierBreakdown[carrier] ?? { count: 0, spend: 0 };
      return {
        carrier,
        priorPct:    (p.count / priorTotal)   * 100,
        currentPct:  (c.count / currentTotal) * 100,
        priorCount:  p.count,
        currentCount: c.count,
        priorSpend:  p.spend,
        currentSpend: c.spend,
        countDiff:   c.count - p.count,
        spendDiff:   c.spend - p.spend,
        countPctDiff: p.count > 0 ? ((c.count - p.count) / p.count) * 100 : 0,
        spendPctDiff: p.spend > 0 ? ((c.spend - p.spend) / p.spend) * 100 : 0,
      };
    });
  }, [currentSummary, priorPeriod]);

  const sortedCarrierRows = useMemo(() => {
    let rows = [...allCarrierRows];
    if (carrierSearch.trim()) {
      const q = carrierSearch.trim().toLowerCase();
      rows = rows.filter(r => r.carrier.toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      const av = (a as Record<string, unknown>)[carrierSortKey];
      const bv = (b as Record<string, unknown>)[carrierSortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return carrierSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = av as number, bn = bv as number;
      return carrierSortDir === 'asc' ? an - bn : bn - an;
    });
    return rows;
  }, [allCarrierRows, carrierSortKey, carrierSortDir, carrierSearch]);

  // ── Export data ───────────────────────────────────────────────────────────
  const kpiExportData = useMemo(() => {
    if (!currentSummary || !priorPeriod || !deltas) return [];
    return [
      { metric: 'Total Shipments', prior: priorPeriod.totalShipments, current: currentSummary.totalShipments, change_pct: deltas.totalShipmentsPct.toFixed(1) + '%' },
      { metric: 'Total Spend',     prior: priorPeriod.totalSpend.toFixed(2), current: currentSummary.totalSpend.toFixed(2), change_pct: deltas.totalSpendPct.toFixed(1) + '%' },
      { metric: 'Avg Label Cost',  prior: priorPeriod.avgLabelCost.toFixed(2), current: currentSummary.avgLabelCost.toFixed(2), change_pct: deltas.avgLabelCostPct.toFixed(1) + '%' },
      { metric: 'Avg Weight (lb)', prior: priorPeriod.avgWeight.toFixed(2), current: currentSummary.avgWeight.toFixed(2), change_pct: deltas.avgWeightPct.toFixed(1) + '%' },
      { metric: 'Total Revenue',   prior: priorPeriod.totalRevenue.toFixed(2), current: currentSummary.totalRevenue.toFixed(2), change_pct: deltas.totalRevenuePct.toFixed(1) + '%' },
    ];
  }, [currentSummary, priorPeriod, deltas]);

  const carrierExportData = useMemo(() =>
    sortedCarrierRows.map(r => ({
      carrier:         r.carrier,
      prior_shipments: r.priorCount,
      current_shipments: r.currentCount,
      shipment_change: r.countDiff,
      shipment_change_pct: r.countPctDiff.toFixed(1) + '%',
      prior_spend:     r.priorSpend.toFixed(2),
      current_spend:   r.currentSpend.toFixed(2),
      spend_change:    r.spendDiff.toFixed(2),
      spend_change_pct: r.spendPctDiff.toFixed(1) + '%',
    }))
  , [sortedCarrierRows]);

  // ── Date range labels ─────────────────────────────────────────────────────
  const fmtDateRange = (dr?: { min: string; max: string }) => {
    if (!dr?.min || !dr?.max) return '—';
    return `${dr.min.slice(0, 7)} → ${dr.max.slice(0, 7)}`;
  };
  const currentLabel = reportingPeriod || fmtDateRange(currentSummary?.dateRange);
  const priorLabel   = priorPeriod ? fmtDateRange(priorPeriod.dateRange) : '—';

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const { errors } = await uploadPriorCSV(file);
    setUploading(false);
    if (errors.length) setUploadError(errors.join('; '));
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!rawShipments.length) {
    return (
      <div style={{ padding: '64px 32px', textAlign: 'center', color: '#9CA3AF', fontFamily: FONT }}>
        <div style={{ fontSize: 14 }}>Upload a current-period Shipments CSV first (Setup tab)</div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto', fontFamily: FONT }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0 }}>Prior Quarter Comparison</h2>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 3 }}>
            Compare key shipping metrics between the current period and a prior CSV upload
          </div>
        </div>
        {priorPeriod && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, background: 'rgba(34,197,94,0.08)', border: '0.5px solid rgba(34,197,94,0.2)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#15803D' }}>Prior: {priorPeriod.fileName}</span>
            </div>
            <button
              onClick={clearPriorPeriod}
              style={{ padding: '5px 10px', borderRadius: 7, border: '0.5px solid rgba(239,82,82,0.3)', background: 'rgba(239,82,82,0.07)', color: RED, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Upload zone ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <UploadZone onFile={handleFile} uploading={uploading || isLoading} />
        {uploadError && (
          <div style={{ marginTop: 10, fontSize: 12, color: RED, padding: '8px 12px', background: 'rgba(239,82,82,0.07)', borderRadius: 7, border: '0.5px solid rgba(239,82,82,0.2)' }}>
            {uploadError}
          </div>
        )}
      </div>

      {/* ── Comparison content (only when prior data loaded) ──────────────── */}
      {priorPeriod && currentSummary && deltas && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── KPI summary cards ──────────────────────────────────────────── */}
          <SectionCard
            title="KPI Overview"
            actions={
              <>
                <InsightGate sectionKey="priorQuarterKPIs" />
                <ExportButton data={kpiExportData} filename="prior_quarter_kpis" />
              </>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0 }}>
              {([
                { label: 'Shipments',       prior: fmtN(priorPeriod.totalShipments),          current: fmtN(currentSummary.totalShipments),          pct: deltas.totalShipmentsPct, invert: false },
                { label: 'Total Spend',     prior: fmtBig$(priorPeriod.totalSpend),            current: fmtBig$(currentSummary.totalSpend),            pct: deltas.totalSpendPct,     invert: true  },
                { label: 'Avg Label Cost',  prior: fmtFixed$(priorPeriod.avgLabelCost),        current: fmtFixed$(currentSummary.avgLabelCost),        pct: deltas.avgLabelCostPct,   invert: true  },
                { label: 'Avg Weight',      prior: fmtLb(priorPeriod.avgWeight),               current: fmtLb(currentSummary.avgWeight),               pct: deltas.avgWeightPct,      invert: false },
                { label: 'Total Revenue',   prior: fmtBig$(priorPeriod.totalRevenue),          current: fmtBig$(currentSummary.totalRevenue),          pct: deltas.totalRevenuePct,   invert: false },
              ] as { label: string; prior: string; current: string; pct: number; invert: boolean }[]).map((kpi, i) => {
                const dir = deltaDirection(kpi.pct);
                const isGood = kpi.invert ? dir === 'down' : dir === 'up';
                const isFlat = dir === 'flat';
                const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
                const badgeColor = isFlat ? '#9CA3AF' : isGood ? GREEN : RED;
                return (
                  <div key={kpi.label} style={{ padding: '16px', borderRight: i < 4 ? '0.5px solid rgba(0,0,0,0.06)' : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{kpi.label}</div>
                    <div style={{ fontSize: 9, fontWeight: 500, color: '#9CA3AF', marginBottom: 1 }}>Prior</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>{kpi.prior}</div>
                    <div style={{ fontSize: 9, fontWeight: 500, color: BLUE, marginBottom: 1 }}>Current</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 8 }}>{kpi.current}</div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: badgeColor }}>{arrow} {formatDeltaPct(kpi.pct)}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* ── Metric Detail table ─────────────────────────────────────────── */}
          <SectionCard
            title="Metric Detail"
            actions={
              <>
                <ExportButton data={kpiExportData} filename="prior_quarter_metric_detail" />
              </>
            }
          >
            <TableHeader priorLabel={priorLabel} currentLabel={currentLabel} />
            <MetricRow label="Total Shipments" prior={fmtN(priorPeriod.totalShipments)}      current={fmtN(currentSummary.totalShipments)}      pct={deltas.totalShipmentsPct} invert={false} />
            <MetricRow label="Total Spend"     prior={fmtBig$(priorPeriod.totalSpend)}       current={fmtBig$(currentSummary.totalSpend)}       pct={deltas.totalSpendPct}     invert={true}  />
            <MetricRow label="Avg Label Cost"  prior={fmtFixed$(priorPeriod.avgLabelCost)}   current={fmtFixed$(currentSummary.avgLabelCost)}   pct={deltas.avgLabelCostPct}   invert={true}  />
            <MetricRow label="Avg Weight (lb)" prior={fmtLb(priorPeriod.avgWeight)}          current={fmtLb(currentSummary.avgWeight)}          pct={deltas.avgWeightPct}      invert={false} />
            <MetricRow label="Total Revenue"   prior={fmtBig$(priorPeriod.totalRevenue)}     current={fmtBig$(currentSummary.totalRevenue)}     pct={deltas.totalRevenuePct}   invert={false} />
            <MetricRow
              label="Cost Recovery Ratio"
              prior={priorPeriod.totalRevenue > 0    ? (priorPeriod.totalSpend    / priorPeriod.totalRevenue    * 100).toFixed(1) + '%' : '—'}
              current={currentSummary.totalRevenue > 0 ? (currentSummary.totalSpend / currentSummary.totalRevenue * 100).toFixed(1) + '%' : '—'}
            />
          </SectionCard>

          {/* ── Carrier Mix visual ─────────────────────────────────────────── */}
          <SectionCard
            title="Carrier Mix"
            actions={
              <>
                <InsightGate sectionKey="priorQuarterCarrierMix" />
                <ExportButton data={carrierExportData} filename="prior_quarter_carrier_mix" />
              </>
            }
          >
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 28, height: 6, borderRadius: 3, background: 'rgba(148,163,184,0.5)' }} />
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>Prior ({priorLabel})</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 28, height: 6, borderRadius: 3, background: BLUE, opacity: 0.75 }} />
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>Current ({currentLabel})</span>
                </div>
              </div>
              {[...allCarrierRows].sort((a, b) => b.currentCount - a.currentCount).map(r => (
                <CarrierBar key={r.carrier} carrier={r.carrier} priorPct={r.priorPct} currentPct={r.currentPct} />
              ))}
            </div>
          </SectionCard>

          {/* ── Carrier Detail table ───────────────────────────────────────── */}
          <SectionCard
            title="Carrier Detail"
            actions={
              <>
                <SortFilterButton
                  sortKey={carrierSortKey}
                  sortDir={carrierSortDir}
                  onSort={(k, d) => { setCarrierSortKey(k); setCarrierSortDir(d); }}
                  options={CARRIER_SORT_OPTIONS}
                  defaultSortKey="currentCount"
                  hasActiveFilter={!!carrierSearch.trim()}
                  extraContent={
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Filter carrier</div>
                      <input
                        type="text"
                        value={carrierSearch}
                        onChange={e => setCarrierSearch(e.target.value)}
                        placeholder="e.g. UPS, FedEx…"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.12)', fontSize: 12, outline: 'none', fontFamily: FONT }}
                      />
                    </div>
                  }
                />
                <ExportButton data={carrierExportData} filename="prior_quarter_carrier_detail" />
              </>
            }
          >
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '8px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', background: '#F9FAFB' }}>
              {['Carrier', 'Prior Shpmnts', 'Current Shpmnts', 'Chg', 'Prior Spend', 'Current Spend', 'Spend Chg'].map(h => (
                <div key={h} style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
            </div>
            {sortedCarrierRows.length === 0 && (
              <div style={{ padding: '20px 16px', color: '#9CA3AF', fontSize: 12 }}>No carriers match your filter.</div>
            )}
            {sortedCarrierRows.map(r => {
              const countColor = r.countDiff >= 0 ? GREEN : RED;
              const spendColor = r.spendDiff <= 0 ? GREEN : RED;
              return (
                <div key={r.carrier} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '9px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.05)', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{r.carrier}</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>{fmtN(r.priorCount)}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{fmtN(r.currentCount)}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: countColor }}>{r.countDiff >= 0 ? '+' : ''}{fmtN(r.countDiff)} ({formatDeltaPct(r.countPctDiff)})</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>{fmtBig$(r.priorSpend)}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{fmtBig$(r.currentSpend)}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: spendColor }}>{r.spendDiff >= 0 ? '+' : ''}{fmtBig$(r.spendDiff)} ({formatDeltaPct(r.spendPctDiff)})</div>
                </div>
              );
            })}
          </SectionCard>

          {/* ── Warehouse Breakdown ────────────────────────────────────────── */}
          {warehouseRows.length > 0 && (
            <SectionCard title="Warehouse Breakdown">
              <div style={{ padding: '0 0 4px' }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr', padding: '8px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', background: '#F9FAFB' }}>
                  {['Warehouse', 'Prior Shpmnts', 'Prior %', 'Current Shpmnts', 'Current %'].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
                  ))}
                </div>
                {warehouseRows.map(r => {
                  const diff = r.currentPct - r.priorPct;
                  const diffColor = Math.abs(diff) < 2 ? '#9CA3AF' : diff > 0 ? GREEN : RED;
                  return (
                    <div key={r.warehouse} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr', padding: '9px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.05)', alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{r.warehouse}</div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>{fmtN(r.priorCount)}</div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>{r.priorPct.toFixed(1)}%</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{fmtN(r.currentCount)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{r.currentPct.toFixed(1)}%</span>
                        {Math.abs(diff) >= 0.5 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: diffColor }}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* ── Service Mix ────────────────────────────────────────────────── */}
          {serviceRows.length > 0 && (
            <SectionCard title="Service Mix">
              <div style={{ padding: '0 0 4px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '8px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', background: '#F9FAFB' }}>
                  {['Service', 'Prior Shpmnts', 'Prior %', 'Current Shpmnts', 'Current %'].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
                  ))}
                </div>
                {serviceRows.map(r => {
                  const diff = r.currentPct - r.priorPct;
                  const diffColor = Math.abs(diff) < 2 ? '#9CA3AF' : diff > 0 ? GREEN : RED;
                  return (
                    <div key={r.service} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '9px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.05)', alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.service}</div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>{fmtN(r.priorCount)}</div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>{r.priorPct.toFixed(1)}%</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{fmtN(r.currentCount)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{r.currentPct.toFixed(1)}%</span>
                        {Math.abs(diff) >= 0.5 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: diffColor }}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* ── Period info ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Prior Period</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{priorPeriod.fileName}</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{priorLabel}</div>
            </div>
            <div style={{ flex: 1, background: '#fff', border: `0.5px solid rgba(68,114,232,0.2)`, borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Current Period</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{reportingPeriod || 'Current period'}</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{fmtDateRange(currentSummary.dateRange)}</div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
