import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useData } from './DataContext';
import { usePDF } from './PDFContext';
import type { DeckSectionKey, DeckSectionToggle, SectionInsight, CustomDeckSlide, DataInstanceSlide } from '../components/pdf/QBRDeckDocument';
import type { DeckTemplate } from '../utils/deckTemplates';

export const SECTION_ORDER: DeckSectionKey[] = [
  'agenda', 'introductions',
  'accountOverview', 'costGap', 'carrierMix', 'serviceLevelMix', 'labelCostByCarrier',
  'zonePerformance', 'expiryAlerts', 'daysOnHand', 'recommendedActions',
  'volumeTrend', 'childAccountTrends', 'carrierSpendGMV', 'fulfillmentMix',
  'childAccountScorecard',
  'manualAdjustments',
  'shippingKPIs', 'zoneMap', 'warehouseInsights', 'shipmentsByState',
  'upsAvgCost', 'upsZoneBreakdown',
  'inventoryKPIs', 'rateCardKPIs', 'threePlKPIs', 'accountHealthKPIs', 'accountDetailTable',
  'priorQuarterKPIs', 'priorQuarterCarrierMix',
];

export const SECTION_LABELS: Record<DeckSectionKey, string> = {
  agenda:                'Agenda',
  introductions:         'Introductions',
  accountOverview:       'Account Overview',
  costGap:               'Cost Analysis',
  carrierMix:            'Carrier Mix',
  serviceLevelMix:       'Service Level Mix',
  labelCostByCarrier:    'Label Cost by Carrier',
  zonePerformance:       'Rate Card Performance',
  expiryAlerts:          'Expiry Alerts',
  daysOnHand:            'Days on Hand',
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

export interface SectionAvailability {
  available: boolean;
  reason: string;
}

// ─── localStorage persistence ─────────────────────────────────────────────────
const DECK_STORAGE_KEY = 'shiphero_deck_v1';

export interface PersistedDeckState {
  sections: DeckSectionToggle[];
  customSlides: CustomDeckSlide[];
  dataInstances: DataInstanceSlide[];
  execSummary?: string;
}

function loadDeckState(): Partial<PersistedDeckState> {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedDeckState>) : {};
  } catch {
    return {};
  }
}

function saveDeckState(state: PersistedDeckState) {
  try {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded — silently ignore
  }
}

interface DeckContextValue {
  sections: DeckSectionToggle[];
  setSections: React.Dispatch<React.SetStateAction<DeckSectionToggle[]>>;
  toggleSection: (key: DeckSectionKey) => void;
  setInsight: (key: DeckSectionKey, insight: SectionInsight | undefined) => void;
  setCustomLabel: (key: DeckSectionKey, label: string | undefined) => void;
  setSectionLabel: (key: DeckSectionKey, label: string | undefined) => void;
  setNotes: (key: DeckSectionKey, notes: string | undefined) => void;
  setHidden: (key: DeckSectionKey, hidden: boolean) => void;
  setDuplicates: (key: DeckSectionKey, count: number) => void;
  availability: Record<DeckSectionKey, SectionAvailability>;
  customSlides: CustomDeckSlide[];
  addCustomSlide: (slide: CustomDeckSlide) => void;
  updateCustomSlide: (id: string, patch: Partial<CustomDeckSlide>) => void;
  removeCustomSlide: (id: string) => void;
  setLayout: (key: DeckSectionKey, layout: 'standard' | 'wide' | undefined) => void;
  setRowFilter: (key: DeckSectionKey, filter: string[] | undefined) => void;
  setKpiFilter: (key: DeckSectionKey, filter: string[] | undefined) => void;
  setContentOffset: (key: DeckSectionKey, offset: { dx: number; dy: number } | undefined) => void;
  setNarrative: (key: DeckSectionKey, narrative: string | undefined) => void;
  setCallout: (key: DeckSectionKey, callout: { stat: string; headline: string; body?: string; icon?: string } | undefined) => void;
  clearDeck: () => void;
  applyTemplate: (template: DeckTemplate) => void;
  /** Reorder all slides atomically — newOrder is IDs of non-cover, non-instance slides in desired sequence */
  reorderDeck: (newOrder: string[]) => void;
  /** Extra copies of a data section with independent configs (different filters, narrative, etc.) */
  dataInstances: DataInstanceSlide[];
  addDataInstance: (parentKey: DeckSectionKey) => DataInstanceSlide;
  updateDataInstance: (id: string, patch: Partial<DataInstanceSlide>) => void;
  removeDataInstance: (id: string) => void;
  /** Shared exec summary — kept in sync between FollowUpDocument and Deck Builder cover panel */
  execSummary: string;
  setExecSummary: (v: string) => void;
  /** Bulk-apply imported state from a session bundle */
  applyImportedDeckState: (rawJson: string) => void;
}

const DeckContext = createContext<DeckContextValue | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const { rawShipments, warehouses, statsRows, priorPeriod } = useData();
  const { inventoryData } = usePDF();

  const originZip      = warehouses[0]?.zip?.trim() || '';
  const hasShipping    = rawShipments.length > 0;
  const hasCharged     = rawShipments.some(s => s.totalShippingCharged > 0);
  const hasRateCard    = hasShipping && !!originZip;
  const hasExpiry      = (inventoryData?.expiryAlerts?.length ?? 0) > 0;
  const hasDOH         = (inventoryData?.daysOnHand?.length ?? 0) > 0;
  const hasStats       = statsRows.length > 0;
  const hasManualAdj   = (inventoryData?.manualAdjRows?.length ?? 0) > 0;
  const hasPriorPeriod = hasShipping && !!priorPeriod;

  const availability: Record<DeckSectionKey, SectionAvailability> = {
    agenda:                { available: true,         reason: '' },
    introductions:         { available: true,         reason: '' },
    accountOverview:       { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    costGap:               { available: hasCharged,   reason: 'Requires "Total Shipping Charged" column in CSV' },
    carrierMix:            { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    serviceLevelMix:       { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    labelCostByCarrier:    { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    zonePerformance:       { available: hasRateCard,  reason: 'Requires Shipments CSV + warehouse ZIP' },
    expiryAlerts:          { available: hasExpiry,    reason: 'Upload Product Locations CSV on Inventory tab' },
    daysOnHand:            { available: hasDOH,       reason: 'Upload both inventory CSVs on Inventory tab' },
    recommendedActions:    { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    volumeTrend:           { available: hasStats,     reason: 'Upload Monthly Statistics CSV on Account Health tab' },
    childAccountTrends:    { available: hasStats,     reason: 'Upload Monthly Statistics CSV on Account Health tab' },
    carrierSpendGMV:       { available: hasStats,     reason: 'Upload Monthly Statistics CSV on Account Health tab' },
    fulfillmentMix:        { available: hasStats,     reason: 'Upload Monthly Statistics CSV on Account Health tab' },
    childAccountScorecard: { available: hasStats,     reason: 'Upload Monthly Statistics CSV on Account Health tab' },
    manualAdjustments:     { available: hasManualAdj, reason: 'Upload an Inventory Change Report CSV on Inventory tab' },
    shippingKPIs:          { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    upsAvgCost:            { available: hasRateCard,  reason: 'Requires Shipments CSV + warehouse ZIP' },
    upsZoneBreakdown:      { available: hasRateCard,  reason: 'Requires Shipments CSV + warehouse ZIP' },
    zoneMap:               { available: hasRateCard,  reason: 'Requires Shipments CSV + warehouse ZIP' },
    warehouseInsights:     { available: hasRateCard,  reason: 'Requires Shipments CSV + warehouse ZIP' },
    shipmentsByState:      { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    inventoryKPIs:         { available: hasExpiry || hasDOH, reason: 'Upload inventory CSVs on Inventory tab' },
    rateCardKPIs:          { available: hasRateCard,  reason: 'Requires Shipments CSV + warehouse ZIP' },
    threePlKPIs:           { available: hasShipping,  reason: 'Upload a Shipments CSV first' },
    accountDetailTable:    { available: hasShipping,    reason: 'Upload a Shipments CSV first' },
    accountHealthKPIs:     { available: hasStats,       reason: 'Upload Monthly Statistics CSV on Account Health tab' },
    priorQuarterKPIs:      { available: hasPriorPeriod, reason: 'Upload a prior-period CSV on the Prior Quarter tab' },
    priorQuarterCarrierMix:{ available: hasPriorPeriod, reason: 'Upload a prior-period CSV on the Prior Quarter tab' },
  };

  const [sections, setSections] = useState<DeckSectionToggle[]>(() => {
    const saved = loadDeckState().sections;
    if (saved?.length) {
      const savedMap = new Map(saved.map(s => [s.key, s]));
      return SECTION_ORDER.map(key => savedMap.get(key) ?? { key, enabled: false });
    }
    return SECTION_ORDER.map(key => ({ key, enabled: false }));
  });

  const [customSlides, setCustomSlides] = useState<CustomDeckSlide[]>(
    () => loadDeckState().customSlides ?? []
  );
  const [dataInstances, setDataInstances] = useState<DataInstanceSlide[]>(
    () => loadDeckState().dataInstances ?? []
  );
  const [execSummary, setExecSummaryState] = useState<string>(
    () => loadDeckState().execSummary ?? ''
  );

  const setExecSummary = (v: string) => setExecSummaryState(v);

  useEffect(() => {
    saveDeckState({ sections, customSlides, dataInstances, execSummary });
  }, [sections, customSlides, dataInstances, execSummary]);

  const clearDeck = () => {
    localStorage.removeItem(DECK_STORAGE_KEY);
    setSections(SECTION_ORDER.map(key => ({ key, enabled: false })));
    setCustomSlides([]);
    setDataInstances([]);
    setExecSummaryState('');
  };

  const applyImportedDeckState = (rawJson: string) => {
    try {
      const state = JSON.parse(rawJson) as Partial<PersistedDeckState>;
      if (state.sections?.length) {
        const savedMap = new Map(state.sections.map(s => [s.key as DeckSectionKey, s]));
        setSections(SECTION_ORDER.map(key => savedMap.get(key) ?? { key, enabled: false }));
      }
      if (state.customSlides) setCustomSlides(state.customSlides);
      if (state.dataInstances) setDataInstances(state.dataInstances);
      if (state.execSummary !== undefined) setExecSummaryState(state.execSummary);
    } catch {
      console.warn('[DeckContext] applyImportedDeckState: invalid JSON');
    }
  };

  const applyTemplate = (template: DeckTemplate) => {
    const templateKeySet = new Set(template.sectionKeys);
    setSections(prev => {
      const map = new Map(prev.map(s => [s.key, s]));
      // Enabled sections in template order, preserving existing insight/narrative data
      const inTemplate = template.sectionKeys
        .filter(k => map.has(k))
        .map(k => ({ ...map.get(k)!, enabled: true }));
      // All other sections — disabled, preserve their data
      const notInTemplate = prev
        .filter(s => !templateKeySet.has(s.key))
        .map(s => ({ ...s, enabled: false }));
      return [...inTemplate, ...notInTemplate];
    });
    // Replace custom slides with template's (give each a fresh id)
    setCustomSlides(
      template.customSlides.map(cs => ({ ...cs, id: crypto.randomUUID() }))
    );
  };

  const reorderDeck = (newOrder: string[]) => {
    // Step 1: reorder data sections to match newOrder
    setSections(prev => {
      const dataKeysInNewOrder = newOrder.filter(id =>
        prev.some(s => s.key === (id as DeckSectionKey))
      ) as DeckSectionKey[];
      const dataKeySet = new Set(dataKeysInNewOrder);
      const map = new Map(prev.map(s => [s.key, s]));
      return [
        ...dataKeysInNewOrder.map(k => map.get(k)!),
        ...prev.filter(s => !dataKeySet.has(s.key)),
      ];
    });

    // Step 2: reorder customSlides array and recompute orderKeys
    setCustomSlides(prev => {
      const customIdSet = new Set(prev.map(c => c.id));
      // Walk full order to assign each custom slide an anchor
      const anchorMap = new Map<string, string>();
      let lastAnchor = 'cover';
      for (const id of ['cover', ...newOrder]) {
        if (customIdSet.has(id)) {
          anchorMap.set(id, `after:${lastAnchor}`);
        } else {
          lastAnchor = id; // 'cover' or a data section key
        }
      }
      const customInNewOrder = newOrder
        .filter(id => customIdSet.has(id))
        .map(id => prev.find(c => c.id === id)!)
        .filter(Boolean)
        .map(c => ({ ...c, orderKey: anchorMap.get(c.id) ?? c.orderKey }));
      const handledIds = new Set(customInNewOrder.map(c => c.id));
      return [...customInNewOrder, ...prev.filter(c => !handledIds.has(c.id))];
    });
  };

  const toggleSection = (key: DeckSectionKey) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, enabled: !s.enabled } : s));
  };

  const setInsight = (key: DeckSectionKey, insight: SectionInsight | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, insight } : s));
  };

  const setCustomLabel = (key: DeckSectionKey, label: string | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, customLabel: label || undefined } : s));
  };

  const setSectionLabel = (key: DeckSectionKey, label: string | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, sectionLabel: label || undefined } : s));
  };

  const setNotes = (key: DeckSectionKey, notes: string | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, notes: notes || undefined } : s));
  };

  const setHidden = (key: DeckSectionKey, hidden: boolean) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, hidden: hidden || undefined } : s));
  };

  const setDuplicates = (key: DeckSectionKey, count: number) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, duplicates: count > 0 ? count : undefined } : s));
  };

  const addCustomSlide = (slide: CustomDeckSlide) => {
    setCustomSlides(prev => [...prev, slide]);
  };

  const updateCustomSlide = (id: string, patch: Partial<CustomDeckSlide>) => {
    setCustomSlides(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const removeCustomSlide = (id: string) => {
    setCustomSlides(prev => prev.filter(c => c.id !== id));
  };

  const addDataInstance = (parentKey: DeckSectionKey): DataInstanceSlide => {
    const inst: DataInstanceSlide = { id: crypto.randomUUID(), parentKey, orderKey: `after:${parentKey}` };
    setDataInstances(prev => [...prev, inst]);
    return inst;
  };

  const updateDataInstance = (id: string, patch: Partial<DataInstanceSlide>) => {
    setDataInstances(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  };

  const removeDataInstance = (id: string) => {
    setDataInstances(prev => prev.filter(d => d.id !== id));
  };

  const setLayout = (key: DeckSectionKey, layout: 'standard' | 'wide' | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, layout: layout || undefined } : s));
  };

  const setRowFilter = (key: DeckSectionKey, filter: string[] | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, rowFilter: filter } : s));
  };

  const setKpiFilter = (key: DeckSectionKey, filter: string[] | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, kpiFilter: filter?.length ? filter : undefined } : s));
  };

  const setContentOffset = (key: DeckSectionKey, offset: { dx: number; dy: number } | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, contentOffset: offset } : s));
  };

  const setNarrative = (key: DeckSectionKey, narrative: string | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, narrative: narrative || undefined } : s));
  };

  const setCallout = (key: DeckSectionKey, callout: { stat: string; headline: string; body?: string; icon?: string } | undefined) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, callout: callout ?? undefined } : s));
  };

  return (
    <DeckContext.Provider value={{
      sections, setSections, toggleSection, setInsight, setCustomLabel, setSectionLabel,
      setNotes, setHidden, setDuplicates, availability,
      customSlides, addCustomSlide, updateCustomSlide, removeCustomSlide,
      setLayout, setRowFilter, setKpiFilter, setContentOffset, setNarrative, setCallout,
      clearDeck, applyTemplate, reorderDeck,
      dataInstances, addDataInstance, updateDataInstance, removeDataInstance,
      execSummary, setExecSummary, applyImportedDeckState,
    }}>
      {children}
    </DeckContext.Provider>
  );
}

export function useDeck() {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error('useDeck must be used within DeckProvider');
  return ctx;
}

export type { SectionInsight, CustomDeckSlide };
