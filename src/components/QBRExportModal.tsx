import { useState, useMemo, useCallback, useRef } from 'react';
import { pdf } from '@react-pdf/renderer';
import { useData } from '../context/DataContext';
import { usePDF } from '../context/PDFContext';
import { useAudit } from '../context/AuditContext';
import { useDeck } from '../context/DeckContext';
import QBRDocument from './pdf/QBRDocument';
import type {
  QBRDocumentProps, KPISummaryPDF, CustomerStatPDF,
  CostGapRowPDF, CarrierMixRowPDF, ZoneComparisonPDF,
  SectionKey, SectionOptions, EnabledSection,
} from './pdf/QBRDocument';
import { getZoneFromOriginToState } from '../utils/uspsZones';
import { inferServiceKey, SERVICE_TABLES, lookupMrcRate } from '../data/shipheroRates';
import type { ServiceKey } from '../data/shipheroRates';
import { generateRecommendedActions, RecommendedAction } from '../utils/recommendedActions';
import { computeDeltas } from '../utils/periodComparison';
import React from 'react';

interface Props { onClose: () => void; mode?: 'modal' | 'tab'; }

// ── Section metadata ──────────────────────────────────────────────────────────
interface SortOption { value: string; label: string; }
interface SectionMeta {
  label: string;
  sub: string;
  color: string;
  hasTable: boolean;
  sortOptions: SortOption[];
  defaultSort: string;
  defaultDir: 'asc' | 'desc';
}

const NAVY = '#252F3E';
const BLUE = '#4472E8';
const ORANGE = '#EF5252';

const SECTION_META: Record<SectionKey, SectionMeta> = {
  accountOverview: {
    label: 'Account Overview',
    sub: 'KPI summary: shipments, label cost, margin, avg zone',
    color: BLUE,
    hasTable: false,
    sortOptions: [],
    defaultSort: '',
    defaultDir: 'desc',
  },
  topAccounts: {
    label: 'Top Accounts',
    sub: 'Account volume breakdown with cost and zone data',
    color: BLUE,
    hasTable: true,
    sortOptions: [
      { value: 'orderCount', label: 'Volume (shipments)' },
      { value: 'avgShippingCost', label: 'Avg Label Cost' },
      { value: 'avgOrderValue', label: 'Avg Billed Amount' },
      { value: 'avgZone', label: 'Avg Zone' },
    ],
    defaultSort: 'orderCount',
    defaultDir: 'desc',
  },
  labelVsCharged: {
    label: 'Shipping Cost Analysis',
    sub: 'Label cost vs total charged — gap analysis by account',
    color: '#EF4444',
    hasTable: true,
    sortOptions: [
      { value: 'gap', label: 'Gap $ (worst first)' },
      { value: 'gapPct', label: 'Gap % (worst first)' },
      { value: 'shipments', label: 'Shipments (highest)' },
      { value: 'labelCost', label: 'Avg Label Cost (highest)' },
      { value: 'name', label: 'Account Name (A\u2192Z)' },
    ],
    defaultSort: 'gap',
    defaultDir: 'asc',
  },
  carrierMix: {
    label: 'Carrier Mix',
    sub: 'Carrier distribution by volume and cost',
    color: '#0891B2',
    hasTable: true,
    sortOptions: [
      { value: 'shipments', label: 'Shipments (highest)' },
      { value: 'pctOfTotal', label: '% of Total (highest)' },
      { value: 'avgCost', label: 'Avg Cost (highest)' },
    ],
    defaultSort: 'shipments',
    defaultDir: 'desc',
  },
  zonePerformance: {
    label: 'Rate Card Performance',
    sub: 'Actual vs MRC rates by USPS zone',
    color: '#7C3AED',
    hasTable: true,
    sortOptions: [
      { value: 'zone', label: 'Zone (1\u21928)' },
      { value: 'delta', label: 'Delta $ (worst first)' },
      { value: 'deltaPercent', label: 'Delta % (worst first)' },
      { value: 'shipmentCount', label: 'Shipments (highest)' },
    ],
    defaultSort: 'zone',
    defaultDir: 'asc',
  },
  expiryAlerts: {
    label: 'Expiry Alerts',
    sub: 'Lot-tracked items expiring within 180 days',
    color: '#EF4444',
    hasTable: true,
    sortOptions: [
      { value: 'daysToExpire', label: 'Days to Expiry (urgent first)' },
      { value: 'tier', label: 'Urgency Tier' },
      { value: 'units', label: 'Units (highest)' },
      { value: 'client', label: 'Client (A\u2192Z)' },
    ],
    defaultSort: 'daysToExpire',
    defaultDir: 'asc',
  },
  daysOnHand: {
    label: 'Days on Hand',
    sub: 'Stock levels vs daily velocity \u2014 flags critical SKUs',
    color: ORANGE,
    hasTable: true,
    sortOptions: [
      { value: 'status', label: 'Status (critical first)' },
      { value: 'doh', label: 'Days on Hand (lowest first)' },
      { value: 'dailyVelocity', label: 'Daily Velocity (highest)' },
      { value: 'currentUnits', label: 'Units on Hand (highest)' },
      { value: 'client', label: 'Client (A\u2192Z)' },
    ],
    defaultSort: 'status',
    defaultDir: 'asc',
  },
  poCadence: {
    label: 'Inbound PO Cadence',
    sub: 'Purchase order frequency and volume by client',
    color: '#0891B2',
    hasTable: true,
    sortOptions: [
      { value: 'totalUnitsIn', label: 'Total Units (highest)' },
      { value: 'poCount', label: 'PO Count (highest)' },
      { value: 'avgUnitsPerPO', label: 'Avg Units/PO (highest)' },
      { value: 'lastReceived', label: 'Last Received (most recent)' },
      { value: 'client', label: 'Client (A\u2192Z)' },
    ],
    defaultSort: 'totalUnitsIn',
    defaultDir: 'desc',
  },
};

const SECTION_ORDER: SectionKey[] = [
  'accountOverview', 'topAccounts', 'labelVsCharged', 'carrierMix',
  'zonePerformance', 'expiryAlerts', 'daysOnHand', 'poCadence',
];

// ── Section state ─────────────────────────────────────────────────────────────
interface SectionState extends EnabledSection {
  expanded: boolean;
}

function defaultOptions(key: SectionKey): SectionOptions {
  const m = SECTION_META[key];
  return {
    showTable: m.hasTable,
    tableRows: 10,
    sortBy: m.defaultSort,
    sortDir: m.defaultDir,
    customText: '',
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const BASE: React.CSSProperties = { fontFamily: "'Metropolis', sans-serif" };
const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: '8px', fontSize: '13px',
  border: '1.5px solid #e5e7eb', background: '#fafafa', color: NAVY,
  outline: 'none', boxSizing: 'border-box', fontFamily: "'Metropolis', sans-serif",
};
const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE, cursor: 'pointer', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '30px',
};

// ── Component ─────────────────────────────────────────────────────────────────
// ── Deck section key → PDF section key mapping ────────────────────────────────
const DECK_TO_PDF: Partial<Record<string, SectionKey>> = {
  accountOverview: 'accountOverview',
  costGap:         'labelVsCharged',
  carrierMix:      'carrierMix',
  zonePerformance: 'zonePerformance',
  expiryAlerts:    'expiryAlerts',
  daysOnHand:      'daysOnHand',
};

export default function QBRExportModal({ onClose, mode = 'modal' }: Props) {
  const isTab = mode === 'tab';
  const { rawShipments, warehouses, reportingPeriod: contextPeriod, priorPeriod, uploadPriorCSV, clientName: contextClient, clientLogo } = useData();
  const { inventoryData } = usePDF();
  const { log } = useAudit();
  const { sections: deckSections } = useDeck();
  const priorFileRef = useRef<HTMLInputElement>(null);

  const originZip = warehouses[0]?.zip?.trim() || '';
  const hasShipping = rawShipments.length > 0;
  const hasCharged = rawShipments.some(s => s.totalShippingCharged > 0);
  const hasRateCard = hasShipping && !!originZip;
  const hasExpiry = (inventoryData?.expiryAlerts?.length ?? 0) > 0;
  const hasDOH = (inventoryData?.daysOnHand?.length ?? 0) > 0;
  const hasPO = (inventoryData?.poCadence?.length ?? 0) > 0;

  const availability: Record<SectionKey, { available: boolean; reason: string }> = {
    accountOverview: { available: hasShipping, reason: 'Upload a shipping CSV first' },
    topAccounts: { available: hasShipping, reason: 'Upload a shipping CSV first' },
    labelVsCharged: { available: hasCharged, reason: 'Requires "Total Shipping Charged" column in CSV' },
    carrierMix: { available: hasShipping, reason: 'Upload a shipping CSV first' },
    zonePerformance: { available: hasRateCard, reason: 'Requires shipping CSV + warehouse ZIP configured' },
    expiryAlerts: { available: hasExpiry, reason: 'Upload Product Locations CSV on Inventory tab' },
    daysOnHand: { available: hasDOH, reason: 'Upload both inventory CSVs on Inventory tab' },
    poCadence: { available: hasPO, reason: 'Upload Inventory Change Report on Inventory tab' },
  };

  const [clientName, setClientName] = useState(() => contextClient || '');
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportingPeriod, setReportingPeriod] = useState(() => contextPeriod || '');
  const [generating, setGenerating] = useState(false);
  const [priorUploading, setPriorUploading] = useState(false);
  const [priorError, setPriorError] = useState<string | null>(null);

  // ── Recommended actions ────────────────────────────────────────────────────
  const delta = useMemo(() => {
    if (!priorPeriod || rawShipments.length === 0) return undefined;
    const totalSpend = rawShipments.reduce((s, r) => s + r.labelCost, 0);
    const totalRevenue = rawShipments.reduce((s, r) => s + r.totalShippingCharged, 0);
    const totalWeight = rawShipments.reduce((s, r) => s + r.weight, 0);
    return computeDeltas({
      totalShipments: rawShipments.length,
      totalSpend,
      avgLabelCost: rawShipments.length > 0 ? totalSpend / rawShipments.length : 0,
      avgWeight: rawShipments.length > 0 ? totalWeight / rawShipments.length : 0,
      totalRevenue,
    }, priorPeriod);
  }, [rawShipments, priorPeriod]);

  const [actions, setActions] = useState<RecommendedAction[]>(() =>
    generateRecommendedActions(rawShipments, priorPeriod ?? undefined, undefined)
  );
  const [includeActions, setIncludeActions] = useState(true);

  // Build set of PDF section keys enabled in the deck
  const deckEnabledPdfKeys = useMemo(() => {
    const enabled = new Set<SectionKey>();
    for (const ds of deckSections) {
      if (!ds.enabled) continue;
      const pdfKey = DECK_TO_PDF[ds.key];
      if (pdfKey) enabled.add(pdfKey);
    }
    return enabled;
  }, [deckSections]);

  const [sections, setSections] = useState<SectionState[]>(() =>
    SECTION_ORDER.map(key => {
      // topAccounts and poCadence don't have deck equivalents — enable if data available
      const noDeckEquiv = key === 'topAccounts' || key === 'poCadence';
      const enabledByDeck = deckEnabledPdfKeys.has(key);
      const enabled = availability[key].available && (noDeckEquiv || enabledByDeck);
      return { key, enabled, expanded: false, options: defaultOptions(key) };
    })
  );

  // ── Drag-and-drop reorder ──────────────────────────────────────────────────
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (idx: number) => {
    dragIndexRef.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    const dragIdx = dragIndexRef.current;
    if (dragIdx === null || dragIdx === dropIdx) { setDragOverIndex(null); return; }
    setSections(prev => {
      const arr = [...prev];
      const [dragged] = arr.splice(dragIdx, 1);
      arr.splice(dropIdx, 0, dragged);
      return arr;
    });
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  // ── Prior period upload ────────────────────────────────────────────────────
  const handlePriorUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPriorUploading(true);
    setPriorError(null);
    const { errors } = await uploadPriorCSV(file);
    if (errors.length > 0) {
      setPriorError(errors[0]);
    } else {
      log('prior_period_upload', { fileName: file.name });
    }
    setPriorUploading(false);
    e.target.value = '';
  }, [uploadPriorCSV, log]);

  // ── Mutators ───────────────────────────────────────────────────────────────
  const toggleEnabled = (idx: number) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, enabled: !s.enabled } : s));
  };

  const toggleExpanded = (idx: number) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, expanded: !s.expanded } : s));
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    setSections(prev => {
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };

  const updateOption = <K extends keyof SectionOptions>(idx: number, key: K, value: SectionOptions[K]) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, options: { ...s.options, [key]: value } } : s));
  };

  // ── Data computation ───────────────────────────────────────────────────────
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

  // ── Generate PDF ───────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const formattedDate = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const needsInventory = sections.some(s => s.enabled && ['expiryAlerts', 'daysOnHand', 'poCadence'].includes(s.key));
      const docProps: QBRDocumentProps = {
        clientName: clientName || 'Client',
        reportDate: formattedDate,
        reportingPeriod: reportingPeriod || undefined,
        clientLogo: clientLogo || undefined,
        enabledSections: sections.map(({ key, enabled, options }) => ({ key, enabled, options })),
        kpis,
        customerStats,
        costGapRows,
        carrierMix,
        zoneComparisons,
        inventoryData: needsInventory ? inventoryData : null,
        recommendedActions: includeActions && actions.length > 0 ? actions : undefined,
        priorPeriod: priorPeriod ?? undefined,
        delta: delta ?? undefined,
      };
      const blob = await pdf(<QBRDocument {...docProps} /> as React.ReactElement).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ShipHero_QBR_${(clientName || 'Client').replace(/\s+/g, '_')}_${reportDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      log('qbr_export', {
        client: clientName || 'Client',
        period: reportingPeriod || '',
        sections: sections.filter(s => s.enabled).map(s => s.key).join(','),
        hasPriorPeriod: !!priorPeriod,
      });

      onClose();
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [clientName, reportDate, reportingPeriod, sections, kpis, customerStats, costGapRows, carrierMix, zoneComparisons, inventoryData, includeActions, actions, priorPeriod, delta, log, onClose]);

  const enabledCount = sections.filter(s => s.enabled).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  const inner = (
    <>
      <div style={{ ...BASE, background: '#fff', borderRadius: isTab ? 0 : '16px', width: '100%', maxWidth: isTab ? '100%' : '740px', height: isTab ? '100%' : undefined, maxHeight: isTab ? '100%' : '92vh', display: 'flex', flexDirection: 'column', boxShadow: isTab ? 'none' : '0 24px 80px rgba(0,0,0,0.35)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: NAVY, padding: '18px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: 32, height: 32, borderRadius: '8px', background: '#4472E8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: '16px', color: '#fff' }}>QBR Follow Up</div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '1px' }}>Configure sections, tables, and notes for the post-QBR summary</div>
              </div>
            </div>
            {!isTab && <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '6px 10px', color: '#94A3B8', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}>✕</button>}
          </div>

          {/* Client + Date + Period row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', paddingBottom: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94A3B8', marginBottom: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Client Name</label>
              <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Acme Corp"
                style={{ ...INPUT_STYLE, background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.15)', color: '#fff' }}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.15)')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94A3B8', marginBottom: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Report Date</label>
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                style={{ ...INPUT_STYLE, background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.15)', color: '#fff', colorScheme: 'dark' }}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.15)')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94A3B8', marginBottom: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Reporting Period</label>
              <input type="text" value={reportingPeriod} onChange={e => setReportingPeriod(e.target.value)} placeholder="e.g. Q2 2026"
                style={{ ...INPUT_STYLE, background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.15)', color: '#fff' }}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.15)')}
              />
            </div>
          </div>

          {/* Accent bar */}
          <div style={{ height: '3px', background: `linear-gradient(90deg, ${ORANGE} 0%, ${BLUE} 100%)`, marginLeft: '-24px', marginRight: '-24px' }} />
        </div>

        {/* Section builder */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
            Pages &amp; Sections — {enabledCount} selected · drag to reorder
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sections.map((sec, idx) => {
              const meta = SECTION_META[sec.key];
              const isFirst = idx === 0;
              const isLast = idx === sections.length - 1;

              const avail = availability[sec.key].available;
              const unavailReason = availability[sec.key].reason;
              return (
                <div
                  key={sec.key}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDrop={e => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  style={{
                    border: `1.5px solid ${dragOverIndex === idx ? ORANGE : sec.enabled && avail ? 'rgba(68,114,232,0.25)' : '#e5e7eb'}`,
                    borderRadius: '10px', overflow: 'hidden',
                    background: dragOverIndex === idx ? 'rgba(245,166,35,0.04)' : sec.enabled && avail ? 'rgba(68,114,232,0.03)' : '#fafafa',
                    transition: 'border-color 0.15s, background 0.15s',
                    opacity: dragIndexRef.current === idx ? 0.5 : 1,
                  }}
                >
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px' }}>

                    {/* Drag handle */}
                    <div
                      title="Drag to reorder"
                      style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, cursor: 'grab', padding: '2px 3px' }}
                    >
                      {[0,1,2].map(i => (
                        <div key={i} style={{ display: 'flex', gap: '3px' }}>
                          <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#C4C9D4' }} />
                          <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#C4C9D4' }} />
                        </div>
                      ))}
                    </div>

                    {/* Position badge */}
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: sec.enabled && avail ? NAVY : '#E5E7EB', color: sec.enabled && avail ? '#fff' : '#9CA3AF', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {idx + 1}
                    </div>

                    {/* Color dot */}
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0, opacity: avail ? 1 : 0.35 }} />

                    {/* Checkbox + label */}
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1, cursor: avail ? 'pointer' : 'default', opacity: avail ? 1 : 0.5 }}>
                      <input type="checkbox" checked={avail ? sec.enabled : false} disabled={!avail}
                        onChange={() => avail && toggleEnabled(idx)}
                        style={{ marginTop: '2px', accentColor: BLUE, width: '14px', height: '14px', flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: avail ? NAVY : '#9CA3AF' }}>{meta.label}</div>
                        <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '1px' }}>
                          {avail ? meta.sub : `⚠ ${unavailReason}`}
                        </div>
                      </div>
                    </label>

                    {/* Expand toggle */}
                    {avail && sec.enabled && (
                      <button onClick={() => toggleExpanded(idx)}
                        style={{ background: sec.expanded ? NAVY : '#F5F5F0', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: sec.expanded ? '#fff' : '#6B7280', fontSize: '11px', fontWeight: 600, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {sec.expanded ? '▲ Less' : '▼ Settings'}
                      </button>
                    )}
                  </div>

                  {/* Expanded settings panel */}
                  {sec.expanded && sec.enabled && avail && (
                    <div style={{ borderTop: '1px solid #e5e7eb', padding: '14px 14px 14px 46px', background: '#fff' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>

                        {/* Custom note */}
                        <div>
                          <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#6B7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Analyst Note <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — appears in PDF)</span>
                          </label>
                          <textarea
                            value={sec.options.customText}
                            onChange={e => updateOption(idx, 'customText', e.target.value)}
                            placeholder="Add context, insights, or talking points for this section..."
                            rows={2}
                            style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '52px', fontSize: '12px', lineHeight: '1.4' }}
                          />
                        </div>

                        {/* Table settings */}
                        {meta.hasTable && (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
                                <div
                                  onClick={() => updateOption(idx, 'showTable', !sec.options.showTable)}
                                  style={{
                                    width: '36px', height: '20px', borderRadius: '10px',
                                    background: sec.options.showTable ? BLUE : '#D1D5DB',
                                    position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                                  }}
                                >
                                  <div style={{ position: 'absolute', top: '2px', left: sec.options.showTable ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                                </div>
                                <span style={{ fontSize: '12px', fontWeight: 700, color: NAVY }}>Include data table</span>
                              </label>
                            </div>

                            {sec.options.showTable && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '10px' }}>

                                {/* Sort by */}
                                <div>
                                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#6B7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort By</label>
                                  <div style={{ position: 'relative' }}>
                                    <select value={sec.options.sortBy} onChange={e => updateOption(idx, 'sortBy', e.target.value)} style={SELECT_STYLE}>
                                      {meta.sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                  </div>
                                </div>

                                {/* Rows */}
                                <div>
                                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#6B7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rows to Show</label>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    {[5, 10, 20, 50, 0].map(n => (
                                      <button key={n} onClick={() => updateOption(idx, 'tableRows', n)}
                                        style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: `1.5px solid ${sec.options.tableRows === n ? BLUE : '#e5e7eb'}`, background: sec.options.tableRows === n ? BLUE : '#fff', color: sec.options.tableRows === n ? '#fff' : '#6B7280', fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
                                        {n === 0 ? 'All' : n}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Sort dir */}
                                <div>
                                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#6B7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order</label>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    {(['asc', 'desc'] as const).map(d => (
                                      <button key={d} onClick={() => updateOption(idx, 'sortDir', d)}
                                        style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: `1.5px solid ${sec.options.sortDir === d ? BLUE : '#e5e7eb'}`, background: sec.options.sortDir === d ? BLUE : '#fff', color: sec.options.sortDir === d ? '#fff' : '#6B7280', fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
                                        {d === 'asc' ? '↑ Asc' : '↓ Desc'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Prior Period (QoQ Comparison) ────────────────────────────── */}
          <div style={{ marginTop: '14px', border: '1.5px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0891B2', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '13px', color: NAVY }}>QoQ Comparison <span style={{ fontWeight: 400, fontSize: '11px', color: '#6B7280' }}>(optional)</span></div>
                <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '1px' }}>
                  {priorPeriod
                    ? `Prior period: ${priorPeriod.fileName} — ${priorPeriod.totalShipments.toLocaleString()} shipments`
                    : 'Upload a prior period CSV to show period-over-period deltas on the cover page'}
                </div>
              </div>
              {priorPeriod ? (
                <div style={{ fontSize: '11px', color: '#4ADE80', fontWeight: 600 }}>✓ Loaded</div>
              ) : (
                <>
                  <input ref={priorFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handlePriorUpload} />
                  <button
                    onClick={() => priorFileRef.current?.click()}
                    disabled={priorUploading}
                    style={{ background: '#F5F5F0', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', color: '#374151', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}
                  >
                    {priorUploading ? 'Uploading…' : 'Upload CSV'}
                  </button>
                </>
              )}
            </div>
            {priorError && (
              <div style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.06)', borderTop: '1px solid rgba(239,68,68,0.15)', fontSize: '11px', color: '#DC2626' }}>{priorError}</div>
            )}
          </div>

          {/* ── Recommended Actions ─────────────────────────────────────── */}
          <div style={{ marginTop: '10px', border: `1.5px solid ${includeActions ? 'rgba(245,166,35,0.4)' : '#e5e7eb'}`, borderRadius: '10px', overflow: 'hidden', background: includeActions ? 'rgba(245,166,35,0.03)' : '#fafafa', transition: 'border-color 0.15s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: ORANGE, flexShrink: 0 }} />
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1, cursor: 'pointer' }}>
                <input type="checkbox" checked={includeActions} onChange={e => setIncludeActions(e.target.checked)}
                  style={{ marginTop: '2px', accentColor: ORANGE, width: '14px', height: '14px', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: NAVY }}>Recommended Actions</div>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '1px' }}>Auto-generated from your data — edit as needed before exporting</div>
                </div>
              </label>
            </div>

            {includeActions && (
              <div style={{ borderTop: '1px solid #e5e7eb', padding: '12px 14px', background: '#fff' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {actions.map((action, idx) => (
                    <div key={action.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#fafafa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }}>
                        <select
                          value={action.priority}
                          onChange={e => setActions(prev => prev.map((a, i) => i === idx ? { ...a, priority: e.target.value as RecommendedAction['priority'], edited: true } : a))}
                          style={{
                            fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                            background: action.priority === 'high' ? '#FEE2E2' : action.priority === 'medium' ? '#FEF3C7' : '#F0FDF4',
                            color: action.priority === 'high' ? '#DC2626' : action.priority === 'medium' ? '#D97706' : '#16A34A',
                            textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, outline: 'none', fontFamily: "'Metropolis', sans-serif",
                          }}
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <input
                          value={action.title}
                          onChange={e => setActions(prev => prev.map((a, i) => i === idx ? { ...a, title: e.target.value, edited: true } : a))}
                          style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '12px', fontWeight: 700, color: NAVY, outline: 'none', fontFamily: "'Metropolis', sans-serif" }}
                        />
                        <button
                          onClick={() => setActions(prev => prev.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}
                          title="Remove action"
                        >✕</button>
                      </div>
                      <textarea
                        value={action.body}
                        onChange={e => setActions(prev => prev.map((a, i) => i === idx ? { ...a, body: e.target.value, edited: true } : a))}
                        rows={2}
                        style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '11px', color: '#374151', outline: 'none', padding: '8px 10px', resize: 'vertical', lineHeight: '1.5', fontFamily: "'Metropolis', sans-serif", boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => setActions(prev => [...prev, { id: `custom-${Date.now()}`, category: 'general', priority: 'medium', title: 'New action', body: '', edited: true }])}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', border: '1.5px dashed #D1D5DB', background: 'transparent', color: '#6B7280', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '14px' }}>+</span> Add action
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: '#FAFAF8', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>
            <span style={{ fontWeight: 700, color: NAVY }}>{enabledCount}</span> section{enabledCount !== 1 ? 's' : ''} · cover page always included
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ ...BASE, padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, background: '#F5F5F0', border: '1px solid #e5e7eb', color: NAVY, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || enabledCount === 0}
              style={{ ...BASE, padding: '8px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 800, background: generating || enabledCount === 0 ? '#9CA3AF' : ORANGE, border: 'none', color: NAVY, cursor: generating || enabledCount === 0 ? 'not-allowed' : 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {generating ? (
                <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(0,0,0,0.2)', borderTopColor: NAVY, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating…</>
              ) : (
                <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download PDF</>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );

  if (isTab) return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>{inner}</div>;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {inner}
    </div>
  );
}
