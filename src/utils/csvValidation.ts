/** CSV column validation — returns friendly errors/warnings before parsing proceeds. */

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
  warnings: string[];
}

// ── Shipments CSV ────────────────────────────────────────────────────────────

/** Required columns for the shipments CSV (any alias satisfies the requirement). */
const SHIPMENT_REQUIRED: { label: string; aliases: string[] }[] = [
  { label: 'Shipping Label ID', aliases: ['Shipping Label ID', 'shipping_label_id', 'label_id'] },
  { label: 'Order date',        aliases: ['Order date', 'order_date', 'Order Date', 'orderdate'] },
  { label: 'Warehouse',         aliases: ['Warehouse', 'warehouse'] },
  { label: 'Carrier',           aliases: ['Carrier', 'carrier'] },
  { label: 'State',             aliases: ['State', 'state'] },
  { label: 'Zip',               aliases: ['Zip', 'zip', 'ZIP'] },
  { label: 'Country',           aliases: ['Country', 'country'] },
  { label: 'Label Cost',        aliases: ['Label Cost', 'label_cost', 'LabelCost'] },
  { label: 'Weight (lb)',       aliases: ['Weight (lb)', 'weight_lb', 'Weight', 'weight'] },
];

const SHIPMENT_OPTIONAL: { label: string; aliases: string[]; warningDetail?: string }[] = [
  { label: '3PL Customer / Account', aliases: ['3PL Customer', '3pl_customer', '3PL customer', 'Customer', 'Brand', 'Account', 'Store Name', 'store_name'] },
  {
    label: 'Total Shipping Charged',
    aliases: ['Total Shipping Charged', 'total_shipping_charged'],
    warningDetail: 'Cost gap analysis will be unavailable — re-export from ShipHero with billing data included.',
  },
];

export function validateShipmentColumns(headers: string[]): { errors: string[]; warnings: string[] } {
  const norm = headers.map(h => h.trim());
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of SHIPMENT_REQUIRED) {
    if (!req.aliases.some(a => norm.includes(a))) {
      errors.push(`Missing required column: "${req.label}" (accepted names: ${req.aliases.slice(0, 3).join(', ')})`);
    }
  }

  for (const opt of SHIPMENT_OPTIONAL) {
    if (!opt.aliases.some(a => norm.includes(a))) {
      const detail = opt.warningDetail ?? 'Some metrics may be incomplete.';
      warnings.push(`Missing column "${opt.label}": ${detail}`);
    }
  }

  return { errors, warnings };
}

// ── Item Locations CSV ────────────────────────────────────────────────────────

const ITEM_LOCATION_REQUIRED: { label: string; aliases: string[] }[] = [
  { label: 'Item',          aliases: ['Item', 'item', 'Product', 'product', 'Name', 'name'] },
  { label: 'SKU',           aliases: ['SKU', 'sku', 'Sku'] },
  { label: 'Warehouse',     aliases: ['Warehouse', 'warehouse'] },
  { label: 'Location',      aliases: ['Location', 'location'] },
  { label: 'Units',         aliases: ['Units', 'units', 'Quantity', 'quantity', 'qty'] },
];

export function validateItemLocationColumns(headers: string[]): { errors: string[]; warnings: string[] } {
  const norm = headers.map(h => h.trim());
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of ITEM_LOCATION_REQUIRED) {
    if (!req.aliases.some(a => norm.includes(a))) {
      errors.push(`Missing required column: "${req.label}" (accepted names: ${req.aliases.slice(0, 3).join(', ')})`);
    }
  }

  if (!norm.some(h => /expir/i.test(h) || /exp.*date/i.test(h) || h === 'Expiration Date')) {
    warnings.push('No expiration date column found — expiry alerts will be unavailable');
  }

  return { errors, warnings };
}

// ── Inventory Change CSV ─────────────────────────────────────────────────────

const INV_CHANGE_REQUIRED: { label: string; aliases: string[] }[] = [
  { label: 'Date',              aliases: ['Date', 'date', 'Timestamp', 'timestamp', 'Created At', 'created_at'] },
  { label: 'SKU',               aliases: ['SKU', 'sku', 'Sku'] },
  { label: 'Previous On Hand',  aliases: ['Previous On Hand', 'previous_on_hand', 'Previous', 'Prev On Hand'] },
  { label: 'Updated On Hand',   aliases: ['Updated On Hand', 'updated_on_hand', 'Updated', 'New On Hand'] },
  { label: 'Changed By',        aliases: ['Changed By', 'changed_by', 'User', 'user', 'Modified By'] },
];

export function validateInventoryChangeColumns(headers: string[]): { errors: string[]; warnings: string[] } {
  const norm = headers.map(h => h.trim());
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of INV_CHANGE_REQUIRED) {
    if (!req.aliases.some(a => norm.includes(a))) {
      errors.push(`Missing required column: "${req.label}" (accepted names: ${req.aliases.slice(0, 3).join(', ')})`);
    }
  }

  if (!norm.some(h => /reason/i.test(h))) {
    warnings.push('No reason/notes column found — change categorization will be limited');
  }

  return { errors, warnings };
}

// ── Generic helper ────────────────────────────────────────────────────────────

/** Formats a validation result as a human-readable message for display in the UI. */
export function formatValidationMessage(errors: string[], warnings: string[]): string | null {
  if (errors.length === 0 && warnings.length === 0) return null;
  const lines: string[] = [];
  if (errors.length > 0) {
    lines.push(`${errors.length} column error${errors.length > 1 ? 's' : ''}:`);
    errors.forEach(e => lines.push(`  • ${e}`));
  }
  if (warnings.length > 0) {
    lines.push(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}:`);
    warnings.forEach(w => lines.push(`  • ${w}`));
  }
  return lines.join('\n');
}
