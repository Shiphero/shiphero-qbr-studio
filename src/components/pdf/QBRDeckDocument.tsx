import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet, Svg, Path } from '@react-pdf/renderer';
import shipheroWhiteUrl from '../../assets/logos/shiphero-white.png';
import type { InventoryPDFData } from '../../context/PDFContext';
import type { RecommendedAction } from '../../utils/recommendedActions';
import type {
  KPISummaryPDF, CustomerStatPDF, CostGapRowPDF,
  CarrierMixRowPDF, ZoneComparisonPDF,
} from './QBRDocument';

// ── Brand ─────────────────────────────────────────────────────────────────────
const LIGHT_BG = '#EDEEF2';  // all content slide backgrounds
const NAVY     = '#252F3E';  // dark slides, sidebar marks
const ORANGE   = '#EF5252';  // accent, underlines, highlights
const BLUE     = '#4472E8';  // section labels, numbers
const DARK     = '#1C1C2E';  // titles on light slides
const GRAY     = '#6B7280';  // body text
const WHITE    = '#FFFFFF';
const GREEN    = '#22C55E';
const RED      = '#EF4444';
const LIGHT    = '#F0F1F3';  // KPI tile backgrounds

// ── Slide dimensions (16:9 landscape) ────────────────────────────────────────
const W = 720;
const H = 405;
const CONTENT_PAD_LEFT = 34;
const CONTENT_PAD_H    = 16;

export type DeckSectionKey =
  | 'agenda' | 'introductions'
  | 'accountOverview' | 'carrierMix' | 'costGap'
  | 'serviceLevelMix' | 'labelCostByCarrier'
  | 'zonePerformance' | 'expiryAlerts' | 'daysOnHand' | 'recommendedActions'
  // Account Health tab sections (require Monthly Stats CSV)
  | 'volumeTrend' | 'childAccountTrends' | 'carrierSpendGMV' | 'fulfillmentMix'
  | 'childAccountScorecard'
  // Inventory Health tab (require Inventory Change Report CSV)
  | 'manualAdjustments'
  // Network / Shipping tab
  | 'shippingKPIs' | 'zoneMap' | 'warehouseInsights' | 'shipmentsByState'
  // Rate Card tab UPS comparison (require Shipments CSV + warehouse ZIP)
  | 'upsAvgCost' | 'upsZoneBreakdown'
  // Tab KPI summaries
  | 'inventoryKPIs' | 'rateCardKPIs' | 'threePlKPIs' | 'accountHealthKPIs'
  // 3PL table
  | 'accountDetailTable'
  // Prior quarter comparison
  | 'priorQuarterKPIs' | 'priorQuarterCarrierMix';

export interface SectionInsight {
  whatHappening: string;
  whyMatters: string;
  action: string;
  actionNote: string;
}

export interface DeckSectionToggle {
  key: DeckSectionKey;
  enabled: boolean;
  insight?: SectionInsight;
  customLabel?: string;
  /** Overrides the uppercase category label above the slide title (e.g. "SHIPPING OVERVIEW") */
  sectionLabel?: string;
  /** Speaker notes added to the slide in the PPTX file */
  notes?: string;
  /** If true, slide stays in the strip but is skipped during PPTX export */
  hidden?: boolean;
  /** Number of extra copies to include in the PPTX (0 or undefined = one slide, 1 = two slides, etc.) */
  duplicates?: number;
  /** Layout variant: 'wide' skips sidebar mark and widens content area */
  layout?: 'standard' | 'wide';
  /** Row names to include (empty/null = show all) */
  rowFilter?: string[];
  /** Stat tile IDs to show on KPI summary slides (empty/null = show all) */
  kpiFilter?: string[];
  /** Inch offset from the default content position, applied in the slide preview and PPTX export */
  contentOffset?: { dx: number; dy: number };
  /** Freeform narrative text shown as bullet points on the slide and exported to PPTX/PDF */
  narrative?: string;
  /** Base64 PNG snapshot captured via html2canvas at export time — used instead of chart builders */
  snapshot?: string;
  /** Right-side navy callout panel: large stat + headline + optional supporting line */
  callout?: { stat: string; headline: string; body?: string; icon?: string };
}

/** An extra copy of a data section with independent config (different row filter, narrative, etc.) */
export interface DataInstanceSlide {
  id: string;
  parentKey: DeckSectionKey;
  /** Positioning anchor — same format as CustomDeckSlide.orderKey */
  orderKey: string;
  customLabel?: string;
  rowFilter?: string[];
  narrative?: string;
  insight?: SectionInsight;
  notes?: string;
  snapshot?: string;
}

export interface CustomDeckSlide {
  id: string;
  variant:
    | 'divider'   // Navy slide — centered section title
    | 'text'      // Light bg — title + free-form body
    | 'qa'        // Navy slide — "Q&A" / closer
    | 'thankyou'  // Navy slide — "Thank You" + next steps
    | 'quote'     // Light bg — large pull quote + attribution
    | 'twocol'    // Light bg — title + two text columns
    | 'image'     // Light bg — uploaded image + optional caption
    | 'blank';    // Light bg — empty or single heading
  enabled: boolean;
  hidden?: boolean;
  duplicates?: number;
  title: string;
  /** Body / left-column text (used by: text, thankyou, twocol) */
  body?: string;
  /** Subtitle / attribution (used by: divider, qa, quote, twocol right-col label) */
  subtitle?: string;
  /** Right column text (used by: twocol) */
  rightCol?: string;
  /** Base64 image data URL (used by: image) */
  imageData?: string;
  notes?: string;
  /** Ordering anchor: 'after:cover' | 'after:<DeckSectionKey>' | 'end' */
  orderKey: string;
}

export interface TeamMember {
  id: string;
  name: string;
  title: string;
  photo?: string;    // base64 data URL
  showPhoto?: boolean; // default true; false = hide avatar on slide
}

export interface QBRDeckDocumentProps {
  clientName: string;
  reportDate: string;
  reportingPeriod?: string;
  clientLogo?: string;
  enabledSections: DeckSectionToggle[];
  teamMembers?: TeamMember[];
  kpis: KPISummaryPDF | null;
  customerStats: CustomerStatPDF[];
  costGapRows: CostGapRowPDF[];
  carrierMix: CarrierMixRowPDF[];
  zoneComparisons: ZoneComparisonPDF[];
  inventoryData: InventoryPDFData | null;
  recommendedActions?: RecommendedAction[];
  fontOption?: 'A' | 'B' | 'C';
  coverPhoto?: string;  // base64 background image for cover slide
  coverColorScheme?: string;  // e.g. 'midnight', 'forest' — mapped to hex in generator
  statsRows?: import('../../utils/statsParser').MonthlyStatRow[];
  customSlides?: CustomDeckSlide[];
  dataInstances?: DataInstanceSlide[];
  /** Prior-period comparison data for the Prior Quarter KPIs slide */
  priorPeriod?: import('../../utils/periodComparison').PriorPeriodSummary | null;
}

// ── Agenda label map (for human-readable slide titles) ────────────────────────
const SECTION_LABELS: Record<DeckSectionKey, string> = {
  agenda:                'Agenda',
  introductions:         'Introductions',
  accountOverview:       'Account Overview',
  costGap:               'Shipping Cost Analysis',
  carrierMix:            'Carrier Mix',
  serviceLevelMix:       'Service Level Mix',
  labelCostByCarrier:    'Label Cost by Carrier',
  zonePerformance:       'Rate Card Performance',
  expiryAlerts:          'Inventory Expiry Alerts',
  daysOnHand:            'Inventory Days on Hand',
  recommendedActions:    'Recommended Actions',
  volumeTrend:           'Total Volume Trend',
  childAccountTrends:    'Child Account Trends',
  carrierSpendGMV:       'Carrier Spend vs GMV',
  fulfillmentMix:        'Fulfillment Mix',
  childAccountScorecard: 'Child Account Scorecard',
  manualAdjustments:     'Manual Adjustments',
  shippingKPIs:          'Shipping Overview',
  upsAvgCost:            'UPS Avg Cost by Zone',
  upsZoneBreakdown:      'UPS Zone-by-Zone Breakdown',
  zoneMap:               'Zone Distribution Map',
  warehouseInsights:     'Warehouse Insights',
  shipmentsByState:      'Shipments by State',
  inventoryKPIs:         'Inventory Summary',
  rateCardKPIs:          'Rate Card Summary',
  threePlKPIs:           '3PL Account Summary',
  accountDetailTable:    'Account Detail Table',
  accountHealthKPIs:     'Account Health Summary',
  priorQuarterKPIs:      'Prior Quarter KPIs',
  priorQuarterCarrierMix:'Prior Quarter Carrier Mix',
};

// ── Stylesheet ────────────────────────────────────────────────────────────────
const D = StyleSheet.create({
  page: { width: W, height: H, fontFamily: 'Helvetica', backgroundColor: LIGHT_BG },
  darkPage: { width: W, height: H, fontFamily: 'Helvetica', backgroundColor: NAVY },
  content: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: CONTENT_PAD_LEFT,
    paddingTop: CONTENT_PAD_H,
  },
  contentFull: {
    flex: 1,
    paddingHorizontal: CONTENT_PAD_LEFT,
    paddingTop: CONTENT_PAD_H,
  },
  // KPI tiles
  kpiTile: {
    flex: 1, backgroundColor: LIGHT, borderRadius: 4,
    padding: 10, marginRight: 8, alignItems: 'flex-start',
  },
  kpiTileLast: {
    flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: 10, alignItems: 'flex-start',
  },
  kpiLabel: { fontSize: 7, color: GRAY, marginBottom: 4 },
  kpiValue: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: NAVY },
  kpiSub: { fontSize: 7, color: GRAY, marginTop: 2 },
  // Slide title (inside content area)
  slideTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 3 },
  slideSub: { fontSize: 8, color: GRAY, marginBottom: 10 },
  // Callout
  calloutRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6, borderRadius: 3 },
  calloutBar: { width: 3, borderRadius: 2 },
  calloutBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, paddingHorizontal: 8 },
  calloutIcon: { fontSize: 9, marginRight: 5, fontFamily: 'Helvetica-Bold' },
  calloutText: { fontSize: 8, color: NAVY, flex: 1 },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number) { return '$' + n.toFixed(2); }
function fmtK(n: number) { return '$' + (n / 1000).toFixed(1) + 'K'; }
function fmtN(n: number) { return n.toLocaleString(); }
function pct(n: number) { return n.toFixed(1) + '%'; }
function clamp(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }
function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }

// ── Shared primitives ─────────────────────────────────────────────────────────

function ShipHeroMark({ dark = false }: { dark?: boolean }) {
  const fill = dark ? WHITE : NAVY;
  const s = dark ? NAVY : WHITE;
  return (
    <View style={{ width: 16, height: 16 }}>
      <Svg width="16" height="16" viewBox="0 0 16 16">
        <Path d="M 8,1 L 14.1,4.5 L 14.1,11.5 L 8,15 L 1.9,11.5 L 1.9,4.5 Z" fill={fill} />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: s }}>S</Text>
      </View>
    </View>
  );
}

function SlideMark({ num, dark = false }: { num: number; dark?: boolean }) {
  const line = dark ? 'rgba(255,255,255,0.12)' : '#CBD5E1';
  const sub  = dark ? 'rgba(255,255,255,0.3)' : '#94A3B8';
  return (
    <>
      {/* Thin vertical left border */}
      <View style={{ position: 'absolute', left: 22, top: 0, bottom: 0, width: 1, backgroundColor: line }} />
      {/* S mark */}
      <View style={{ position: 'absolute', left: 4, top: 8 }}>
        <ShipHeroMark dark={dark} />
      </View>
      {/* Slide number bottom left */}
      <Text style={{ position: 'absolute', bottom: 8, left: 6, fontSize: 7, color: sub }}>{num}</Text>
    </>
  );
}

function SlideTitle({ label, title, dark = false, center = false }: { label: string; title: string; dark?: boolean; center?: boolean }) {
  const titleColor = dark ? WHITE : DARK;
  const labelColor = dark ? '#7DB3FF' : BLUE;
  const align = center ? 'center' : 'left';
  return (
    <View style={{ marginBottom: 12, alignItems: center ? 'center' : 'flex-start' }}>
      <Text style={{ fontSize: 7.5, color: labelColor, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold', marginBottom: 4, textAlign: align }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: titleColor, textAlign: align, marginBottom: 3 }}>
        {title}
      </Text>
      <View style={{ width: 52, height: 2.5, backgroundColor: ORANGE }} />
    </View>
  );
}

function Callout({ icon, text, color = BLUE }: { icon: string; text: string; color?: string }) {
  return (
    <View style={D.calloutRow}>
      <View style={[D.calloutBar, { backgroundColor: color }]} />
      <View style={[D.calloutBody, { backgroundColor: color + '18' }]}>
        <Text style={[D.calloutIcon, { color }]}>{icon}</Text>
        <Text style={D.calloutText}>{text}</Text>
      </View>
    </View>
  );
}

function HBar({
  label, value, maxValue, color, display, labelW = 110,
}: { label: string; value: number; maxValue: number; color: string; display: string; labelW?: number }) {
  const fill = maxValue > 0 ? clamp((value / maxValue) * 100, 2, 100) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ fontSize: 8, color: NAVY, width: labelW }}>{trunc(label, 18)}</Text>
      <View style={{ flex: 1, height: 11, backgroundColor: '#E5E7EB', borderRadius: 2, marginHorizontal: 8 }}>
        <View style={{ width: `${fill}%`, height: 11, backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={{ fontSize: 8, color: GRAY, width: 52, textAlign: 'right' }}>{display}</Text>
    </View>
  );
}

// ── Cover Slide ───────────────────────────────────────────────────────────────
function CoverSlide({ clientName, reportDate, reportingPeriod, clientLogo }: {
  clientName: string; reportDate: string; reportingPeriod?: string; clientLogo?: string;
}) {
  // ShipHero logo: 320×84 px → at render height 28 the width is ≈107
  const SH_LOGO_H = 28;
  const SH_LOGO_W = Math.round((320 / 84) * SH_LOGO_H); // ≈ 107

  return (
    <Page size={[W, H]} style={D.darkPage}>
      {/* Top orange accent bar */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: ORANGE }} />

      {/* Bottom orange accent bar */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: ORANGE, opacity: 0.4 }} />

      {/* Main centered content */}
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center', alignItems: 'center',
      }}>

        {/* ── Logo row ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          marginBottom: 32,
          paddingHorizontal: 24,
          paddingVertical: 16,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.08)',
        }}>
          {/* ShipHero white logo */}
          <Image
            src={shipheroWhiteUrl}
            style={{ width: SH_LOGO_W, height: SH_LOGO_H }}
          />

          {/* Divider */}
          <View style={{
            width: 1, height: 40,
            backgroundColor: 'rgba(255,255,255,0.18)',
            marginHorizontal: 24,
          }} />

          {/* Client / brand logo */}
          {clientLogo ? (
            <View style={{ width: 140, height: 44, justifyContent: 'center', alignItems: 'center' }}>
              <Image src={clientLogo} style={{ width: 140, height: 44, objectFit: 'contain' }} />
            </View>
          ) : (
            <View style={{
              paddingHorizontal: 16, paddingVertical: 10,
              borderRadius: 6,
              backgroundColor: 'rgba(255,255,255,0.06)',
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: WHITE, letterSpacing: 1 }}>
                {(clientName || 'CLIENT').toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {/* ── Client name ── */}
        <Text style={{
          fontSize: 38, fontFamily: 'Helvetica-Bold', color: WHITE,
          textAlign: 'center', marginBottom: 6, letterSpacing: -0.5,
        }}>
          {clientName || 'Client'}
        </Text>

        {/* Orange underline */}
        <View style={{ width: 60, height: 3, backgroundColor: ORANGE, borderRadius: 2, marginBottom: 14 }} />

        {/* QBR label */}
        <Text style={{
          fontSize: 9, color: 'rgba(255,255,255,0.45)',
          letterSpacing: 2.5, fontFamily: 'Helvetica-Bold',
          marginBottom: reportingPeriod ? 8 : 0,
        }}>
          QUARTERLY BUSINESS REVIEW
        </Text>

        {/* Period */}
        {reportingPeriod && (
          <Text style={{ fontSize: 13, color: ORANGE, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 }}>
            {reportingPeriod}
          </Text>
        )}
      </View>

      {/* Bottom bar: date left · confidential right */}
      <View style={{
        position: 'absolute', bottom: 14, left: 32, right: 32,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Text style={{ fontSize: 7.5, color: BLUE, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold' }}>
          {reportDate.toUpperCase()}
        </Text>
        <Text style={{ fontSize: 7, color: 'rgba(255,255,255,0.25)', letterSpacing: 0.5 }}>
          Confidential — ShipHero
        </Text>
      </View>
    </Page>
  );
}

// ── Agenda Slide ─────────────────────────────────────────────────────────────
function AgendaSlide({ items }: { items: { num: number; label: string }[] }) {
  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={2} />
      <View style={{ flex: 1, flexDirection: 'row', paddingLeft: 34 }}>
        {/* Left: "Agenda" word mark */}
        <View style={{ width: 280, justifyContent: 'center', paddingLeft: 12 }}>
          <Text style={{ fontSize: 7.5, color: BLUE, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>QUARTERLY BUSINESS REVIEW</Text>
          <Text style={{ fontSize: 42, fontFamily: 'Helvetica-Bold', color: DARK, lineHeight: 1.1 }}>Agenda</Text>
          <View style={{ width: 80, height: 3, backgroundColor: ORANGE, marginTop: 6 }} />
        </View>

        {/* Center vertical separator */}
        <View style={{ width: 1, backgroundColor: '#D1D5DB', marginVertical: 30 }} />

        {/* Right: numbered list */}
        <View style={{ flex: 1, justifyContent: 'center', paddingLeft: 32, paddingRight: 20, gap: 0 }}>
          {items.map(({ num, label }) => (
            <View key={num} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: num < items.length ? 1 : 0, borderBottomColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BLUE, width: 28, flexShrink: 0 }}>{num}.</Text>
              <Text style={{ fontSize: 12, color: DARK, flex: 1 }}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </Page>
  );
}

// ── Introductions Slide ───────────────────────────────────────────────────────
function IntroductionsSlide({ members }: { members: TeamMember[] }) {
  const shown = members.slice(0, 5); // up to 5 like the template
  const cardW = shown.length <= 3 ? 150 : shown.length === 4 ? 130 : 110;
  const photoSize = shown.length <= 3 ? 90 : shown.length <= 4 ? 80 : 72;

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={3} />
      <View style={{ flex: 1, paddingLeft: 34, paddingTop: 18, paddingRight: 20, paddingBottom: 16, justifyContent: 'center' }}>
        {/* Centered title */}
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: DARK, textAlign: 'center' }}>
            The ShipHero Team
          </Text>
          <View style={{ width: 80, height: 2.5, backgroundColor: ORANGE, marginTop: 5 }} />
        </View>

        {shown.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: GRAY }}>Add team members in the Deck Builder to populate this slide.</Text>
          </View>
        ) : (
          <>
            {/* Photo row */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 0 }}>
              {shown.map((m, i) => {
                const withPhoto = m.showPhoto !== false;
                return (
                  <View key={m.id ?? i} style={{ alignItems: 'center', width: cardW }}>
                    {withPhoto ? (
                      <View style={{ width: photoSize, height: photoSize, borderRadius: photoSize / 2, overflow: 'hidden', backgroundColor: NAVY, justifyContent: 'center', alignItems: 'center' }}>
                        {m.photo ? (
                          <Image src={m.photo} style={{ width: photoSize, height: photoSize, objectFit: 'cover' }} />
                        ) : (
                          <Text style={{ fontSize: photoSize * 0.35, fontFamily: 'Helvetica-Bold', color: WHITE }}>
                            {m.name ? m.name.charAt(0).toUpperCase() : '?'}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <View style={{ width: photoSize * 0.6, height: photoSize * 0.6 }} />
                    )}
                  </View>
                );
              })}
            </View>

            {/* Horizontal separator */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginVertical: 10 }}>
              {shown.map((_, i) => (
                <View key={i} style={{ width: cardW, height: 1, backgroundColor: '#D1D5DB', marginHorizontal: 8 }} />
              ))}
            </View>

            {/* Name + Title row */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
              {shown.map((m, i) => (
                <View key={m.id ?? i} style={{ alignItems: 'center', width: cardW }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: DARK, textAlign: 'center', marginBottom: 2 }}>{m.name}</Text>
                  <Text style={{ fontSize: 9, color: BLUE, textAlign: 'center' }}>{m.title}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </Page>
  );
}

// ── Account Overview Slide ────────────────────────────────────────────────────
function AccountOverviewSlide({ kpis, customerStats }: {
  kpis: KPISummaryPDF; customerStats: CustomerStatPDF[];
}) {
  const top6 = customerStats.slice(0, 6);
  const maxOrders = top6[0]?.orderCount ?? 1;
  const margin = kpis.totalCharged > 0 ? kpis.totalCharged - kpis.totalLabelCost : null;

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={4} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="SHIPPING OVERVIEW" title="Account Overview" />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: KPI tiles */}
          <View style={{ width: 260, marginRight: 18 }}>
            <Text style={D.slideSub}>Key metrics for the reporting period</Text>

            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              <View style={D.kpiTile}>
                <Text style={D.kpiLabel}>SHIPMENTS</Text>
                <Text style={[D.kpiValue, { color: BLUE, fontSize: 20 }]}>{fmtN(kpis.totalShipments)}</Text>
              </View>
              <View style={D.kpiTileLast}>
                <Text style={D.kpiLabel}>LABEL COST</Text>
                <Text style={[D.kpiValue, { fontSize: 20 }]}>{fmtK(kpis.totalLabelCost)}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              <View style={D.kpiTile}>
                <Text style={D.kpiLabel}>AVG COST/SHIP</Text>
                <Text style={[D.kpiValue, { fontSize: 20 }]}>{fmt$(kpis.avgLabelCost)}</Text>
              </View>
              <View style={D.kpiTileLast}>
                <Text style={D.kpiLabel}>AVG ZONE</Text>
                <Text style={[D.kpiValue, { fontSize: 20 }]}>{kpis.avgZone !== null ? kpis.avgZone.toFixed(1) : '--'}</Text>
              </View>
            </View>

            {margin !== null && (
              <View style={{ flexDirection: 'row' }}>
                <View style={D.kpiTile}>
                  <Text style={D.kpiLabel}>BILLED TO CLIENTS</Text>
                  <Text style={[D.kpiValue, { color: ORANGE, fontSize: 20 }]}>{fmtK(kpis.totalCharged)}</Text>
                </View>
                <View style={D.kpiTileLast}>
                  <Text style={D.kpiLabel}>MARGIN</Text>
                  <Text style={[D.kpiValue, { color: margin >= 0 ? GREEN : RED, fontSize: 20 }]}>
                    {margin >= 0 ? '+' : ''}{fmtK(margin)}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Right: top accounts bar chart */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 8, letterSpacing: 0.5 }}>
              TOP ACCOUNTS BY VOLUME
            </Text>
            {top6.map((a, i) => (
              <HBar
                key={i}
                label={a.customer}
                value={a.orderCount}
                maxValue={maxOrders}
                color={BLUE}
                display={`${fmtN(a.orderCount)} · ${pct(a.volumePercent)}`}
                labelW={100}
              />
            ))}
          </View>
        </View>
      </View>
    </Page>
  );
}

// ── Carrier Mix Slide ─────────────────────────────────────────────────────────
const CARRIER_COLORS = [BLUE, ORANGE, '#22C55E', '#8B5CF6', '#0891B2', '#EF4444', '#F97316'];

function CarrierMixSlide({ rows }: { rows: CarrierMixRowPDF[] }) {
  const top8 = rows.slice(0, 8);
  const maxShip = top8[0]?.shipments ?? 1;
  const total = rows.reduce((s, r) => s + r.shipments, 0);

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={5} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="SHIPPING BREAKDOWN" title="Carrier Mix" />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: bar chart */}
          <View style={{ flex: 1, marginRight: 20 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              VOLUME BY CARRIER / SERVICE
            </Text>
            {top8.map((r, i) => (
              <HBar
                key={i}
                label={r.carrier}
                value={r.shipments}
                maxValue={maxShip}
                color={CARRIER_COLORS[i % CARRIER_COLORS.length]}
                display={`${pct(r.pctOfTotal)}`}
                labelW={130}
              />
            ))}
          </View>

          {/* Right: summary stats */}
          <View style={{ width: 190 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              HIGHLIGHTS
            </Text>
            <View style={{ backgroundColor: LIGHT, borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <Text style={{ fontSize: 8, color: GRAY, marginBottom: 3 }}>TOTAL SHIPMENTS</Text>
              <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: NAVY }}>{fmtN(total)}</Text>
            </View>
            {top8.slice(0, 3).map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: CARRIER_COLORS[i], marginRight: 6 }} />
                  <Text style={{ fontSize: 8, color: NAVY }}>{trunc(r.carrier, 14)}</Text>
                </View>
                <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: NAVY }}>{pct(r.pctOfTotal)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </Page>
  );
}

// ── Cost Gap Slide ────────────────────────────────────────────────────────────
function CostGapSlide({ rows }: { rows: CostGapRowPDF[] }) {
  const top8 = [...rows].sort((a, b) => a.gap - b.gap).slice(0, 8);
  const maxGap = Math.max(...top8.map(r => Math.abs(r.gap)), 1);
  const totalGap = rows.reduce((s, r) => s + r.gap, 0);

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={6} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="BILLING ANALYSIS" title="Shipping Cost Analysis" />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: gap bar chart */}
          <View style={{ flex: 1, marginRight: 20 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              LABEL COST vs. BILLED — GAP BY ACCOUNT
            </Text>
            {top8.map((r, i) => (
              <HBar
                key={i}
                label={r.name}
                value={Math.abs(r.gap)}
                maxValue={maxGap}
                color={r.gap < 0 ? RED : GREEN}
                display={`${r.gap >= 0 ? '+' : ''}${fmt$(r.gap)} (${pct(r.gapPct)})`}
                labelW={110}
              />
            ))}
          </View>

          {/* Right */}
          <View style={{ width: 190 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              SUMMARY
            </Text>
            <View style={{ backgroundColor: LIGHT, borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <Text style={{ fontSize: 8, color: GRAY, marginBottom: 3 }}>TOTAL MARGIN GAP</Text>
              <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: totalGap >= 0 ? GREEN : RED }}>
                {totalGap >= 0 ? '+' : ''}{fmtK(totalGap)}
              </Text>
            </View>
            <Callout
              icon={totalGap < 0 ? '!' : 'i'}
              text={totalGap < 0
                ? 'Label costs exceed billed revenue — review billing rates.'
                : 'Positive margin overall. Monitor under-charged accounts.'}
              color={totalGap < 0 ? RED : GREEN}
            />
          </View>
        </View>
      </View>
    </Page>
  );
}

// ── Rate Card Performance Slide ───────────────────────────────────────────────
function ZonePerformanceSlide({ rows }: { rows: ZoneComparisonPDF[] }) {
  const maxVal = Math.max(...rows.map(r => Math.max(r.rateCardAvg, r.actualAvg)), 1);
  const avgDelta = rows.length > 0 ? rows.reduce((s, r) => s + r.deltaPercent, 0) / rows.length : 0;

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={7} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="RATE CARD" title="Rate Card Performance" />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: grouped zone bars */}
          <View style={{ flex: 1, marginRight: 20 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 6, letterSpacing: 0.5 }}>
              ACTUAL vs. MRC RATE BY ZONE
            </Text>
            {/* Legend */}
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {[{ c: BLUE, l: 'MRC Rate' }, { c: ORANGE, l: 'Actual Avg' }].map(({ c, l }) => (
                <View key={l} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14 }}>
                  <View style={{ width: 8, height: 8, backgroundColor: c, borderRadius: 2, marginRight: 4 }} />
                  <Text style={{ fontSize: 7, color: GRAY }}>{l}</Text>
                </View>
              ))}
            </View>
            {rows.map(r => (
              <View key={r.zone} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 7.5, color: NAVY, marginBottom: 2, fontFamily: 'Helvetica-Bold' }}>Zone {r.zone}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <View style={{ flex: 1, height: 9, backgroundColor: '#E5E7EB', borderRadius: 2, marginRight: 6 }}>
                    <View style={{ width: `${clamp((r.rateCardAvg / maxVal) * 100, 2, 100)}%`, height: 9, backgroundColor: BLUE, borderRadius: 2 }} />
                  </View>
                  <Text style={{ fontSize: 7, color: GRAY, width: 40, textAlign: 'right' }}>{fmt$(r.rateCardAvg)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, height: 9, backgroundColor: '#E5E7EB', borderRadius: 2, marginRight: 6 }}>
                    <View style={{ width: `${clamp((r.actualAvg / maxVal) * 100, 2, 100)}%`, height: 9, backgroundColor: ORANGE, borderRadius: 2 }} />
                  </View>
                  <Text style={{ fontSize: 7, color: GRAY, width: 40, textAlign: 'right' }}>{fmt$(r.actualAvg)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Right */}
          <View style={{ width: 190 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              RATE PERFORMANCE
            </Text>
            <View style={{ backgroundColor: LIGHT, borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <Text style={{ fontSize: 8, color: GRAY, marginBottom: 3 }}>AVG DELTA vs. MRC</Text>
              <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: avgDelta <= 0 ? GREEN : RED }}>
                {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(1)}%
              </Text>
              <Text style={{ fontSize: 7, color: GRAY, marginTop: 2 }}>
                {avgDelta <= 0 ? 'Below MRC (favorable)' : 'Above MRC (review needed)'}
              </Text>
            </View>
            <Callout
              icon={avgDelta <= 0 ? 'i' : '!'}
              text={avgDelta <= 0
                ? `Actual rates averaging ${Math.abs(avgDelta).toFixed(1)}% below MRC across all zones.`
                : `Actual rates averaging ${avgDelta.toFixed(1)}% above MRC — flag for renegotiation.`}
              color={avgDelta <= 0 ? GREEN : RED}
            />
          </View>
        </View>
      </View>
    </Page>
  );
}

// ── Expiry Alerts Slide ───────────────────────────────────────────────────────
function ExpiryAlertsSlide({ inventoryData }: { inventoryData: InventoryPDFData }) {
  const alerts = inventoryData.expiryAlerts;
  const critical = alerts.filter(a => a.tier === 'critical').length;
  const warning  = alerts.filter(a => a.tier === 'warning').length;
  const watch    = alerts.filter(a => a.tier === 'watch').length;
  const total    = critical + warning + watch;
  const top6     = alerts.slice(0, 6);

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={8} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="INVENTORY" title="Expiry Alerts" />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: top items */}
          <View style={{ flex: 1, marginRight: 20 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 8, letterSpacing: 0.5 }}>
              ITEMS EXPIRING SOONEST
            </Text>
            {/* Table header */}
            <View style={{ flexDirection: 'row', backgroundColor: DARK, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 2 }}>
              {['Client', 'SKU', 'Days Left', 'Urgency'].map((h, i) => (
                <Text key={h} style={{ fontSize: 7, color: WHITE, fontFamily: 'Helvetica-Bold', flex: i === 1 ? 2 : 1 }}>{h}</Text>
              ))}
            </View>
            {top6.map((r, i) => {
              const tierColor = r.tier === 'critical' ? RED : r.tier === 'warning' ? ORANGE : '#EAB308';
              return (
                <View key={i} style={{ flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: i % 2 === 1 ? LIGHT : WHITE }}>
                  <Text style={{ fontSize: 7, color: NAVY, flex: 1 }}>{trunc(r.client || '', 10)}</Text>
                  <Text style={{ fontSize: 7, color: NAVY, flex: 2 }}>{trunc(r.sku || '', 16)}</Text>
                  <Text style={{ fontSize: 7, color: tierColor, fontFamily: 'Helvetica-Bold', flex: 1 }}>{r.daysToExpire ?? '--'}</Text>
                  <Text style={{ fontSize: 7, color: tierColor, flex: 1 }}>{r.tier.toUpperCase()}</Text>
                </View>
              );
            })}
          </View>

          {/* Right: summary */}
          <View style={{ width: 190 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              URGENCY BREAKDOWN
            </Text>
            {[
              { label: 'Critical (<30d)', count: critical, color: RED },
              { label: 'Warning (30–90d)', count: warning, color: ORANGE },
              { label: 'Watch (90–180d)', count: watch, color: '#EAB308' },
            ].map(({ label, count, color }) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: color + '15', borderRadius: 4, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6 }}>
                <Text style={{ fontSize: 8, color: NAVY }}>{label}</Text>
                <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color }}>{count}</Text>
              </View>
            ))}
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 8, color: GRAY }}>Total alerting SKUs: <Text style={{ color: NAVY, fontFamily: 'Helvetica-Bold' }}>{total}</Text></Text>
            </View>
          </View>
        </View>
      </View>
    </Page>
  );
}

// ── Days on Hand Slide ────────────────────────────────────────────────────────
function DaysOnHandSlide({ inventoryData }: { inventoryData: InventoryPDFData }) {
  const rows = inventoryData.daysOnHand;
  const critical    = rows.filter(r => r.status === 'critical').length;
  const low         = rows.filter(r => r.status === 'low').length;
  const overstocked = rows.filter(r => r.status === 'overstocked').length;
  const top6Critical = [...rows].filter(r => r.status === 'critical' || r.status === 'low')
    .sort((a, b) => (a.doh ?? 999) - (b.doh ?? 999)).slice(0, 6);

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={9} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="INVENTORY" title="Days on Hand" />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: critical SKUs */}
          <View style={{ flex: 1, marginRight: 20 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 8, letterSpacing: 0.5 }}>
              CRITICAL & LOW STOCK SKUs
            </Text>
            <View style={{ flexDirection: 'row', backgroundColor: DARK, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 2 }}>
              {['Client', 'SKU', 'Days on Hand', 'Status'].map((h, i) => (
                <Text key={h} style={{ fontSize: 7, color: WHITE, fontFamily: 'Helvetica-Bold', flex: i === 1 ? 2 : 1 }}>{h}</Text>
              ))}
            </View>
            {top6Critical.length > 0 ? top6Critical.map((r, i) => {
              const c = r.status === 'critical' ? RED : ORANGE;
              return (
                <View key={i} style={{ flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: i % 2 === 1 ? LIGHT : WHITE }}>
                  <Text style={{ fontSize: 7, color: NAVY, flex: 1 }}>{trunc(r.client || '', 10)}</Text>
                  <Text style={{ fontSize: 7, color: NAVY, flex: 2 }}>{trunc(r.sku || '', 16)}</Text>
                  <Text style={{ fontSize: 7, color: c, fontFamily: 'Helvetica-Bold', flex: 1 }}>{r.doh !== null ? Math.round(r.doh) : '--'}</Text>
                  <Text style={{ fontSize: 7, color: c, flex: 1 }}>{r.status.toUpperCase()}</Text>
                </View>
              );
            }) : (
              <View style={{ padding: 14, alignItems: 'center' }}>
                <Text style={{ fontSize: 9, color: GREEN }}>No critical or low stock SKUs</Text>
              </View>
            )}
          </View>

          {/* Right: status summary */}
          <View style={{ width: 190 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GRAY, marginBottom: 10, letterSpacing: 0.5 }}>
              STOCK STATUS
            </Text>
            {[
              { label: 'Critical (<14d)', count: critical, color: RED },
              { label: 'Low (14–30d)', count: low, color: ORANGE },
              { label: 'Overstocked (>180d)', count: overstocked, color: BLUE },
            ].map(({ label, count, color }) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: color + '15', borderRadius: 4, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6 }}>
                <Text style={{ fontSize: 8, color: NAVY }}>{label}</Text>
                <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color }}>{count}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 8, color: GRAY, marginTop: 4 }}>Total tracked SKUs: <Text style={{ color: NAVY, fontFamily: 'Helvetica-Bold' }}>{rows.length}</Text></Text>
          </View>
        </View>
      </View>
    </Page>
  );
}

// ── Recommended Actions Slide ─────────────────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = { HIGH: RED, MEDIUM: ORANGE, LOW: BLUE };

function RecommendedActionsSlide({ actions }: { actions: RecommendedAction[] }) {
  const top6 = actions.slice(0, 6);
  const cols: RecommendedAction[][] = [top6.slice(0, 3), top6.slice(3, 6)];

  return (
    <Page size={[W, H]} style={D.page}>
      <SlideMark num={10} />
      <View style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: 34, paddingRight: 20, paddingTop: 14, paddingBottom: 14 }}>
        <SlideTitle label="NEXT STEPS" title="Recommended Actions" />
        <View style={{ flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {cols.map((col, ci) => (
            <View key={ci} style={{ flex: 1, gap: 8 }}>
              {col.map((a, i) => {
                const pc = PRIORITY_COLOR[a.priority] ?? BLUE;
                return (
                  <View key={a.id ?? i} style={{ borderRadius: 6, borderWidth: 1, borderColor: pc + '40', overflow: 'hidden' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: pc + '18', paddingVertical: 5, paddingHorizontal: 10 }}>
                      <View style={{ backgroundColor: pc, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, marginRight: 8 }}>
                        <Text style={{ fontSize: 6.5, color: WHITE, fontFamily: 'Helvetica-Bold' }}>{a.priority}</Text>
                      </View>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY, flex: 1 }}>{a.title}</Text>
                    </View>
                    <View style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
                      <Text style={{ fontSize: 8, color: GRAY, lineHeight: 1.4 }}>{a.body}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </Page>
  );
}

// ── Main Document ─────────────────────────────────────────────────────────────
// Keys that appear in the agenda (content sections only, not meta slides)
const AGENDA_KEYS: DeckSectionKey[] = [
  'introductions', 'accountOverview', 'costGap', 'carrierMix',
  'zonePerformance', 'expiryAlerts', 'daysOnHand', 'recommendedActions',
];

export default function QBRDeckDocument(props: QBRDeckDocumentProps) {
  const {
    clientName, reportDate, reportingPeriod, clientLogo,
    enabledSections, teamMembers = [], kpis, customerStats, costGapRows,
    carrierMix, zoneComparisons, inventoryData, recommendedActions,
  } = props;

  const enabled = new Set(enabledSections.filter(s => s.enabled).map(s => s.key));

  // Build ordered agenda items from enabled sections (excluding 'agenda' itself)
  const agendaItems = AGENDA_KEYS
    .filter(k => enabled.has(k))
    .map((k, i) => ({ num: i + 1, label: SECTION_LABELS[k] }));

  return (
    <Document title={`ShipHero QBR Deck — ${clientName}`} author="ShipHero" subject="Quarterly Business Review Deck">
      <CoverSlide
        clientName={clientName}
        reportDate={reportDate}
        reportingPeriod={reportingPeriod}
        clientLogo={clientLogo}
      />

      {enabled.has('agenda') && agendaItems.length > 0 && (
        <AgendaSlide items={agendaItems} />
      )}

      {enabled.has('introductions') && (
        <IntroductionsSlide members={teamMembers} />
      )}

      {enabled.has('accountOverview') && kpis && customerStats.length > 0 && (
        <AccountOverviewSlide kpis={kpis} customerStats={customerStats} />
      )}

      {enabled.has('costGap') && costGapRows.length > 0 && (
        <CostGapSlide rows={costGapRows} />
      )}

      {enabled.has('carrierMix') && carrierMix.length > 0 && (
        <CarrierMixSlide rows={carrierMix} />
      )}

      {enabled.has('zonePerformance') && zoneComparisons.length > 0 && (
        <ZonePerformanceSlide rows={zoneComparisons} />
      )}

      {enabled.has('expiryAlerts') && inventoryData && inventoryData.expiryAlerts.length > 0 && (
        <ExpiryAlertsSlide inventoryData={inventoryData} />
      )}

      {enabled.has('daysOnHand') && inventoryData && inventoryData.daysOnHand.length > 0 && (
        <DaysOnHandSlide inventoryData={inventoryData} />
      )}

      {enabled.has('recommendedActions') && recommendedActions && recommendedActions.length > 0 && (
        <RecommendedActionsSlide actions={recommendedActions} />
      )}
    </Document>
  );
}
