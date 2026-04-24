import Papa from 'papaparse';

export type DetectedType = 'shipments' | 'stats' | 'locations' | 'inventory-changes' | 'unknown';

export const TYPE_META: Record<DetectedType, { label: string; color: string; bg: string }> = {
  shipments:           { label: 'Shipments Report',          color: '#166534', bg: '#F0FDF4' },
  stats:               { label: 'QuickSight CSS_5_Insights',  color: '#1E40AF', bg: '#EFF6FF' },
  locations:           { label: 'Product Locations CSV',      color: '#6B21A8', bg: '#FAF5FF' },
  'inventory-changes': { label: 'Inventory Changes CSV',      color: '#92400E', bg: '#FFFBEB' },
  unknown:             { label: 'Unknown format',             color: '#991B1B', bg: '#FEF2F2' },
};

export function detectReportType(headers: string[]): DetectedType {
  const h = new Set(headers.map(s => s.trim()));
  const has = (...keys: string[]) => keys.some(k => h.has(k));

  if (has('Shipping Label ID', 'shipping_label_id', 'label_id')) return 'shipments';
  if (has('Previous On Hand', 'previous_on_hand', 'Prev On Hand')) return 'inventory-changes';
  if (has('Location', 'location') && has('SKU', 'sku', 'Sku')) return 'locations';
  if (has('accountId', 'account_id', 'account id', 'labelCount', 'label_count', 'label count')) return 'stats';
  return 'unknown';
}

export function readCSVHeaders(file: File): Promise<string[]> {
  return new Promise(resolve => {
    Papa.parse(file, {
      preview: 1,
      header: true,
      complete: r => resolve(r.meta.fields ?? []),
      error:    () => resolve([]),
    });
  });
}
