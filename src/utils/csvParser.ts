import Papa from 'papaparse';
import { RawShipment, Shipment } from '../types/index';
import { ParseResult, validateShipmentColumns } from './csvValidation';

export function parseCSV(file: File): Promise<ParseResult<Shipment>> {
  return new Promise((resolve) => {
    Papa.parse<RawShipment>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Validate columns first
        const headers = results.meta.fields ?? [];
        const { errors, warnings } = validateShipmentColumns(headers);
        if (errors.length > 0) {
          resolve({ rows: [], errors, warnings });
          return;
        }

        try {
          const rows = transformShipments(results.data);
          resolve({ rows, errors: [], warnings });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to parse CSV';
          resolve({ rows: [], errors: [msg], warnings });
        }
      },
      error: (error) => {
        resolve({ rows: [], errors: [error.message], warnings: [] });
      },
    });
  });
}

function normalizeZip(zip: string): string {
  if (!zip) return '';
  return zip.split('-')[0].trim();
}

export function transformShipments(raw: RawShipment[]): Shipment[] {
  return raw
    .filter((row) => {
      const country = row['Country'] || row['country'] || '';
      const labelCost = row['Label Cost'] || row['label_cost'] || '0';
      const zip = row['Zip'] || row['zip'] || '';
      const state = row['State'] || row['state'] || '';
      return (
        country.toUpperCase() === 'US' &&
        labelCost !== '0.00' &&
        labelCost !== '0' &&
        labelCost !== '' &&
        zip !== '' &&
        state !== ''
      );
    })
    .map((row) => {
      const labelCostStr = row['Label Cost'] || '0';
      const weightStr = row['Weight (lb)'] || '0';
      const totalChargedStr = row['Total Shipping Charged'] || '0';

      const customer3pl =
        row['3PL Customer'] ||
        row['3pl_customer'] ||
        row['3PL customer'] ||
        row['Customer'] ||
        row['Brand'] ||
        row['Account'] ||
        row['Store Name'] ||
        row['store_name'] ||
        '';

      return {
        id: row['Shipping Label ID'] || '',
        orderDate: row['Order date'] || '',
        warehouse: row['Warehouse'] || '',
        warehouseId: row['Warehouse ID'] || '',
        carrier: row['Carrier'] || '',
        shippingMethod: row['Shipping Method'] || '',
        zip: normalizeZip(row['Zip'] || ''),
        state: (row['State'] || '').toUpperCase().trim(),
        country: row['Country'] || '',
        labelCost: parseFloat(labelCostStr) || 0,
        weight: parseFloat(weightStr) || 0,
        totalShippingCharged: parseFloat(totalChargedStr) || 0,
        customer3pl: customer3pl.trim(),
      };
    });
}

export function getUniqueWarehouses(shipments: Shipment[]): Array<{ name: string; warehouseId: string }> {
  const seen = new Map<string, string>();
  for (const s of shipments) {
    if (s.warehouse && !seen.has(s.warehouse)) {
      seen.set(s.warehouse, s.warehouseId);
    }
  }
  return Array.from(seen.entries()).map(([name, warehouseId]) => ({ name, warehouseId }));
}

export function getUniqueCarriers(shipments: Shipment[]): string[] {
  const carriers = new Set<string>();
  for (const s of shipments) {
    if (s.carrier) carriers.add(s.carrier);
  }
  return Array.from(carriers).sort();
}

export function getDateRange(shipments: Shipment[]): { min: string; max: string } {
  let min = '';
  let max = '';
  for (const s of shipments) {
    if (!s.orderDate) continue;
    if (!min || s.orderDate < min) min = s.orderDate;
    if (!max || s.orderDate > max) max = s.orderDate;
  }
  return { min, max };
}
