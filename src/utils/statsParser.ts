import Papa from 'papaparse';

export interface MonthlyStatRow {
  month: string;            // "2025-11"
  accountId: string;
  accountName: string;
  childAccountId: string;
  childAccountName: string;  // display name for the child account (may be empty)
  warehouseId: string;
  labelCount: number;
  orderCount: number;
  carrierSpend: number;
  stripeBilling: number;
  stores: number;
  storeIncrease: number;
  // Warehouse-level totals (same across all children for a given warehouse+month)
  shippedUnits: number;
  shippedSkus: number;
  gmv: number;
  mibLabels: number;
  sibLabels: number;
  bulkLabels: number;
  wholesaleLabels: number;
  manualLabels: number;
  unknownLabels: number;
}

type RawRow = Record<string, string>;

function num(v: string | undefined): number {
  if (!v || v.trim() === '') return 0;
  return parseFloat(v) || 0;
}

function toYYYYMM(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : dateStr.slice(0, 7);
}

export function parseStatsCSV(file: File): Promise<MonthlyStatRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().replace(/^\uFEFF/, '').replace(/^"/, '').replace(/"$/, ''),
      complete: (results) => {
        try {
          const rows = results.data.map((r): MonthlyStatRow => ({
            month: toYYYYMM(r['date'] || ''),
            accountId: r['account id'] || '',
            accountName: r['account name'] || '',
            childAccountId: r['child account id'] || '',
            childAccountName: r['child account name'] || r['child_account_name'] || '',
            warehouseId: r['warehouse id'] || '',
            labelCount: num(r['label count']),
            orderCount: num(r['order count']),
            carrierSpend: num(r['carrier spend']),
            stripeBilling: num(r['stripe billing']),
            stores: num(r['stores']),
            storeIncrease: num(r['store increase']),
            shippedUnits: num(r['shipped units']),
            shippedSkus: num(r['shipped skus']),
            gmv: num(r['gmv']),
            mibLabels: num(r['mib labels']),
            sibLabels: num(r['sib labels']),
            bulkLabels: num(r['bulkship labels']),
            wholesaleLabels: num(r['wholesale labels'] ?? r['wholesale labels ']),
            manualLabels: num(r['manually fulfilled labels']),
            unknownLabels: num(r['unkown labels'] ?? r['unknown labels']),
          }));
          resolve(rows.filter((r) => r.month !== ''));
        } catch (err) {
          reject(err);
        }
      },
      error: reject,
    });
  });
}

/** Deduplicate warehouse-level rows so fulfillment mix is counted once per warehouse+month */
export function dedupeWarehouseRows(rows: MonthlyStatRow[]): MonthlyStatRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.month}::${r.warehouseId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(month) - 1]} ${year}`;
}
