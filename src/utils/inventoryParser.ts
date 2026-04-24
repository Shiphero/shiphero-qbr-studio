import Papa from 'papaparse';

// ─── Item Locations ────────────────────────────────────────────────────────────

export interface ItemLocationRow {
  item: string;
  sku: string;
  warehouse: string;
  client: string;
  location: string;
  locationType: string;
  units: number;
  pickable: boolean;
  sellable: boolean;
  hasLot: boolean;
  lotName: string;
  expDate: string;           // "2027-02-23" or ""
  daysToExpire: number | null;
  creationDate: string;
}

// ─── Inventory Change ──────────────────────────────────────────────────────────

export type ChangeCategory =
  | 'DTC Order'
  | 'B2B / Wholesale'
  | 'Inbound PO'
  | 'Manual Adjustment'
  | 'Kit Update'
  | 'Product Update'
  | 'Damage'
  | 'Other';

export interface InventoryChangeRow {
  client: string;
  date: string;              // ISO timestamp "2026-03-24 07:41:12-04:00"
  warehouse: string;
  sku: string;
  name: string;
  location: string;
  previousOnHand: number;
  updatedOnHand: number;
  unitDelta: number;         // updatedOnHand - previousOnHand
  rawReason: string;
  reason: string;            // HTML-stripped
  reasonCategory: ChangeCategory;
  changedBy: string;
  lotName: string;
  lotExpiration: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/##?(\w)/g, '#$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v: string | undefined): number {
  if (!v || v.trim() === '') return 0;
  return parseFloat(v.replace(/,/g, '')) || 0;
}

function bool(v: string | undefined): boolean {
  return (v || '').toLowerCase().trim() === 'yes';
}

export function categorizeReason(raw: string): ChangeCategory {
  const r = raw.toLowerCase();
  if (r.includes('pickingjob')) return 'B2B / Wholesale';
  if (r.includes('wholesale order') && r.includes('shipped')) return 'B2B / Wholesale';
  if (r.includes('order') && r.includes('shipped')) return 'DTC Order';
  if (r.includes('received from purchase order')) return 'Inbound PO';
  if (r.includes('kit sku') || r.includes('kit product')) return 'Kit Update';
  if (r.includes('was updated')) return 'Product Update';
  if (
    r.includes('change from the product page') ||
    r.includes('via the shiphero web dashboard') ||
    r.includes('manual')
  ) return 'Manual Adjustment';
  if (r.includes('damage') || r.includes('damaged')) return 'Damage';
  return 'Other';
}

/** Strip order/PO numbers so similar reasons group together */
export function normalizeReason(reason: string): string {
  return reason
    .replace(/#[\w-]+/g, '#...')
    .replace(/purchase order\s+[\w-]+/gi, 'Purchase Order #...')
    .replace(/po\s+[\w-]+/gi, 'PO #...')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/** Normalize a raw header to a canonical lowercase key without spaces/underscores */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '_');
}

/**
 * Build a case-insensitive field-lookup helper from a parsed row.
 * Accepts multiple candidate names so callers can handle header variations.
 */
function makeGet(r: Record<string, string>) {
  return (...candidates: string[]): string => {
    for (const name of candidates) {
      const norm = normalizeHeader(name);
      const val = r[norm];
      if (val !== undefined) return val.trim();
    }
    return '';
  };
}

export function parseItemLocationsCSV(file: File): Promise<ItemLocationRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (results) => {
        try {
          const rows = results.data.map((r): ItemLocationRow => {
            const get = makeGet(r);
            const daysStr = get('days_to_expire', 'days to expire', 'days');
            const days =
              daysStr && !isNaN(Number(daysStr)) ? Number(daysStr) : null;
            return {
              item: get('item', 'item_name', 'product_name', 'product'),
              sku: get('sku', 'item_sku'),
              warehouse: get('warehouse', 'warehouse_name'),
              client: get('client', 'client_name', 'threepl_name', 'account'),
              location: get('location', 'location_name'),
              locationType: get('type', 'location_type'),
              units: num(get('units', 'qty', 'quantity', 'on_hand')),
              pickable: bool(get('pickable')),
              sellable: bool(get('sellable')),
              hasLot: bool(get('active_lot', 'has_lot', 'lot')),
              lotName: get('lot_name', 'lot'),
              expDate: get('exp_date', 'expiration_date', 'expiry_date', 'expiry'),
              daysToExpire: days,
              creationDate: get('creation_date', 'created_at', 'created_date'),
            };
          });
          // Exclude digital products and blanks
          resolve(
            rows.filter(
              (r) => r.sku !== '' && r.locationType.toLowerCase() !== 'digital'
            )
          );
        } catch (err) {
          reject(err);
        }
      },
      error: reject,
    });
  });
}

export function parseInventoryChangeCSV(file: File): Promise<InventoryChangeRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (results) => {
        try {
          const rows = results.data.map((r): InventoryChangeRow => {
            const get = makeGet(r);
            const prev = num(get('previous_on_hand', 'prev_on_hand', 'previous_qty'));
            const updated = num(get('updated_on_hand', 'new_on_hand', 'updated_qty'));
            const rawReason = get('reason', 'change_reason', 'notes') || '';
            const reason = stripHtml(rawReason);
            return {
              client: get('threepl_name', 'client', 'client_name', 'account'),
              date: get('date', 'created_at', 'timestamp'),
              warehouse: get('warehouse', 'warehouse_name'),
              sku: get('sku', 'item_sku'),
              name: get('name', 'item_name', 'product_name'),
              location: get('location', 'location_name'),
              previousOnHand: prev,
              updatedOnHand: updated,
              unitDelta: updated - prev,
              rawReason,
              reason,
              reasonCategory: categorizeReason(rawReason),
              changedBy: get('changed_by', 'user', 'updated_by'),
              lotName: get('lot_name', 'lot'),
              lotExpiration: get('lot_expiration', 'expiration_date', 'exp_date'),
            };
          });
          resolve(rows.filter((r) => r.client !== '' && r.sku !== ''));
        } catch (err) {
          reject(err);
        }
      },
      error: reject,
    });
  });
}
