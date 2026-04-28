/**
 * Defines the selectable stat tiles for each KPI summary slide.
 * Used by:
 *  - QBRDeckBuilder  → renders the "Stats to show" checkbox panel
 *  - LiveSlidePreview → filters which tiles are visible in the canvas preview
 *  - generateQBRDeck  → renders only selected tiles onto the PPTX slide
 */
import type { DeckSectionKey } from '../components/pdf/QBRDeckDocument';

export interface KpiStatDef {
  id: string;
  /** Human-readable checkbox label shown in the builder */
  label: string;
  /** When true, this stat may not exist depending on available data */
  conditional?: boolean;
}

const SHIPPING_STATS: KpiStatDef[] = [
  { id: 'totalShipments', label: 'Total Shipments' },
  { id: 'totalLabelCost', label: 'Total Label Cost' },
  { id: 'avgLabelCost',   label: 'Avg Label Cost' },
  { id: 'accounts',       label: 'Accounts' },
  { id: 'avgZone',        label: 'Avg Zone',     conditional: true },
  { id: 'totalBilled',    label: 'Total Billed', conditional: true },
];

export const KPI_SLIDE_STATS: Partial<Record<DeckSectionKey, KpiStatDef[]>> = {
  accountOverview:  SHIPPING_STATS,
  shippingKPIs:     SHIPPING_STATS,

  accountHealthKPIs: [
    { id: 'orders',          label: 'Orders' },
    { id: 'labels',          label: 'Labels' },
    { id: 'carrierSpend',    label: 'Carrier Spend' },
    { id: 'gmv',             label: 'GMV' },
    { id: 'platformBilling', label: 'Platform Billing' },
  ],

  threePlKPIs: [
    { id: '3plAccounts',   label: '3PL Accounts' },
    { id: 'totalShipments',label: 'Total Shipments' },
    { id: 'totalLabelCost',label: 'Total Label Cost' },
    { id: 'avgLabelCost',  label: 'Avg Label Cost' },
    { id: 'totalBilled',   label: 'Total Billed', conditional: true },
    { id: 'topAccount',    label: 'Top Account' },
  ],

  inventoryKPIs: [
    { id: 'activeSkus',  label: 'Active SKUs',          conditional: true },
    { id: 'totalUnits',  label: 'Total Units on Hand',   conditional: true },
    { id: 'expiring90',  label: 'Expiring < 90 Days',   conditional: true },
    { id: 'avgDOH',      label: 'Avg Days on Hand',      conditional: true },
    { id: 'manualAdj',   label: 'Manual Adjustments',    conditional: true },
  ],

  rateCardKPIs: [
    { id: 'totalShipments', label: 'Shipments Analyzed' },
    { id: 'mrcTotal',       label: 'ShipHero MRC Total',  conditional: true },
    { id: 'actualTotal',    label: 'Actual Total Paid',    conditional: true },
    { id: 'totalDelta',     label: 'Total Delta',          conditional: true },
    { id: 'zonesAnalyzed',  label: 'Zones Analyzed' },
    { id: 'avgRateDelta',   label: 'Avg Rate Delta' },
    { id: 'zonesAboveMRC',  label: 'Zones Above MRC' },
  ],

  priorQuarterKPIs: [
    { id: 'shipmentsChange', label: 'Shipments Δ' },
    { id: 'spendChange',     label: 'Spend Δ' },
    { id: 'avgCostChange',   label: 'Avg Cost Δ' },
    { id: 'priorPeriod',     label: 'Prior Period' },
  ],
};

/** Returns true if this section key has selectable KPI stats */
export function isKpiSlide(key: DeckSectionKey): boolean {
  return key in KPI_SLIDE_STATS;
}

/**
 * Filters a tile list to only the IDs in kpiFilter.
 * If kpiFilter is empty/undefined, returns all tiles.
 */
export function applyKpiFilter<T extends { id: string }>(
  tiles: T[],
  kpiFilter?: string[],
): T[] {
  if (!kpiFilter?.length) return tiles;
  const allowed = new Set(kpiFilter);
  return tiles.filter(t => allowed.has(t.id));
}
