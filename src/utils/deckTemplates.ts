import type { DeckSectionKey, CustomDeckSlide } from '../components/pdf/QBRDeckDocument';

export interface DeckTemplate {
  id: string;
  name: string;
  createdAt?: string;
  isBuiltIn?: true;
  sectionKeys: DeckSectionKey[];
  fontOption: 'A' | 'B' | 'C';
  customSlides: CustomDeckSlide[];
}

const mkDivider = (title: string, orderKey: string): CustomDeckSlide => ({
  id: crypto.randomUUID(), variant: 'divider', enabled: true,
  title, orderKey,
});

export const BUILT_IN_TEMPLATES: DeckTemplate[] = [
  {
    id: 'builtin-standard',
    name: 'Standard QBR',
    isBuiltIn: true,
    fontOption: 'B',
    sectionKeys: [
      'agenda', 'introductions',
      'accountOverview', 'carrierMix', 'serviceLevelMix',
      'zonePerformance', 'recommendedActions',
    ],
    customSlides: [],
  },
  {
    id: 'builtin-shipping',
    name: 'Shipping Deep Dive',
    isBuiltIn: true,
    fontOption: 'B',
    sectionKeys: [
      'agenda',
      'accountOverview', 'shippingKPIs',
      'carrierMix', 'serviceLevelMix', 'labelCostByCarrier',
      'zonePerformance', 'upsAvgCost', 'upsZoneBreakdown',
      'zoneMap', 'warehouseInsights', 'shipmentsByState',
      'recommendedActions',
    ],
    customSlides: [
      mkDivider('Carrier Analysis', 'after:accountOverview'),
      mkDivider('Zone & Cost Analysis', 'after:labelCostByCarrier'),
    ],
  },
  {
    id: 'builtin-account-health',
    name: 'Account Health Review',
    isBuiltIn: true,
    fontOption: 'B',
    sectionKeys: [
      'agenda',
      'accountOverview', 'accountHealthKPIs',
      'volumeTrend', 'childAccountTrends',
      'carrierSpendGMV', 'fulfillmentMix',
      'childAccountScorecard',
      'recommendedActions',
    ],
    customSlides: [
      mkDivider('Growth Trends', 'after:accountHealthKPIs'),
    ],
  },
  {
    id: 'builtin-executive',
    name: 'Executive Summary',
    isBuiltIn: true,
    fontOption: 'C',
    sectionKeys: [
      'accountOverview', 'costGap',
      'carrierMix', 'volumeTrend',
      'recommendedActions',
    ],
    customSlides: [],
  },
];

const TEMPLATES_KEY = 'shiphero_templates_v1';

export function loadSavedTemplates(): DeckTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as DeckTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveTemplate(template: DeckTemplate): void {
  try {
    const existing = loadSavedTemplates().filter(t => t.id !== template.id);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([template, ...existing]));
  } catch { /* ignore */ }
}

export function deleteTemplate(id: string): void {
  try {
    const updated = loadSavedTemplates().filter(t => t.id !== id);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}
