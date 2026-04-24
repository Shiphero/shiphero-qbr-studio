import { Shipment } from '../types/index';

/** Aggregated summary stored for a prior period — avoids storing full Shipment[]. */
export interface PriorPeriodSummary {
  fileName: string;
  uploadedAt: string;        // ISO
  totalShipments: number;
  totalSpend: number;
  avgLabelCost: number;
  avgWeight: number;
  totalRevenue: number;
  carrierBreakdown: Record<string, { count: number; spend: number }>;
  /** Per-shipping-method breakdown (e.g. "UPS Ground", "USPS Priority") */
  serviceBreakdown?: Record<string, { count: number; spend: number }>;
  /** Per-warehouse breakdown */
  warehouseBreakdown?: Record<string, { count: number; spend: number }>;
  /** Top destination states (state code → shipment count) */
  stateBreakdown?: Record<string, number>;
  dateRange: { min: string; max: string };
}

/** Delta between current and prior period values. */
export interface PeriodDelta {
  totalShipments: number;         // absolute change
  totalShipmentsPct: number;      // % change
  totalSpend: number;
  totalSpendPct: number;
  avgLabelCost: number;
  avgLabelCostPct: number;
  avgWeight: number;
  avgWeightPct: number;
  totalRevenue: number;
  totalRevenuePct: number;
}

export function buildPriorPeriodSummary(
  shipments: Shipment[],
  fileName: string,
): PriorPeriodSummary {
  if (shipments.length === 0) {
    return {
      fileName,
      uploadedAt: new Date().toISOString(),
      totalShipments: 0,
      totalSpend: 0,
      avgLabelCost: 0,
      avgWeight: 0,
      totalRevenue: 0,
      carrierBreakdown: {},
      dateRange: { min: '', max: '' },
    };
  }

  let totalSpend = 0;
  let totalWeight = 0;
  let totalRevenue = 0;
  let minDate = '';
  let maxDate = '';
  const carriers:   Record<string, { count: number; spend: number }> = {};
  const services:   Record<string, { count: number; spend: number }> = {};
  const warehouses: Record<string, { count: number; spend: number }> = {};
  const states:     Record<string, number> = {};

  for (const s of shipments) {
    totalSpend += s.labelCost;
    totalWeight += s.weight;
    totalRevenue += s.totalShippingCharged;
    if (!minDate || s.orderDate < minDate) minDate = s.orderDate;
    if (!maxDate || s.orderDate > maxDate) maxDate = s.orderDate;

    const c = s.carrier || 'Unknown';
    if (!carriers[c]) carriers[c] = { count: 0, spend: 0 };
    carriers[c].count++;
    carriers[c].spend += s.labelCost;

    const svc = s.shippingMethod || 'Unknown';
    if (!services[svc]) services[svc] = { count: 0, spend: 0 };
    services[svc].count++;
    services[svc].spend += s.labelCost;

    const wh = s.warehouse || 'Unknown';
    if (!warehouses[wh]) warehouses[wh] = { count: 0, spend: 0 };
    warehouses[wh].count++;
    warehouses[wh].spend += s.labelCost;

    if (s.state) states[s.state] = (states[s.state] ?? 0) + 1;
  }

  return {
    fileName,
    uploadedAt: new Date().toISOString(),
    totalShipments: shipments.length,
    totalSpend,
    avgLabelCost: totalSpend / shipments.length,
    avgWeight: totalWeight / shipments.length,
    totalRevenue,
    carrierBreakdown: carriers,
    serviceBreakdown: services,
    warehouseBreakdown: warehouses,
    stateBreakdown: states,
    dateRange: { min: minDate, max: maxDate },
  };
}

function pct(current: number, prior: number): number {
  if (prior === 0) return 0;
  return ((current - prior) / prior) * 100;
}

export function computeDeltas(
  current: { totalShipments: number; totalSpend: number; avgLabelCost: number; avgWeight: number; totalRevenue: number },
  prior: PriorPeriodSummary,
): PeriodDelta {
  return {
    totalShipments:    current.totalShipments - prior.totalShipments,
    totalShipmentsPct: pct(current.totalShipments, prior.totalShipments),
    totalSpend:        current.totalSpend - prior.totalSpend,
    totalSpendPct:     pct(current.totalSpend, prior.totalSpend),
    avgLabelCost:      current.avgLabelCost - prior.avgLabelCost,
    avgLabelCostPct:   pct(current.avgLabelCost, prior.avgLabelCost),
    avgWeight:         current.avgWeight - prior.avgWeight,
    avgWeightPct:      pct(current.avgWeight, prior.avgWeight),
    totalRevenue:      current.totalRevenue - prior.totalRevenue,
    totalRevenuePct:   pct(current.totalRevenue, prior.totalRevenue),
  };
}

/** Format a delta value for display, e.g. "+12.3%" or "−5.1%" */
export function formatDeltaPct(pct: number, decimals = 1): string {
  if (!isFinite(pct)) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(decimals)}%`;
}

export function deltaDirection(value: number): 'up' | 'down' | 'flat' {
  if (value > 0.05) return 'up';
  if (value < -0.05) return 'down';
  return 'flat';
}
