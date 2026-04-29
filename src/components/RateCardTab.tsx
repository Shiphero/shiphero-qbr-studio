import { useState, useMemo } from 'react';
import ExportButton from './ExportButton';
import InsightGate, { StatDeckButton } from './InsightGate';
import SortFilterButton from './SortFilterButton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useData } from '../context/DataContext';
import { getZoneFromOriginToState } from '../utils/uspsZones';
import {
  ServiceKey,
  SERVICE_LABELS,
  SERVICE_TABLES,
  inferServiceKey,
  lookupMrcRate,
} from '../data/shipheroRates';
import {
  UPSServiceKey,
  UPS_SERVICE_LABELS,
  UPS_GROUND_ZONES,
  UPS_NDA_ZONES,
  UPS_DAY2_ZONES,
  UPS_DS3_ZONES,
  UPS_RATES,
  lookupUPSRate,
} from '../data/upsRates';

interface ZoneComparison {
  zone: number;
  shipmentCount: number;
  rateCardTotal: number;
  actualTotal: number;
  rateCardAvg: number;
  actualAvg: number;
  delta: number;
  deltaPercent: number;
}

function formatUSD(val: number): string {
  return '$' + val.toFixed(2);
}

function formatBigUSD(val: number): string {
  if (Math.abs(val) >= 1_000_000) return '$' + (val / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(val) >= 1_000) return '$' + (val / 1_000).toFixed(1) + 'K';
  return '$' + val.toFixed(2);
}

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  deckBtn?: React.ReactNode;
}

function KPICard({ label, value, sub, accent, deckBtn }: KPICardProps) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', position: 'relative' }}
    >
      {deckBtn}
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-black" style={{ color: accent || '#252F3E' }}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const rateCard = payload.find((p) => p.name === 'ShipHero MRC');
  const actual = payload.find((p) => p.name === 'Actual Paid');
  const delta = (actual?.value ?? 0) - (rateCard?.value ?? 0);
  return (
    <div
      className="rounded-xl p-3 shadow-xl text-sm"
      style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: '170px' }}
    >
      <div className="font-bold text-white mb-2">Zone {label}</div>
      {rateCard && (
        <div className="text-gray-300">
          ShipHero MRC: <span className="text-white font-semibold">{formatUSD(rateCard.value)}</span>
        </div>
      )}
      {actual && (
        <div className="text-gray-300">
          Actual Paid: <span className="text-white font-semibold">{formatUSD(actual.value)}</span>
        </div>
      )}
      <div className="mt-1" style={{ color: delta > 0.01 ? '#EF4444' : '#22C55E' }}>
        Delta: <span className="font-bold">{delta > 0 ? '+' : ''}{formatUSD(delta)}</span>
      </div>
    </div>
  );
};

const ALL_SERVICE_KEYS: ServiceKey[] = ['GA', 'GA_RURAL', 'PM', 'PM_RURAL', 'PME', 'PME_RURAL'];

export default function RateCardTab() {
  const { rawShipments, warehouses, fileName } = useData();
  const [selectedService, setSelectedService] = useState<ServiceKey | 'auto'>('auto');
  const [zoneTableExpanded, setZoneTableExpanded] = useState(false);
  const [zoneSortKey, setZoneSortKey] = useState<keyof ZoneComparison>('zone');
  const [zoneSortDir, setZoneSortDir] = useState<'asc' | 'desc'>('asc');

  // UPS Rate Card state
  const [upsEnabled, setUpsEnabled] = useState(false);
  const [selectedUPSService, setSelectedUPSService] = useState<UPSServiceKey>('GROUND_COMM');
  const [upsZoneTableExpanded, setUpsZoneTableExpanded] = useState(false);
  const [upsZoneSortKey, setUpsZoneSortKey] = useState<keyof ZoneComparison>('zone');
  const [upsZoneSortDir, setUpsZoneSortDir] = useState<'asc' | 'desc'>('asc');

  const handleZoneSort = (key: keyof ZoneComparison) => {
    if (zoneSortKey === key) setZoneSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setZoneSortKey(key); setZoneSortDir('asc'); }
  };

  const primaryWarehouse = warehouses[0];
  const originZip = primaryWarehouse?.zip?.trim() || '';

  const hasData = rawShipments.length > 0;
  const hasWarehouse = !!originZip;

  /** Detect the dominant service type in the shipment data */
  const detectedService = useMemo<ServiceKey | null>(() => {
    if (!hasData) return null;
    const counts: Partial<Record<ServiceKey, number>> = {};
    for (const s of rawShipments) {
      const key = inferServiceKey(s.shippingMethod);
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    let best: ServiceKey | null = null;
    let bestCount = 0;
    for (const [k, c] of Object.entries(counts) as [ServiceKey, number][]) {
      if (c > bestCount) { best = k; bestCount = c; }
    }
    return best;
  }, [rawShipments, hasData]);

  const effectiveService: ServiceKey | null = useMemo(() => {
    if (selectedService !== 'auto') return selectedService;
    return detectedService;
  }, [selectedService, detectedService]);

  const comparisons = useMemo<ZoneComparison[]>(() => {
    if (!effectiveService || !originZip || rawShipments.length === 0) return [];
    const table = SERVICE_TABLES[effectiveService];
    const zoneMap = new Map<number, { count: number; rateTotal: number; actualTotal: number }>();

    for (const shipment of rawShipments) {
      if (!shipment.state || shipment.weight <= 0) continue;
      const zone = getZoneFromOriginToState(originZip, shipment.state);
      if (zone < 1 || zone > 8) continue;
      const mrcRate = lookupMrcRate(table, shipment.weight, zone);
      if (mrcRate === null) continue;

      const existing = zoneMap.get(zone) || { count: 0, rateTotal: 0, actualTotal: 0 };
      zoneMap.set(zone, {
        count: existing.count + 1,
        rateTotal: existing.rateTotal + mrcRate,
        actualTotal: existing.actualTotal + shipment.labelCost,
      });
    }

    const results: ZoneComparison[] = [];
    zoneMap.forEach((v, zone) => {
      const rateCardAvg = v.count > 0 ? v.rateTotal / v.count : 0;
      const actualAvg = v.count > 0 ? v.actualTotal / v.count : 0;
      const delta = actualAvg - rateCardAvg;
      const deltaPercent = rateCardAvg > 0 ? (delta / rateCardAvg) * 100 : 0;
      results.push({
        zone,
        shipmentCount: v.count,
        rateCardTotal: v.rateTotal,
        actualTotal: v.actualTotal,
        rateCardAvg,
        actualAvg,
        delta,
        deltaPercent,
      });
    });

    results.sort((a, b) => a.zone - b.zone);
    return results;
  }, [effectiveService, originZip, rawShipments]);

  const summary = useMemo(() => {
    if (comparisons.length === 0) return null;
    const totalShipments = comparisons.reduce((s, c) => s + c.shipmentCount, 0);
    const rateCardTotal = comparisons.reduce((s, c) => s + c.rateCardTotal, 0);
    const actualTotal = comparisons.reduce((s, c) => s + c.actualTotal, 0);
    const totalDelta = actualTotal - rateCardTotal;
    return { totalShipments, rateCardTotal, actualTotal, totalDelta };
  }, [comparisons]);

  const chartData = comparisons.map((c) => ({
    zone: `${c.zone}`,
    'ShipHero MRC': parseFloat(c.rateCardAvg.toFixed(2)),
    'Actual Paid': parseFloat(c.actualAvg.toFixed(2)),
  }));

  const sortedComparisons = useMemo(() => {
    return [...comparisons].sort((a, b) => {
      const av = a[zoneSortKey] as number;
      const bv = b[zoneSortKey] as number;
      return zoneSortDir === 'asc' ? av - bv : bv - av;
    });
  }, [comparisons, zoneSortKey, zoneSortDir]);

  const canCompare = hasData && hasWarehouse && !!effectiveService;

  /** Map a USPS zone (1-8) to the UPS zone number for the selected service */
  const mapToUPSZone = (uspsZone: number, service: UPSServiceKey): number => {
    const z = Math.max(2, Math.min(8, uspsZone)); // clamp; UPS Ground starts at zone 2
    if (service === 'GROUND_COMM' || service === 'GROUND_RES') return z;
    if (service === 'NDA_COMM') return 100 + z;
    if (service === 'DAY2_COMM') return 200 + z;
    return 300 + z; // DS3_COMM
  };

  const upsZones = useMemo(() => {
    if (selectedUPSService === 'GROUND_COMM' || selectedUPSService === 'GROUND_RES') return UPS_GROUND_ZONES;
    if (selectedUPSService === 'NDA_COMM') return UPS_NDA_ZONES;
    if (selectedUPSService === 'DAY2_COMM') return UPS_DAY2_ZONES;
    return UPS_DS3_ZONES;
  }, [selectedUPSService]);

  const upsComparisons = useMemo<ZoneComparison[]>(() => {
    if (!upsEnabled || !originZip || rawShipments.length === 0) return [];
    const zoneMap = new Map<number, { count: number; rateTotal: number; actualTotal: number }>();

    for (const shipment of rawShipments) {
      if (!shipment.state || shipment.weight <= 0) continue;
      const uspsZone = getZoneFromOriginToState(originZip, shipment.state);
      if (uspsZone < 1 || uspsZone > 8) continue;
      const upsZone = mapToUPSZone(uspsZone, selectedUPSService);
      const upsRate = lookupUPSRate(selectedUPSService, shipment.weight, upsZone);
      if (upsRate === null) continue;

      const existing = zoneMap.get(uspsZone) || { count: 0, rateTotal: 0, actualTotal: 0 };
      zoneMap.set(uspsZone, {
        count: existing.count + 1,
        rateTotal: existing.rateTotal + upsRate,
        actualTotal: existing.actualTotal + shipment.labelCost,
      });
    }

    const results: ZoneComparison[] = [];
    zoneMap.forEach((v, zone) => {
      const rateCardAvg = v.count > 0 ? v.rateTotal / v.count : 0;
      const actualAvg = v.count > 0 ? v.actualTotal / v.count : 0;
      const delta = actualAvg - rateCardAvg;
      const deltaPercent = rateCardAvg > 0 ? (delta / rateCardAvg) * 100 : 0;
      results.push({ zone, shipmentCount: v.count, rateCardTotal: v.rateTotal, actualTotal: v.actualTotal, rateCardAvg, actualAvg, delta, deltaPercent });
    });
    results.sort((a, b) => a.zone - b.zone);
    return results;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsEnabled, selectedUPSService, originZip, rawShipments]);

  const upsSummary = useMemo(() => {
    if (upsComparisons.length === 0) return null;
    const totalShipments = upsComparisons.reduce((s, c) => s + c.shipmentCount, 0);
    const rateCardTotal = upsComparisons.reduce((s, c) => s + c.rateCardTotal, 0);
    const actualTotal = upsComparisons.reduce((s, c) => s + c.actualTotal, 0);
    return { totalShipments, rateCardTotal, actualTotal, totalDelta: actualTotal - rateCardTotal };
  }, [upsComparisons]);

  const upsChartData = upsComparisons.map((c) => ({
    zone: `${c.zone}`,
    'ShipHero UPS': parseFloat(c.rateCardAvg.toFixed(2)),
    'Actual Paid': parseFloat(c.actualAvg.toFixed(2)),
  }));

  const sortedUPSComparisons = useMemo(() => {
    return [...upsComparisons].sort((a, b) => {
      const av = a[upsZoneSortKey] as number;
      const bv = b[upsZoneSortKey] as number;
      return upsZoneSortDir === 'asc' ? av - bv : bv - av;
    });
  }, [upsComparisons, upsZoneSortKey, upsZoneSortDir]);

  const handleUPSZoneSort = (key: keyof ZoneComparison) => {
    if (upsZoneSortKey === key) setUpsZoneSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setUpsZoneSortKey(key); setUpsZoneSortDir('asc'); }
  };

  // Sample rows for UPS rate preview (1–5 lbs)
  const upsPreviewRows = useMemo(() => {
    const table = UPS_RATES[selectedUPSService];
    return table.filter(r => r[0] >= 1 && r[0] <= 5);
  }, [selectedUPSService]);

  return (
    <div style={{ fontFamily: "'Metropolis', sans-serif", color: '#252F3E' }}>
      <div className="p-6">
      {/* Page title */}
      <div className="mb-6">
        <h1 className="text-2xl font-black" style={{ color: '#252F3E' }}>Rate Card Comparison</h1>
        <p className="text-sm text-gray-500 mt-1">
          Compare your actual shipping costs against ShipHero's negotiated USPS MRC rates.
        </p>
      </div>

      {/* Service selector */}
      <div
        className="rounded-xl p-5 mb-6"
        style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0"
            style={{ background: '#4472E8' }}
          >
            1
          </div>
          <div>
            <div className="font-black text-base" style={{ color: '#252F3E' }}>Select Service Type</div>
            <div className="text-xs text-gray-400">
              Choose the USPS service to benchmark against ShipHero's MRC rates.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            {/* Auto badge */}
            {detectedService && selectedService === 'auto' && (
              <div
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#15803D', border: '1px solid rgba(34,197,94,0.3)' }}
              >
                Auto-detected: {SERVICE_LABELS[detectedService]}
              </div>
            )}
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value as ServiceKey | 'auto')}
              className="rounded-lg px-3 py-2 text-sm font-semibold"
              style={{
                background: '#F5F5F0',
                border: '1.5px solid #E5E7EB',
                color: '#252F3E',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="auto">Auto-detect from data</option>
              {ALL_SERVICE_KEYS.map((key) => (
                <option key={key} value={key}>{SERVICE_LABELS[key]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Rate card mini-preview */}
        {effectiveService && (
          <div className="mt-4 overflow-x-auto">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
              ShipHero MRC — {SERVICE_LABELS[effectiveService]} (sample rates, ≤ 5 lbs)
            </div>
            <table className="text-xs border-collapse" style={{ minWidth: '480px' }}>
              <thead>
                <tr style={{ background: '#F5F5F0' }}>
                  <th className="px-2 py-1.5 text-left font-bold border" style={{ borderColor: '#E5E7EB', color: '#252F3E' }}>Max Wt</th>
                  {[1,2,3,4,5,6,7,8].map(z => (
                    <th key={z} className="px-2 py-1.5 text-right font-bold border" style={{ borderColor: '#E5E7EB', color: '#4472E8' }}>Z{z}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SERVICE_TABLES[effectiveService]
                  .filter(row => row[0] >= 0.5 && row[0] <= 5)
                  .map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td className="px-2 py-1 font-semibold border" style={{ borderColor: '#E5E7EB', color: '#252F3E' }}>
                        {row[0] >= 1 ? `${row[0]} lb` : `${(row[0] * 16).toFixed(0)} oz`}
                      </td>
                      {[1,2,3,4,5,6,7,8].map(z => (
                        <td key={z} className="px-2 py-1 text-right border" style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                          ${row[z].toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Missing data messages */}
      {!hasData && (
        <div
          className="rounded-xl p-5 mb-6 text-sm font-semibold"
          style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', color: '#92650a' }}
        >
          Upload a ShipHero CSV report on the Network Optimization tab first.
        </div>
      )}

      {hasData && !hasWarehouse && (
        <div
          className="rounded-xl p-5 mb-6 text-sm font-semibold"
          style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', color: '#92650a' }}
        >
          Configure warehouse ZIP codes on the Network Optimization tab first.
        </div>
      )}

      {hasData && hasWarehouse && !effectiveService && (
        <div
          className="rounded-xl p-5 mb-6 text-sm font-semibold"
          style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', color: '#92650a' }}
        >
          Could not auto-detect a service type from your shipments. Please select one from the dropdown above.
        </div>
      )}

      {/* Comparison results */}
      {canCompare && comparisons.length > 0 && summary && (
        <>
          {/* KPI summary */}
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Rate Card Summary</span>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4">
            <KPICard
              label="Shipments Analyzed"
              value={summary.totalShipments.toLocaleString()}
              sub={fileName || undefined}
              deckBtn={<StatDeckButton sectionKey="rateCardKPIs" statId="totalShipments" />}
            />
            <KPICard
              label="ShipHero MRC Total"
              value={formatBigUSD(summary.rateCardTotal)}
              sub="Expected at negotiated rate"
              accent="#4472E8"
              deckBtn={<StatDeckButton sectionKey="rateCardKPIs" statId="mrcTotal" />}
            />
            <KPICard
              label="Actual Total Paid"
              value={formatBigUSD(summary.actualTotal)}
              sub="From label cost in CSV"
              accent="#EF5252"
              deckBtn={<StatDeckButton sectionKey="rateCardKPIs" statId="actualTotal" />}
            />
            <KPICard
              label="Total Delta"
              value={(summary.totalDelta >= 0 ? '+' : '') + formatBigUSD(summary.totalDelta)}
              sub={summary.totalDelta > 0.01 ? 'Overpaid vs MRC' : summary.totalDelta < -0.01 ? 'Saved vs MRC' : 'On rate'}
              accent={summary.totalDelta > 0.01 ? '#EF4444' : '#22C55E'}
              deckBtn={<StatDeckButton sectionKey="rateCardKPIs" statId="totalDelta" />}
            />
          </div>

          {/* Chart + Table */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Bar chart */}
            <div
              className="rounded-xl p-5"
              style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-black text-base" style={{ color: '#252F3E' }}>
                  Avg Cost by Zone — MRC vs Actual
                </h3>
                <div className="flex items-center gap-2">
                  <InsightGate sectionKey="zonePerformance" />
                  <ExportButton
                    data={chartData.map((r) => ({
                      Zone: r.zone,
                      'ShipHero MRC Avg ($)': r['ShipHero MRC'],
                      'Actual Paid Avg ($)': r['Actual Paid'],
                    }))}
                    filename="mrc_vs_actual_by_zone"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                {SERVICE_LABELS[effectiveService!]}
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="zone"
                    tick={{ fontSize: 11, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}
                    label={{ value: 'USPS Zone', position: 'insideBottom', offset: -8, fontSize: 11, fill: '#6B7280' }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => '$' + v.toFixed(0)}
                    tick={{ fontSize: 11, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}
                  />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Metropolis', sans-serif" }} />
                  <Bar dataKey="ShipHero MRC" fill="#4472E8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Actual Paid" fill="#EF5252" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
            >
              <div className="px-5 py-4" style={{ borderBottom: '1px solid #e5e7eb' }}>
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Zone-by-Zone Breakdown</h3>
                  <div className="flex items-center gap-2">
                    <InsightGate sectionKey="zonePerformance" />
                    <ExportButton
                      data={comparisons.map((c) => {
                        const withinTolerance = Math.abs(c.deltaPercent) <= 5;
                        const overpaid = c.delta > 0.01;
                        return {
                          Zone: `Zone ${c.zone}`,
                          '# Shipments': c.shipmentCount,
                          'MRC Avg ($)': parseFloat(c.rateCardAvg.toFixed(2)),
                          'Actual Avg ($)': parseFloat(c.actualAvg.toFixed(2)),
                          'Delta ($)': parseFloat(c.delta.toFixed(2)),
                          'Delta %': parseFloat(c.deltaPercent.toFixed(1)),
                          Status: withinTolerance ? 'On Rate' : overpaid ? 'Over' : 'Under',
                        };
                      })}
                      filename="zone_breakdown"
                    />
                    <SortFilterButton
                      sortKey={zoneSortKey} sortDir={zoneSortDir}
                      defaultSortKey="zone" defaultSortDir="asc"
                      onSort={(k, d) => { setZoneSortKey(k as keyof ZoneComparison); setZoneSortDir(d); setZoneTableExpanded(false); }}
                      options={[
                        { key: 'zone',          label: 'Zone',        descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'shipmentCount', label: '# Ships',     descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                        { key: 'rateCardAvg',   label: 'MRC Avg',     descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'actualAvg',     label: 'Actual Avg',  descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'delta',         label: 'Delta',       descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'deltaPercent',  label: 'Delta %',     descLabel: '↓ High', ascLabel: '↑ Low' },
                      ]}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{SERVICE_LABELS[effectiveService!]}</p>
              </div>
              {/* Zone status legend */}
              <div className="px-5 py-2 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid #f3f4f6', background: '#FAFAF8' }}>
                <span className="text-xs font-semibold text-gray-400 mr-1">Status:</span>
                {([
                  { label: '✓ On Rate', bg: 'rgba(34,197,94,0.1)',   text: '#15803D', border: 'rgba(34,197,94,0.3)',   note: 'within ±5%' },
                  { label: '⚠ Over',   bg: 'rgba(239,68,68,0.08)',  text: '#b91c1c', border: 'rgba(239,68,68,0.3)',  note: 'paying above MRC' },
                  { label: '✓ Under',  bg: 'rgba(68,114,232,0.08)', text: '#1d4ed8', border: 'rgba(68,114,232,0.3)', note: 'paying below MRC' },
                ]).map(({ label, bg, text, border, note }) => (
                  <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                    style={{ background: bg, color: text, border: `1px solid ${border}` }}>
                    {label}
                    <span className="font-normal opacity-75">({note})</span>
                  </span>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                      {([
                        { key: 'zone' as keyof ZoneComparison, label: 'Zone', align: 'left' },
                        { key: 'shipmentCount' as keyof ZoneComparison, label: '# Ships', align: 'right' },
                        { key: 'rateCardAvg' as keyof ZoneComparison, label: 'MRC Avg', align: 'right', color: '#4472E8' },
                        { key: 'actualAvg' as keyof ZoneComparison, label: 'Actual Avg', align: 'right', color: '#EF5252' },
                        { key: 'delta' as keyof ZoneComparison, label: 'Delta', align: 'right' },
                        { key: 'deltaPercent' as keyof ZoneComparison, label: 'Status', align: 'center' },
                      ]).map(({ key, label, align, color }) => (
                        <th
                          key={key}
                          onClick={() => handleZoneSort(key)}
                          className={`px-3 py-2.5 text-${align} text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap`}
                          style={{ color: zoneSortKey === key ? '#4472E8' : (color ?? '#252F3E') }}
                        >
                          {label}
                          <span className="ml-1 font-normal" style={{ opacity: zoneSortKey === key ? 1 : 0.3 }}>
                            {zoneSortKey === key ? (zoneSortDir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(zoneTableExpanded ? sortedComparisons : sortedComparisons.slice(0, 5)).map((c, idx) => {
                      const overpaid = c.delta > 0.01;
                      const withinTolerance = Math.abs(c.deltaPercent) <= 5;

                      const statusLabel = withinTolerance ? '✓ On Rate' : overpaid ? '⚠ Over' : '✓ Under';
                      const statusColor = withinTolerance
                        ? { bg: 'rgba(34,197,94,0.1)', text: '#15803D', border: 'rgba(34,197,94,0.3)' }
                        : overpaid
                        ? { bg: 'rgba(239,68,68,0.08)', text: '#b91c1c', border: 'rgba(239,68,68,0.3)' }
                        : { bg: 'rgba(68,114,232,0.08)', text: '#1d4ed8', border: 'rgba(68,114,232,0.3)' };

                      return (
                        <tr
                          key={c.zone}
                          style={{
                            background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.03)',
                            borderBottom: '1px solid #f3f4f6',
                          }}
                        >
                          <td className="px-3 py-2.5 font-bold" style={{ color: '#252F3E' }}>Zone {c.zone}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-600">
                            {c.shipmentCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold" style={{ color: '#4472E8' }}>
                            {formatUSD(c.rateCardAvg)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold" style={{ color: '#EF5252' }}>
                            {formatUSD(c.actualAvg)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold" style={{ color: overpaid ? '#EF4444' : '#22C55E' }}>
                            {c.delta >= 0 ? '+' : ''}{formatUSD(c.delta)}
                            <span className="text-xs font-medium ml-1 text-gray-400">
                              ({c.deltaPercent >= 0 ? '+' : ''}{c.deltaPercent.toFixed(1)}%)
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-xs font-bold"
                              style={{
                                background: statusColor.bg,
                                color: statusColor.text,
                                border: `1px solid ${statusColor.border}`,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {comparisons.length > 5 && (
                <div className="py-2.5 text-center" style={{ borderTop: '1px solid #f3f4f6' }}>
                  <button
                    onClick={() => setZoneTableExpanded(e => !e)}
                    className="text-xs font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-80"
                    style={{ background: '#F5F5F0', color: '#4472E8', border: '1px solid #e5e7eb' }}
                  >
                    {zoneTableExpanded ? '↑ Show less' : `↓ Show all ${comparisons.length} zones`}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Methodology note */}
          <div
            className="rounded-lg p-3 mt-6"
            style={{ background: '#F5F5F0', border: '1px solid #E5E7EB' }}
          >
            <p className="text-xs text-gray-400 leading-relaxed">
              <span className="font-semibold text-gray-500">Methodology: </span>
              MRC rates sourced from ShipHero's negotiated USPS rate card. Zone is estimated from the origin
              warehouse ZIP to the destination state centroid using USPS distance bands. Weights are matched
              to the nearest weight tier in the rate table. Delta = Actual − MRC (positive means overpaid).
            </p>
          </div>
        </>
      )}

      {/* Loaded but no matches */}
      {canCompare && comparisons.length === 0 && (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        >
          <div className="text-3xl mb-2">🔍</div>
          <p className="text-sm text-gray-400">
            No matching shipments found. Ensure shipments have valid state and weight data.
          </p>
        </div>
      )}

      {/* ── ShipHero UPS Rate Card ─────────────────────────────────────────── */}
      <div className="mt-8">
        {/* Toggle card */}
        <div
          className="rounded-xl p-5 mb-0"
          style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
        >
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black text-white flex-shrink-0"
                style={{ background: upsEnabled ? '#22C55E' : '#94A3B8' }}>
                {upsEnabled ? '✓' : 'U'}
              </div>
              <div className="min-w-0">
                <div className="font-black text-base" style={{ color: '#252F3E' }}>ShipHero UPS Rate Card</div>
                <div className="text-xs text-gray-400">2026 ShipHero Program rates — compare your shipment profile against negotiated UPS rates</div>
              </div>
            </div>
            {/* Toggle */}
            <button
              onClick={() => setUpsEnabled(v => !v)}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all"
              style={{
                background: upsEnabled ? 'rgba(34,197,94,0.1)' : '#F5F5F0',
                color: upsEnabled ? '#15803D' : '#6B7280',
                border: `1.5px solid ${upsEnabled ? 'rgba(34,197,94,0.4)' : '#E5E7EB'}`,
              }}
            >
              <span style={{
                display: 'inline-block', width: 32, height: 18, borderRadius: 9, position: 'relative',
                background: upsEnabled ? '#22C55E' : '#D1D5DB', transition: 'background 0.2s',
                flexShrink: 0,
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: upsEnabled ? 16 : 2,
                  width: 14, height: 14, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </span>
              {upsEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          {/* Service selector + rate preview — shown when enabled */}
          {upsEnabled && (
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid #e5e7eb' }}>
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-400">Service</div>
                <select
                  value={selectedUPSService}
                  onChange={(e) => setSelectedUPSService(e.target.value as UPSServiceKey)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold"
                  style={{ background: '#F5F5F0', border: '1.5px solid #E5E7EB', color: '#252F3E', outline: 'none', cursor: 'pointer' }}
                >
                  {(Object.keys(UPS_SERVICE_LABELS) as UPSServiceKey[]).map(k => (
                    <option key={k} value={k}>{UPS_SERVICE_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              {/* Rate preview table */}
              <div className="overflow-x-auto">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
                  {UPS_SERVICE_LABELS[selectedUPSService]} — sample rates (1–5 lbs)
                </div>
                <table className="text-xs border-collapse" style={{ minWidth: '440px' }}>
                  <thead>
                    <tr style={{ background: '#F5F5F0' }}>
                      <th className="px-2 py-1.5 text-left font-bold border" style={{ borderColor: '#E5E7EB', color: '#252F3E' }}>Weight</th>
                      {upsZones.map(z => (
                        <th key={z} className="px-2 py-1.5 text-right font-bold border" style={{ borderColor: '#E5E7EB', color: '#EF5252' }}>Z{z}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {upsPreviewRows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td className="px-2 py-1 font-semibold border" style={{ borderColor: '#E5E7EB', color: '#252F3E' }}>{row[0]} lb</td>
                        {upsZones.map((_, zi) => (
                          <td key={zi} className="px-2 py-1 text-right border" style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                            ${(row[zi + 1] as number).toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* UPS Comparison results */}
        {upsEnabled && hasData && hasWarehouse && upsSummary && upsComparisons.length > 0 && (
          <div className="mt-4">
            {/* KPI summary */}
            <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4">
              <KPICard label="Shipments Analyzed" value={upsSummary.totalShipments.toLocaleString()} sub={fileName || undefined} />
              <KPICard label="ShipHero UPS Total" value={formatBigUSD(upsSummary.rateCardTotal)} sub="At negotiated UPS rate" accent="#EF5252" />
              <KPICard label="Actual Total Paid" value={formatBigUSD(upsSummary.actualTotal)} sub="From label cost in CSV" accent="#4472E8" />
              <KPICard
                label="Total Delta"
                value={(upsSummary.totalDelta >= 0 ? '+' : '') + formatBigUSD(upsSummary.totalDelta)}
                sub={upsSummary.totalDelta > 0.01 ? 'Overpaid vs UPS rate' : upsSummary.totalDelta < -0.01 ? 'Saved vs UPS rate' : 'On rate'}
                accent={upsSummary.totalDelta > 0.01 ? '#EF4444' : '#22C55E'}
              />
            </div>

            {/* Chart + Table */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Avg Cost by Zone — UPS vs Actual</h3>
                  <InsightGate sectionKey="upsAvgCost" />
                </div>
                <p className="text-xs text-gray-400 mb-4">{UPS_SERVICE_LABELS[selectedUPSService]}</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={upsChartData} margin={{ top: 4, right: 8, left: 8, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="zone" tick={{ fontSize: 11, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}
                      label={{ value: 'USPS Zone', position: 'insideBottom', offset: -8, fontSize: 11, fill: '#6B7280' }} />
                    <YAxis tickFormatter={(v: number) => '$' + v.toFixed(0)} tick={{ fontSize: 11, fill: '#6B7280', fontFamily: "'Metropolis', sans-serif" }} />
                    <RechartsTooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const ups = payload.find(p => p.name === 'ShipHero UPS');
                        const actual = payload.find(p => p.name === 'Actual Paid');
                        const delta = (actual?.value as number ?? 0) - (ups?.value as number ?? 0);
                        return (
                          <div className="rounded-xl p-3 shadow-xl text-sm" style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: 170 }}>
                            <div className="font-bold text-white mb-2">Zone {label}</div>
                            {ups && <div className="text-gray-300">ShipHero UPS: <span className="text-white font-semibold">{formatUSD(ups.value as number)}</span></div>}
                            {actual && <div className="text-gray-300">Actual Paid: <span className="text-white font-semibold">{formatUSD(actual.value as number)}</span></div>}
                            <div className="mt-1" style={{ color: delta > 0.01 ? '#EF4444' : '#22C55E' }}>
                              Delta: <span className="font-bold">{delta > 0 ? '+' : ''}{formatUSD(delta)}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Metropolis', sans-serif" }} />
                    <Bar dataKey="ShipHero UPS" fill="#EF5252" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Actual Paid" fill="#4472E8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <div>
                    <h3 className="font-black text-base" style={{ color: '#252F3E' }}>Zone-by-Zone Breakdown</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{UPS_SERVICE_LABELS[selectedUPSService]}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <InsightGate sectionKey="upsZoneBreakdown" />
                    <ExportButton
                      data={upsComparisons.map(c => ({
                        Zone: `Zone ${c.zone}`, '# Shipments': c.shipmentCount,
                        'UPS Rate Avg ($)': parseFloat(c.rateCardAvg.toFixed(2)),
                        'Actual Avg ($)': parseFloat(c.actualAvg.toFixed(2)),
                        'Delta ($)': parseFloat(c.delta.toFixed(2)),
                        'Delta %': parseFloat(c.deltaPercent.toFixed(1)),
                      }))}
                      filename="ups_zone_breakdown"
                    />
                    <SortFilterButton
                      sortKey={upsZoneSortKey} sortDir={upsZoneSortDir}
                      defaultSortKey="zone" defaultSortDir="asc"
                      onSort={(k, d) => { setUpsZoneSortKey(k as keyof ZoneComparison); setUpsZoneSortDir(d); setUpsZoneTableExpanded(false); }}
                      options={[
                        { key: 'zone',          label: 'Zone',       descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'shipmentCount', label: '# Ships',    descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                        { key: 'rateCardAvg',   label: 'UPS Rate',   descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'actualAvg',     label: 'Actual Avg', descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'delta',         label: 'Delta',      descLabel: '↓ High', ascLabel: '↑ Low' },
                        { key: 'deltaPercent',  label: 'Delta %',    descLabel: '↓ High', ascLabel: '↑ Low' },
                      ]}
                    />
                  </div>
                </div>
                {/* UPS Zone status legend */}
                <div className="px-5 py-2 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid #f3f4f6', background: '#FAFAF8' }}>
                  <span className="text-xs font-semibold text-gray-400 mr-1">Status:</span>
                  {([
                    { label: '✓ On Rate', bg: 'rgba(34,197,94,0.1)',   text: '#15803D', border: 'rgba(34,197,94,0.3)',   note: 'within ±5%' },
                    { label: '⚠ Over',   bg: 'rgba(239,68,68,0.08)',  text: '#b91c1c', border: 'rgba(239,68,68,0.3)',  note: 'paying above UPS rate' },
                    { label: '✓ Under',  bg: 'rgba(68,114,232,0.08)', text: '#1d4ed8', border: 'rgba(68,114,232,0.3)', note: 'paying below UPS rate' },
                  ]).map(({ label, bg, text, border, note }) => (
                    <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                      style={{ background: bg, color: text, border: `1px solid ${border}` }}>
                      {label}
                      <span className="font-normal opacity-75">({note})</span>
                    </span>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                        {([
                          { key: 'zone' as keyof ZoneComparison, label: 'Zone', align: 'left' },
                          { key: 'shipmentCount' as keyof ZoneComparison, label: '# Ships', align: 'right' },
                          { key: 'rateCardAvg' as keyof ZoneComparison, label: 'UPS Rate', align: 'right', color: '#EF5252' },
                          { key: 'actualAvg' as keyof ZoneComparison, label: 'Actual Avg', align: 'right', color: '#4472E8' },
                          { key: 'delta' as keyof ZoneComparison, label: 'Delta', align: 'right' },
                          { key: 'deltaPercent' as keyof ZoneComparison, label: 'Status', align: 'center' },
                        ]).map(({ key, label, align, color }) => (
                          <th key={key} onClick={() => handleUPSZoneSort(key)}
                            className={`px-3 py-2.5 text-${align} text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap`}
                            style={{ color: upsZoneSortKey === key ? '#EF5252' : (color ?? '#252F3E') }}>
                            {label}
                            <span className="ml-1 font-normal" style={{ opacity: upsZoneSortKey === key ? 1 : 0.3 }}>
                              {upsZoneSortKey === key ? (upsZoneSortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(upsZoneTableExpanded ? sortedUPSComparisons : sortedUPSComparisons.slice(0, 5)).map((c, idx) => {
                        const overpaid = c.delta > 0.01;
                        const withinTol = Math.abs(c.deltaPercent) <= 5;
                        const statusLabel = withinTol ? '✓ On Rate' : overpaid ? '⚠ Over' : '✓ Under';
                        const statusColor = withinTol
                          ? { bg: 'rgba(34,197,94,0.1)', text: '#15803D', border: 'rgba(34,197,94,0.3)' }
                          : overpaid
                          ? { bg: 'rgba(239,68,68,0.08)', text: '#b91c1c', border: 'rgba(239,68,68,0.3)' }
                          : { bg: 'rgba(68,114,232,0.08)', text: '#1d4ed8', border: 'rgba(68,114,232,0.3)' };
                        return (
                          <tr key={c.zone} style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(245,166,35,0.03)', borderBottom: '1px solid #f3f4f6' }}>
                            <td className="px-3 py-2.5 font-bold" style={{ color: '#252F3E' }}>Zone {c.zone}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-gray-600">{c.shipmentCount.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right font-semibold" style={{ color: '#EF5252' }}>{formatUSD(c.rateCardAvg)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold" style={{ color: '#4472E8' }}>{formatUSD(c.actualAvg)}</td>
                            <td className="px-3 py-2.5 text-right font-bold" style={{ color: overpaid ? '#EF4444' : '#22C55E' }}>
                              {c.delta >= 0 ? '+' : ''}{formatUSD(c.delta)}
                              <span className="text-xs font-medium ml-1 text-gray-400">({c.deltaPercent >= 0 ? '+' : ''}{c.deltaPercent.toFixed(1)}%)</span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold"
                                style={{ background: statusColor.bg, color: statusColor.text, border: `1px solid ${statusColor.border}` }}>
                                {statusLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {upsComparisons.length > 5 && (
                  <div className="py-2.5 text-center" style={{ borderTop: '1px solid #f3f4f6' }}>
                    <button onClick={() => setUpsZoneTableExpanded(e => !e)}
                      className="text-xs font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-80"
                      style={{ background: '#F5F5F0', color: '#EF5252', border: '1px solid #e5e7eb' }}>
                      {upsZoneTableExpanded ? '↑ Show less' : `↓ Show all ${upsComparisons.length} zones`}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg p-3 mt-6" style={{ background: '#F5F5F0', border: '1px solid #E5E7EB' }}>
              <p className="text-xs text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-500">UPS Methodology: </span>
                2026 ShipHero Program UPS rates. Zone is estimated from origin warehouse ZIP to destination state centroid
                using USPS distance bands as a proxy for UPS zones (zones 2–8). For NDA/2nd Day/3DS the zone offset
                (e.g. 102–108) is applied accordingly. Delta = Actual − ShipHero UPS Rate (positive means overpaid vs UPS).
              </p>
            </div>
          </div>
        )}

        {upsEnabled && hasData && !hasWarehouse && (
          <div className="mt-4 rounded-xl p-5 text-sm font-semibold"
            style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', color: '#92650a' }}>
            Configure warehouse ZIP codes on the Network Optimization tab to enable UPS zone comparison.
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
