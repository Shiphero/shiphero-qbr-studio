import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import React, { createRef } from 'react';
import { generateQBRDeck, isBlankSnapshot } from '../utils/generateQBRDeck';
import { useData } from '../context/DataContext';
import { usePDF } from '../context/PDFContext';
import { useAudit } from '../context/AuditContext';
import { getZoneFromOriginToState } from '../utils/uspsZones';
import { inferServiceKey, SERVICE_TABLES, lookupMrcRate } from '../data/shipheroRates';
import type { ServiceKey } from '../data/shipheroRates';
import { generateRecommendedActions } from '../utils/recommendedActions';
import { generateCallout } from '../utils/generateCallout';
import { BUILT_IN_TEMPLATES, loadSavedTemplates, saveTemplate, deleteTemplate } from '../utils/deckTemplates';
import type { DeckTemplate } from '../utils/deckTemplates';
import type { RecommendedAction } from '../utils/recommendedActions';
import type {
  KPISummaryPDF, CustomerStatPDF, CostGapRowPDF,
  CarrierMixRowPDF, ZoneComparisonPDF,
} from './pdf/QBRDocument';
import type { DeckSectionKey, QBRDeckDocumentProps, TeamMember, SectionInsight, DataInstanceSlide } from './pdf/QBRDeckDocument';
import type { CustomDeckSlide } from '../context/DeckContext';
import { TEAM_MEMBER_PRESETS } from '../data/teamMemberPresets';
import { useDeck, SECTION_ORDER, SECTION_LABELS } from '../context/DeckContext';
import { LiveSlidePreview, ScaledSlidePreview } from './LiveSlidePreview';
import { CALLOUT_ICONS, getIconDataUrl } from '../utils/deckIcons';
import type { SlidePreviewData } from './LiveSlidePreview';
import DeckPreviewModal from './DeckPreviewModal';
import { KPI_SLIDE_STATS, isKpiSlide } from '../utils/kpiSlideStats';

// ─── html2canvas snapshot capture ────────────────────────────────────────────
async function captureElementPng(el: HTMLElement, scale = 2): Promise<string> {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(el, {
    scale,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#EDEEF2',
    logging: false,
  });
  return canvas.toDataURL('image/png');
}

/** Render a LiveSlidePreview into a hidden off-screen div at 960×540 (1× slide dims at 96dpi),
 *  capture with html2canvas at 2× scale → 1920×1080 PNG. */
async function snapshotSection(
  key: DeckSectionKey,
  label: string,
  data: SlidePreviewData,
  containerRef: React.RefObject<HTMLDivElement | null>,
): Promise<string | null> {
  if (!containerRef.current) return null;
  return new Promise(resolve => {
    // We render a LiveSlidePreview into the container, wait a tick, then capture
    const container = containerRef.current!;
    // The container is a hidden div at exactly 960×540
    // React renders synchronously into the container via createRoot
    import('react-dom/client').then(({ createRoot }) => {
      const root = createRoot(container);
      root.render(
        React.createElement(LiveSlidePreview, { sectionKey: key, label, data, width: 960 })
      );
      // Wait for recharts to render (SVG layout happens synchronously but paint is async)
      setTimeout(async () => {
        try {
          const png = await captureElementPng(container, 2);
          root.unmount();
          resolve(png);
        } catch {
          root.unmount();
          resolve(null);
        }
      }, 300);
    });
  });
}

// ─── Builder localStorage persistence ────────────────────────────────────────
const BUILDER_STORAGE_KEY = 'shiphero_builder_v1';

// ─── Cover color schemes ──────────────────────────────────────────────────────
export const COVER_COLOR_SCHEMES = [
  { id: 'navy',  label: 'Navy',  bg: '#252F3E', accent: '#EF5252', darkText: false },
  { id: 'red',   label: 'Red',   bg: '#EF5252', accent: '#252F3E', darkText: false },
  { id: 'white', label: 'White', bg: '#FFFFFF', accent: '#EF5252', darkText: true  },
  { id: 'black', label: 'Black', bg: '#000000', accent: '#EF5252', darkText: false },
] as const;
export type CoverColorSchemeId = typeof COVER_COLOR_SCHEMES[number]['id'];

interface PersistedBuilderState {
  teamMembers: TeamMember[];
  reportDate: string;
  reportingPeriod: string;
  clientName: string;
  selectedFont: 'A' | 'B' | 'C';
  deckLogo?: string;
  coverPhoto?: string;
  coverColorScheme?: CoverColorSchemeId;
}

function loadBuilderState(): Partial<PersistedBuilderState> {
  try {
    const raw = localStorage.getItem(BUILDER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedBuilderState>) : {};
  } catch {
    return {};
  }
}

function saveBuilderState(state: PersistedBuilderState) {
  try {
    localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded (likely from base64 photos) — silently ignore
  }
}

// ─── Brand ────────────────────────────────────────────────────────────────────
const NAVY   = '#252F3E';
const ORANGE = '#EF5252';
const BLUE   = '#4472E8';
const FONT   = "'Metropolis', sans-serif";

// ─── Structural slides (no insight story needed) ───────────────────────────
const STRUCTURAL: Set<DeckSectionKey> = new Set(['agenda', 'introductions', 'recommendedActions']);

// ─── Insight action dropdown options ──────────────────────────────────────
const INSIGHT_ACTIONS = [
  { value: '',                        label: 'Select an action…' },
  { value: 'rate-optimization',       label: 'Rate optimization' },
  { value: 'volume-incentive',        label: 'Volume incentive' },
  { value: 'carrier-diversification', label: 'Carrier diversification' },
  { value: 'operational-review',      label: 'Operational review' },
  { value: 'onboarding-review',       label: 'Onboarding review' },
  { value: 'no-action',               label: 'No action needed' },
  { value: 'custom',                  label: 'Custom action' },
];


// ─── Chart glyph type per section ─────────────────────────────────────────
const CHART_TYPE: Record<DeckSectionKey, 'bar' | 'line' | 'area' | 'table' | 'list' | 'mixed' | 'pie'> = {
  agenda:                'list',
  introductions:         'mixed',
  accountOverview:       'mixed',
  costGap:               'bar',
  carrierMix:            'pie',
  serviceLevelMix:       'bar',
  labelCostByCarrier:    'bar',
  zonePerformance:       'bar',
  expiryAlerts:          'table',
  daysOnHand:            'bar',
  recommendedActions:    'list',
  volumeTrend:           'area',
  childAccountTrends:    'line',
  carrierSpendGMV:       'area',
  fulfillmentMix:        'bar',
  childAccountScorecard: 'table',
  manualAdjustments:     'table',
  shippingKPIs:          'mixed',
  upsAvgCost:            'bar',
  upsZoneBreakdown:      'table',
  zoneMap:               'mixed',
  warehouseInsights:     'list',
  shipmentsByState:      'table',
  inventoryKPIs:         'mixed',
  rateCardKPIs:          'mixed',
  threePlKPIs:           'mixed',
  accountDetailTable:    'table',
  accountHealthKPIs:     'mixed',
  priorQuarterKPIs:      'mixed',
  priorQuarterCarrierMix:'bar',
};

// ─── Section metadata (label + category) ──────────────────────────────────
interface SectionMeta { label: string; sub: string; category: string }
const SECTION_META: Record<DeckSectionKey, SectionMeta> = {
  agenda:                { label: 'Agenda',                   sub: 'Auto-generated from enabled slides',              category: 'Structure'      },
  introductions:         { label: 'Introductions',            sub: 'ShipHero team members on the call',               category: 'Structure'      },
  accountOverview:       { label: 'Account Overview',         sub: 'KPI summary + top accounts by volume',            category: 'Shipping'       },
  costGap:               { label: 'Shipping Cost Analysis',   sub: 'Label cost vs. billed — gap by account',          category: 'Billing'        },
  carrierMix:            { label: 'Carrier Mix',              sub: 'Volume and cost breakdown by carrier',             category: 'Shipping'       },
  serviceLevelMix:       { label: 'Service Level Mix',        sub: 'Shipments by service type (Ground, Express…)',    category: 'Shipping'       },
  labelCostByCarrier:    { label: 'Label Cost by Carrier',    sub: 'Avg per-shipment label cost across carriers',     category: 'Billing'        },
  zonePerformance:       { label: 'Rate Card Performance',    sub: 'Actual vs. MRC rates by USPS zone',               category: 'Rate Card'      },
  expiryAlerts:          { label: 'Inventory Expiry Alerts',  sub: 'Lot-tracked items expiring within 180 days',      category: 'Inventory'      },
  daysOnHand:            { label: 'Inventory Days on Hand',   sub: 'Stock levels vs. daily velocity',                 category: 'Inventory'      },
  recommendedActions:    { label: 'Recommended Actions',      sub: 'Auto-generated action items from your data',      category: 'Structure'      },
  volumeTrend:           { label: 'Total Volume Trend',       sub: 'Monthly orders & labels — all child accounts',    category: 'Account Health' },
  childAccountTrends:    { label: 'Child Account Trends',     sub: 'Top 6 accounts by order volume over time',        category: 'Account Health' },
  carrierSpendGMV:       { label: 'Carrier Spend vs GMV',     sub: 'Monthly carrier spend and gross merch. value',    category: 'Account Health' },
  fulfillmentMix:        { label: 'Fulfillment Mix',          sub: 'SIB / MIB / Bulk / Manual breakdown (%)',         category: 'Account Health' },
  childAccountScorecard: { label: 'Child Account Scorecard',  sub: 'MoM health summary — all child accounts',         category: 'Account Health' },
  manualAdjustments:     { label: 'Manual Adjustments',       sub: 'Non-automated inventory changes by category',     category: 'Inventory'      },
  shippingKPIs:          { label: 'Shipping Overview',        sub: 'Total shipments, cost, avg cost, states reached', category: 'Shipping'       },
  upsAvgCost:            { label: 'UPS Avg Cost by Zone',     sub: 'ShipHero UPS negotiated rate vs actual paid',     category: 'Rate Card'      },
  upsZoneBreakdown:      { label: 'UPS Zone-by-Zone',         sub: 'Shipment count, UPS rate, delta per zone',        category: 'Rate Card'      },
  zoneMap:               { label: 'Zone Distribution Map',    sub: 'USPS zone heat map from warehouse origin',        category: 'Network'        },
  warehouseInsights:     { label: 'Warehouse Insights',       sub: 'Top locations to add a warehouse and save costs', category: 'Network'        },
  shipmentsByState:      { label: 'Shipments by State',       sub: 'Volume and cost breakdown by destination state',  category: 'Shipping'       },
  inventoryKPIs:         { label: 'Inventory Summary',        sub: 'Active SKUs, units on hand, expiry, DOH',         category: 'Inventory'      },
  rateCardKPIs:          { label: 'Rate Card Summary',        sub: 'MRC total vs actual paid — total delta',          category: 'Rate Card'      },
  threePlKPIs:           { label: '3PL Account Summary',      sub: '3PL customers, shipments, label cost, billed',    category: '3PL'            },
  accountDetailTable:    { label: 'Account Detail Table',     sub: 'Per-account volume, weight, cost, zone',          category: '3PL'            },
  accountHealthKPIs:     { label: 'Account Health Summary',   sub: 'Orders, labels, carrier spend, GMV, billing',     category: 'Account Health' },
  priorQuarterKPIs:      { label: 'Prior Quarter KPIs',       sub: 'Shipments, spend, cost, weight — prior vs current', category: 'Prior Quarter' },
  priorQuarterCarrierMix:{ label: 'Prior Quarter Carrier Mix', sub: 'Carrier volume & spend — prior vs current',       category: 'Prior Quarter'  },
};

// ─── Tiny chart glyph (SVG placeholder) ───────────────────────────────────
function ChartGlyph({ type, scale = 1 }: { type: string; scale?: number }) {
  const s = { opacity: 0.22 };
  const B = BLUE, O = ORANGE, G = '#22C55E', N = NAVY;
  if (type === 'bar') return (
    <svg width={80 * scale} height={44 * scale} viewBox="0 0 80 44" fill="none" preserveAspectRatio="none">
      <rect x="4"  y="20" width="10" height="20" fill={B} style={s} />
      <rect x="18" y="10" width="10" height="30" fill={O} style={s} />
      <rect x="32" y="16" width="10" height="24" fill={B} style={s} />
      <rect x="46" y="6"  width="10" height="34" fill={O} style={s} />
      <rect x="60" y="14" width="10" height="26" fill={B} style={s} />
      <line x1="2" y1="42" x2="78" y2="42" stroke={N} strokeWidth="1" opacity="0.1" />
    </svg>
  );
  if (type === 'line') return (
    <svg width={80 * scale} height={44 * scale} viewBox="0 0 80 44" fill="none">
      <polyline points="4,36 18,24 32,28 46,12 60,18 74,8" stroke={B} strokeWidth="2" fill="none" opacity="0.3" />
      <polyline points="4,40 18,32 32,36 46,22 60,28 74,20" stroke={O} strokeWidth="2" fill="none" opacity="0.3" />
    </svg>
  );
  if (type === 'area') return (
    <svg width={80 * scale} height={44 * scale} viewBox="0 0 80 44" fill="none">
      <path d="M4,36 18,22 32,26 46,14 60,20 74,10 74,42 4,42Z" fill={B} opacity="0.15" />
      <polyline points="4,36 18,22 32,26 46,14 60,20 74,10" stroke={B} strokeWidth="2" fill="none" opacity="0.4" />
    </svg>
  );
  if (type === 'pie') return (
    <svg width={44 * scale} height={44 * scale} viewBox="0 0 44 44" fill="none">
      <path d="M22,22 L22,4 A18,18 0 0,1 38,31 Z" fill={B} opacity="0.35" />
      <path d="M22,22 L38,31 A18,18 0 0,1 8,36 Z"  fill={O} opacity="0.35" />
      <path d="M22,22 L8,36 A18,18 0 0,1 22,4 Z"   fill={G} opacity="0.35" />
    </svg>
  );
  if (type === 'table') return (
    <svg width={80 * scale} height={44 * scale} viewBox="0 0 80 44" fill="none">
      <rect x="2" y="2" width="76" height="10" rx="2" fill={N} opacity="0.12" />
      {[14, 22, 30, 38].map(y => (
        <React.Fragment key={y}>
          <rect x="2"  y={y} width="35" height="6" rx="1" fill={B} opacity="0.10" />
          <rect x="42" y={y} width="18" height="6" rx="1" fill={N} opacity="0.08" />
          <rect x="63" y={y} width="15" height="6" rx="1" fill={N} opacity="0.08" />
        </React.Fragment>
      ))}
    </svg>
  );
  if (type === 'list') return (
    <svg width={80 * scale} height={44 * scale} viewBox="0 0 80 44" fill="none">
      {[6, 16, 26, 36].map(y => (
        <React.Fragment key={y}>
          <circle cx="8" cy={y + 3} r="3" fill={O} opacity="0.4" />
          <rect x="16" y={y} width={30 + Math.random() * 20} height="6" rx="2" fill={N} opacity="0.10" />
        </React.Fragment>
      ))}
    </svg>
  );
  // mixed / default
  return (
    <svg width={80 * scale} height={44 * scale} viewBox="0 0 80 44" fill="none">
      <rect x="4"  y="24" width="12" height="16" fill={B} opacity="0.25" />
      <rect x="20" y="16" width="12" height="24" fill={O} opacity="0.25" />
      <rect x="48" y="4"  width="28" height="6"  rx="2" fill={N} opacity="0.10" />
      <rect x="48" y="14" width="20" height="6"  rx="2" fill={N} opacity="0.08" />
      <rect x="48" y="24" width="24" height="6"  rx="2" fill={N} opacity="0.08" />
    </svg>
  );
}

// ─── Slide thumbnail (16:9 mini canvas) ───────────────────────────────────
function SlideThumbnail({
  sectionKey, size = 'sm', customType, customVariant, coverPhotoUrl, logoUrl, coverBg, coverAccent,
}: {
  sectionKey: string;
  size?: 'sm' | 'lg';
  customType?: 'cover' | 'data' | 'custom';
  customVariant?: CustomDeckSlide['variant'];
  coverPhotoUrl?: string;
  logoUrl?: string;
  coverBg?: string;
  coverAccent?: string;
}) {
  const w = size === 'lg' ? 480 : 160;
  const h = Math.round(w / (16 / 9));
  const isCover = sectionKey === 'cover' || customType === 'cover';
  const coverBgColor  = coverBg ?? NAVY;
  const coverAccColor = coverAccent ?? ORANGE;
  const coverDarkText = coverBg === '#FFFFFF'; // white bg needs dark text
  const isCustom = customType === 'custom';
  const label = isCover ? 'Cover' : SECTION_LABELS[sectionKey as DeckSectionKey] ?? sectionKey;
  const chartType = isCover ? 'mixed' : (CHART_TYPE[sectionKey as DeckSectionKey] ?? 'mixed');
  const lg = size === 'lg';

  // ── Navy closer slides (divider, Q&A, Thank You) ───────────────────────────
  if (isCustom && (customVariant === 'divider' || customVariant === 'qa' || customVariant === 'thankyou')) {
    const tagLine = customVariant === 'divider' ? 'SECTION' : customVariant === 'qa' ? 'Q & A' : 'THANK YOU';
    const sub     = customVariant === 'thankyou' ? '• Next steps' : undefined;
    return (
      <div style={{
        width: w, height: h, borderRadius: lg ? 10 : 6,
        background: NAVY, overflow: 'hidden', position: 'relative', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: lg ? 14 : 6, fontWeight: 800, color: '#fff', letterSpacing: 1, textAlign: 'center', padding: lg ? '0 32px' : '0 8px' }}>{tagLine}</div>
        {sub && <div style={{ fontSize: lg ? 9 : 4, color: '#94A3B8', marginTop: lg ? 4 : 2 }}>{sub}</div>}
        <div style={{ width: lg ? 60 : 24, height: 2, background: ORANGE, borderRadius: 1, marginTop: lg ? 8 : 3 }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: lg ? 4 : 2, background: ORANGE }} />
      </div>
    );
  }

  // ── Light bg custom slides ────────────────────────────────────────────────
  if (isCustom && customVariant === 'text') {
    return (
      <div style={{ width: w, height: h, borderRadius: lg ? 10 : 6, background: '#F8F9FB', border: '1px solid #E5E7EB', overflow: 'hidden', position: 'relative', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: lg ? '14px 18px 10px' : '5px 7px 4px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: lg ? 7 : 3.5, fontWeight: 700, color: BLUE, letterSpacing: 1, textTransform: 'uppercase' }}>CUSTOM</div>
          <div style={{ fontSize: lg ? 13 : 5, fontWeight: 700, color: NAVY }}>Custom Slide</div>
        </div>
        <div style={{ flex: 1, padding: lg ? '12px 18px' : '4px 7px', display: 'flex', flexDirection: 'column', gap: lg ? 6 : 2 }}>
          {[1, 2, 3].map(i => <div key={i} style={{ height: lg ? 8 : 3, background: '#E5E7EB', borderRadius: 2, width: `${70 + i * 10}%` }} />)}
        </div>
        <div style={{ height: lg ? 3 : 1.5, background: `linear-gradient(90deg, ${ORANGE} 0%, ${BLUE} 100%)`, flexShrink: 0 }} />
      </div>
    );
  }

  if (isCustom && customVariant === 'quote') {
    return (
      <div style={{ width: w, height: h, borderRadius: lg ? 10 : 6, background: '#F8F9FB', border: '1px solid #E5E7EB', overflow: 'hidden', position: 'relative', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: lg ? 6 : 3, padding: lg ? '16px 24px' : '6px 10px' }}>
        <div style={{ fontSize: lg ? 40 : 16, color: BLUE, fontWeight: 900, lineHeight: 1, alignSelf: 'flex-start', opacity: 0.5 }}>"</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: lg ? 5 : 2, width: '100%' }}>
          {[90, 100, 80, 70].map((pct, i) => <div key={i} style={{ height: lg ? 6 : 2.5, background: '#CBD5E1', borderRadius: 2, width: `${pct}%`, margin: '0 auto' }} />)}
        </div>
        <div style={{ height: lg ? 4 : 2, background: '#E5E7EB', borderRadius: 2, width: '40%' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: lg ? 3 : 1.5, background: ORANGE }} />
      </div>
    );
  }

  if (isCustom && customVariant === 'twocol') {
    return (
      <div style={{ width: w, height: h, borderRadius: lg ? 10 : 6, background: '#F8F9FB', border: '1px solid #E5E7EB', overflow: 'hidden', position: 'relative', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: lg ? '10px 14px 8px' : '4px 6px 3px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ height: lg ? 8 : 3.5, background: NAVY, borderRadius: 2, width: '60%', opacity: 0.7 }} />
        </div>
        <div style={{ flex: 1, display: 'flex', gap: lg ? 8 : 3, padding: lg ? '10px 14px' : '4px 6px' }}>
          {[0, 1].map(i => (
            <div key={i} style={{ flex: 1, background: '#fff', borderRadius: lg ? 4 : 2, border: '1px solid #E5E7EB', padding: lg ? 6 : 2, display: 'flex', flexDirection: 'column', gap: lg ? 4 : 1.5 }}>
              {[100, 85, 95, 75].map((pct, j) => <div key={j} style={{ height: lg ? 5 : 2, background: '#E5E7EB', borderRadius: 1, width: `${pct}%` }} />)}
            </div>
          ))}
        </div>
        <div style={{ height: lg ? 3 : 1.5, background: ORANGE, flexShrink: 0 }} />
      </div>
    );
  }

  if (isCustom && customVariant === 'image') {
    return (
      <div style={{ width: w, height: h, borderRadius: lg ? 10 : 6, background: '#F8F9FB', border: '1px solid #E5E7EB', overflow: 'hidden', position: 'relative', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '75%', height: '60%', background: '#D1D5DB', borderRadius: lg ? 6 : 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={lg ? 32 : 14} height={lg ? 28 : 12} viewBox="0 0 32 28" fill="none">
            <rect x="1" y="1" width="30" height="26" rx="3" stroke="#9CA3AF" strokeWidth="1.5" />
            <circle cx="11" cy="10" r="3" fill="#9CA3AF" opacity="0.6" />
            <path d="M1 21 L9 14 L16 20 L22 13 L31 21" stroke="#9CA3AF" strokeWidth="1.5" fill="none" opacity="0.6" />
          </svg>
        </div>
        <div style={{ height: lg ? 6 : 2.5, background: '#E5E7EB', borderRadius: 2, width: '50%', marginTop: lg ? 8 : 3 }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: lg ? 3 : 1.5, background: ORANGE }} />
      </div>
    );
  }

  if (isCustom && customVariant === 'blank') {
    return (
      <div style={{ width: w, height: h, borderRadius: lg ? 10 : 6, background: '#F8F9FB', border: '1px solid #E5E7EB', overflow: 'hidden', position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: lg ? 11 : 5, color: '#D1D5DB', fontWeight: 500 }}>BLANK</div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: lg ? 3 : 1.5, background: ORANGE }} />
      </div>
    );
  }

  return (
    <div style={{
      width: w, height: h, borderRadius: size === 'lg' ? 10 : 6,
      background: isCover ? coverBgColor : '#F8F9FB',
      border: `1px solid ${isCover ? 'transparent' : '#E5E7EB'}`,
      overflow: 'hidden', position: 'relative', flexShrink: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      {isCover ? (
        /* Cover slide mini-render */
        <>
          {coverPhotoUrl && (
            <img src={coverPhotoUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />
          )}
          {/* Top accent bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: size === 'lg' ? 4 : 1.5, background: coverAccColor, zIndex: 1 }} />
          <div style={{ padding: size === 'lg' ? '28px 32px' : '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
            <div style={{ fontSize: size === 'lg' ? 11 : 5, color: coverDarkText ? 'rgba(37,47,62,0.5)' : 'rgba(255,255,255,0.5)', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: size === 'lg' ? 6 : 2 }}>Quarterly Business Review</div>
            {logoUrl ? (
              <img src={logoUrl} alt="" style={{ height: size === 'lg' ? 28 : 10, maxWidth: size === 'lg' ? 120 : 44, objectFit: 'contain', marginBottom: size === 'lg' ? 8 : 3 }} />
            ) : (
              <div style={{ fontSize: size === 'lg' ? 22 : 8, color: coverDarkText ? NAVY : '#fff', fontWeight: 800, letterSpacing: 1, marginBottom: size === 'lg' ? 8 : 3 }}>CLIENT NAME</div>
            )}
            <div style={{ width: size === 'lg' ? 48 : 16, height: size === 'lg' ? 3 : 1.5, background: coverAccColor, borderRadius: 1 }} />
            <div style={{ fontSize: size === 'lg' ? 10 : 4, color: coverDarkText ? 'rgba(37,47,62,0.35)' : 'rgba(255,255,255,0.35)', marginTop: size === 'lg' ? 10 : 4 }}>Prepared by ShipHero</div>
          </div>
        </>
      ) : (
        <>
          {/* Title bar */}
          <div style={{
            padding: size === 'lg' ? '14px 18px 10px' : '5px 7px 4px',
            borderBottom: `1px solid #E5E7EB`,
          }}>
            <div style={{ fontSize: size === 'lg' ? 13 : 5, fontWeight: 700, color: NAVY, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</div>
          </div>
          {/* Chart area */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: size === 'lg' ? 16 : 6 }}>
            <ChartGlyph type={chartType} scale={size === 'lg' ? 1.8 : 0.6} />
          </div>
        </>
      )}
      {/* Bottom accent bar */}
      <div style={{ height: size === 'lg' ? 3 : 1.5, background: isCover ? `linear-gradient(90deg, ${coverAccColor} 0%, ${BLUE} 100%)` : `linear-gradient(90deg, ${ORANGE} 0%, ${BLUE} 100%)`, flexShrink: 0 }} />
    </div>
  );
}

// ─── Completion dot ────────────────────────────────────────────────────────
// ─── Custom-slide form helpers (module-level to prevent re-mounting on each render) ──
const CF_INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  borderRadius: 8, border: '1.5px solid #E5E7EB',
  fontSize: 12, color: NAVY, fontFamily: FONT, outline: 'none', background: '#fff',
};
const CF_TA: React.CSSProperties = { ...CF_INPUT, resize: 'vertical', lineHeight: 1.5 };

function CfLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{children}</label>;
}
function CfField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><CfLabel>{label}</CfLabel>{children}</div>;
}

function CompletionDot({ sectionKey, sections, itemType }: { sectionKey: string; sections: ReturnType<typeof useDeck>['sections']; itemType?: 'cover' | 'data' | 'custom' }) {
  if (sectionKey === 'cover' || itemType === 'cover') return <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', flexShrink: 0 }} title="Always included" />;
  if (itemType === 'custom') return <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#CBD5E1', flexShrink: 0 }} title="Custom slide" />;
  if (STRUCTURAL.has(sectionKey as DeckSectionKey)) return <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#CBD5E1', flexShrink: 0 }} title="Auto-generated" />;
  const sec = sections.find(s => s.key === sectionKey);
  const hasInsight = !!(sec?.insight?.whatHappening && sec?.insight?.whyMatters && sec?.insight?.action);
  return (
    <div
      style={{ width: 8, height: 8, borderRadius: '50%', background: hasInsight ? '#22C55E' : '#F59E0B', flexShrink: 0 }}
      title={hasInsight ? 'Story written' : 'Story missing — go to Data tab'}
    />
  );
}

// ─── Inline insight story editor ──────────────────────────────────────────
function InlineInsightEditor({ sectionKey, insight, onSave }: {
  sectionKey: DeckSectionKey;
  insight: SectionInsight | undefined;
  onSave: (key: DeckSectionKey, val: SectionInsight | undefined) => void;
}) {
  const [what,   setWhat]   = useState(insight?.whatHappening ?? '');
  const [why,    setWhy]    = useState(insight?.whyMatters ?? '');
  const [action, setAction] = useState(insight?.action ?? '');
  const [note,   setNote]   = useState(insight?.actionNote ?? '');

  const canSave = what.trim().length > 0 && why.trim().length > 0 && action.length > 0;

  const taStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '7px 10px', borderRadius: 8,
    border: '1.5px solid #E5E7EB',
    fontSize: 12, color: NAVY, fontFamily: FONT,
    resize: 'none', outline: 'none', lineHeight: 1.5,
    background: '#fff',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
          What's happening? <span style={{ color: ORANGE }}>*</span>
        </label>
        <textarea value={what} onChange={e => setWhat(e.target.value.slice(0, 150))} rows={2} style={taStyle}
          placeholder="e.g. Orders are down 23% MoM across all child accounts" />
        <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 2 }}>{what.length}/150</div>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
          Why does it matter? <span style={{ color: ORANGE }}>*</span>
        </label>
        <textarea value={why} onChange={e => setWhy(e.target.value.slice(0, 150))} rows={2} style={taStyle}
          placeholder="e.g. Their highest-volume account has been declining 3 months in a row" />
        <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 2 }}>{why.length}/150</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Recommended action <span style={{ color: ORANGE }}>*</span>
          </label>
          <select value={action} onChange={e => setAction(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E5E7EB', fontSize: 12, color: action ? NAVY : '#9CA3AF', fontFamily: FONT, outline: 'none', background: '#fff', cursor: 'pointer' }}>
            {INSIGHT_ACTIONS.map(a => (
              <option key={a.value} value={a.value} disabled={!a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Notes <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF' }}>(optional)</span>
          </label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={1} style={taStyle}
            placeholder="Additional context…" />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {insight ? (
          <button onClick={() => { setWhat(''); setWhy(''); setAction(''); setNote(''); onSave(sectionKey, undefined); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, padding: 0, fontFamily: FONT }}>
            Clear story
          </button>
        ) : <div />}
        <button
          onClick={() => canSave && onSave(sectionKey, { whatHappening: what.trim(), whyMatters: why.trim(), action, actionNote: note.trim() })}
          disabled={!canSave}
          style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: canSave ? BLUE : '#E5E7EB', color: canSave ? '#fff' : '#9CA3AF', fontWeight: 600, fontSize: 12, cursor: canSave ? 'pointer' : 'not-allowed', fontFamily: FONT }}
        >
          Save Story
        </button>
      </div>
    </div>
  );
}

// ─── SlideListItem type ────────────────────────────────────────────────────
interface SlideListItem {
  id: string;
  type: 'cover' | 'data' | 'custom' | 'instance';
  variant?: CustomDeckSlide['variant'];
  label: string;
  isFixed: boolean;
  isHidden: boolean;
  duplicates: number;
  /** For type==='instance': the DataInstanceSlide id */
  instanceId?: string;
  /** For type==='instance': the parent section key */
  parentKey?: DeckSectionKey;
}

// ─── Row filter slide keys ─────────────────────────────────────────────────
const ROW_FILTER_SLIDES = new Set<string>([
  'accountDetailTable', 'costGap', 'carrierMix', 'shipmentsByState',
  'childAccountScorecard', 'childAccountTrends', 'serviceLevelMix', 'labelCostByCarrier',
]);

// ─── Filter SlidePreviewData for a specific instance rowFilter ─────────────
function filterPreviewData(data: SlidePreviewData, sectionKey: DeckSectionKey, rowFilter: string[] | undefined): SlidePreviewData {
  if (!rowFilter?.length) return data;
  const filterSet = new Set(rowFilter);
  switch (sectionKey) {
    case 'accountDetailTable':
    case 'costGap':
      return {
        ...data,
        costGapRows:   data.costGapRows.filter(r => filterSet.has(r.name)),
        customerStats: data.customerStats.filter(c => filterSet.has(c.customer)),
      };
    case 'carrierMix':
      return {
        ...data,
        carrierMix:  data.carrierMix.filter(r => filterSet.has(r.carrier)),
        rawShipments: data.rawShipments.filter(s => filterSet.has(s.carrier || 'Unknown')),
      };
    case 'shipmentsByState':
      return { ...data, rawShipments: data.rawShipments.filter(s => s.state && filterSet.has(s.state)) };
    case 'childAccountScorecard':
    case 'childAccountTrends':
      return { ...data, statsRows: data.statsRows.filter(r => filterSet.has(r.accountName || r.accountId)) };
    case 'serviceLevelMix':
      return { ...data, rawShipments: data.rawShipments.filter(s => filterSet.has(s.shippingMethod || 'Unknown')) };
    case 'labelCostByCarrier':
      return { ...data, rawShipments: data.rawShipments.filter(s => filterSet.has(s.carrier || 'Unknown')) };
    default:
      return data;
  }
}

// ─── Inline-editable slide canvas ─────────────────────────────────────────
// SlideEditText: module-level so React never remounts it mid-edit
interface SlideEditTextProps {
  field: string;
  value: string | undefined;
  placeholder: string;
  onSave: (field: string, val: string) => void;
  isEditing: boolean;
  onStart: () => void;
  onStop: () => void;
  dispStyle: React.CSSProperties;
  editStyle: React.CSSProperties;
  multiline?: boolean;
  rows?: number;
}
function SlideEditText({ field, value, placeholder, onSave, isEditing, onStart, onStop, dispStyle, editStyle, multiline, rows = 3 }: SlideEditTextProps) {
  const escRef = React.useRef(false);
  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!escRef.current) onSave(field, e.target.value);
    escRef.current = false;
    onStop();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { escRef.current = true; (e.target as HTMLInputElement).blur(); }
    if (!multiline && e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
  };
  if (isEditing) {
    return multiline
      ? <textarea autoFocus defaultValue={value ?? ''} onBlur={handleBlur} onKeyDown={handleKeyDown} rows={rows} style={editStyle} />
      : <input    autoFocus defaultValue={value ?? ''} onBlur={handleBlur} onKeyDown={handleKeyDown}         style={editStyle} />;
  }
  return (
    <div
      onClick={onStart}
      style={{ cursor: 'text', ...dispStyle }}
      onMouseEnter={e => { e.currentTarget.style.outline = '1.5px dashed rgba(68,114,232,0.35)'; e.currentTarget.style.borderRadius = '4px'; }}
      onMouseLeave={e => { e.currentTarget.style.outline = 'none'; e.currentTarget.style.borderRadius = '0'; }}
      title="Click to edit"
    >
      {value ? value : <span style={{ opacity: 0.3, fontStyle: 'italic' }}>{placeholder}</span>}
    </div>
  );
}

function EditableCustomSlide({ slide, onUpdate }: { slide: CustomDeckSlide; onUpdate: (patch: Partial<CustomDeckSlide>) => void }) {
  const [ef, setEf] = React.useState<string | null>(null);
  const v = slide.variant;
  const isNavy = v === 'divider' || v === 'qa' || v === 'thankyou';
  const W = 480, H = 270;

  const save = (field: string, val: string) => onUpdate({ [field]: val || undefined } as Partial<CustomDeckSlide>);
  const et = (field: string, value: string | undefined, ph: string, ds: React.CSSProperties, es: React.CSSProperties, extra?: Partial<SlideEditTextProps>) => (
    <SlideEditText key={field} field={field} value={value} placeholder={ph} onSave={save}
      isEditing={ef === field} onStart={() => setEf(field)} onStop={() => setEf(null)}
      dispStyle={ds} editStyle={es} {...extra} />
  );

  // shared style builders
  const navyInput = (fs: number, fw: React.CSSProperties['fontWeight'] = 800): React.CSSProperties => ({
    fontSize: fs, fontWeight: fw, color: '#fff', textAlign: 'center' as const, lineHeight: 1.25, letterSpacing: 0.3,
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 4,
    outline: 'none', fontFamily: FONT, width: '100%', boxSizing: 'border-box' as const, padding: '2px 10px',
  });
  const navyDisp = (fs: number, fw: React.CSSProperties['fontWeight'] = 800): React.CSSProperties => ({
    fontSize: fs, fontWeight: fw, color: '#fff', textAlign: 'center' as const, lineHeight: 1.25, letterSpacing: 0.3, width: '100%',
  });
  const navySubDisp: React.CSSProperties = { fontSize: 10, color: '#94A3B8', textAlign: 'center', width: '100%' };
  const navySubInput: React.CSSProperties = {
    fontSize: 10, color: '#94A3B8', textAlign: 'center',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4,
    outline: 'none', fontFamily: FONT, width: '100%', boxSizing: 'border-box' as const, padding: '2px 8px',
  };
  const lightTitleDisp = (fs = 14): React.CSSProperties => ({ fontSize: fs, fontWeight: 700, color: NAVY, lineHeight: 1.3, width: '100%' });
  const lightTitleInput = (fs = 14): React.CSSProperties => ({
    fontSize: fs, fontWeight: 700, color: NAVY, lineHeight: 1.3,
    background: 'rgba(68,114,232,0.06)', border: '1px solid rgba(68,114,232,0.28)', borderRadius: 4,
    outline: 'none', fontFamily: FONT, width: '100%', boxSizing: 'border-box' as const, padding: '2px 8px',
  });
  const lightBodyDisp = (fs = 10, color = '#6B7280'): React.CSSProperties => ({ fontSize: fs, color, lineHeight: 1.55, width: '100%', whiteSpace: 'pre-wrap' as const });
  const lightBodyInput = (fs = 10): React.CSSProperties => ({
    fontSize: fs, color: '#6B7280', lineHeight: 1.55,
    background: 'rgba(68,114,232,0.04)', border: '1px solid rgba(68,114,232,0.28)', borderRadius: 4,
    outline: 'none', fontFamily: FONT, width: '100%', boxSizing: 'border-box' as const, padding: '3px 8px', resize: 'none' as const,
  });

  // shared layout bits
  const orangeBar   = <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: ORANGE }} />;
  const orangeLine  = <div style={{ width: 100, height: 3, background: ORANGE, borderRadius: 1.5, flexShrink: 0 }} />;
  const sidebar     = <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: BLUE }} />;
  const PADL = 28; // left pad for light slides

  /* ── NAVY VARIANTS ────────────────────────────────── */
  if (isNavy) {
    return (
      <div style={{ width: W, height: H, background: NAVY, borderRadius: 10, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '20px 60px' }}>
          {v === 'qa' ? (
            // Q&A — large centered title + optional subtitle
            <>
              {et('title', slide.title, 'Q&A', navyDisp(32), navyInput(32))}
              {orangeLine}
              {et('subtitle', slide.subtitle, 'We\u2019d love to hear from you', navySubDisp, navySubInput)}
            </>
          ) : v === 'thankyou' ? (
            // Thank You — title + bullet body
            <>
              {et('title', slide.title, 'Thank You', navyDisp(26), navyInput(26))}
              {orangeLine}
              {et('body', slide.body, 'Next steps\u2026\n(one per line)', { ...navySubDisp, textAlign: 'left', paddingLeft: 8, whiteSpace: 'pre-wrap', lineHeight: 1.6 },
                { ...navySubInput, textAlign: 'left', background: 'rgba(255,255,255,0.05)', lineHeight: 1.6, resize: 'none' }, { multiline: true, rows: 4 })}
            </>
          ) : (
            // Divider — centered title + optional subtitle
            <>
              {et('title', slide.title, 'Section Title\u2026', navyDisp(22), navyInput(22))}
              {orangeLine}
              {et('subtitle', slide.subtitle, 'Subtitle (optional)\u2026', navySubDisp, navySubInput)}
            </>
          )}
        </div>
        {orangeBar}
      </div>
    );
  }

  /* ── LIGHT VARIANTS ───────────────────────────────── */
  const lightWrap = (children: React.ReactNode) => (
    <div style={{ width: W, height: H, background: '#EDEEF2', borderRadius: 10, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
      {sidebar}
      <div style={{ position: 'absolute', left: PADL, right: 16, top: 12, bottom: 10 }}>{children}</div>
      {orangeBar}
    </div>
  );

  if (v === 'text' || v === 'blank') {
    return lightWrap(
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        {v === 'text' && <div style={{ fontSize: 7, fontWeight: 700, color: BLUE, letterSpacing: 1.5, textTransform: 'uppercase', userSelect: 'none' }}>CUSTOM</div>}
        {et('title', slide.title, v === 'blank' ? 'Heading (optional)\u2026' : 'Slide title\u2026', lightTitleDisp(), lightTitleInput())}
        {v === 'text' && (
          <>
            <div style={{ height: 1, background: '#D1D5DB', flexShrink: 0 }} />
            {et('body', slide.body, 'Body text\u2026', lightBodyDisp(), lightBodyInput(), { multiline: true, rows: 7 })}
          </>
        )}
      </div>
    );
  }

  if (v === 'quote') {
    return lightWrap(
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
        <div style={{ fontSize: 52, color: BLUE, opacity: 0.2, fontWeight: 900, lineHeight: 1, alignSelf: 'flex-start', userSelect: 'none', pointerEvents: 'none', marginTop: -8 }}>"</div>
        {et('body', slide.body, 'Quote text\u2026', { ...lightBodyDisp(13, NAVY), fontStyle: 'italic', textAlign: 'center' },
          { ...lightBodyInput(13), fontStyle: 'italic', textAlign: 'center' }, { multiline: true, rows: 4 })}
        {et('subtitle', slide.subtitle, '\u2014 Attribution', { fontSize: 9, color: '#6B7280', textAlign: 'center', width: '100%' },
          { fontSize: 9, color: '#6B7280', textAlign: 'center', background: 'transparent', border: '1px solid rgba(68,114,232,0.28)', borderRadius: 4, outline: 'none', fontFamily: FONT, width: '100%', boxSizing: 'border-box' as const, padding: '2px 6px' })}
      </div>
    );
  }

  if (v === 'twocol') {
    const colH = H - 12 - 32 - 10 - 14; // canvas height minus padding/title/gap
    return lightWrap(
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
        {et('title', slide.title, 'Slide title\u2026', lightTitleDisp(13), lightTitleInput(13))}
        <div style={{ height: 1, background: '#D1D5DB', flexShrink: 0 }} />
        <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
          {[
            { f: 'body',     val: slide.body,     ph: 'Left column\u2026' },
            { f: 'rightCol', val: slide.rightCol, ph: 'Right column\u2026' },
          ].map(({ f, val, ph }) => (
            <div key={f} style={{ flex: 1, background: '#fff', borderRadius: 6, border: '1px solid #E5E7EB', padding: '8px 10px', overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {et(f, val, ph, { ...lightBodyDisp(9), flex: 1 }, { ...lightBodyInput(9), flex: 1, height: '100%' }, { multiline: true, rows: 7 })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (v === 'image') {
    return lightWrap(
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
        {slide.imageData ? (
          <img src={slide.imageData} alt="" style={{ flex: 1, objectFit: 'contain', borderRadius: 6, minHeight: 0 }} />
        ) : (
          <div style={{ flex: 1, border: '2px dashed #D1D5DB', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', gap: 4 }}>
            <span style={{ fontSize: 22 }}>⌸</span>
            <span style={{ fontSize: 9, color: '#9CA3AF' }}>Upload via the panel →</span>
          </div>
        )}
        {et('title', slide.title, 'Caption (optional)\u2026',
          { fontSize: 10, color: NAVY, flexShrink: 0 },
          { fontSize: 10, color: NAVY, background: 'transparent', border: '1px solid rgba(68,114,232,0.28)', borderRadius: 4, outline: 'none', fontFamily: FONT, width: '100%', boxSizing: 'border-box' as const, padding: '2px 6px', flexShrink: 0 })}
      </div>
    );
  }

  // Blank fallback
  return lightWrap(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {et('title', slide.title, 'Heading (optional)\u2026', lightTitleDisp(), lightTitleInput())}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function QBRDeckBuilder() {
  const {
    rawShipments, filteredStatsRows: statsRows, warehouses, reportingPeriod: contextPeriod,
    clientName: contextClient, clientLogo, priorPeriod, cachedAt, statsLoaded,
    recordDeckExport,
  } = useData();
  const { inventoryData } = usePDF();
  const { log } = useAudit();

  const originZip    = warehouses[0]?.zip?.trim() || '';
  const hasShipping  = rawShipments.length > 0;
  const hasCharged   = rawShipments.some(s => s.totalShippingCharged > 0);
  const hasRateCard  = hasShipping && !!originZip;

  const {
    sections, setSections, availability,
    toggleSection: toggleSectionCtx, setCustomLabel, setSectionLabel,
    setNotes, setInsight, setHidden, setDuplicates,
    customSlides, addCustomSlide, updateCustomSlide, removeCustomSlide,
    setLayout, setRowFilter, setKpiFilter, setContentOffset, setNarrative, setCallout,
    clearDeck, applyTemplate, reorderDeck,
    dataInstances, addDataInstance, updateDataInstance, removeDataInstance,
    execSummary, setExecSummary,
  } = useDeck();

  // ── Hidden snapshot container (960×540, off-screen) ────────────────────
  const snapshotContainerRef = useRef<HTMLDivElement | null>(null);

  // ── Team members (Introductions slide) ─────────────────────────────────
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(
    () => loadBuilderState().teamMembers ?? []
  );
  const [memberSearch, setMemberSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const memberPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const searchRef = useRef<HTMLDivElement>(null);

  const filteredPresets = useMemo(() => {
    const q = memberSearch.toLowerCase().trim();
    if (!q) return TEAM_MEMBER_PRESETS.slice(0, 8);
    return TEAM_MEMBER_PRESETS.filter(p => p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)).slice(0, 10);
  }, [memberSearch]);

  const addFromPreset = useCallback((name: string, title: string) => {
    setTeamMembers(prev => [...prev, { id: crypto.randomUUID(), name, title, photo: undefined, showPhoto: true }]);
    setMemberSearch(''); setSearchOpen(false);
  }, []);
  const addCustomMember = useCallback(() => {
    setTeamMembers(prev => [...prev, { id: crypto.randomUUID(), name: '', title: '', photo: undefined, showPhoto: true }]);
  }, []);
  const updateMember = useCallback((id: string, field: keyof TeamMember, value: string) => {
    setTeamMembers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  }, []);
  const toggleMemberPhoto = useCallback((id: string) => {
    setTeamMembers(prev => prev.map(m => m.id === id ? { ...m, showPhoto: !(m.showPhoto !== false) } : m));
  }, []);
  const removeMember = useCallback((id: string) => {
    setTeamMembers(prev => prev.filter(m => m.id !== id));
  }, []);
  const handleMemberPhoto = useCallback((id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => setTeamMembers(prev => prev.map(m => m.id === id ? { ...m, photo: reader.result as string } : m));
    reader.readAsDataURL(file);
  }, []);

  // ── Deck settings ───────────────────────────────────────────────────────
  const [reportDate, setReportDate]         = useState(() => loadBuilderState().reportDate ?? new Date().toISOString().slice(0, 10));
  const [reportingPeriod, setReportingPeriod] = useState(() => contextPeriod || loadBuilderState().reportingPeriod || '');
  const [clientName, setClientName]         = useState(() => contextClient || loadBuilderState().clientName || '');
  const [selectedFont, setSelectedFont]     = useState<'A' | 'B' | 'C'>(() => loadBuilderState().selectedFont ?? 'B');
  const [deckLogo, setDeckLogo]             = useState<string | undefined>(() => loadBuilderState().deckLogo);
  const [coverPhoto, setCoverPhoto]         = useState<string | undefined>(() => loadBuilderState().coverPhoto);
  const [coverColorScheme, setCoverColorScheme] = useState<CoverColorSchemeId>(() => loadBuilderState().coverColorScheme ?? 'navy');
  const [generateProgress, setGenerateProgress] = useState<string | null>(null);
  const [showPreflight, setShowPreflight]   = useState(false);
  const [showPreview, setShowPreview]       = useState(false);
  const [showTemplates, setShowTemplates]   = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<DeckTemplate[]>(() => loadSavedTemplates());
  const [saveTemplateName, setSaveTemplateName] = useState('');

  // ── Editor state ────────────────────────────────────────────────────────
  const [selectedKey, setSelectedKey]         = useState<string>('cover');
  const [renamingKey, setRenamingKey]         = useState<string | null>(null);
  const [renameValue, setRenameValue]         = useState('');
  const [leftCollapsed, setLeftCollapsed]     = useState(false);
  const [rightCollapsed, setRightCollapsed]   = useState(false);
  const [generatingCallout, setGeneratingCallout] = useState(false);
  const [calloutError, setCalloutError]       = useState<string | null>(null);

  // ── Persist builder state ───────────────────────────────────────────────
  useEffect(() => {
    saveBuilderState({ teamMembers, reportDate, reportingPeriod, clientName, selectedFont, deckLogo, coverPhoto, coverColorScheme });
  }, [teamMembers, reportDate, reportingPeriod, clientName, selectedFont, deckLogo, coverPhoto, coverColorScheme]);

  // ── Drag state ──────────────────────────────────────────────────────────
  const [dragIndex, setDragIndex]   = useState<number | null>(null);
  const [dropIndex, setDropIndex]   = useState<number | null>(null);

  // ── Derived: enabled slides in current order ────────────────────────────
  const enabledSections = useMemo(() =>
    sections.filter(s => s.enabled && availability[s.key].available),
    [sections, availability]
  );

  // Cover + enabled sections + custom slides for display
  const slideList = useMemo((): SlideListItem[] => {
    // Group custom slides by their orderKey
    const customByKey: Record<string, CustomDeckSlide[]> = {};
    for (const cs of customSlides.filter(c => c.enabled)) {
      (customByKey[cs.orderKey] ??= []).push(cs);
    }
    // Group data instances by their orderKey (after:<parentKey>)
    const instancesByKey: Record<string, DataInstanceSlide[]> = {};
    for (const inst of dataInstances) {
      (instancesByKey[inst.orderKey] ??= []).push(inst);
    }

    const result: SlideListItem[] = [
      { id: 'cover', type: 'cover', label: 'Cover Slide', isFixed: true, isHidden: false, duplicates: 0 },
    ];

    // After cover
    for (const cs of customByKey['after:cover'] ?? []) {
      result.push({ id: cs.id, type: 'custom', variant: cs.variant, label: cs.title || 'Untitled', isFixed: false, isHidden: !!cs.hidden, duplicates: cs.duplicates ?? 0 });
    }

    for (const s of enabledSections) {
      result.push({ id: s.key, type: 'data', label: s.customLabel || SECTION_LABELS[s.key], isFixed: false, isHidden: !!s.hidden, duplicates: s.duplicates ?? 0 });
      // Append any data instances ordered after this section
      for (const inst of instancesByKey[`after:${s.key}`] ?? []) {
        result.push({
          id: inst.id, type: 'instance',
          label: inst.customLabel || (SECTION_LABELS[inst.parentKey] + ' (copy)'),
          isFixed: false, isHidden: false, duplicates: 0,
          instanceId: inst.id, parentKey: inst.parentKey,
        });
      }
      for (const cs of customByKey[`after:${s.key}`] ?? []) {
        result.push({ id: cs.id, type: 'custom', variant: cs.variant, label: cs.title || 'Untitled', isFixed: false, isHidden: !!cs.hidden, duplicates: cs.duplicates ?? 0 });
      }
    }

    for (const cs of customByKey['end'] ?? []) {
      result.push({ id: cs.id, type: 'custom', variant: cs.variant, label: cs.title || 'Untitled', isFixed: false, isHidden: !!cs.hidden, duplicates: cs.duplicates ?? 0 });
    }

    return result;
  }, [enabledSections, customSlides, dataInstances]);

  // ── Unified slide reorder ───────────────────────────────────────────────
  const handleSlideReorder = useCallback((fromListIdx: number, toListIdx: number) => {
    if (fromListIdx === toListIdx) return;
    // Work on the draggable subset only (exclude cover and instances)
    const draggable = slideList.filter(s => s.id !== 'cover' && s.type !== 'instance');
    const draggedId = slideList[fromListIdx]?.id;
    const targetId  = slideList[toListIdx]?.id;
    if (!draggedId || !targetId || draggedId === targetId) return;
    const fromF = draggable.findIndex(s => s.id === draggedId);
    const toF   = draggable.findIndex(s => s.id === targetId);
    if (fromF === -1 || toF === -1) return;
    const newDraggable = [...draggable];
    const [moved] = newDraggable.splice(fromF, 1);
    newDraggable.splice(toF, 0, moved);
    reorderDeck(newDraggable.map(s => s.id));
  }, [slideList, reorderDeck]);

  // ── Rename logic ─────────────────────────────────────────────────────────
  const startRename = (key: string, currentLabel: string) => {
    setRenamingKey(key);
    setRenameValue(currentLabel);
  };
  const commitRename = () => {
    if (renamingKey && renamingKey !== 'cover') {
      const trimmed = renameValue.trim();
      // Only rename data slides (custom slides use title field directly)
      const item = slideList.find(s => s.id === renamingKey);
      if (item?.type === 'data') {
        setCustomLabel(renamingKey as DeckSectionKey, trimmed || undefined);
      }
    }
    setRenamingKey(null);
  };

  // ── Data computation (for PPTX generation) ──────────────────────────────
  const kpis = useMemo((): KPISummaryPDF | null => {
    if (!hasShipping) return null;
    const total = rawShipments.reduce((s, r) => s + r.labelCost, 0);
    const totalCharged = rawShipments.reduce((s, r) => s + r.totalShippingCharged, 0);
    const accounts = new Set(rawShipments.map(s => s.customer3pl || '(Unassigned)')).size;
    let zoneSum = 0, zoneCount = 0;
    if (originZip) {
      for (const s of rawShipments) {
        if (s.state) { const z = getZoneFromOriginToState(originZip, s.state); if (z > 0) { zoneSum += z; zoneCount++; } }
      }
    }
    return { totalShipments: rawShipments.length, totalLabelCost: total, totalCharged, uniqueAccounts: accounts, avgLabelCost: rawShipments.length > 0 ? total / rawShipments.length : 0, avgZone: zoneCount > 0 ? zoneSum / zoneCount : null };
  }, [rawShipments, hasShipping, originZip]);

  const customerStats = useMemo((): CustomerStatPDF[] => {
    if (!hasShipping) return [];
    const map = new Map<string, { count: number; totalCost: number; totalCharged: number; totalZone: number; zoneCount: number }>();
    for (const s of rawShipments) {
      const key = s.customer3pl || '(Unassigned)';
      const ex = map.get(key) ?? { count: 0, totalCost: 0, totalCharged: 0, totalZone: 0, zoneCount: 0 };
      const zone = originZip && s.state ? getZoneFromOriginToState(originZip, s.state) : 0;
      map.set(key, { count: ex.count + 1, totalCost: ex.totalCost + s.labelCost, totalCharged: ex.totalCharged + s.totalShippingCharged, totalZone: ex.totalZone + (zone > 0 ? zone : 0), zoneCount: ex.zoneCount + (zone > 0 ? 1 : 0) });
    }
    const total = rawShipments.length;
    return [...map.entries()].map(([customer, v]) => ({ customer, orderCount: v.count, volumePercent: total > 0 ? (v.count / total) * 100 : 0, avgShippingCost: v.count > 0 ? v.totalCost / v.count : 0, avgOrderValue: v.count > 0 ? v.totalCharged / v.count : 0, avgZone: v.zoneCount > 0 ? v.totalZone / v.zoneCount : 0 })).sort((a, b) => b.orderCount - a.orderCount);
  }, [rawShipments, hasShipping, originZip]);

  const costGapRows = useMemo((): CostGapRowPDF[] => {
    if (!hasCharged) return [];
    return customerStats.filter(c => c.avgOrderValue > 0).map(c => ({ name: c.customer, labelCost: c.avgShippingCost, totalCharged: c.avgOrderValue, gap: c.avgOrderValue - c.avgShippingCost, gapPct: c.avgShippingCost > 0 ? ((c.avgOrderValue - c.avgShippingCost) / c.avgShippingCost) * 100 : 0, shipments: c.orderCount }));
  }, [customerStats, hasCharged]);

  const carrierMix = useMemo((): CarrierMixRowPDF[] => {
    if (!hasShipping) return [];
    const map = new Map<string, { count: number; totalCost: number }>();
    for (const s of rawShipments) { const key = s.carrier || s.shippingMethod || 'Unknown'; const ex = map.get(key) ?? { count: 0, totalCost: 0 }; map.set(key, { count: ex.count + 1, totalCost: ex.totalCost + s.labelCost }); }
    const total = rawShipments.length;
    return [...map.entries()].map(([carrier, v]) => ({ carrier, shipments: v.count, pctOfTotal: total > 0 ? (v.count / total) * 100 : 0, avgCost: v.count > 0 ? v.totalCost / v.count : 0 })).sort((a, b) => b.shipments - a.shipments);
  }, [rawShipments, hasShipping]);

  const zoneComparisons = useMemo((): ZoneComparisonPDF[] => {
    if (!hasRateCard) return [];
    const counts: Partial<Record<ServiceKey, number>> = {};
    for (const s of rawShipments) { const key = inferServiceKey(s.shippingMethod); if (key) counts[key] = (counts[key] ?? 0) + 1; }
    let bestService: ServiceKey | null = null, bestCount = 0;
    for (const [k, c] of Object.entries(counts) as [ServiceKey, number][]) { if (c > bestCount) { bestService = k; bestCount = c; } }
    if (!bestService) return [];
    const table = SERVICE_TABLES[bestService];
    const zoneMap = new Map<number, { count: number; rateTotal: number; actualTotal: number }>();
    for (const s of rawShipments) {
      if (!s.state || s.weight <= 0) continue;
      const zone = getZoneFromOriginToState(originZip, s.state);
      if (zone < 1 || zone > 8) continue;
      const mrcRate = lookupMrcRate(table, s.weight, zone);
      if (mrcRate === null) continue;
      const ex = zoneMap.get(zone) ?? { count: 0, rateTotal: 0, actualTotal: 0 };
      zoneMap.set(zone, { count: ex.count + 1, rateTotal: ex.rateTotal + mrcRate, actualTotal: ex.actualTotal + s.labelCost });
    }
    return [...zoneMap.entries()].map(([zone, v]) => { const rateCardAvg = v.count > 0 ? v.rateTotal / v.count : 0; const actualAvg = v.count > 0 ? v.actualTotal / v.count : 0; const delta = actualAvg - rateCardAvg; return { zone, shipmentCount: v.count, rateCardAvg, actualAvg, delta, deltaPercent: rateCardAvg > 0 ? (delta / rateCardAvg) * 100 : 0 }; }).sort((a, b) => a.zone - b.zone);
  }, [rawShipments, hasRateCard, originZip]);

  const autoActions = useMemo(() => generateRecommendedActions(rawShipments, undefined, undefined), [rawShipments]);

  // ── Live preview data base (displayActions added after declaration below) ──
  const ACTIONS_STORAGE_KEY = 'shiphero_builder_actions_v1';
  const [editedActions, setEditedActions] = useState<RecommendedAction[] | null>(() => {
    try {
      const raw = localStorage.getItem('shiphero_builder_actions_v1');
      return raw ? (JSON.parse(raw) as RecommendedAction[]) : null;
    } catch { return null; }
  });
  const displayActions = editedActions ?? autoActions;

  // Persist edits immediately — a null means "use auto-generated" (clear persisted)
  useEffect(() => {
    try {
      if (editedActions !== null) {
        localStorage.setItem(ACTIONS_STORAGE_KEY, JSON.stringify(editedActions));
      } else {
        localStorage.removeItem(ACTIONS_STORAGE_KEY);
      }
    } catch { /* quota exceeded — ignore */ }
  }, [editedActions]);

  const updateAction = useCallback((id: string, field: 'title' | 'body', value: string) => {
    setEditedActions(prev => (prev ?? autoActions).map(a => a.id === id ? { ...a, [field]: value, edited: true } : a));
  }, [autoActions]);

  const removeAction = useCallback((id: string) => {
    setEditedActions(prev => (prev ?? autoActions).filter(a => a.id !== id));
  }, [autoActions]);

  const addAction = useCallback(() => {
    setEditedActions(prev => [...(prev ?? autoActions), {
      id: crypto.randomUUID(), category: 'general' as const, priority: 'medium' as const, title: 'New action item', body: '', edited: true,
    }]);
  }, [autoActions]);

  // ── Live preview data bundle ─────────────────────────────────────────────
  const previewData = useMemo((): SlidePreviewData => ({
    kpis, customerStats, costGapRows, carrierMix, zoneComparisons,
    statsRows, inventoryData, displayActions,
    enabledSections: sections, rawShipments, priorPeriod,
  }), [kpis, customerStats, costGapRows, carrierMix, zoneComparisons, statsRows, inventoryData, displayActions, sections, rawShipments, priorPeriod]);

  // ── Available rows for row filter (works for data AND instance slides) ───
  const availableRows = useMemo((): string[] => {
    // For instances use the parent section key; for data slides use the key itself
    const instParent = dataInstances.find(inst => inst.id === selectedKey)?.parentKey;
    const effKey = instParent ?? selectedKey;
    if (!effKey || !ROW_FILTER_SLIDES.has(effKey)) return [];
    if (effKey === 'costGap' || effKey === 'accountDetailTable')
      return costGapRows.map(r => r.name);
    if (effKey === 'carrierMix' || effKey === 'labelCostByCarrier')
      return carrierMix.map(r => r.carrier);
    if (effKey === 'shipmentsByState')
      return [...new Set(rawShipments.map(s => s.state).filter(Boolean))].sort() as string[];
    if (effKey === 'childAccountScorecard' || effKey === 'childAccountTrends')
      return [...new Set(statsRows.map(r => r.accountName || r.accountId).filter(Boolean))].sort();
    if (effKey === 'serviceLevelMix')
      return [...new Set(rawShipments.map(s => s.shippingMethod || 'Unknown').filter(Boolean))].sort();
    return [];
  }, [selectedKey, dataInstances, costGapRows, carrierMix, rawShipments, statsRows]);

  // ── Pre-flight checks ────────────────────────────────────────────────────
  type PreflightLevel = 'pass' | 'warn' | 'fail';
  interface PreflightCheck { label: string; level: PreflightLevel; detail: string; }

  const STATS_SECTION_KEYS: Set<string> = new Set([
    'volumeTrend', 'childAccountTrends', 'carrierSpendGMV', 'fulfillmentMix',
    'childAccountScorecard', 'accountHealthKPIs',
  ]);
  const PRIOR_SECTION_KEYS: Set<string> = new Set([
    'priorQuarterKPIs', 'priorQuarterCarrierMix',
  ]);

  const preflightChecks = useMemo((): PreflightCheck[] => {
    const activeSections = sections.filter(s => s.enabled && !s.hidden);
    const checks: PreflightCheck[] = [];

    // 1. Shipments data (hard fail if none)
    if (!hasShipping) {
      checks.push({ label: 'Shipments data', level: 'fail', detail: 'No shipments CSV loaded — upload one on the Setup tab before generating.' });
    } else {
      checks.push({ label: 'Shipments data', level: 'pass', detail: `${rawShipments.length.toLocaleString()} shipments loaded.` });
    }

    // 2. Stats data (warn if stats slides are enabled but no stats)
    const statsEnabled = activeSections.some(s => STATS_SECTION_KEYS.has(s.key));
    if (statsEnabled && !statsLoaded) {
      checks.push({ label: 'Monthly statistics', level: 'warn', detail: 'Account Health slides are enabled but no Statistics CSV is loaded. Those slides will be skipped.' });
    } else if (statsEnabled) {
      checks.push({ label: 'Monthly statistics', level: 'pass', detail: 'Statistics data loaded.' });
    }

    // 3. Prior-quarter data (warn if prior slides are enabled but no prior data)
    const priorEnabled = activeSections.some(s => PRIOR_SECTION_KEYS.has(s.key));
    if (priorEnabled && !priorPeriod) {
      checks.push({ label: 'Prior-quarter data', level: 'warn', detail: 'Prior-quarter slides are enabled but no prior-period CSV is loaded. Those slides will be skipped.' });
    } else if (priorEnabled) {
      checks.push({ label: 'Prior-quarter data', level: 'pass', detail: 'Prior-quarter data loaded.' });
    }

    // 4. Data freshness (warn if shipments data is > 14 days old)
    if (cachedAt) {
      const ageMs = Date.now() - new Date(cachedAt).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      if (ageDays > 14) {
        checks.push({ label: 'Data freshness', level: 'warn', detail: `Shipments data is ${ageDays} days old. Consider re-importing for the most accurate QBR.` });
      }
    }

    return checks;
  }, [sections, hasShipping, rawShipments.length, statsLoaded, priorPeriod, cachedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const preflightHasFail = preflightChecks.some(c => c.level === 'fail');
  const preflightHasWarn = preflightChecks.some(c => c.level === 'warn');
  const preflightHasIssues = preflightHasFail || preflightHasWarn;

  // ── Generate PPTX (inner — called after pre-flight clears) ───────────────
  const doGenerate = useCallback(async () => {
    setShowPreflight(false);
    setGenerateProgress('Preparing…');
    try {
      const formattedDate = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // ── Capture chart snapshots for all enabled data sections ─────────────
      // Structural slides (cover, agenda, intro, etc.) don't need snapshots.
      const SKIP_SNAPSHOT: Set<DeckSectionKey> = new Set(['agenda', 'introductions', 'recommendedActions', 'zoneMap', 'warehouseInsights', 'shipmentsByState']);
      const activeSections = sections.filter(s => s.enabled && !s.hidden);
      const snapshots: Record<string, string> = {};

      const snapshotTargets = activeSections.filter(s => !SKIP_SNAPSHOT.has(s.key));
      for (let i = 0; i < snapshotTargets.length; i++) {
        const sec = snapshotTargets[i];
        setGenerateProgress(`Capturing slide ${i + 1} of ${snapshotTargets.length}: ${sec.customLabel || SECTION_LABELS[sec.key]}`);
        try {
          const png = await snapshotSection(sec.key, sec.customLabel || SECTION_LABELS[sec.key], previewData, snapshotContainerRef);
          if (png && !isBlankSnapshot(png)) {
            snapshots[sec.key] = png;
          } else if (png) {
            console.warn(`[QBR] Blank snapshot captured for "${sec.key}" — will fall back to data-driven render`);
          }
        } catch { /* ignore individual snapshot failures */ }
      }

      // Apply snapshots to sections
      const sectionsWithSnapshots = sections.map(s =>
        snapshots[s.key] ? { ...s, snapshot: snapshots[s.key] } : s
      );

      // Capture snapshots for data instances too
      const instancesWithSnapshots: DataInstanceSlide[] = await Promise.all(
        dataInstances.map(async inst => {
          if (SKIP_SNAPSHOT.has(inst.parentKey)) return inst;
          try {
            // Apply rowFilter to previewData before snapshotting
            const instData = inst.rowFilter?.length
              ? filterPreviewData(previewData, inst.parentKey, inst.rowFilter)
              : previewData;
            const png = await snapshotSection(inst.parentKey, inst.customLabel || SECTION_LABELS[inst.parentKey], instData, snapshotContainerRef);
            if (png && !isBlankSnapshot(png)) return { ...inst, snapshot: png };
            if (png) console.warn(`[QBR] Blank snapshot for instance "${inst.customLabel || inst.parentKey}" — omitting`);
          } catch { /* ignore */ }
          return inst;
        })
      );

      const docProps: QBRDeckDocumentProps = {
        clientName: clientName || 'Client', reportDate: formattedDate,
        reportingPeriod: reportingPeriod || undefined,
        clientLogo: deckLogo || clientLogo || undefined,
        coverPhoto: coverPhoto || undefined,
        coverColorScheme: coverColorScheme !== 'navy' ? coverColorScheme : undefined,
        enabledSections: sectionsWithSnapshots, teamMembers, kpis, customerStats, costGapRows, carrierMix,
        zoneComparisons, inventoryData, recommendedActions: displayActions.length > 0 ? displayActions : undefined,
        fontOption: selectedFont, statsRows: statsRows.length > 0 ? statsRows : undefined,
        customSlides: customSlides.length > 0 ? customSlides : undefined,
        dataInstances: instancesWithSnapshots.length > 0 ? instancesWithSnapshots : undefined,
        priorPeriod: priorPeriod ?? undefined,
      };
      const blob = await generateQBRDeck(docProps, msg => setGenerateProgress(msg));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `ShipHero_QBR_Deck_${(clientName || 'Client').replace(/\s+/g, '_')}_${reportDate}.pptx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      const enabledSlideCount = sections.filter(s => s.enabled && !s.hidden).length;
      log('deck_export', { client: clientName, period: reportingPeriod, slides: enabledSlideCount });
      recordDeckExport(enabledSlideCount);
    } catch (err) {
      console.error('Deck generation failed:', err);
      alert('Failed to generate deck. Please try again.');
    } finally { setGenerateProgress(null); }
  }, [clientName, reportDate, reportingPeriod, sections, teamMembers, kpis, customerStats, costGapRows, carrierMix, zoneComparisons, inventoryData, displayActions, log, clientLogo, deckLogo, coverPhoto, selectedFont, statsRows, customSlides, previewData, dataInstances, recordDeckExport]);

  // ── Outer generate handler — shows pre-flight modal if needed ────────────
  const handleGenerate = useCallback(() => {
    if (preflightHasIssues) {
      setShowPreflight(true);
    } else {
      doGenerate();
    }
  }, [preflightHasIssues, doGenerate]);

  // Count only visible (non-hidden) slides + their duplicates for header stats
  const slideCount = slideList.reduce((n, s) => s.isHidden ? n : n + 1 + s.duplicates, 0);
  const readMin    = Math.ceil(slideCount * 0.75);

  // ── Selected slide data ──────────────────────────────────────────────────
  const selectedSlideItem  = slideList.find(s => s.id === selectedKey);
  const selectedSection    = selectedSlideItem?.type === 'data' ? sections.find(s => s.key === selectedKey) : null;
  const selectedInstance   = selectedSlideItem?.type === 'instance' ? dataInstances.find(inst => inst.id === selectedKey) : null;
  const selectedCustom     = selectedSlideItem?.type === 'custom' ? customSlides.find(c => c.id === selectedKey) : null;
  /** Effective section key — for instances, use parentKey for data/meta lookups */
  const effectiveSectionKey = (selectedInstance?.parentKey ?? selectedKey) as DeckSectionKey;
  const selectedLabel     = selectedSlideItem?.type === 'cover' ? 'Cover Slide'
    : selectedSlideItem?.type === 'custom' ? (selectedCustom?.title || 'Untitled')
    : selectedSlideItem?.type === 'instance' ? (selectedInstance?.customLabel || (SECTION_LABELS[effectiveSectionKey] + ' (copy)'))
    : (selectedSection?.customLabel || SECTION_LABELS[selectedKey as DeckSectionKey] || selectedKey);
  const selectedMeta       = (selectedSlideItem?.type === 'data' || selectedSlideItem?.type === 'instance')
    ? SECTION_META[effectiveSectionKey] : null;
  const selectedInsight    = selectedInstance?.insight ?? selectedSection?.insight;
  const hasInsight         = !!(selectedInsight?.whatHappening && selectedInsight?.whyMatters && selectedInsight?.action);
  const isStructural       = selectedKey === 'cover' || STRUCTURAL.has(selectedKey as DeckSectionKey);
  const selectedIsHidden   = selectedSlideItem?.type === 'custom' ? !!selectedCustom?.hidden : !!selectedSection?.hidden;
  const selectedDuplicates = selectedSlideItem?.type === 'custom' ? (selectedCustom?.duplicates ?? 0) : (selectedSection?.duplicates ?? 0);

  // ── Computed filtered previewData for instance preview ──────────────────
  const instancePreviewData = useMemo((): SlidePreviewData => {
    if (!selectedInstance) return previewData;
    return filterPreviewData(previewData, selectedInstance.parentKey, selectedInstance.rowFilter);
  }, [selectedInstance, previewData]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: FONT, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F0F1F3' }}>

      {/* ── Hidden snapshot container (off-screen, 960×540 for html2canvas) ── */}
      <div
        ref={snapshotContainerRef}
        style={{
          position: 'fixed', left: -9999, top: 0,
          width: 960, height: 540,
          overflow: 'hidden', pointerEvents: 'none',
          background: '#EDEEF2', zIndex: -1,
        }}
      />

      {/* ── Top header bar ───────────────────────────────────────────────── */}
      <div style={{ background: NAVY, padding: '14px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', lineHeight: 1.2 }}>QBR Deck Builder</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>{slideCount} slides · ~{readMin} min read · 16:9 PPTX</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowTemplates(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
              Templates
            </button>
            <button
              onClick={() => setShowPreview(true)}
              disabled={!hasShipping}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: !hasShipping ? '#64748B' : '#fff', fontWeight: 600, fontSize: 12, cursor: !hasShipping ? 'not-allowed' : 'pointer', fontFamily: FONT }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              Preview
            </button>
            <button
              onClick={handleGenerate}
              disabled={!hasShipping || !!generateProgress}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, border: 'none', background: !hasShipping ? '#374151' : ORANGE, color: !hasShipping ? '#64748B' : '#fff', fontWeight: 700, fontSize: 12, cursor: (!hasShipping || !!generateProgress) ? 'not-allowed' : 'pointer', fontFamily: FONT, maxWidth: 340, overflow: 'hidden' }}
            >
              {generateProgress ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {generateProgress ?? 'Download PPTX'}
              </span>
            </button>
          </div>
        </div>

        {/* Client / Date / Period row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {([
            { label: 'CLIENT NAME',      value: clientName,       onChange: setClientName,       type: 'text', placeholder: 'e.g. Acme Corp' },
            { label: 'REPORT DATE',      value: reportDate,       onChange: setReportDate,       type: 'date', placeholder: '' },
            { label: 'REPORTING PERIOD', value: reportingPeriod,  onChange: setReportingPeriod,  type: 'text', placeholder: 'e.g. Q2 2026' },
          ] as const).map(({ label, value, onChange, type, placeholder }) => (
            <div key={label}>
              <label style={{ display: 'block', fontSize: 9, fontWeight: 700, color: '#64748B', marginBottom: 3, letterSpacing: '0.08em' }}>{label}</label>
              <input
                type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                style={{ width: '100%', padding: '6px 9px', borderRadius: 7, fontSize: 12, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', color: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: FONT, colorScheme: 'dark' }}
              />
            </div>
          ))}
        </div>

        <div style={{ height: 2, background: `linear-gradient(90deg, ${ORANGE} 0%, ${BLUE} 100%)`, marginLeft: -20, marginRight: -20, marginTop: 14 }} />
      </div>

      {/* ── Main editor area ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left panel: Slide strip (collapsible) ──────────────────────── */}
        {leftCollapsed ? (
          <div style={{ width: 36, background: '#1E2837', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, gap: 10 }}>
            <button
              onClick={() => setLeftCollapsed(false)}
              title="Expand slides panel"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#475569', writingMode: 'vertical-rl', textTransform: 'uppercase', letterSpacing: '0.1em', transform: 'rotate(180deg)' }}>
              {slideList.length} slides
            </div>
          </div>
        ) : (
        <div style={{ width: 220, background: '#1E2837', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Slides ({slideList.length})</span>
            <button
              onClick={() => setLeftCollapsed(true)}
              title="Collapse slides panel"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          </div>

          {/* Unavailable-but-enabled warning */}
          {(() => {
            const unavailable = sections.filter(
              s => s.enabled && !availability[s.key].available
            );
            if (!unavailable.length) return null;
            return (
              <div style={{
                margin: '4px 8px 0',
                padding: '7px 10px',
                borderRadius: 7,
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.3)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 7,
              }}>
                <svg style={{ flexShrink: 0, marginTop: 1 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div style={{ fontSize: 10, color: '#92400E', lineHeight: 1.4 }}>
                  <strong>{unavailable.length} slide{unavailable.length > 1 ? 's' : ''} skipped — missing data:</strong>
                  {unavailable.map(s => (
                    <div key={s.key} style={{ marginTop: 2, opacity: 0.85 }}>
                      · {SECTION_LABELS[s.key]}: <span style={{ fontStyle: 'italic' }}>{availability[s.key].reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Slide cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px', minHeight: 0 }}>
            {slideList.map((slide, listIdx) => {
              const isDataSlide  = slide.type === 'data';
              const isDraggable  = !slide.isFixed && slide.type !== 'instance';
              const isDragging   = dragIndex === listIdx;
              const isDropTarget = dropIndex === listIdx && dragIndex !== null && dragIndex !== listIdx;
              const isSelected   = selectedKey === slide.id;

              return (
                <div
                  key={slide.id}
                  draggable={isDraggable}
                  onDragStart={e => { if (isDraggable) { setDragIndex(listIdx); e.dataTransfer.effectAllowed = 'move'; } }}
                  onDragOver={e => { if (dragIndex !== null && listIdx !== dragIndex && listIdx > 0) { e.preventDefault(); setDropIndex(listIdx); } }}
                  onDragLeave={() => setDropIndex(null)}
                  onDrop={e => { e.preventDefault(); if (dragIndex !== null) { handleSlideReorder(dragIndex, listIdx); } setDragIndex(null); setDropIndex(null); }}
                  onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                  onClick={() => setSelectedKey(slide.id)}
                  style={{
                    marginBottom: 6, borderRadius: 8, cursor: slide.isFixed ? 'pointer' : (isDraggable ? 'grab' : 'default'),
                    border: isSelected
                      ? `2px solid ${ORANGE}`
                      : isDropTarget
                        ? `2px dashed ${BLUE}`
                        : '2px solid transparent',
                    background: isSelected ? 'rgba(239,82,82,0.08)' : isDragging ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.03)',
                    opacity: isDragging ? 0.4 : slide.isHidden ? 0.45 : 1,
                    transition: 'border-color 0.1s, background 0.1s',
                    padding: 6,
                    userSelect: 'none',
                  }}
                >
                  {/* Thumbnail + info row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    {/* Drag handle */}
                    {isDraggable ? (
                      <div style={{ color: '#475569', fontSize: 10, paddingTop: 3, cursor: 'grab', flexShrink: 0 }}>⠿</div>
                    ) : (
                      <div style={{ width: 10, flexShrink: 0 }} />
                    )}

                    {/* Thumbnail */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      {(slide.type === 'data' || slide.type === 'instance') ? (
                        <ScaledSlidePreview
                          sectionKey={(slide.type === 'instance' ? slide.parentKey! : slide.id) as DeckSectionKey}
                          label={slide.label}
                          data={slide.type === 'instance'
                            ? filterPreviewData(previewData, slide.parentKey!, dataInstances.find(i => i.id === slide.id)?.rowFilter)
                            : previewData}
                          displayWidth={160}
                        />
                      ) : (
                        <SlideThumbnail
                          sectionKey={slide.id}
                          size="sm"
                          customType={slide.type as 'cover' | 'custom'}
                          customVariant={slide.variant}
                          coverPhotoUrl={slide.id === 'cover' ? coverPhoto : undefined}
                          logoUrl={slide.id === 'cover' ? (deckLogo || clientLogo || undefined) : undefined}
                          coverBg={COVER_COLOR_SCHEMES.find(s => s.id === coverColorScheme)?.bg}
                          coverAccent={COVER_COLOR_SCHEMES.find(s => s.id === coverColorScheme)?.accent}
                        />
                      )}
                      {/* Hidden overlay */}
                      {slide.isHidden && (
                        <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(30,40,55,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        </div>
                      )}
                      {/* Duplicate badge */}
                      {slide.duplicates > 0 && (
                        <div style={{ position: 'absolute', bottom: 2, right: 2, background: BLUE, color: '#fff', fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 4px', lineHeight: 1.4 }}>
                          ×{slide.duplicates + 1}
                        </div>
                      )}
                    </div>

                    {/* Slide info */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                      {/* Slide number + completion dot */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#475569', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '1px 4px' }}>{listIdx + 1}</span>
                        <CompletionDot sectionKey={slide.id} sections={sections} itemType={slide.type === 'instance' ? 'data' : slide.type} />
                        {slide.isHidden && (
                          <span style={{ fontSize: 8, fontWeight: 600, color: '#475569', background: 'rgba(71,85,105,0.2)', borderRadius: 3, padding: '1px 4px' }}>HIDDEN</span>
                        )}
                        {slide.type === 'custom' && (
                          <span style={{ fontSize: 8, fontWeight: 600, color: '#6366F1', background: 'rgba(99,102,241,0.12)', borderRadius: 3, padding: '1px 4px' }}>
                            {{ divider: 'DIVIDER', text: 'TEXT', qa: 'Q&A', thankyou: 'THANK YOU', quote: 'QUOTE', twocol: '2-COL', image: 'IMAGE', blank: 'BLANK' }[slide.variant ?? 'text'] ?? 'CUSTOM'}
                          </span>
                        )}
                      </div>

                      {/* Name */}
                      <div
                        title={slide.isFixed ? undefined : 'Double-click to rename'}
                        onDoubleClick={e => { e.stopPropagation(); if (!slide.isFixed && isDataSlide) startRename(slide.id, slide.label); }}
                        style={{ fontSize: 11, fontWeight: 600, color: slide.isHidden ? '#475569' : renamingKey === slide.id ? BLUE : (isDataSlide && selectedSection?.customLabel ? BLUE : '#CBD5E1'), overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.3 }}
                      >
                        {renamingKey === slide.id ? renameValue || slide.label : slide.label}
                      </div>
                    </div>
                  </div>

                  {/* Actions row (shown for non-fixed selected slides) */}
                  {!slide.isFixed && isSelected && (
                    <div style={{ marginTop: 5, display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                      {/* Duplicate button — only for data slides */}
                      {slide.type === 'data' && (
                        <button
                          title="Add a copy with its own filter/narrative"
                          onClick={e => {
                            e.stopPropagation();
                            const inst = addDataInstance(slide.id as DeckSectionKey);
                            setSelectedKey(inst.id);
                          }}
                          style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(68,114,232,0.3)', background: 'rgba(68,114,232,0.08)', color: BLUE, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                        >
                          + Copy
                        </button>
                      )}
                      {slide.type === 'instance' ? (
                        <button
                          onClick={e => { e.stopPropagation(); removeDataInstance(slide.id); setSelectedKey('cover'); }}
                          style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                        >
                          Remove
                        </button>
                      ) : slide.type === 'custom' ? (
                        <button
                          onClick={e => { e.stopPropagation(); removeCustomSlide(slide.id); setSelectedKey('cover'); }}
                          style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); toggleSectionCtx(slide.id as DeckSectionKey); setSelectedKey('cover'); }}
                          style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )} {/* end left panel */}

        {/* ── Center: Slide canvas + editors ─────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F0F1F3' }}>
          {slideList.length === 1 ? (
            /* Empty state */
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40 }}>
              <div style={{ fontSize: 40 }}>🎞️</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Your deck only has the cover slide</div>
              <div style={{ fontSize: 13, color: '#6B7280', textAlign: 'center', maxWidth: 360 }}>
                Go to the Data tabs to write insights and add slides, or click <strong>+ Add</strong> in the slide strip to browse all available slides.
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
              {/* ── Slide preview ── */}
              <div style={{ display: 'flex', gap: 24, marginBottom: 24, alignItems: 'flex-start' }}>
                {selectedSlideItem?.type === 'data' ? (
                  <LiveSlidePreview
                    sectionKey={selectedKey as DeckSectionKey}
                    label={selectedLabel}
                    sectionLabel={selectedSection?.sectionLabel}
                    data={previewData}
                    contentOffset={selectedSection?.contentOffset}
                    onOffsetChange={(offset) => setContentOffset(selectedKey as DeckSectionKey, offset)}
                    callout={selectedSection?.callout}
                    kpiFilter={selectedSection?.kpiFilter}
                    width={480}
                  />
                ) : selectedSlideItem?.type === 'instance' && selectedInstance ? (
                  <LiveSlidePreview
                    sectionKey={effectiveSectionKey}
                    label={selectedLabel}
                    sectionLabel={undefined}
                    data={instancePreviewData}
                    contentOffset={undefined}
                    onOffsetChange={undefined}
                    callout={selectedInstance.insight ? undefined : undefined}
                    width={480}
                  />
                ) : selectedSlideItem?.type === 'custom' && selectedCustom ? (
                  <EditableCustomSlide
                    slide={selectedCustom}
                    onUpdate={patch => updateCustomSlide(selectedCustom.id, patch)}
                  />
                ) : (
                  <SlideThumbnail
                    sectionKey={selectedKey}
                    size="lg"
                    customType={selectedSlideItem?.type === 'instance' ? 'data' : selectedSlideItem?.type as 'cover' | 'data' | 'custom' | undefined}
                    customVariant={selectedSlideItem?.variant}
                    coverPhotoUrl={selectedKey === 'cover' ? coverPhoto : undefined}
                    logoUrl={selectedKey === 'cover' ? (deckLogo || clientLogo || undefined) : undefined}
                    coverBg={COVER_COLOR_SCHEMES.find(s => s.id === coverColorScheme)?.bg}
                    coverAccent={COVER_COLOR_SCHEMES.find(s => s.id === coverColorScheme)?.accent}
                  />
                )}

                {/* Right meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Slide name / rename */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {renamingKey === selectedKey && (selectedSlideItem?.type === 'data' || selectedSlideItem?.type === 'instance') ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => {
                          const trimmed = renameValue.trim();
                          if (selectedSlideItem?.type === 'instance' && selectedInstance) {
                            updateDataInstance(selectedInstance.id, { customLabel: trimmed || undefined });
                          } else {
                            commitRename();
                          }
                          setRenamingKey(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenamingKey(null);
                        }}
                        style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: `2px solid ${BLUE}`, fontSize: 18, fontWeight: 700, color: NAVY, background: '#fff', outline: 'none', fontFamily: FONT }}
                      />
                    ) : (
                      <>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: 0, flex: 1 }}>
                          {selectedLabel}
                          {selectedSlideItem?.type === 'instance' && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: BLUE, background: 'rgba(68,114,232,0.1)', borderRadius: 4, padding: '2px 7px', marginLeft: 8, verticalAlign: 'middle' }}>COPY</span>
                          )}
                        </h2>
                        {selectedKey !== 'cover' && (selectedSlideItem?.type === 'data' || selectedSlideItem?.type === 'instance') && (
                          <button
                            onClick={() => startRename(selectedKey, selectedLabel)}
                            title="Rename slide"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: '1.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            Rename
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Subtitle */}
                  {selectedMeta && (
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>{selectedMeta.sub}</div>
                  )}

                  {/* Completion badge + slide operations */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    {!isStructural && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: hasInsight ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${hasInsight ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: hasInsight ? '#22C55E' : '#F59E0B' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: hasInsight ? '#15803D' : '#92400E' }}>
                          {hasInsight ? 'Story written' : 'Story missing'}
                        </span>
                      </div>
                    )}
                    {selectedKey !== 'cover' && (
                      <>
                        {/* Hide / Show */}
                        <button
                          onClick={() => {
                            if (selectedSlideItem?.type === 'custom') {
                              updateCustomSlide(selectedKey, { hidden: !selectedIsHidden });
                            } else {
                              setHidden(selectedKey as DeckSectionKey, !selectedIsHidden);
                            }
                          }}
                          title={selectedIsHidden ? 'Show slide in export' : 'Hide slide from export'}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, border: `1px solid ${selectedIsHidden ? 'rgba(71,85,105,0.4)' : '#E5E7EB'}`, background: selectedIsHidden ? 'rgba(71,85,105,0.12)' : '#fff', color: selectedIsHidden ? '#94A3B8' : '#6B7280', fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}
                        >
                          {selectedIsHidden ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                              <line x1="1" y1="1" x2="23" y2="23"/>
                            </svg>
                          )}
                          {selectedIsHidden ? 'Show' : 'Hide'}
                        </button>
                        {/* Duplicate */}
                        {selectedDuplicates === 0 ? (
                          <button
                            onClick={() => {
                              if (selectedSlideItem?.type === 'custom') {
                                updateCustomSlide(selectedKey, { duplicates: 1 });
                              } else {
                                setDuplicates(selectedKey as DeckSectionKey, 1);
                              }
                            }}
                            title="Add a duplicate of this slide to the export"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            Duplicate
                          </button>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: 'rgba(68,114,232,0.08)', border: '1px solid rgba(68,114,232,0.25)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: BLUE }}>×{selectedDuplicates + 1} copies</span>
                            <button
                              onClick={() => {
                                if (selectedSlideItem?.type === 'custom') {
                                  updateCustomSlide(selectedKey, { duplicates: selectedDuplicates - 1 });
                                } else {
                                  setDuplicates(selectedKey as DeckSectionKey, selectedDuplicates - 1);
                                }
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 14, lineHeight: 1, padding: '0 2px', fontFamily: FONT }}
                              title="Remove one copy"
                            >×</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Custom slide content editor ── */}
              {selectedSlideItem?.type === 'custom' && selectedCustom && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Slide Content</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* Title — all variants except quote (which uses body as the main text) */}
                    {selectedCustom.variant !== 'quote' && (
                      <CfField label={selectedCustom.variant === 'image' ? 'Caption (optional)' : selectedCustom.variant === 'blank' ? 'Heading (optional)' : 'Title'}>
                        <input value={selectedCustom.title}
                          onChange={e => updateCustomSlide(selectedCustom.id, { title: e.target.value })}
                          placeholder={selectedCustom.variant === 'qa' ? 'Q&A' : selectedCustom.variant === 'thankyou' ? 'Thank You' : selectedCustom.variant === 'divider' ? 'Section name\u2026' : 'Slide title\u2026'}
                          style={CF_INPUT} />
                      </CfField>
                    )}

                    {/* Subtitle — divider, qa */}
                    {(selectedCustom.variant === 'divider' || selectedCustom.variant === 'qa') && (
                      <CfField label="Subtitle (optional)">
                        <input value={selectedCustom.subtitle ?? ''}
                          onChange={e => updateCustomSlide(selectedCustom.id, { subtitle: e.target.value || undefined })}
                          placeholder={selectedCustom.variant === 'qa' ? 'We\u2019d love to hear from you' : 'Subtitle line below title\u2026'}
                          style={CF_INPUT} />
                      </CfField>
                    )}

                    {/* Body — text, thankyou */}
                    {(selectedCustom.variant === 'text' || selectedCustom.variant === 'thankyou') && (
                      <CfField label={selectedCustom.variant === 'thankyou' ? 'Next Steps (one per line)' : 'Body Text'}>
                        <textarea value={selectedCustom.body ?? ''}
                          onChange={e => updateCustomSlide(selectedCustom.id, { body: e.target.value || undefined })}
                          rows={selectedCustom.variant === 'thankyou' ? 4 : 6}
                          placeholder={selectedCustom.variant === 'thankyou' ? 'Schedule follow-up call\nSend rate card proposal\u2026' : 'Slide body text\u2026'}
                          style={CF_TA} />
                      </CfField>
                    )}

                    {/* Quote — quote text + attribution */}
                    {selectedCustom.variant === 'quote' && (
                      <>
                        <CfField label="Quote Text">
                          <textarea value={selectedCustom.body ?? ''}
                            onChange={e => updateCustomSlide(selectedCustom.id, { body: e.target.value || undefined })}
                            rows={4} placeholder="Enter the quote or callout text\u2026" style={CF_TA} />
                        </CfField>
                        <CfField label="Attribution (optional)">
                          <input value={selectedCustom.subtitle ?? ''}
                            onChange={e => updateCustomSlide(selectedCustom.id, { subtitle: e.target.value || undefined })}
                            placeholder="CEO, Acme Corp" style={CF_INPUT} />
                        </CfField>
                      </>
                    )}

                    {/* Two columns */}
                    {selectedCustom.variant === 'twocol' && (
                      <>
                        <CfField label="Left Column">
                          <textarea value={selectedCustom.body ?? ''}
                            onChange={e => updateCustomSlide(selectedCustom.id, { body: e.target.value || undefined })}
                            rows={5} placeholder="Left column content\u2026" style={CF_TA} />
                        </CfField>
                        <CfField label="Right Column">
                          <textarea value={selectedCustom.rightCol ?? ''}
                            onChange={e => updateCustomSlide(selectedCustom.id, { rightCol: e.target.value || undefined })}
                            rows={5} placeholder="Right column content\u2026" style={CF_TA} />
                        </CfField>
                      </>
                    )}

                    {/* Image upload */}
                    {selectedCustom.variant === 'image' && (
                      <CfField label="Image">
                        {selectedCustom.imageData ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <img src={selectedCustom.imageData} alt="Slide image" style={{ width: '100%', borderRadius: 8, border: '1px solid #E5E7EB', maxHeight: 160, objectFit: 'contain', background: '#F3F4F6' }} />
                            <button onClick={() => updateCustomSlide(selectedCustom.id, { imageData: undefined })}
                              style={{ alignSelf: 'flex-start', background: 'rgba(239,82,82,0.08)', border: '1px solid rgba(239,82,82,0.2)', borderRadius: 6, color: ORANGE, fontSize: 11, fontWeight: 600, padding: '4px 10px', cursor: 'pointer', fontFamily: FONT }}>
                              Remove image
                            </button>
                          </div>
                        ) : (
                          <label style={{ display: 'block', cursor: 'pointer' }}>
                            <div style={{ padding: '20px 12px', border: '2px dashed #D1D5DB', borderRadius: 8, textAlign: 'center', background: '#FAFAFA' }}
                              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BLUE; }}
                              onDragLeave={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                              onDrop={e => {
                                e.preventDefault(); e.currentTarget.style.borderColor = '#D1D5DB';
                                const file = e.dataTransfer.files[0];
                                if (file && file.type.startsWith('image/')) {
                                  const reader = new FileReader();
                                  reader.onload = ev => updateCustomSlide(selectedCustom.id, { imageData: ev.target?.result as string });
                                  reader.readAsDataURL(file);
                                }
                              }}>
                              <div style={{ fontSize: 22, marginBottom: 6 }}>⌸</div>
                              <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>Drop an image or <span style={{ color: BLUE, textDecoration: 'underline' }}>browse</span></div>
                              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>PNG, JPG, GIF, WebP</div>
                            </div>
                            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = ev => updateCustomSlide(selectedCustom.id, { imageData: ev.target?.result as string });
                                reader.readAsDataURL(file);
                              }
                            }} />
                          </label>
                        )}
                      </CfField>
                    )}

                    {/* Speaker Notes */}
                    <CfField label="Speaker Notes">
                      <textarea value={selectedCustom.notes ?? ''}
                        onChange={e => updateCustomSlide(selectedCustom.id, { notes: e.target.value || undefined })}
                        rows={3} placeholder="Talking points\u2026" style={CF_TA} />
                    </CfField>

                    {/* Position */}
                    <CfField label="Position">
                      <select value={selectedCustom.orderKey}
                        onChange={e => updateCustomSlide(selectedCustom.id, { orderKey: e.target.value })}
                        style={{ ...CF_INPUT, cursor: 'pointer' }}>
                        <option value="after:cover">After cover</option>
                        {enabledSections.map(s => (
                          <option key={s.key} value={`after:${s.key}`}>After {s.customLabel || SECTION_LABELS[s.key]}</option>
                        ))}
                        <option value="end">End of deck</option>
                      </select>
                    </CfField>

                  </div>
                </div>
              )}

              {/* ── KPI stat tile selector ── */}
              {!isStructural && selectedSlideItem?.type === 'data' && (() => {
                const sKey = selectedKey as DeckSectionKey;
                if (!isKpiSlide(sKey)) return null;
                const statDefs = KPI_SLIDE_STATS[sKey] ?? [];
                const currentFilter = selectedSection?.kpiFilter ?? [];
                // A stat is "on" when filter is empty (all shown) or the id is in the filter
                const isOn = (id: string) => currentFilter.length === 0 || currentFilter.includes(id);
                const allOn = currentFilter.length === 0;
                return (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Stats to Show
                      </div>
                      <button
                        onClick={() => setKpiFilter(sKey, undefined)}
                        style={{ fontSize: 10, color: allOn ? BLUE : '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: FONT }}
                      >
                        {allOn ? '✓ All selected' : 'Select all'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {statDefs.map(stat => {
                        const on = isOn(stat.id);
                        return (
                          <label key={stat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 8px', borderRadius: 6, background: on ? 'rgba(68,114,232,0.06)' : '#F9FAFB', border: `1px solid ${on ? 'rgba(68,114,232,0.2)' : '#E5E7EB'}` }}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={e => {
                                // Build new filter set
                                const currentIds = allOn ? statDefs.map(s => s.id) : [...currentFilter];
                                const next = e.target.checked
                                  ? [...new Set([...currentIds, stat.id])]
                                  : currentIds.filter(id => id !== stat.id);
                                // If all are checked, clear the filter (= show all)
                                const allChecked = statDefs.every(s => next.includes(s.id));
                                setKpiFilter(sKey, allChecked ? undefined : next.length ? next : undefined);
                              }}
                              style={{ accentColor: BLUE, width: 13, height: 13, flexShrink: 0 }}
                            />
                            <span style={{ fontSize: 12, color: on ? NAVY : '#9CA3AF', fontWeight: on ? 600 : 400 }}>{stat.label}</span>
                            {stat.conditional && <span style={{ fontSize: 9, color: '#9CA3AF', marginLeft: 'auto' }}>conditional</span>}
                          </label>
                        );
                      })}
                    </div>
                    {!allOn && (
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6 }}>
                        {currentFilter.length} of {statDefs.length} stats selected
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Narrative editor (data slides + instances) ── */}
              {!isStructural && (selectedSlideItem?.type === 'data' || selectedSlideItem?.type === 'instance') && (() => {
                const isInstance = selectedSlideItem.type === 'instance';
                const narrativeValue = isInstance ? (selectedInstance?.narrative ?? '') : (selectedSection?.narrative ?? '');
                const setNarrativeValue = (val: string | undefined) => {
                  if (isInstance && selectedInstance) updateDataInstance(selectedInstance.id, { narrative: val });
                  else setNarrative(selectedKey as DeckSectionKey, val);
                };
                const bulletCount = narrativeValue.split('\n').filter(l => l.trim()).length;
                return (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Slide Narrative
                        {isInstance && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 600, color: BLUE, background: 'rgba(68,114,232,0.1)', borderRadius: 3, padding: '1px 5px' }}>this copy</span>}
                      </div>
                      {narrativeValue && (
                        <span style={{ fontSize: 10, color: '#6B7280' }}>
                          {bulletCount} bullet{bulletCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>
                      Talking points shown on the slide in the exported deck. One bullet per line.
                    </div>
                    <textarea
                      key={selectedKey + '-narrative'}
                      value={narrativeValue}
                      onChange={e => setNarrativeValue(e.target.value || undefined)}
                      rows={4}
                      placeholder={'• e.g. Orders are down 23% MoM across all accounts\n• Highest-volume account has been declining 3 months in a row'}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '9px 12px', borderRadius: 8,
                        border: narrativeValue ? `1.5px solid ${BLUE}` : '1.5px solid #E5E7EB',
                        fontSize: 12, color: NAVY, fontFamily: FONT,
                        outline: 'none', background: narrativeValue ? 'rgba(68,114,232,0.03)' : '#fff',
                        resize: 'vertical', lineHeight: 1.6,
                      }}
                    />
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
                      {narrativeValue
                        ? 'Appears as bullets at the bottom of the exported slide'
                        : 'Empty — no narrative on this slide'}
                    </div>
                  </div>
                );
              })()}

              {/* ── Callout Panel editor ── */}
              {!isStructural && selectedSlideItem?.type === 'data' && (() => {
                const callout = selectedSection?.callout;
                const hasCallout = callout !== undefined;
                return (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Callout Panel</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: hasCallout ? NAVY : '#9CA3AF' }}>
                        <input
                          type="checkbox"
                          checked={hasCallout}
                          onChange={e => {
                            if (!e.target.checked) setCallout(selectedKey as DeckSectionKey, undefined);
                            else setCallout(selectedKey as DeckSectionKey, { stat: '', headline: '' });
                          }}
                          style={{ accentColor: NAVY }}
                        />
                        Enable
                      </label>
                    </div>
                    {hasCallout && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>
                          Navy panel on the right 37% of the slide with a bold stat, headline, and body.
                        </div>
                        <input
                          key={selectedKey + '-callout-stat'}
                          value={callout?.stat ?? ''}
                          onChange={e => setCallout(selectedKey as DeckSectionKey, { ...callout!, stat: e.target.value })}
                          placeholder="e.g. 92%, +$45K, ALERT"
                          style={{ ...CF_INPUT, fontWeight: 700 }}
                        />
                        <input
                          key={selectedKey + '-callout-headline'}
                          value={callout?.headline ?? ''}
                          onChange={e => setCallout(selectedKey as DeckSectionKey, { ...callout!, headline: e.target.value })}
                          placeholder="3–6 word headline"
                          style={CF_INPUT}
                        />
                        <textarea
                          key={selectedKey + '-callout-body'}
                          value={callout?.body ?? ''}
                          onChange={e => setCallout(selectedKey as DeckSectionKey, { ...callout!, body: e.target.value || undefined })}
                          rows={2}
                          placeholder="One supporting sentence (max 55 chars)"
                          style={CF_TA}
                        />

                        {/* Icon picker */}
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Icon</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                            {/* No icon */}
                            <button
                              title="No icon"
                              onClick={() => setCallout(selectedKey as DeckSectionKey, { ...callout!, icon: undefined })}
                              style={{
                                width: '100%', aspectRatio: '1', borderRadius: 6, border: `1.5px solid ${!callout?.icon ? ORANGE : 'rgba(0,0,0,0.1)'}`,
                                background: !callout?.icon ? 'rgba(239,82,82,0.08)' : '#F9FAFB',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 9, color: '#9CA3AF', fontFamily: FONT,
                              }}
                            >
                              None
                            </button>
                            {CALLOUT_ICONS.map(icon => {
                              const selected = callout?.icon === icon.name;
                              const dataUrl = getIconDataUrl(icon.name, selected ? '#ffffff' : '#374151', 18);
                              return (
                                <button
                                  key={icon.name}
                                  title={icon.label}
                                  onClick={() => setCallout(selectedKey as DeckSectionKey, { ...callout!, icon: selected ? undefined : icon.name })}
                                  style={{
                                    width: '100%', aspectRatio: '1', borderRadius: 6,
                                    border: `1.5px solid ${selected ? ORANGE : 'rgba(0,0,0,0.1)'}`,
                                    background: selected ? NAVY : '#F9FAFB',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: 4,
                                  }}
                                >
                                  {dataUrl && <img src={dataUrl} alt={icon.label} style={{ width: 16, height: 16 }} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <button
                          disabled={generatingCallout || !hasInsight}
                          onClick={async () => {
                            if (!selectedInsight) return;
                            setGeneratingCallout(true);
                            setCalloutError(null);
                            try {
                              const result = await generateCallout({
                                whatHappening: selectedInsight.whatHappening ?? '',
                                whyMatters: selectedInsight.whyMatters ?? '',
                                action: selectedInsight.action ?? '',
                                actionNote: selectedInsight.actionNote,
                              });
                              setCallout(selectedKey as DeckSectionKey, result);
                            } catch (err) {
                              setCalloutError(err instanceof Error ? err.message : 'Generation failed');
                            } finally {
                              setGeneratingCallout(false);
                            }
                          }}
                          title={!hasInsight ? 'Fill in the Insight Story first' : undefined}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 8, border: 'none', cursor: generatingCallout || !hasInsight ? 'not-allowed' : 'pointer',
                            background: hasInsight ? NAVY : '#E5E7EB', color: hasInsight ? '#fff' : '#9CA3AF',
                            fontSize: 12, fontFamily: FONT, fontWeight: 600, opacity: generatingCallout ? 0.7 : 1,
                          }}
                        >
                          {generatingCallout ? '⏳ Generating…' : '✨ Generate from story'}
                        </button>
                        {!hasInsight && (
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>Fill in the Insight Story below to enable AI generation</div>
                        )}
                        {calloutError && (
                          <div style={{ fontSize: 11, color: '#EF4444', padding: '6px 10px', background: '#FEF2F2', borderRadius: 6 }}>{calloutError}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Insight story editor (data + instances) ── */}
              {!isStructural && (selectedSlideItem?.type === 'data' || selectedSlideItem?.type === 'instance') && (() => {
                const isInstance = selectedSlideItem.type === 'instance';
                const saveInsightFn = isInstance && selectedInstance
                  ? (_key: DeckSectionKey, ins: SectionInsight | undefined) => updateDataInstance(selectedInstance.id, { insight: ins })
                  : setInsight;
                return (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      Insight Story
                      {isInstance && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 600, color: BLUE, background: 'rgba(68,114,232,0.1)', borderRadius: 3, padding: '1px 5px' }}>this copy</span>}
                    </div>
                    <InlineInsightEditor
                      key={selectedKey}
                      sectionKey={isInstance ? effectiveSectionKey : selectedKey as DeckSectionKey}
                      insight={selectedInsight}
                      onSave={saveInsightFn}
                    />
                  </div>
                );
              })()}

              {/* ── Layout picker (for data slides, not structural) ── */}
              {selectedSlideItem?.type === 'data' && !isStructural && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Layout</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['standard', 'wide'] as const).map(layout => {
                      const isActive = (selectedSection?.layout ?? 'standard') === layout;
                      return (
                        <div
                          key={layout}
                          onClick={() => setLayout(selectedKey as DeckSectionKey, layout === 'standard' ? undefined : layout)}
                          style={{
                            flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                            border: `2px solid ${isActive ? ORANGE : '#E5E7EB'}`,
                            background: isActive ? '#FFF7ED' : '#fff',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 11, color: isActive ? ORANGE : '#374151' }}>{layout === 'standard' ? 'Standard' : 'Wide'}</div>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
                            {layout === 'standard' ? 'Sidebar + content' : 'Full-width content'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Instance position control ── */}
              {selectedSlideItem?.type === 'instance' && selectedInstance && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Position</div>
                  <select
                    value={selectedInstance.orderKey}
                    onChange={e => updateDataInstance(selectedInstance.id, { orderKey: e.target.value })}
                    style={{ ...CF_INPUT, cursor: 'pointer' }}
                  >
                    <option value={`after:${selectedInstance.parentKey}`}>After original slide</option>
                    {enabledSections.filter(s => s.key !== selectedInstance.parentKey).map(s => (
                      <option key={s.key} value={`after:${s.key}`}>After {s.customLabel || SECTION_LABELS[s.key]}</option>
                    ))}
                    <option value="end">End of deck</option>
                  </select>
                </div>
              )}

              {/* ── Row filter (for applicable data slides AND instances) ── */}
              {(selectedSlideItem?.type === 'data' || selectedSlideItem?.type === 'instance') && availableRows.length > 0 && (() => {
                // For data slides: read/write selectedSection.rowFilter
                // For instances:  read/write selectedInstance.rowFilter via updateDataInstance
                const isInstance = selectedSlideItem.type === 'instance';
                const activeFilter: string[] | undefined = isInstance ? selectedInstance?.rowFilter : selectedSection?.rowFilter;
                const clearFilter = () => {
                  if (isInstance && selectedInstance) updateDataInstance(selectedInstance.id, { rowFilter: undefined });
                  else setRowFilter(selectedKey as DeckSectionKey, undefined);
                };
                const toggleRow = (row: string, isIncluded: boolean) => {
                  const current = activeFilter ?? availableRows;
                  const next = isIncluded ? current.filter(r => r !== row) : [...current, row];
                  const newFilter = next.length === availableRows.length ? undefined : next;
                  if (isInstance && selectedInstance) updateDataInstance(selectedInstance.id, { rowFilter: newFilter });
                  else setRowFilter(selectedKey as DeckSectionKey, newFilter);
                };
                return (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Row Filter
                        {isInstance && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 600, color: BLUE, background: 'rgba(68,114,232,0.1)', borderRadius: 3, padding: '1px 5px' }}>this copy only</span>}
                      </div>
                      {activeFilter?.length ? (
                        <button
                          onClick={clearFilter}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, padding: 0, fontFamily: FONT, fontWeight: 600 }}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 8 }}>
                      {activeFilter?.length
                        ? `${activeFilter.length} of ${availableRows.length} rows shown`
                        : `All ${availableRows.length} rows shown — uncheck to hide`}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
                      {availableRows.map(row => {
                        const isIncluded = !activeFilter?.length || activeFilter.includes(row);
                        return (
                          <label key={row} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: isIncluded ? NAVY : '#9CA3AF', cursor: 'pointer', padding: '2px 0' }}>
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={() => toggleRow(row, isIncluded)}
                              style={{ accentColor: BLUE }}
                            />
                            {row}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Recommended Actions editor ── */}
              {selectedKey === 'recommendedActions' && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Action Items</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {displayActions.map(act => (
                      <div key={act.id} style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', border: '1.5px solid #E5E7EB', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            value={act.title}
                            onChange={e => updateAction(act.id, 'title', e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 6, border: '1.5px solid #E5E7EB', fontSize: 12, fontWeight: 600, color: NAVY, fontFamily: FONT, outline: 'none' }}
                          />
                          <textarea
                            value={act.body}
                            onChange={e => updateAction(act.id, 'body', e.target.value)}
                            rows={2}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 6, border: '1.5px solid #E5E7EB', fontSize: 12, color: '#374151', fontFamily: FONT, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
                          />
                        </div>
                        <button onClick={() => removeAction(act.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 18, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                    <button
                      onClick={addAction}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, border: `1.5px dashed ${BLUE}`, background: 'rgba(68,114,232,0.04)', color: BLUE, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add action item
                    </button>
                  </div>
                </div>
              )}

              {/* ── Section label override + Speaker notes ── */}
              {selectedKey !== 'cover' && selectedSlideItem?.type === 'data' && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Slide Text Overrides</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Section category label */}
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                        Category Label
                        <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', marginLeft: 6 }}>(uppercase label above slide title)</span>
                      </label>
                      <input
                        value={selectedSection?.sectionLabel ?? ''}
                        onChange={e => setSectionLabel(selectedKey as DeckSectionKey, e.target.value || undefined)}
                        placeholder={selectedMeta ? selectedMeta.label.toUpperCase() : 'e.g. SHIPPING OVERVIEW'}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '7px 10px', borderRadius: 8,
                          border: '1.5px solid #E5E7EB',
                          fontSize: 12, color: NAVY, fontFamily: FONT,
                          outline: 'none', background: '#fff',
                        }}
                      />
                    </div>
                    {/* Speaker notes */}
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                        Speaker Notes
                        <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', marginLeft: 6 }}>(added to PPTX slide notes)</span>
                      </label>
                      <textarea
                        value={selectedSection?.notes ?? ''}
                        onChange={e => setNotes(selectedKey as DeckSectionKey, e.target.value || undefined)}
                        placeholder="Talking points for the presenter…"
                        rows={4}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '7px 10px', borderRadius: 8,
                          border: '1.5px solid #E5E7EB',
                          fontSize: 12, color: NAVY, fontFamily: FONT,
                          outline: 'none', background: '#fff',
                          resize: 'vertical', lineHeight: 1.5,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Cover: Deck Settings ── */}
              {selectedKey === 'cover' && (() => {
                const fileToBase64 = (file: File): Promise<string> => new Promise((res, rej) => {
                  const r = new FileReader();
                  r.onload = () => res(r.result as string);
                  r.onerror = rej;
                  r.readAsDataURL(file);
                });
                const SettingRow = ({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) => (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: sub ? 2 : 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                      {sub && <div style={{ fontSize: 10, color: '#9CA3AF' }}>{sub}</div>}
                    </div>
                    {children}
                  </div>
                );
                const ImageUploadBox = ({ value, onUpload, onClear, placeholder }: { value?: string; onUpload: (b64: string) => void; onClear: () => void; placeholder: string }) => {
                  const inputRef = React.useRef<HTMLInputElement>(null);
                  return value ? (
                    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1.5px solid #E5E7EB' }}>
                      <img src={value} alt="" style={{ width: '100%', maxHeight: 100, objectFit: 'cover', display: 'block' }} />
                      <button onClick={onClear} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer', padding: '2px 7px', lineHeight: 1.6 }}>Remove</button>
                    </div>
                  ) : (
                    <>
                      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => { const f = e.target.files?.[0]; if (f) onUpload(await fileToBase64(f)); e.target.value = ''; }} />
                      <button onClick={() => inputRef.current?.click()} style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '1.5px dashed #D1D5DB', background: '#F9FAFB', color: '#6B7280', fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
                        {placeholder}
                      </button>
                    </>
                  );
                };
                return (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {/* Logo */}
                    <SettingRow label="Client Logo" sub="Overrides logo from data upload">
                      <ImageUploadBox value={deckLogo} onUpload={setDeckLogo} onClear={() => setDeckLogo(undefined)} placeholder="+ Upload logo" />
                      {!deckLogo && clientLogo && <div style={{ fontSize: 10, color: '#22C55E', marginTop: 4 }}>✓ Using logo from data upload</div>}
                    </SettingRow>

                    {/* Cover color scheme */}
                    <SettingRow label="Cover Color" sub="Background color of the title slide">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                        {COVER_COLOR_SCHEMES.map(scheme => {
                          const isActive = coverColorScheme === scheme.id;
                          const labelColor = scheme.darkText ? 'rgba(37,47,62,0.75)' : 'rgba(255,255,255,0.85)';
                          const checkBg   = scheme.darkText ? NAVY : ORANGE;
                          const checkStroke = '#fff';
                          return (
                            <button
                              key={scheme.id}
                              title={scheme.label}
                              onClick={() => setCoverColorScheme(scheme.id)}
                              style={{
                                position: 'relative',
                                height: 52, borderRadius: 8, cursor: 'pointer',
                                border: isActive ? `2.5px solid ${ORANGE}` : `1.5px solid ${scheme.bg === '#FFFFFF' ? '#D1D5DB' : 'transparent'}`,
                                background: scheme.bg,
                                padding: 0, overflow: 'hidden',
                                boxShadow: isActive ? `0 0 0 1px ${ORANGE}` : '0 1px 3px rgba(0,0,0,0.15)',
                                transition: 'border-color 0.12s, box-shadow 0.12s',
                              }}
                            >
                              {/* Accent stripe at bottom */}
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, background: scheme.accent }} />
                              {/* Label */}
                              <div style={{ position: 'absolute', inset: '0 0 5px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: labelColor, letterSpacing: '0.02em', textShadow: scheme.darkText ? 'none' : '0 1px 2px rgba(0,0,0,0.3)' }}>
                                  {scheme.label}
                                </span>
                              </div>
                              {isActive && (
                                <div style={{ position: 'absolute', top: 5, right: 5, width: 14, height: 14, borderRadius: '50%', background: checkBg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}>
                                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                    <path d="M2 5l2.5 2.5L8 3" stroke={checkStroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </SettingRow>

                    {/* Cover photo */}
                    <SettingRow label="Cover Background Photo" sub="Optional image layered over the color">
                      <ImageUploadBox value={coverPhoto} onUpload={setCoverPhoto} onClear={() => setCoverPhoto(undefined)} placeholder="+ Upload background photo" />
                    </SettingRow>

                    {/* Font size */}
                    <SettingRow label="Font Size Option" sub="Applies to all slides">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        {([
                          { id: 'A', label: 'Compact',  date: 10, subtitle: 10, title: 13, section: 8  },
                          { id: 'B', label: 'Balanced', date: 12, subtitle: 12, title: 16, section: 10 },
                          { id: 'C', label: 'Bold',     date: 14, subtitle: 14, title: 20, section: 12 },
                        ] as const).map(opt => (
                          <div key={opt.id} onClick={() => setSelectedFont(opt.id)}
                            style={{ border: `2px solid ${selectedFont === opt.id ? ORANGE : '#E5E7EB'}`, borderRadius: 10, padding: 10, cursor: 'pointer', background: selectedFont === opt.id ? '#FFF7ED' : '#fff', transition: 'border-color 0.15s' }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 10, color: selectedFont === opt.id ? ORANGE : '#374151', marginBottom: 6 }}>{opt.label}</div>
                            <div style={{ background: NAVY, borderRadius: 5, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div style={{ fontSize: opt.date,     color: '#94A3B8', fontWeight: 600 }}>2026</div>
                              <div style={{ fontSize: opt.subtitle, color: ORANGE,    fontWeight: 700 }}>QBR</div>
                              <div style={{ fontSize: opt.title,    color: '#fff',    fontWeight: 700 }}>ACME</div>
                            </div>
                            <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4 }}>{opt.title}pt / {opt.section}pt</div>
                          </div>
                        ))}
                      </div>
                    </SettingRow>

                    {/* Executive Summary */}
                    <SettingRow label="Executive Summary" sub="Shared with Follow-Up document">
                      <textarea
                        value={execSummary}
                        onChange={e => setExecSummary(e.target.value)}
                        placeholder="Write a brief narrative summary of this quarter's performance…"
                        rows={5}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '8px 10px', borderRadius: 8,
                          border: '1.5px solid #E5E7EB',
                          fontSize: 12, color: NAVY, fontFamily: FONT,
                          outline: 'none', background: '#fff',
                          resize: 'vertical', lineHeight: 1.5,
                        }}
                        onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = '#4472E8'; }}
                        onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = '#E5E7EB'; }}
                      />
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>Edits here also appear on the Follow-Up document.</div>
                    </SettingRow>

                    {/* Reset */}
                    <SettingRow label="Reset Deck">
                      <button
                        onClick={() => {
                          if (!confirm('Reset all deck settings, slides, and configurations? This cannot be undone.')) return;
                          clearDeck();
                          setDeckLogo(undefined);
                          setCoverPhoto(undefined);
                          setTeamMembers([]);
                          setSelectedFont('B');
                          setEditedActions(null);
                          localStorage.removeItem(BUILDER_STORAGE_KEY);
                          setSelectedKey('cover');
                        }}
                        style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: '1.5px solid #FCA5A5', background: '#FEF2F2', color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                      >
                        Reset deck to defaults
                      </button>
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>Removes all enabled slides, custom slides, story content, and recommended action edits.</div>
                    </SettingRow>
                  </div>
                );
              })()}

              {/* ── Introductions: Team member editor ── */}
              {selectedKey === 'introductions' && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Team Members</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {teamMembers.map(m => {
                      const photoOn = m.showPhoto !== false;
                      return (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff' }}>
                          <div style={{ position: 'relative', flexShrink: 0 }}>
                            <div onClick={() => photoOn && memberPhotoRefs.current[m.id]?.click()} style={{ width: 40, height: 40, borderRadius: '50%', background: photoOn ? NAVY : '#E5E7EB', flexShrink: 0, cursor: photoOn ? 'pointer' : 'default', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${photoOn ? ORANGE : '#D1D5DB'}`, opacity: photoOn ? 1 : 0.5 }}>
                              {m.photo && photoOn ? <img src={m.photo} alt="" style={{ width: 40, height: 40, objectFit: 'cover' }} /> : <span style={{ fontSize: 14, fontWeight: 800, color: photoOn ? '#fff' : '#9CA3AF' }}>{m.name ? m.name.charAt(0).toUpperCase() : '?'}</span>}
                            </div>
                          </div>
                          <input ref={el => { memberPhotoRefs.current[m.id] = el; }} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleMemberPhoto(m.id, f); e.target.value = ''; }} />
                          <input value={m.name} onChange={e => updateMember(m.id, 'name', e.target.value)} placeholder="Full name" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1.5px solid #E5E7EB', fontSize: 12, fontFamily: FONT, outline: 'none' }} />
                          <input value={m.title} onChange={e => updateMember(m.id, 'title', e.target.value)} placeholder="Title / Role" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1.5px solid #E5E7EB', fontSize: 12, fontFamily: FONT, outline: 'none' }} />
                          <button onClick={() => toggleMemberPhoto(m.id)} style={{ background: photoOn ? 'rgba(245,166,35,0.12)' : '#F3F4F6', border: `1.5px solid ${photoOn ? ORANGE : '#E5E7EB'}`, borderRadius: 6, cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={photoOn ? ORANGE : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          </button>
                          <button onClick={() => removeMember(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}

                    {/* Preset search */}
                    <div ref={searchRef} style={{ position: 'relative' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input value={memberSearch} onChange={e => { setMemberSearch(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 150)} placeholder="Search team members…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: FONT, background: 'transparent', color: '#374151' }} />
                      </div>
                      {searchOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1.5px solid #D1D5DB', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', marginTop: 4, overflow: 'hidden' }}>
                          {filteredPresets.map((p, i) => (
                            <div key={i} onMouseDown={() => addFromPreset(p.name, p.title)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: i < filteredPresets.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', flexDirection: 'column', gap: 2 }} onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: FONT }}>{p.name}</span>
                              <span style={{ fontSize: 11, color: '#6B7280', fontFamily: FONT }}>{p.title}</span>
                            </div>
                          ))}
                          <div onMouseDown={addCustomMember} style={{ padding: '8px 12px', cursor: 'pointer', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 6 }} onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            <span style={{ fontSize: 12, color: BLUE, fontWeight: 700, fontFamily: FONT }}>Add custom member…</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: Slide library (collapsible) ───────────────────── */}
        {rightCollapsed ? (
          <div style={{ width: 36, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, borderLeft: '1px solid #E5E7EB', flexShrink: 0, gap: 10 }}>
            <button
              onClick={() => setRightCollapsed(false)}
              title="Expand slide library"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', writingMode: 'vertical-rl', textTransform: 'uppercase', letterSpacing: '0.1em', transform: 'rotate(180deg)' }}>
              Library
            </div>
          </div>
        ) : (
          <div style={{ width: 300, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderLeft: '1px solid #E5E7EB', flexShrink: 0 }}>
            {/* Library header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: NAVY, flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Slide Library</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>Click to add or remove slides</div>
              </div>
              <button
                onClick={() => setRightCollapsed(true)}
                title="Collapse library"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            {/* Library content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', minHeight: 0 }}>
              {/* Helper — renders one library row */}
              {(() => {
                const LIBRARY_GROUPS: Array<{
                  group: string;
                  items: Array<{
                    variant: CustomDeckSlide['variant'];
                    label: string;
                    sub: string;
                    icon: string;
                    iconBg: string;
                    iconFg: string;
                    defaults?: Partial<CustomDeckSlide>;
                  }>;
                }> = [
                  {
                    group: 'Structure',
                    items: [
                      { variant: 'divider',  label: 'Section Divider',    sub: 'Navy slide with centered title',        icon: '▬', iconBg: 'rgba(37,47,62,0.10)',   iconFg: NAVY },
                      { variant: 'text',     label: 'Custom Text Slide',  sub: 'Editable title and free-form body',     icon: '✎', iconBg: 'rgba(68,114,232,0.10)', iconFg: BLUE },
                      { variant: 'blank',    label: 'Blank Slide',        sub: 'Empty canvas — add content later',      icon: '□', iconBg: 'rgba(100,116,139,0.10)', iconFg: '#64748B' },
                    ],
                  },
                  {
                    group: 'Closers',
                    items: [
                      { variant: 'qa',       label: 'Q&A',                sub: 'Navy closer — "Questions?" ending',     icon: '?', iconBg: 'rgba(37,47,62,0.10)',   iconFg: NAVY,
                        defaults: { title: 'Q&A', subtitle: 'We\u2019d love to hear from you' } },
                      { variant: 'thankyou', label: 'Thank You',          sub: 'Navy closer with next steps list',      icon: '✓', iconBg: 'rgba(37,47,62,0.10)',   iconFg: NAVY,
                        defaults: { title: 'Thank You', body: 'Next steps go here\nAnother item' } },
                    ],
                  },
                  {
                    group: 'Callouts',
                    items: [
                      { variant: 'quote',    label: 'Quote / Callout',    sub: 'Large pull quote with attribution',     icon: '\u201C', iconBg: 'rgba(68,114,232,0.10)', iconFg: BLUE },
                      { variant: 'twocol',   label: 'Two-Column Layout',  sub: 'Side-by-side text blocks',              icon: '⊟', iconBg: 'rgba(68,114,232,0.10)', iconFg: BLUE },
                    ],
                  },
                  {
                    group: 'Media',
                    items: [
                      { variant: 'image',    label: 'Image Slide',        sub: 'Full-slide image + optional caption',   icon: '⌸', iconBg: 'rgba(100,116,139,0.10)', iconFg: '#64748B',
                        defaults: { title: '' } },
                    ],
                  },
                ];
                return LIBRARY_GROUPS.map(({ group, items }) => (
                  <div key={group} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, paddingLeft: 2 }}>{group}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {items.map(({ variant, label, sub, icon, iconBg, iconFg, defaults }) => (
                        <div
                          key={variant}
                          onClick={() => {
                            const newSlide: CustomDeckSlide = {
                              id: crypto.randomUUID(), variant, enabled: true,
                              title: defaults?.title ?? label,
                              orderKey: 'end',
                              ...defaults,
                            };
                            addCustomSlide(newSlide);
                            setSelectedKey(newSlide.id);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#FAFAFA', cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.04)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#FAFAFA'; e.currentTarget.style.borderColor = '#E5E7EB'; }}
                        >
                          <div style={{ width: 28, height: 20, borderRadius: 4, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, color: iconFg, fontWeight: 700 }}>
                            {icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                            <div style={{ fontSize: 10, color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
                          </div>
                          <div style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.08)', color: '#6366F1', border: '1px solid rgba(99,102,241,0.18)', flexShrink: 0 }}>
                            + Add
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )} {/* end right panel */}

      </div> {/* end main 3-panel area */}

      {/* ── Preview modal ─────────────────────────────────────────────────── */}
      {showPreview && (
        <DeckPreviewModal
          clientName={clientName} reportingPeriod={reportingPeriod}
          data={previewData}
          onClose={() => setShowPreview(false)}
          onDownload={() => { setShowPreview(false); handleGenerate(); }}
          generating={!!generateProgress}
        />
      )}

      {/* ── Pre-flight validation modal ──────────────────────────────────── */}
      {showPreflight && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowPreflight(false); }}
        >
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', fontFamily: FONT }}>
            {/* Header */}
            <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>Pre-flight Check</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>Reviewing your data before generating…</div>
              </div>
              <button onClick={() => setShowPreflight(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9CA3AF', lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {/* Check rows */}
            <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {preflightChecks.map((check, i) => {
                const colors = check.level === 'fail'
                  ? { bg: '#FEF2F2', border: '#FECACA', icon: '#EF4444', text: '#991B1B', detail: '#B91C1C' }
                  : check.level === 'warn'
                  ? { bg: '#FFFBEB', border: '#FDE68A', icon: '#F59E0B', text: '#92400E', detail: '#B45309' }
                  : { bg: '#F0FDF4', border: '#BBF7D0', icon: '#22C55E', text: '#166534', detail: '#15803D' };
                const iconPath = check.level === 'fail'
                  ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                  : check.level === 'warn'
                  ? <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>
                  : <><polyline points="20 6 9 17 4 12"/></>;
                return (
                  <div key={i} style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.icon} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>{iconPath}</svg>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{check.label}</div>
                      <div style={{ fontSize: 11, color: colors.detail, marginTop: 2, lineHeight: 1.4 }}>{check.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '12px 22px 18px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowPreflight(false)}
                style={{ padding: '7px 16px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}
              >
                Cancel
              </button>
              {!preflightHasFail && (
                <button
                  onClick={doGenerate}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: ORANGE, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}
                >
                  {preflightHasWarn ? 'Generate Anyway' : 'Generate'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Templates modal ──────────────────────────────────────────────── */}
      {showTemplates && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowTemplates(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>

            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>Deck Templates</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>Apply a template to quickly configure your slide selection</div>
              </div>
              <button onClick={() => setShowTemplates(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9CA3AF', lineHeight: 1, padding: 4 }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

              {/* Built-in templates */}
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Built-in</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 24 }}>
                {BUILT_IN_TEMPLATES.map(tpl => (
                  <div key={tpl.id} style={{ border: '1.5px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = ORANGE; e.currentTarget.style.boxShadow = '0 2px 12px rgba(239,82,82,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.boxShadow = 'none'; }}
                    onClick={() => {
                      if (!confirm(`Apply "${tpl.name}" template? This will replace your current slide selection.`)) return;
                      applyTemplate(tpl);
                      setSelectedFont(tpl.fontOption);
                      setSelectedKey('cover');
                      setShowTemplates(false);
                    }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: NAVY, marginBottom: 5 }}>{tpl.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {tpl.sectionKeys.slice(0, 6).map(k => (
                        <span key={k} style={{ fontSize: 10, background: '#F3F4F6', color: '#374151', borderRadius: 4, padding: '2px 6px' }}>{SECTION_LABELS[k]}</span>
                      ))}
                      {tpl.sectionKeys.length > 6 && (
                        <span style={{ fontSize: 10, color: '#9CA3AF' }}>+{tpl.sectionKeys.length - 6} more</span>
                      )}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10, color: '#9CA3AF' }}>{tpl.sectionKeys.length} slides · Font {tpl.fontOption}</div>
                  </div>
                ))}
              </div>

              {/* Saved templates */}
              {savedTemplates.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Saved</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                    {savedTemplates.map(tpl => (
                      <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1.5px solid #E5E7EB', borderRadius: 10, padding: '10px 14px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: NAVY }}>{tpl.name}</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                            {tpl.sectionKeys.length} slides · {tpl.createdAt ? new Date(tpl.createdAt).toLocaleDateString() : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (!confirm(`Apply "${tpl.name}"? This will replace your current slide selection.`)) return;
                            applyTemplate(tpl);
                            setSelectedFont(tpl.fontOption);
                            setSelectedKey('cover');
                            setShowTemplates(false);
                          }}
                          style={{ padding: '5px 12px', borderRadius: 6, border: `1.5px solid ${ORANGE}`, background: 'transparent', color: ORANGE, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
                          Apply
                        </button>
                        <button
                          onClick={() => {
                            if (!confirm(`Delete "${tpl.name}"?`)) return;
                            deleteTemplate(tpl.id);
                            setSavedTemplates(loadSavedTemplates());
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16, padding: '0 4px', lineHeight: 1, flexShrink: 0 }}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Save current as template */}
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Save Current Deck as Template</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={saveTemplateName}
                  onChange={e => setSaveTemplateName(e.target.value)}
                  placeholder="Template name…"
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1.5px solid #E5E7EB', fontSize: 12, color: NAVY, fontFamily: FONT, outline: 'none' }}
                />
                <button
                  disabled={!saveTemplateName.trim()}
                  onClick={() => {
                    const name = saveTemplateName.trim();
                    if (!name) return;
                    const enabledKeys = sections
                      .filter(s => s.enabled && availability[s.key].available)
                      .map(s => s.key);
                    const tpl: DeckTemplate = {
                      id: crypto.randomUUID(),
                      name,
                      createdAt: new Date().toISOString(),
                      fontOption: selectedFont,
                      sectionKeys: enabledKeys,
                      // Save structural custom slides (strip client-specific data)
                      customSlides: customSlides
                        .filter(cs => cs.enabled)
                        .map(cs => ({ ...cs, id: crypto.randomUUID(), insight: undefined, notes: undefined })),
                    };
                    saveTemplate(tpl);
                    setSavedTemplates(loadSavedTemplates());
                    setSaveTemplateName('');
                  }}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: saveTemplateName.trim() ? NAVY : '#E5E7EB', color: saveTemplateName.trim() ? '#fff' : '#9CA3AF', fontSize: 12, fontWeight: 700, cursor: saveTemplateName.trim() ? 'pointer' : 'not-allowed', fontFamily: FONT, flexShrink: 0 }}>
                  Save
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6 }}>
                Saves your current slide selection and order ({sections.filter(s => s.enabled).length} enabled). Insight stories and client data are not saved.
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
