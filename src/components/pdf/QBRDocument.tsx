import React from 'react';
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer';
import type { InventoryPDFData, ExpiryTierPDF, DOHStatusPDF } from '../../context/PDFContext';
import type { RecommendedAction } from '../../utils/recommendedActions';
import type { PriorPeriodSummary, PeriodDelta } from '../../utils/periodComparison';

// ── Brand ─────────────────────────────────────────────────────────────────────
const NAVY   = '#252F3E';
const BLUE   = '#4472E8';
const ORANGE = '#EF5252';
const GRAY   = '#6B7280';
const LIGHT  = '#F5F5F0';
const WHITE  = '#FFFFFF';
const RED    = '#EF4444';
const GREEN  = '#22C55E';
const TEAL   = '#0891B2';
const PURPLE = '#7C3AED';
const YELLOW = '#EAB308';

// ── Exported types ────────────────────────────────────────────────────────────

export type SectionKey =
  | 'accountOverview' | 'topAccounts' | 'labelVsCharged'
  | 'carrierMix' | 'zonePerformance' | 'expiryAlerts'
  | 'daysOnHand' | 'poCadence';

export interface SectionOptions {
  showTable: boolean;
  tableRows: number;     // 0 = all
  sortBy: string;        // '' = section default
  sortDir: 'asc' | 'desc';
  customText: string;
}

export interface EnabledSection {
  key: SectionKey;
  enabled: boolean;
  options: SectionOptions;
}

export interface CustomerStatPDF {
  customer: string;
  orderCount: number;
  volumePercent: number;
  avgShippingCost: number;
  avgOrderValue: number;
  avgZone: number;
}

export interface CostGapRowPDF {
  name: string;
  labelCost: number;
  totalCharged: number;
  gap: number;
  gapPct: number;
  shipments: number;
}

export interface CarrierMixRowPDF {
  carrier: string;
  shipments: number;
  pctOfTotal: number;
  avgCost: number;
}

export interface ZoneComparisonPDF {
  zone: number;
  shipmentCount: number;
  rateCardAvg: number;
  actualAvg: number;
  delta: number;
  deltaPercent: number;
}

export interface KPISummaryPDF {
  totalShipments: number;
  totalLabelCost: number;
  totalCharged: number;
  uniqueAccounts: number;
  avgLabelCost: number;
  avgZone: number | null;
}

export interface QBRDocumentProps {
  clientName: string;
  reportDate: string;
  reportingPeriod?: string;
  clientLogo?: string;      // base64 data URL
  enabledSections: EnabledSection[];
  kpis: KPISummaryPDF | null;
  customerStats: CustomerStatPDF[];
  costGapRows: CostGapRowPDF[];
  carrierMix: CarrierMixRowPDF[];
  zoneComparisons: ZoneComparisonPDF[];
  inventoryData: InventoryPDFData | null;
  recommendedActions?: RecommendedAction[];
  priorPeriod?: PriorPeriodSummary;
  delta?: PeriodDelta;
}

// ── Stylesheet ────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', backgroundColor: WHITE, paddingBottom: 40 },
  // Cover
  coverBg: { backgroundColor: NAVY, flex: 1, justifyContent: 'center', alignItems: 'center', padding: 60 },
  coverEyebrow: { fontSize: 9, color: ORANGE, characterSpacing: 3, marginBottom: 14 },
  coverTitle: { fontSize: 32, fontFamily: 'Helvetica-Bold', color: WHITE, textAlign: 'center', marginBottom: 8 },
  coverAccent: { height: 4, width: 80, backgroundColor: ORANGE, marginBottom: 28, marginTop: 4 },
  coverClient: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: ORANGE, textAlign: 'center', marginBottom: 10 },
  coverDate: { fontSize: 13, color: '#CBD5E1', textAlign: 'center', marginBottom: 52 },
  coverTagline: { fontSize: 9, color: '#94A3B8', textAlign: 'center' },
  coverLogoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 48 },
  coverLogoBar: { height: 2, width: 28, backgroundColor: ORANGE, marginHorizontal: 12 },
  coverLogoText: { fontSize: 10, color: '#94A3B8', characterSpacing: 2 },
  // Page chrome
  pageHeader: { backgroundColor: NAVY, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 10 },
  pageHeaderTitle: { color: WHITE, fontSize: 10, fontFamily: 'Helvetica-Bold' },
  pageHeaderRight: { color: ORANGE, fontSize: 8, characterSpacing: 1 },
  accentBar: { height: 3, backgroundColor: ORANGE },
  pageFooter: { position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: GRAY },
  // Content
  content: { paddingHorizontal: 24, paddingTop: 14 },
  sectionTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 5 },
  sectionSub: { fontSize: 8, color: GRAY, marginBottom: 10, marginTop: -3 },
  // KPI cards
  kpiRow: { flexDirection: 'row', marginBottom: 12 },
  kpiCard: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: 10, marginRight: 8 },
  kpiCardLast: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: 10 },
  kpiLabel: { fontSize: 6.5, color: GRAY, marginBottom: 3 },
  kpiValue: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: NAVY },
  kpiSub: { fontSize: 7, color: GRAY, marginTop: 2 },
  // Table
  tableHeaderRow: { flexDirection: 'row', backgroundColor: NAVY, paddingVertical: 5, paddingHorizontal: 8 },
  tableHeaderCell: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: WHITE },
  tableRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8, borderBottomColor: '#F3F4F6', borderBottomWidth: 1 },
  tableRowAlt: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#F8F9FA', borderBottomColor: '#F3F4F6', borderBottomWidth: 1 },
  cellL: { fontSize: 7.5, color: NAVY },
  cellR: { fontSize: 7.5, color: NAVY, textAlign: 'right' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number) { return '$' + n.toFixed(2); }
function fmtN(n: number) { return n.toLocaleString(); }
function pct(n: number) { return n.toFixed(1) + '%'; }
function clamp(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
function applyLimit<T>(arr: T[], limit: number): T[] { return limit === 0 ? arr : arr.slice(0, limit); }

// ── Sort helpers ──────────────────────────────────────────────────────────────
type Comparator<T> = (a: T, b: T) => number;

function makeSorter<T>(key: keyof T, dir: 'asc' | 'desc'): Comparator<T> {
  const m = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number') return m * (va - vb);
    if (typeof va === 'string' && typeof vb === 'string') return m * va.localeCompare(vb);
    return 0;
  };
}

// ── Bar chart row ─────────────────────────────────────────────────────────────
function BarRow({
  label, value, maxValue, barColor, displayValue,
  labelWidth = 90, valueWidth = 50,
}: {
  label: string; value: number; maxValue: number; barColor: string;
  displayValue: string; labelWidth?: number; valueWidth?: number;
}) {
  const fillPct = maxValue > 0 ? clamp((value / maxValue) * 100, 0, 100) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
      <Text style={{ fontSize: 7, color: NAVY, width: labelWidth }}>{truncate(label, 20)}</Text>
      <View style={{ flex: 1, height: 9, backgroundColor: '#E5E7EB', borderRadius: 2, marginHorizontal: 6 }}>
        {fillPct > 0 && <View style={{ width: `${fillPct}%`, height: 9, backgroundColor: barColor, borderRadius: 2 }} />}
      </View>
      <Text style={{ fontSize: 7, color: GRAY, width: valueWidth, textAlign: 'right' }}>{displayValue}</Text>
    </View>
  );
}

// ── Grouped twin bars ─────────────────────────────────────────────────────────
function GroupedBarRow({
  label, val1, val2, max, color1, color2, disp1, disp2, labelWidth = 50,
}: {
  label: string; val1: number; val2: number; max: number;
  color1: string; color2: string; disp1: string; disp2: string; labelWidth?: number;
}) {
  const p1 = max > 0 ? clamp((val1 / max) * 100, 0, 100) : 0;
  const p2 = max > 0 ? clamp((val2 / max) * 100, 0, 100) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ fontSize: 7, color: NAVY, width: labelWidth }}>{label}</Text>
      <View style={{ flex: 1, marginHorizontal: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
          <View style={{ flex: 1, height: 7, backgroundColor: '#E5E7EB', borderRadius: 1 }}>
            {p1 > 0 && <View style={{ width: `${p1}%`, height: 7, backgroundColor: color1, borderRadius: 1 }} />}
          </View>
          <Text style={{ fontSize: 6.5, color: color1, width: 38, textAlign: 'right' }}>{disp1}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, height: 7, backgroundColor: '#E5E7EB', borderRadius: 1 }}>
            {p2 > 0 && <View style={{ width: `${p2}%`, height: 7, backgroundColor: color2, borderRadius: 1 }} />}
          </View>
          <Text style={{ fontSize: 6.5, color: color2, width: 38, textAlign: 'right' }}>{disp2}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Callout box ───────────────────────────────────────────────────────────────
function Callout({ icon, text, color = BLUE }: { icon: string; text: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: 8, borderRadius: 3 }}>
      <View style={{ width: 3, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', backgroundColor: color + '18', paddingVertical: 7, paddingHorizontal: 10 }}>
        <Text style={{ fontSize: 8, color, marginRight: 6, fontFamily: 'Helvetica-Bold' }}>{icon}</Text>
        <Text style={{ fontSize: 8, color: NAVY, flex: 1 }}>{text}</Text>
      </View>
    </View>
  );
}

// ── Analyst note (custom text from builder) ───────────────────────────────────
function AnalystNote({ text }: { text: string }) {
  if (!text || !text.trim()) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: 10, borderRadius: 3 }}>
      <View style={{ width: 3, backgroundColor: ORANGE }} />
      <View style={{ flex: 1, backgroundColor: '#FFF8EC', paddingVertical: 8, paddingHorizontal: 10 }}>
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: ORANGE, marginBottom: 2 }}>ANALYST NOTE</Text>
        <Text style={{ fontSize: 8, color: NAVY }}>{text}</Text>
      </View>
    </View>
  );
}

// ── Status summary card ───────────────────────────────────────────────────────
function StatusCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: color + '18', borderRadius: 4, paddingVertical: 8, paddingHorizontal: 4, marginRight: 6 }}>
      <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color }}>{count}</Text>
      <Text style={{ fontSize: 6, color: GRAY, marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function ChartLabel({ text }: { text: string }) {
  return <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 6, marginTop: 2 }}>{text}</Text>;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14 }}>
      <View style={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2, marginRight: 4 }} />
      <Text style={{ fontSize: 6.5, color: GRAY }}>{label}</Text>
    </View>
  );
}

// ── Page chrome ───────────────────────────────────────────────────────────────
function ContentPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Page size="LETTER" style={S.page}>
      <View style={S.pageHeader}>
        <Text style={S.pageHeaderTitle}>{title}</Text>
        <Text style={S.pageHeaderRight}>SHIPHERO QBR</Text>
      </View>
      <View style={S.accentBar} />
      <View style={S.content}>{children}</View>
      <Text
        style={S.pageFooter}
        fixed
        render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Page ${pageNumber} of ${totalPages}  \u00B7  Confidential \u2014 ShipHero`
        }
      />
    </Page>
  );
}

// ── Section: Account Overview ─────────────────────────────────────────────────
function AccountOverviewSection({ kpis, customerStats, options }: {
  kpis: KPISummaryPDF; customerStats: CustomerStatPDF[]; options: SectionOptions;
}) {
  const top5 = customerStats.slice(0, 5);
  const maxOrders = top5[0]?.orderCount ?? 1;
  const topPct = customerStats[0]?.volumePercent ?? 0;
  const margin = kpis.totalCharged > 0 ? kpis.totalCharged - kpis.totalLabelCost : null;

  return (
    <ContentPage title="Account Overview">
      <Text style={S.sectionTitle}>Shipping Summary</Text>
      <Text style={S.sectionSub}>Key metrics for the reporting period</Text>
      <AnalystNote text={options.customText} />

      <View style={S.kpiRow}>
        <View style={S.kpiCard}>
          <Text style={S.kpiLabel}>TOTAL SHIPMENTS</Text>
          <Text style={[S.kpiValue, { color: BLUE }]}>{fmtN(kpis.totalShipments)}</Text>
        </View>
        <View style={S.kpiCard}>
          <Text style={S.kpiLabel}>TOTAL LABEL COST</Text>
          <Text style={S.kpiValue}>{'$' + (kpis.totalLabelCost / 1000).toFixed(1) + 'K'}</Text>
        </View>
        <View style={S.kpiCard}>
          <Text style={S.kpiLabel}>AVG LABEL COST</Text>
          <Text style={S.kpiValue}>{fmt$(kpis.avgLabelCost)}</Text>
        </View>
        <View style={S.kpiCard}>
          <Text style={S.kpiLabel}>UNIQUE ACCOUNTS</Text>
          <Text style={S.kpiValue}>{kpis.uniqueAccounts}</Text>
        </View>
        <View style={S.kpiCardLast}>
          <Text style={S.kpiLabel}>AVG ZONE</Text>
          <Text style={S.kpiValue}>{kpis.avgZone !== null ? kpis.avgZone.toFixed(1) : '\u2014'}</Text>
        </View>
      </View>

      {kpis.totalCharged > 0 && margin !== null && (
        <View style={[S.kpiRow, { marginBottom: 14 }]}>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>TOTAL BILLED TO CUSTOMERS</Text>
            <Text style={[S.kpiValue, { color: ORANGE }]}>{'$' + (kpis.totalCharged / 1000).toFixed(1) + 'K'}</Text>
          </View>
          <View style={[S.kpiCard, { flex: 2 }]}>
            <Text style={S.kpiLabel}>SHIPPING MARGIN</Text>
            <Text style={[S.kpiValue, { color: margin >= 0 ? GREEN : RED }]}>
              {'$' + (margin / 1000).toFixed(1) + 'K'}
            </Text>
            <Text style={S.kpiSub}>Total Charged \u2212 Label Cost</Text>
          </View>
          <View style={[S.kpiCardLast, { flex: 2 }]}>
            <Text style={S.kpiLabel}>MARGIN %</Text>
            <Text style={[S.kpiValue, { color: margin >= 0 ? GREEN : RED }]}>
              {kpis.totalLabelCost > 0 ? pct((margin / kpis.totalLabelCost) * 100) : '\u2014'}
            </Text>
            <Text style={S.kpiSub}>vs label cost</Text>
          </View>
        </View>
      )}

      {margin !== null && margin < 0 && (
        <Callout icon="!" text={`Shipping margin is negative \u2014 label cost exceeds billed revenue by $${(Math.abs(margin) / 1000).toFixed(1)}K. Review billing rates for undercharging accounts.`} color={RED} />
      )}
      {topPct > 50 && customerStats[0] && (
        <Callout icon="i" text={`${customerStats[0].customer} represents ${pct(topPct)} of all shipments \u2014 high concentration. Consider strategic pricing review.`} color={ORANGE} />
      )}
      {kpis.avgZone !== null && kpis.avgZone >= 6 && (
        <Callout icon="i" text={`Average shipping zone is ${kpis.avgZone.toFixed(1)} \u2014 warehouse placement optimization could reduce transit costs.`} color={BLUE} />
      )}

      {top5.length > 0 && (
        <View>
          <ChartLabel text="Top 5 Accounts by Shipment Volume" />
          {top5.map((r, i) => (
            <BarRow key={i} label={r.customer} value={r.orderCount} maxValue={maxOrders}
              barColor={i === 0 ? BLUE : BLUE + 'A0'}
              displayValue={fmtN(r.orderCount) + ' (' + pct(r.volumePercent) + ')'}
              labelWidth={110} valueWidth={72} />
          ))}
        </View>
      )}
    </ContentPage>
  );
}

// ── Section: Top Accounts ─────────────────────────────────────────────────────
function TopAccountsSection({ rows, options }: { rows: CustomerStatPDF[]; options: SectionOptions }) {
  const sortKeyMap: Record<string, keyof CustomerStatPDF> = {
    orderCount: 'orderCount', avgShippingCost: 'avgShippingCost',
    avgOrderValue: 'avgOrderValue', avgZone: 'avgZone',
  };
  const sk = sortKeyMap[options.sortBy] ?? 'orderCount';
  const sorted = [...rows].sort(makeSorter(sk, options.sortDir));
  const top10Chart = sorted.slice(0, 10);
  const tableData = applyLimit(sorted, options.tableRows);
  const total = rows.reduce((s, r) => s + r.orderCount, 0);
  const top3Pct = top10Chart.slice(0, 3).reduce((s, r) => s + r.volumePercent, 0);
  const COLORS = [BLUE, BLUE + 'D0', BLUE + 'B0', BLUE + '90', BLUE + '80', TEAL, TEAL + 'D0', TEAL + 'B0', TEAL + '90', TEAL + '80'];

  return (
    <ContentPage title="Top Accounts by Volume">
      <Text style={S.sectionTitle}>Account Volume Breakdown</Text>
      <Text style={S.sectionSub}>Accounts ranked by shipment count</Text>
      <AnalystNote text={options.customText} />

      {top3Pct > 0 && (
        <Callout icon="i" text={`Top 3 accounts represent ${pct(top3Pct)} of all ${fmtN(total)} shipments.`} color={BLUE} />
      )}

      <ChartLabel text="Shipments by Account (top 10)" />
      <View style={{ marginBottom: 14 }}>
        {top10Chart.map((r, i) => (
          <BarRow key={i} label={r.customer} value={r.orderCount} maxValue={top10Chart[0]?.orderCount ?? 1}
            barColor={COLORS[i]} displayValue={fmtN(r.orderCount) + ' \u00B7 ' + pct(r.volumePercent)}
            labelWidth={105} valueWidth={72} />
        ))}
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`Cost & Zone Detail${tableData.length < sorted.length ? ` (top ${tableData.length} of ${sorted.length})` : ''}`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 3 }]}>Account</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Orders</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>% Vol</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Avg Label $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Avg Billed $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Avg Zone</Text>
            </View>
            {tableData.map((r, i) => (
              <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                <Text style={[S.cellL, { flex: 3 }]}>{truncate(r.customer, 30)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{fmtN(r.orderCount)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{pct(r.volumePercent)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{fmt$(r.avgShippingCost)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{r.avgOrderValue > 0 ? fmt$(r.avgOrderValue) : '\u2014'}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{r.avgZone > 0 ? r.avgZone.toFixed(1) : '\u2014'}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ContentPage>
  );
}

// ── Section: Label vs Charged ─────────────────────────────────────────────────
function LabelVsChargedSection({ rows, options }: { rows: CostGapRowPDF[]; options: SectionOptions }) {
  const sortKeyMap: Record<string, keyof CostGapRowPDF> = {
    gap: 'gap', gapPct: 'gapPct', shipments: 'shipments',
    labelCost: 'labelCost', totalCharged: 'totalCharged', name: 'name',
  };
  const sk = sortKeyMap[options.sortBy] ?? 'gap';
  const defaultDir = (options.sortBy === '' || options.sortBy === 'gap' || options.sortBy === 'gapPct') ? 'asc' : options.sortDir;
  const sorted = [...rows].sort(makeSorter(sk, defaultDir));
  const tableData = applyLimit(sorted, options.tableRows);
  const underList = rows.filter(r => r.gap < 0);
  const overList = rows.filter(r => r.gap >= 0);
  const totalExposure = underList.reduce((s, r) => s + Math.abs(r.gap) * r.shipments, 0);
  const chartRows = sorted.slice(0, 8);
  const maxAbsGap = Math.max(...rows.map(r => Math.abs(r.gap)), 0.01);

  return (
    <ContentPage title="Shipping Cost Analysis">
      <Text style={S.sectionTitle}>Label Cost vs Total Charged</Text>
      <Text style={S.sectionSub}>Gap = Total Charged \u2212 Label Cost. Negative = undercharging customers.</Text>
      <AnalystNote text={options.customText} />

      {underList.length > 0 && (
        <Callout icon="!" text={`${underList.length} of ${rows.length} accounts are undercharging. Estimated revenue gap: $${(totalExposure / 1000).toFixed(1)}K across ${fmtN(underList.reduce((s, r) => s + r.shipments, 0))} shipments.`} color={RED} />
      )}
      {overList.length > 0 && (
        <Callout icon="\u2713" text={`${overList.length} account${overList.length > 1 ? 's' : ''} billing above label cost: ${overList.map(r => r.name).slice(0, 3).join(', ')}${overList.length > 3 ? ` +${overList.length - 3} more` : ''}.`} color={GREEN} />
      )}

      <ChartLabel text="Avg Shipping Gap by Account" />
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        <LegendItem color={RED} label="Undercharging (gap < $0)" />
        <LegendItem color={GREEN} label="Overcharging (gap > $0)" />
      </View>
      <View style={{ marginBottom: 14 }}>
        {chartRows.map((r, i) => (
          <BarRow key={i} label={r.name} value={Math.abs(r.gap)} maxValue={maxAbsGap}
            barColor={r.gap < 0 ? RED : GREEN}
            displayValue={(r.gap >= 0 ? '+' : '') + fmt$(r.gap) + ' (' + pct(r.gapPct) + ')'}
            labelWidth={100} valueWidth={80} />
        ))}
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`All Accounts${tableData.length < sorted.length ? ` (showing ${tableData.length} of ${sorted.length})` : ''}`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 3 }]}>Account</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Shipments</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Avg Label $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Avg Billed $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Gap $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Gap %</Text>
            </View>
            {tableData.map((r, i) => (
              <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                <Text style={[S.cellL, { flex: 3 }]}>{truncate(r.name, 28)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{fmtN(r.shipments)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{fmt$(r.labelCost)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{fmt$(r.totalCharged)}</Text>
                <Text style={[S.cellR, { flex: 1, color: r.gap < 0 ? RED : GREEN }]}>{(r.gap >= 0 ? '+' : '') + fmt$(r.gap)}</Text>
                <Text style={[S.cellR, { flex: 1, color: r.gap < 0 ? RED : GREEN }]}>{(r.gapPct >= 0 ? '+' : '') + pct(r.gapPct)}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ContentPage>
  );
}

// ── Section: Carrier Mix ──────────────────────────────────────────────────────
const CARRIER_PALETTE = [BLUE, TEAL, ORANGE, PURPLE, GREEN, RED];

function CarrierMixSection({ rows, options }: { rows: CarrierMixRowPDF[]; options: SectionOptions }) {
  const sortKeyMap: Record<string, keyof CarrierMixRowPDF> = {
    shipments: 'shipments', pctOfTotal: 'pctOfTotal', avgCost: 'avgCost', carrier: 'carrier',
  };
  const sk = sortKeyMap[options.sortBy] ?? 'shipments';
  const sorted = [...rows].sort(makeSorter(sk, options.sortDir));
  const tableData = applyLimit(sorted, options.tableRows);
  const total = rows.reduce((s, r) => s + r.shipments, 0);
  const top1 = sorted[0];

  return (
    <ContentPage title="Carrier & Service Mix">
      <Text style={S.sectionTitle}>Carrier Mix</Text>
      <Text style={S.sectionSub}>Shipment distribution by carrier, ranked by volume</Text>
      <AnalystNote text={options.customText} />

      {top1 && (
        <Callout icon="i" text={`${top1.carrier} is the dominant carrier at ${pct(top1.pctOfTotal)} of volume (${fmtN(top1.shipments)} shipments), avg label cost ${fmt$(top1.avgCost)}.`} color={BLUE} />
      )}

      <ChartLabel text="Volume Distribution" />
      <View style={{ height: 20, flexDirection: 'row', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
        {sorted.map((r, i) => {
          const p = total > 0 ? clamp((r.shipments / total) * 100, 0, 100) : 0;
          return p > 1 ? <View key={i} style={{ width: `${p}%`, backgroundColor: CARRIER_PALETTE[i % CARRIER_PALETTE.length] }} /> : null;
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {sorted.map((r, i) => <LegendItem key={i} color={CARRIER_PALETTE[i % CARRIER_PALETTE.length]} label={`${r.carrier} ${pct(r.pctOfTotal)}`} />)}
      </View>

      <ChartLabel text="Shipments by Carrier" />
      <View style={{ marginBottom: 14 }}>
        {sorted.map((r, i) => (
          <BarRow key={i} label={r.carrier} value={r.shipments} maxValue={sorted[0]?.shipments ?? 1}
            barColor={CARRIER_PALETTE[i % CARRIER_PALETTE.length]}
            displayValue={fmtN(r.shipments) + ' \u00B7 ' + pct(r.pctOfTotal)} labelWidth={90} valueWidth={80} />
        ))}
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`Cost Detail by Carrier${tableData.length < sorted.length ? ` (${tableData.length} of ${sorted.length})` : ''}`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 4 }]}>Carrier / Service</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Shipments</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>% of Total</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Avg Label $</Text>
              <Text style={[S.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Total Label Cost</Text>
            </View>
            {tableData.map((r, i) => (
              <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                <View style={{ flex: 4, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 6, height: 6, backgroundColor: CARRIER_PALETTE[i % CARRIER_PALETTE.length], borderRadius: 1, marginRight: 5 }} />
                  <Text style={S.cellL}>{r.carrier}</Text>
                </View>
                <Text style={[S.cellR, { flex: 1.5 }]}>{fmtN(r.shipments)}</Text>
                <Text style={[S.cellR, { flex: 1.5 }]}>{pct(r.pctOfTotal)}</Text>
                <Text style={[S.cellR, { flex: 1.5 }]}>{fmt$(r.avgCost)}</Text>
                <Text style={[S.cellR, { flex: 2 }]}>{'$' + ((r.avgCost * r.shipments) / 1000).toFixed(1) + 'K'}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ContentPage>
  );
}

// ── Section: Zone Performance ─────────────────────────────────────────────────
function ZonePerformanceSection({ rows, options }: { rows: ZoneComparisonPDF[]; options: SectionOptions }) {
  const sortKeyMap: Record<string, keyof ZoneComparisonPDF> = {
    zone: 'zone', shipmentCount: 'shipmentCount', delta: 'delta', deltaPercent: 'deltaPercent',
  };
  const sk = sortKeyMap[options.sortBy] ?? 'zone';
  const defaultDir = options.sortBy === '' ? 'asc' : options.sortDir;
  const sorted = [...rows].sort(makeSorter(sk, defaultDir));
  const tableData = applyLimit(sorted, options.tableRows);
  const maxRate = Math.max(...rows.map(r => Math.max(r.rateCardAvg, r.actualAvg)), 0.01);
  const avgDeltaPct = rows.length > 0 ? rows.reduce((s, r) => s + r.deltaPercent, 0) / rows.length : 0;
  const underList = rows.filter(r => r.delta < -0.01);

  return (
    <ContentPage title="Rate Card Performance">
      <Text style={S.sectionTitle}>Zone-by-Zone Rate Comparison</Text>
      <Text style={S.sectionSub}>Actual shipping costs vs ShipHero MRC (negotiated rates). Delta = Actual \u2212 MRC.</Text>
      <AnalystNote text={options.customText} />

      {avgDeltaPct < -5 && (
        <Callout icon="i" text={`Actual rates averaging ${pct(Math.abs(avgDeltaPct))} below MRC across all zones \u2014 favorable weight mix or carrier incentives may be driving this.`} color={GREEN} />
      )}
      {underList.length > 0 && (
        <Callout icon="i" text={`${underList.length} zone${underList.length > 1 ? 's' : ''} shipping under MRC (zones ${underList.map(r => r.zone).join(', ')}).`} color={BLUE} />
      )}

      <ChartLabel text="MRC Rate vs Actual Rate by Zone" />
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        <LegendItem color={NAVY} label="MRC Rate (rate card)" />
        <LegendItem color={ORANGE} label="Actual Avg Rate" />
      </View>
      <View style={{ marginBottom: 14 }}>
        {sorted.map((r, i) => (
          <GroupedBarRow key={i} label={`Zone ${r.zone}`} val1={r.rateCardAvg} val2={r.actualAvg} max={maxRate}
            color1={NAVY} color2={ORANGE} disp1={fmt$(r.rateCardAvg)} disp2={fmt$(r.actualAvg)} labelWidth={44} />
        ))}
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`Delta Summary${tableData.length < sorted.length ? ` (${tableData.length} of ${sorted.length})` : ''}`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 1 }]}>Zone</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Shipments</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>MRC Avg $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Actual Avg $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Delta $</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Delta %</Text>
              <Text style={[S.tableHeaderCell, { flex: 1 }]}>Status</Text>
            </View>
            {tableData.map((r, i) => {
              const over = r.delta > 0.01;
              const onRate = Math.abs(r.deltaPercent) <= 5;
              const sc = onRate ? GRAY : over ? RED : GREEN;
              return (
                <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                  <Text style={[S.cellL, { flex: 1 }]}>{`Zone ${r.zone}`}</Text>
                  <Text style={[S.cellR, { flex: 1.5 }]}>{fmtN(r.shipmentCount)}</Text>
                  <Text style={[S.cellR, { flex: 1.5 }]}>{fmt$(r.rateCardAvg)}</Text>
                  <Text style={[S.cellR, { flex: 1.5 }]}>{fmt$(r.actualAvg)}</Text>
                  <Text style={[S.cellR, { flex: 1.5, color: over ? RED : GREEN }]}>{(r.delta >= 0 ? '+' : '') + fmt$(r.delta)}</Text>
                  <Text style={[S.cellR, { flex: 1.5, color: over ? RED : GREEN }]}>{(r.deltaPercent >= 0 ? '+' : '') + pct(r.deltaPercent)}</Text>
                  <Text style={[S.cellL, { flex: 1, color: sc, fontFamily: 'Helvetica-Bold', fontSize: 7 }]}>{onRate ? 'On Rate' : over ? 'Over' : 'Under'}</Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </ContentPage>
  );
}

// ── Section: Expiry Alerts ────────────────────────────────────────────────────
const TIER_ORDER: Record<ExpiryTierPDF, number> = { critical: 0, warning: 1, watch: 2, ok: 3 };
const TIER_COLORS: Record<ExpiryTierPDF, string> = { critical: RED, warning: ORANGE, watch: YELLOW, ok: GREEN };

function ExpiryAlertsSection({ rows, options }: { rows: InventoryPDFData['expiryAlerts']; options: SectionOptions }) {
  type R = (typeof rows)[0];
  type SortK = 'daysToExpire' | 'units' | 'tier' | 'client';
  const sortMap: Record<string, (a: R, b: R) => number> = {
    daysToExpire: (a, b) => {
      const da = a.daysToExpire ?? 9999, db = b.daysToExpire ?? 9999;
      return options.sortDir === 'asc' ? da - db : db - da;
    },
    units: (a, b) => options.sortDir === 'asc' ? a.units - b.units : b.units - a.units,
    tier: (a, b) => {
      const diff = TIER_ORDER[a.tier as ExpiryTierPDF] - TIER_ORDER[b.tier as ExpiryTierPDF];
      return options.sortDir === 'asc' ? diff : -diff;
    },
    client: (a, b) => options.sortDir === 'asc' ? a.client.localeCompare(b.client) : b.client.localeCompare(a.client),
  };
  const sk: SortK = (options.sortBy as SortK) || 'daysToExpire';
  const sortFn = sortMap[sk] ?? sortMap.daysToExpire;
  const sorted = [...rows].sort(sortFn);
  const tableData = applyLimit(sorted, options.tableRows);

  const critical = rows.filter(r => r.tier === 'critical');
  const warning  = rows.filter(r => r.tier === 'warning');
  const watch    = rows.filter(r => r.tier === 'watch');

  return (
    <ContentPage title="Inventory Expiry Alerts">
      <Text style={S.sectionTitle}>Expiry Alerts</Text>
      <Text style={S.sectionSub}>Lot-tracked items expiring within 180 days</Text>
      <AnalystNote text={options.customText} />

      <View style={[S.kpiRow, { marginBottom: 14 }]}>
        <StatusCard label={'Critical\n<30 days'} count={critical.length} color={RED} />
        <StatusCard label={'Warning\n30\u201390 days'} count={warning.length} color={ORANGE} />
        <StatusCard label={'Watch\n90\u2013180 days'} count={watch.length} color={BLUE} />
        <View style={{ flex: 1, alignItems: 'center', backgroundColor: LIGHT, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY }}>{rows.length}</Text>
          <Text style={{ fontSize: 6, color: GRAY, marginTop: 2, textAlign: 'center' }}>Total\nAlerting SKUs</Text>
        </View>
      </View>

      {critical.length > 0 && (
        <Callout icon="!" text={`${critical.length} SKU${critical.length > 1 ? 's' : ''} expiring within 30 days \u2014 immediate action required.`} color={RED} />
      )}
      {warning.length > 0 && (
        <Callout icon="~" text={`${warning.length} SKU${warning.length > 1 ? 's' : ''} in 30\u201390 day window. Plan promotions or transfers to clear before expiry.`} color={ORANGE} />
      )}

      <ChartLabel text="Expiry Urgency Distribution" />
      <View style={{ height: 14, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
        {(['critical', 'warning', 'watch'] as ExpiryTierPDF[]).map(tier => {
          const ct = rows.filter(r => r.tier === tier).length;
          const p = rows.length > 0 ? clamp((ct / rows.length) * 100, 0, 100) : 0;
          return p > 0 ? <View key={tier} style={{ width: `${p}%`, backgroundColor: TIER_COLORS[tier] }} /> : null;
        })}
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <LegendItem color={RED} label="Critical <30d" />
        <LegendItem color={ORANGE} label="Warning 30\u201390d" />
        <LegendItem color={YELLOW} label="Watch 90\u2013180d" />
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`Items by Urgency (${tableData.length} of ${rows.length} shown)`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 2 }]}>Client</Text>
              <Text style={[S.tableHeaderCell, { flex: 2 }]}>SKU</Text>
              <Text style={[S.tableHeaderCell, { flex: 3 }]}>Item</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Units</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5 }]}>Exp Date</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Days</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5 }]}>Status</Text>
            </View>
            {tableData.map((r, i) => {
              const color = TIER_COLORS[r.tier as ExpiryTierPDF] ?? GRAY;
              return (
                <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                  <Text style={[S.cellL, { flex: 2 }]}>{truncate(r.client, 14)}</Text>
                  <Text style={[S.cellL, { flex: 2, fontSize: 6.5 }]}>{truncate(r.sku, 16)}</Text>
                  <Text style={[S.cellL, { flex: 3 }]}>{truncate(r.item, 24)}</Text>
                  <Text style={[S.cellR, { flex: 1 }]}>{fmtN(r.units)}</Text>
                  <Text style={[S.cellL, { flex: 1.5, fontSize: 7 }]}>{r.expDate || '\u2014'}</Text>
                  <Text style={[S.cellR, { flex: 1, color, fontFamily: 'Helvetica-Bold', fontSize: 7 }]}>{r.daysToExpire !== null ? String(r.daysToExpire) : '\u2014'}</Text>
                  <Text style={[S.cellL, { flex: 1.5, color, fontSize: 6.5, fontFamily: 'Helvetica-Bold' }]}>
                    {r.tier === 'critical' ? 'CRITICAL' : r.tier === 'warning' ? 'WARNING' : 'WATCH'}
                  </Text>
                </View>
              );
            })}
          </View>
          {rows.length > tableData.length && (
            <Text style={{ fontSize: 7, color: GRAY, marginTop: 6 }}>
              {`Showing ${tableData.length} of ${rows.length} items. Export full data from the dashboard.`}
            </Text>
          )}
        </>
      )}
    </ContentPage>
  );
}

// ── Section: Days on Hand ─────────────────────────────────────────────────────
const STATUS_ORDER: Record<DOHStatusPDF, number> = { critical: 0, low: 1, ok: 2, overstocked: 3, 'no-movement': 4 };
const STATUS_COLORS: Record<DOHStatusPDF, string> = { critical: RED, low: ORANGE, ok: GREEN, overstocked: BLUE, 'no-movement': GRAY };

function DaysOnHandSection({ rows, options }: { rows: InventoryPDFData['daysOnHand']; options: SectionOptions }) {
  type R = (typeof rows)[0];
  const sortMap: Record<string, (a: R, b: R) => number> = {
    status: (a, b) => {
      const diff = STATUS_ORDER[a.status as DOHStatusPDF] - STATUS_ORDER[b.status as DOHStatusPDF];
      return options.sortDir === 'asc' ? diff : -diff;
    },
    doh: (a, b) => {
      const da = a.doh ?? 99999, db = b.doh ?? 99999;
      return options.sortDir === 'asc' ? da - db : db - da;
    },
    currentUnits: (a, b) => options.sortDir === 'asc' ? a.currentUnits - b.currentUnits : b.currentUnits - a.currentUnits,
    dailyVelocity: (a, b) => options.sortDir === 'asc' ? a.dailyVelocity - b.dailyVelocity : b.dailyVelocity - a.dailyVelocity,
    client: (a, b) => options.sortDir === 'asc' ? a.client.localeCompare(b.client) : b.client.localeCompare(a.client),
  };
  const sk = options.sortBy || 'status';
  const sortFn = sortMap[sk] ?? sortMap.status;
  const sorted = [...rows].sort(sortFn);
  const tableData = applyLimit(sorted, options.tableRows);

  const critical = rows.filter(r => r.status === 'critical');
  const low      = rows.filter(r => r.status === 'low');
  const ok       = rows.filter(r => r.status === 'ok');
  const over     = rows.filter(r => r.status === 'overstocked');
  const noMove   = rows.filter(r => r.status === 'no-movement');

  return (
    <ContentPage title="Inventory Days on Hand">
      <Text style={S.sectionTitle}>Days on Hand by SKU</Text>
      <Text style={S.sectionSub}>Current stock \u00F7 daily shipment velocity. Critical &lt;14d \u00B7 Low 14\u201330d \u00B7 Healthy 30\u2013180d \u00B7 Overstocked &gt;180d.</Text>
      <AnalystNote text={options.customText} />

      <View style={[S.kpiRow, { marginBottom: 12 }]}>
        <StatusCard label={'Critical\n<14 days'} count={critical.length} color={RED} />
        <StatusCard label={'Low\n14\u201330 days'} count={low.length} color={ORANGE} />
        <StatusCard label={'Healthy\n30\u2013180 days'} count={ok.length} color={GREEN} />
        <StatusCard label={'Overstocked\n>180 days'} count={over.length} color={BLUE} />
        <View style={{ flex: 1, alignItems: 'center', backgroundColor: LIGHT, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: GRAY }}>{noMove.length}</Text>
          <Text style={{ fontSize: 6, color: GRAY, marginTop: 2, textAlign: 'center' }}>No\nMovement</Text>
        </View>
      </View>

      {critical.length > 0 && (
        <Callout icon="!" text={`${critical.length} SKU${critical.length > 1 ? 's' : ''} have fewer than 14 days of stock \u2014 reorder immediately to avoid stockout.`} color={RED} />
      )}
      {over.length > 0 && (
        <Callout icon="i" text={`${over.length} SKU${over.length > 1 ? 's' : ''} overstocked (>180 days on hand) \u2014 review for storage cost impact.`} color={BLUE} />
      )}

      <ChartLabel text="Inventory Health Distribution" />
      <View style={{ height: 14, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
        {(['critical', 'low', 'ok', 'overstocked', 'no-movement'] as DOHStatusPDF[]).map(s => {
          const ct = rows.filter(r => r.status === s).length;
          const p = rows.length > 0 ? clamp((ct / rows.length) * 100, 0, 100) : 0;
          return p > 0.5 ? <View key={s} style={{ width: `${p}%`, backgroundColor: STATUS_COLORS[s] }} /> : null;
        })}
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        {(['critical', 'low', 'ok', 'overstocked', 'no-movement'] as DOHStatusPDF[]).map(s => (
          <LegendItem key={s} color={STATUS_COLORS[s]} label={s === 'no-movement' ? 'No Movement' : s.charAt(0).toUpperCase() + s.slice(1)} />
        ))}
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`Inventory Detail${tableData.length < sorted.length ? ` (${tableData.length} of ${sorted.length})` : ''}`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 2 }]}>Client</Text>
              <Text style={[S.tableHeaderCell, { flex: 2 }]}>SKU</Text>
              <Text style={[S.tableHeaderCell, { flex: 3 }]}>Item</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>On Hand</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Vel.</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Days</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5 }]}>Status</Text>
            </View>
            {tableData.map((r, i) => {
              const sc = STATUS_COLORS[r.status as DOHStatusPDF] ?? GRAY;
              return (
                <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                  <Text style={[S.cellL, { flex: 2 }]}>{truncate(r.client, 14)}</Text>
                  <Text style={[S.cellL, { flex: 2, fontSize: 6.5 }]}>{truncate(r.sku, 16)}</Text>
                  <Text style={[S.cellL, { flex: 3 }]}>{truncate(r.item, 24)}</Text>
                  <Text style={[S.cellR, { flex: 1 }]}>{fmtN(r.currentUnits)}</Text>
                  <Text style={[S.cellR, { flex: 1 }]}>{r.dailyVelocity.toFixed(1) + '/d'}</Text>
                  <Text style={[S.cellR, { flex: 1, color: sc, fontFamily: 'Helvetica-Bold', fontSize: 7 }]}>{r.doh !== null ? Math.round(r.doh).toString() : '\u2014'}</Text>
                  <Text style={[S.cellL, { flex: 1.5, color: sc, fontSize: 7, fontFamily: 'Helvetica-Bold' }]}>
                    {{ critical: 'CRITICAL', low: 'LOW', ok: 'HEALTHY', overstocked: 'OVERSTOCK', 'no-movement': 'NO MOVE' }[r.status] ?? r.status}
                  </Text>
                </View>
              );
            })}
          </View>
          {rows.length > tableData.length && (
            <Text style={{ fontSize: 7, color: GRAY, marginTop: 6 }}>
              {`Showing ${tableData.length} of ${rows.length} items. Export full data from the dashboard.`}
            </Text>
          )}
        </>
      )}
    </ContentPage>
  );
}

// ── Section: PO Cadence ───────────────────────────────────────────────────────
function POCadenceSection({ rows, options }: { rows: InventoryPDFData['poCadence']; options: SectionOptions }) {
  const sortKeyMap: Record<string, keyof (typeof rows)[0]> = {
    totalUnitsIn: 'totalUnitsIn', poCount: 'poCount',
    avgUnitsPerPO: 'avgUnitsPerPO', lastReceived: 'lastReceived', client: 'client',
  };
  const sk = sortKeyMap[options.sortBy] ?? 'totalUnitsIn';
  const sorted = [...rows].sort(makeSorter(sk as keyof (typeof rows)[0], options.sortDir));
  const tableData = applyLimit(sorted, options.tableRows);
  const totalPOs = rows.reduce((s, r) => s + r.poCount, 0);
  const totalUnits = rows.reduce((s, r) => s + r.totalUnitsIn, 0);
  const top = sorted[0];

  return (
    <ContentPage title="Inventory Inbound PO Cadence">
      <Text style={S.sectionTitle}>Inbound PO Cadence</Text>
      <Text style={S.sectionSub}>Purchase orders received during the report period, by client</Text>
      <AnalystNote text={options.customText} />

      <View style={[S.kpiRow, { marginBottom: 12 }]}>
        <View style={S.kpiCard}>
          <Text style={S.kpiLabel}>TOTAL POs RECEIVED</Text>
          <Text style={[S.kpiValue, { color: BLUE }]}>{totalPOs}</Text>
        </View>
        <View style={S.kpiCard}>
          <Text style={S.kpiLabel}>TOTAL UNITS INBOUND</Text>
          <Text style={S.kpiValue}>{(totalUnits / 1000).toFixed(0) + 'K'}</Text>
        </View>
        <View style={S.kpiCardLast}>
          <Text style={S.kpiLabel}>ACTIVE CLIENTS</Text>
          <Text style={S.kpiValue}>{rows.length}</Text>
        </View>
      </View>

      {top && (
        <Callout icon="i" text={`${top.client} received the most units (${fmtN(top.totalUnitsIn)}) across ${top.poCount} POs \u2014 avg ${fmtN(top.avgUnitsPerPO)} units/PO. Last received: ${top.lastReceived}.`} color={BLUE} />
      )}

      <ChartLabel text="Total Units Received by Client (top 12)" />
      <View style={{ marginBottom: 14 }}>
        {sorted.slice(0, 12).map((r, i) => (
          <BarRow key={i} label={r.client} value={r.totalUnitsIn} maxValue={sorted[0]?.totalUnitsIn ?? 1}
            barColor={TEAL} displayValue={fmtN(r.totalUnitsIn) + ' \u00B7 ' + r.poCount + ' POs'} labelWidth={105} valueWidth={80} />
        ))}
      </View>

      {options.showTable && (
        <>
          <ChartLabel text={`PO Detail${tableData.length < sorted.length ? ` (${tableData.length} of ${sorted.length})` : ''}`} />
          <View>
            <View style={S.tableHeaderRow}>
              <Text style={[S.tableHeaderCell, { flex: 3 }]}>Client</Text>
              <Text style={[S.tableHeaderCell, { flex: 1, textAlign: 'right' }]}># POs</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Total Units</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Avg Units/PO</Text>
              <Text style={[S.tableHeaderCell, { flex: 1.5 }]}>Last Received</Text>
            </View>
            {tableData.map((r, i) => (
              <View key={i} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt} wrap={false}>
                <Text style={[S.cellL, { flex: 3 }]}>{truncate(r.client, 28)}</Text>
                <Text style={[S.cellR, { flex: 1 }]}>{String(r.poCount)}</Text>
                <Text style={[S.cellR, { flex: 1.5 }]}>{fmtN(r.totalUnitsIn)}</Text>
                <Text style={[S.cellR, { flex: 1.5 }]}>{fmtN(r.avgUnitsPerPO)}</Text>
                <Text style={[S.cellL, { flex: 1.5, fontSize: 7 }]}>{r.lastReceived}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ContentPage>
  );
}

// ── Recommended Actions page ──────────────────────────────────────────────────
function RecommendedActionsPage({ actions }: { actions: RecommendedAction[] }) {
  const priorityColor = (p: RecommendedAction['priority']) =>
    p === 'high' ? RED : p === 'medium' ? ORANGE : GREEN;
  const categoryLabel = (c: RecommendedAction['category']) => {
    const labels: Record<RecommendedAction['category'], string> = {
      cost: 'Cost', carrier: 'Carrier', network: 'Network',
      inventory: 'Inventory', growth: 'Growth', general: 'General',
    };
    return labels[c] ?? c;
  };

  return (
    <ContentPage title="Recommended Actions">
      <Text style={S.sectionTitle}>Recommended Actions</Text>
      <Text style={S.sectionSub}>Strategic recommendations for the upcoming quarter</Text>

      {actions.map((action, i) => (
        <View key={action.id} wrap={false} style={{ marginBottom: 10, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: NAVY, paddingVertical: 5, paddingHorizontal: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: priorityColor(action.priority), marginRight: 6 }} />
            <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: WHITE, flex: 1 }}>{i + 1}. {action.title}</Text>
            <Text style={{ fontSize: 6.5, color: '#94A3B8', backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 1, paddingHorizontal: 5, borderRadius: 2 }}>
              {categoryLabel(action.category).toUpperCase()}
            </Text>
          </View>
          <View style={{ backgroundColor: LIGHT, paddingVertical: 7, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 8, color: NAVY, lineHeight: 1.5 }}>{action.body}</Text>
          </View>
        </View>
      ))}
    </ContentPage>
  );
}

// ── QoQ delta badge ───────────────────────────────────────────────────────────
function DeltaBadge({ value, label, suffix = '' }: { value: number; label: string; suffix?: string }) {
  const isUp = value > 0;
  const color = isUp ? GREEN : RED;
  const arrow = isUp ? '\u25B2' : '\u25BC';
  const sign = isUp ? '+' : '';
  return (
    <View style={{ marginLeft: 6, alignItems: 'flex-start' }}>
      <Text style={{ fontSize: 5.5, color: GRAY, marginBottom: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color + '20', borderRadius: 3, paddingVertical: 2, paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 7, color, fontFamily: 'Helvetica-Bold' }}>{arrow} {sign}{value.toFixed(1)}{suffix}</Text>
      </View>
    </View>
  );
}

// ── Main Document ─────────────────────────────────────────────────────────────
export default function QBRDocument(props: QBRDocumentProps) {
  const { clientName, reportDate, reportingPeriod, clientLogo, enabledSections, kpis, customerStats, costGapRows, carrierMix, zoneComparisons, inventoryData, recommendedActions, priorPeriod, delta } = props;
  const active = enabledSections.filter(s => s.enabled);

  return (
    <Document title={`ShipHero QBR \u2014 ${clientName}`} author="ShipHero" subject="Quarterly Business Review">
      {/* Cover */}
      <Page size="LETTER" style={{ backgroundColor: NAVY, padding: 0 }}>
        <View style={S.coverBg}>
          <View style={S.coverLogoRow}>
            <View style={S.coverLogoBar} />
            <Text style={S.coverLogoText}>SHIPHERO</Text>
            <View style={S.coverLogoBar} />
          </View>
          {clientLogo && (
            <View style={{ marginBottom: 20, alignItems: 'center' }}>
              <Image src={clientLogo} style={{ maxWidth: 120, maxHeight: 60, objectFit: 'contain' }} />
            </View>
          )}
          <Text style={S.coverEyebrow}>PREPARED BY SHIPHERO</Text>
          <Text style={S.coverTitle}>Quarterly Business Review</Text>
          <View style={S.coverAccent} />
          <Text style={S.coverClient}>{clientName || 'Client'}</Text>
          {reportingPeriod ? (
            <Text style={[S.coverDate, { color: ORANGE }]}>{reportingPeriod}</Text>
          ) : null}
          <Text style={[S.coverDate, { fontSize: 10, color: '#94A3B8' }]}>{reportDate}</Text>

          {/* QoQ delta strip on cover */}
          {delta && priorPeriod && (
            <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 16 }}>
              <DeltaBadge value={delta.totalShipmentsPct} label="Shipments" suffix="%" />
              <DeltaBadge value={delta.avgLabelCostPct} label="Avg Cost" suffix="%" />
              <DeltaBadge value={delta.totalSpendPct} label="Total Spend" suffix="%" />
            </View>
          )}

          <Text style={S.coverTagline}>Confidential \u2014 For internal use only</Text>
        </View>
      </Page>

      {active.map(({ key, options }) => {
        switch (key) {
          case 'accountOverview':
            return kpis ? <AccountOverviewSection key={key} kpis={kpis} customerStats={customerStats} options={options} /> : null;
          case 'topAccounts':
            return customerStats.length > 0 ? <TopAccountsSection key={key} rows={customerStats} options={options} /> : null;
          case 'labelVsCharged':
            return costGapRows.length > 0 ? <LabelVsChargedSection key={key} rows={costGapRows} options={options} /> : null;
          case 'carrierMix':
            return carrierMix.length > 0 ? <CarrierMixSection key={key} rows={carrierMix} options={options} /> : null;
          case 'zonePerformance':
            return zoneComparisons.length > 0 ? <ZonePerformanceSection key={key} rows={zoneComparisons} options={options} /> : null;
          case 'expiryAlerts':
            return inventoryData?.expiryAlerts?.length ? <ExpiryAlertsSection key={key} rows={inventoryData.expiryAlerts} options={options} /> : null;
          case 'daysOnHand':
            return inventoryData?.daysOnHand?.length ? <DaysOnHandSection key={key} rows={inventoryData.daysOnHand} options={options} /> : null;
          case 'poCadence':
            return inventoryData?.poCadence?.length ? <POCadenceSection key={key} rows={inventoryData.poCadence} options={options} /> : null;
          default:
            return null;
        }
      })}

      {recommendedActions && recommendedActions.length > 0 && (
        <RecommendedActionsPage actions={recommendedActions} />
      )}
    </Document>
  );
}
