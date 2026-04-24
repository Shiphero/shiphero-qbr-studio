/**
 * slaParser.ts
 * Flowspace CSV detection, parsing, and SLA metric computation.
 *
 * Supported report types (auto-detected by header columns):
 *  - ParcelShipment    : "Shipped At", "Delivered At", "Transportation Total"
 *  - OutboundOrder     : "Required Ship Date", "Shipped Date", "Issue Reported"
 *  - ChannelAnalytics  : "Average Transit Time in Days", "Percentage of Orders Delivered within 2 Days"
 *  - InventorySnapshot : "Snapshot Time", "On-Hand Eaches"
 *  - InboundOrder      : "Scheduled Arrival", "Order Received Date", "Order Completed Date"
 *
 * All other report types are stored as raw rows for future use.
 */

import Papa from 'papaparse';

// ─── Report type ──────────────────────────────────────────────────────────────

export type FlowspaceReportType =
  | 'ParcelShipment'
  | 'OutboundOrder'
  | 'ChannelAnalytics'
  | 'InventorySnapshot'
  | 'InboundOrder'
  | 'Unknown';

export function detectReportType(headers: string[]): FlowspaceReportType {
  const h = new Set(headers.map(s => s.trim()));
  if (h.has('Shipped At') && h.has('Delivered At') && h.has('Transportation Total')) return 'ParcelShipment';
  if (h.has('Required Ship Date') && h.has('Shipped Date') && h.has('Issue Reported'))  return 'OutboundOrder';
  if (h.has('Average Transit Time in Days') && h.has('Channel'))                        return 'ChannelAnalytics';
  if (h.has('Snapshot Time') && h.has('On-Hand Eaches'))                                return 'InventorySnapshot';
  if (h.has('Scheduled Arrival') && h.has('Order Received Date'))                       return 'InboundOrder';
  return 'Unknown';
}

// ─── Row types ────────────────────────────────────────────────────────────────

export interface ParcelShipmentRow {
  order:            string;
  creationDate:     string;   // YYYY-MM-DD
  openDate:         string;
  shippedAt:        string;
  deliveredAt:      string;
  carrier:          string;
  service:          string;
  status:           string;
  transportCost:    number;
  channel:          string;
  fromState:        string;
  toState:          string;
}

export interface OutboundOrderRow {
  order:            string;
  channel:          string;
  warehouse:        string;
  creationDate:     string;   // YYYY-MM-DD
  openDate:         string;
  requiredShipDate: string;
  shippedDate:      string;
  status:           string;
  issueReported:    boolean;
  issueTypes:       string;
  sku:              string;
  carrier:          string;
}

export interface ChannelAnalyticsRow {
  channel:          string;
  unitsShipped:     number;
  ordersShipped:    number;
  avgTransitDays:   number;
  pctWithin2:       number;
  pctWithin3:       number;
  pctWithin4:       number;
  avgShipCostUnit:  number;
  avgFulfillCostUnit: number;
  avgOrderCost:     number;
  avgZone:          number;
}

// ─── Parse helpers ─────────────────────────────────────────────────────────

function pct(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace('%', '').trim()) || 0;
}

function money(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/[$,]/g, '').trim()) || 0;
}

function parseDate(s: string): Date | null {
  if (!s || s.trim() === '') return null;
  // Handle "YYYY-MM-DD HH:MM:SS ±TZ" → take date part only
  const d = new Date(s.trim().split(' ')[0]);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: string, b: string): number | null {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function isoWeek(dateStr: string): string {
  const d = parseDate(dateStr);
  if (!d) return 'Unknown';
  // ISO week: find Monday of that week
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

function isoMonth(dateStr: string): string {
  const d = parseDate(dateStr);
  if (!d) return 'Unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function parseParcelShipment(rows: Record<string, string>[]): ParcelShipmentRow[] {
  return rows.map(r => ({
    order:         r['Order']?.trim() ?? '',
    creationDate:  r['Order Creation Date']?.trim() ?? '',
    openDate:      r['Open Date']?.trim() ?? '',
    shippedAt:     r['Shipped At']?.trim() ?? '',
    deliveredAt:   r['Delivered At']?.trim() ?? '',
    carrier:       r['Carrier Account']?.trim() ?? '',
    service:       r['Selected Parcel Service']?.trim() ?? '',
    status:        r['Status']?.trim() ?? '',
    transportCost: money(r['Transportation Total']),
    channel:       r['Channel']?.trim() ?? '',
    fromState:     r['From State']?.trim() ?? '',
    toState:       r['Recipient State']?.trim() ?? '',
  })).filter(r => r.order);
}

export function parseOutboundOrder(rows: Record<string, string>[]): OutboundOrderRow[] {
  return rows.map(r => ({
    order:            r['Order']?.trim() ?? '',
    channel:          r['Channel']?.trim() ?? '',
    warehouse:        r['Warehouse']?.trim() ?? '',
    creationDate:     r['Order Creation Date']?.trim() ?? '',
    openDate:         r['Open Date']?.trim() ?? '',
    requiredShipDate: r['Required Ship Date']?.trim() ?? '',
    shippedDate:      r['Shipped Date']?.trim() ?? '',
    status:           r['Status']?.trim() ?? '',
    issueReported:    r['Issue Reported']?.trim().toLowerCase() === 'true',
    issueTypes:       r['Issue Type(s)']?.trim() ?? '',
    sku:              r['SKU']?.trim() ?? '',
    carrier:          r['Carrier']?.trim() ?? '',
  })).filter(r => r.order);
}

export function parseChannelAnalytics(rows: Record<string, string>[]): ChannelAnalyticsRow[] {
  return rows.map(r => ({
    channel:             r['Channel']?.trim() ?? '',
    unitsShipped:        parseFloat(r['Units Shipped']) || 0,
    ordersShipped:       parseFloat(r['Orders Shipped']) || 0,
    avgTransitDays:      parseFloat(r['Average Transit Time in Days']) || 0,
    pctWithin2:          pct(r['Percentage of Orders Delivered within 2 Days']),
    pctWithin3:          pct(r['Percentage of Orders Delivered within 3 Days']),
    pctWithin4:          pct(r['Percentage of Orders Delivered within 4 Days']),
    avgShipCostUnit:     money(r['Average Shipping Cost per Unit']),
    avgFulfillCostUnit:  money(r['Average Fulfillment Cost per Unit']),
    avgOrderCost:        money(r['Average Order Total Cost']),
    avgZone:             parseFloat(r['Average US Shipping Zone']) || 0,
  })).filter(r => r.channel);
}

// ─── CSV file ingestion ───────────────────────────────────────────────────────

export interface ParsedReport {
  filename:   string;
  type:       FlowspaceReportType;
  rowCount:   number;
  parcelRows:   ParcelShipmentRow[];
  outboundRows: OutboundOrderRow[];
  channelRows:  ChannelAnalyticsRow[];
}

export function parseFlowspaceCSV(filename: string, csvText: string): ParsedReport {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const type    = detectReportType(headers);
  const rawRows = result.data;

  return {
    filename,
    type,
    rowCount: rawRows.length,
    parcelRows:   type === 'ParcelShipment'   ? parseParcelShipment(rawRows)  : [],
    outboundRows: type === 'OutboundOrder'    ? parseOutboundOrder(rawRows)   : [],
    channelRows:  type === 'ChannelAnalytics' ? parseChannelAnalytics(rawRows): [],
  };
}

// ─── SLA Metric computation ───────────────────────────────────────────────────

export interface SLAKPIs {
  // Ship-time SLA (from OutboundOrder)
  onTimeShipRate:    number | null;   // % shipped on or before Required Ship Date
  sameDayShipRate:   number | null;   // % shipped same day as Open Date
  nextDayShipRate:   number | null;   // % shipped 1 day after Open Date
  lateShipCount:     number;
  totalOrdersWithSLA: number;

  // Transit (from ParcelShipment)
  avgTransitDays:     number | null;
  pctDeliveredIn2:    number | null;
  pctDeliveredIn3:    number | null;
  pctDeliveredIn4:    number | null;
  pctDeliveredIn5Plus: number | null;

  // Error rate (from OutboundOrder)
  issueRate:          number | null;
  issueCount:         number;

  // Cost (from ParcelShipment)
  avgTransportCost:   number | null;
}

export function computeSLAKPIs(
  parcelRows: ParcelShipmentRow[],
  outboundRows: OutboundOrderRow[],
): SLAKPIs {
  // ── Ship-time SLA ──────────────────────────────────────────────────────────
  const withSLA = outboundRows.filter(r => r.requiredShipDate && r.shippedDate && r.status !== 'Cancelled');
  const onTime  = withSLA.filter(r => {
    const days = daysBetween(r.shippedDate, r.requiredShipDate);
    return days !== null && days >= 0; // shipped before or on required date
  });
  const sameDay = withSLA.filter(r => r.openDate && r.shippedDate === r.openDate);
  const nextDay = withSLA.filter(r => {
    const d = daysBetween(r.openDate, r.shippedDate);
    return d === 1;
  });
  const late    = withSLA.filter(r => {
    const days = daysBetween(r.shippedDate, r.requiredShipDate);
    return days !== null && days < 0;
  });

  const issues = outboundRows.filter(r => r.issueReported && r.status !== 'Cancelled');

  // ── Transit SLA ─────────────────────────────────────────────────────────────
  const withTransit = parcelRows.filter(r => r.shippedAt && r.deliveredAt && r.status === 'delivered');
  const transitDays = withTransit.map(r => daysBetween(r.shippedAt, r.deliveredAt)).filter((d): d is number => d !== null && d >= 0);

  const avgTransit   = transitDays.length ? transitDays.reduce((a, b) => a + b, 0) / transitDays.length : null;
  const pctIn2       = transitDays.length ? transitDays.filter(d => d <= 2).length / transitDays.length * 100 : null;
  const pctIn3       = transitDays.length ? transitDays.filter(d => d <= 3).length / transitDays.length * 100 : null;
  const pctIn4       = transitDays.length ? transitDays.filter(d => d <= 4).length / transitDays.length * 100 : null;
  const pct5plus     = transitDays.length ? transitDays.filter(d => d >= 5).length  / transitDays.length * 100 : null;

  // ── Cost ────────────────────────────────────────────────────────────────────
  const costs = parcelRows.map(r => r.transportCost).filter(c => c > 0);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;

  return {
    onTimeShipRate:      withSLA.length ? onTime.length / withSLA.length * 100 : null,
    sameDayShipRate:     withSLA.length ? sameDay.length / withSLA.length * 100 : null,
    nextDayShipRate:     withSLA.length ? nextDay.length / withSLA.length * 100 : null,
    lateShipCount:       late.length,
    totalOrdersWithSLA:  withSLA.length,
    avgTransitDays:      avgTransit,
    pctDeliveredIn2:     pctIn2,
    pctDeliveredIn3:     pctIn3,
    pctDeliveredIn4:     pctIn4,
    pctDeliveredIn5Plus: pct5plus,
    issueRate:           outboundRows.length ? issues.length / outboundRows.length * 100 : null,
    issueCount:          issues.length,
    avgTransportCost:    avgCost,
  };
}

// ─── Time-series helpers ──────────────────────────────────────────────────────

export type Granularity = 'week' | 'month';

export interface ShipSLAPoint {
  period:       string;   // ISO week (YYYY-MM-DD) or month (YYYY-MM)
  onTimeRate:   number;
  lateCount:    number;
  onTimeCount:  number;
  totalOrders:  number;
}

export function buildShipSLATimeSeries(
  outboundRows: OutboundOrderRow[],
  granularity: Granularity = 'week',
): ShipSLAPoint[] {
  const bucket = (r: OutboundOrderRow) =>
    granularity === 'week' ? isoWeek(r.openDate || r.creationDate) : isoMonth(r.openDate || r.creationDate);

  const map = new Map<string, { onTime: number; late: number; total: number }>();
  const withSLA = outboundRows.filter(r => r.requiredShipDate && r.shippedDate && r.status !== 'Cancelled');

  for (const r of withSLA) {
    const period = bucket(r);
    if (period === 'Unknown') continue;
    if (!map.has(period)) map.set(period, { onTime: 0, late: 0, total: 0 });
    const b = map.get(period)!;
    b.total++;
    const days = daysBetween(r.shippedDate, r.requiredShipDate);
    if (days !== null && days >= 0) b.onTime++;
    else b.late++;
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { onTime, late, total }]) => ({
      period,
      onTimeRate:  total ? Math.round(onTime / total * 100) : 0,
      lateCount:   late,
      onTimeCount: onTime,
      totalOrders: total,
    }));
}

export interface TransitPoint {
  period:     string;
  avgDays:    number;
  pctIn2:     number;
  pctIn3:     number;
  pctIn4:     number;
  pct5plus:   number;
  count:      number;
}

export function buildTransitTimeSeries(
  parcelRows: ParcelShipmentRow[],
  granularity: Granularity = 'week',
): TransitPoint[] {
  const bucket = (r: ParcelShipmentRow) =>
    granularity === 'week' ? isoWeek(r.shippedAt || r.creationDate) : isoMonth(r.shippedAt || r.creationDate);

  const map = new Map<string, number[]>();
  const delivered = parcelRows.filter(r => r.shippedAt && r.deliveredAt && r.status === 'delivered');

  for (const r of delivered) {
    const d = daysBetween(r.shippedAt, r.deliveredAt);
    if (d === null || d < 0) continue;
    const period = bucket(r);
    if (period === 'Unknown') continue;
    if (!map.has(period)) map.set(period, []);
    map.get(period)!.push(d);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, days]) => ({
      period,
      avgDays:  days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : 0,
      pctIn2:   days.length ? Math.round(days.filter(d => d <= 2).length / days.length * 100) : 0,
      pctIn3:   days.length ? Math.round(days.filter(d => d <= 3).length / days.length * 100) : 0,
      pctIn4:   days.length ? Math.round(days.filter(d => d <= 4).length / days.length * 100) : 0,
      pct5plus: days.length ? Math.round(days.filter(d => d >= 5).length / days.length * 100) : 0,
      count:    days.length,
    }));
}

export interface ChannelSLAPoint {
  channel:      string;
  onTimeRate:   number;
  lateCount:    number;
  totalOrders:  number;
  issueCount:   number;
}

export function buildChannelSLA(outboundRows: OutboundOrderRow[]): ChannelSLAPoint[] {
  const map = new Map<string, { onTime: number; late: number; total: number; issues: number }>();
  const withSLA = outboundRows.filter(r => r.requiredShipDate && r.shippedDate && r.status !== 'Cancelled');

  for (const r of withSLA) {
    const ch = r.channel || 'Unknown';
    if (!map.has(ch)) map.set(ch, { onTime: 0, late: 0, total: 0, issues: 0 });
    const b = map.get(ch)!;
    b.total++;
    if (r.issueReported) b.issues++;
    const days = daysBetween(r.shippedDate, r.requiredShipDate);
    if (days !== null && days >= 0) b.onTime++;
    else b.late++;
  }

  return Array.from(map.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([channel, { onTime, late, total, issues }]) => ({
      channel:    channel.replace(/^(Shopify|Amazon|TikTok) - /, '').slice(0, 28),
      onTimeRate: total ? Math.round(onTime / total * 100) : 0,
      lateCount:  late,
      totalOrders: total,
      issueCount: issues,
    }));
}

// ─── Recent orders table ──────────────────────────────────────────────────────

export interface SLAOrderRow {
  order:         string;
  channel:       string;
  openDate:      string;
  requiredDate:  string;
  shippedDate:   string;
  daysToShip:    number | null;
  shipStatus:    'on-time' | 'late' | 'same-day' | 'pending' | 'unknown';
  issueReported: boolean;
  issueTypes:    string;
  warehouse:     string;
}

export function buildRecentOrders(outboundRows: OutboundOrderRow[], limit = 100): SLAOrderRow[] {
  return [...outboundRows]
    .sort((a, b) => (b.openDate || b.creationDate).localeCompare(a.openDate || a.creationDate))
    .slice(0, limit)
    .map(r => {
      const daysToShip = daysBetween(r.openDate || r.creationDate, r.shippedDate);
      let shipStatus: SLAOrderRow['shipStatus'] = 'unknown';
      if (r.shippedDate && r.requiredShipDate) {
        const diff = daysBetween(r.shippedDate, r.requiredShipDate);
        if (diff !== null) {
          if (daysToShip === 0) shipStatus = 'same-day';
          else if (diff >= 0)   shipStatus = 'on-time';
          else                  shipStatus = 'late';
        }
      } else if (!r.shippedDate) {
        shipStatus = 'pending';
      }
      return {
        order:         r.order,
        channel:       r.channel,
        openDate:      r.openDate || r.creationDate,
        requiredDate:  r.requiredShipDate,
        shippedDate:   r.shippedDate,
        daysToShip,
        shipStatus,
        issueReported: r.issueReported,
        issueTypes:    r.issueTypes,
        warehouse:     r.warehouse,
      };
    });
}
