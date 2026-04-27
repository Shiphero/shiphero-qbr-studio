/**
 * IndexedDB persistence for per-session large data.
 * Allows CSMs to switch between QBRs without re-uploading files.
 *
 * Stores:
 *   sessions  — shipments, stats, warehouses (keyed by session id)
 *   inventory — product locations + change log rows (keyed by session id)
 */

import type { Shipment, WarehouseConfig } from '../types/index';
import type { PriorPeriodSummary } from './periodComparison';
import type { MonthlyStatRow } from './statsParser';
import type { InventoryPDFData } from '../context/PDFContext';

const DB_NAME    = 'shiphero-qbr-v1';
const DB_VERSION = 2;          // bumped to add 'inventory' store
const STORE      = 'sessions';
const INV_STORE  = 'inventory';

export interface PerSessionData {
  id: string;
  rawShipments: Shipment[];
  warehouses: WarehouseConfig[];
  fileName: string | null;
  reportingPeriod: string;
  priorPeriod: PriorPeriodSummary | null;
  statsRows: MonthlyStatRow[];
  statsFileName: string | null;
  savedAt: string;
  /** Serialised DeckContext state — sections (with insight/narrative), dataInstances, execSummary */
  deckState?: string;
}

export interface PerSessionInventory {
  id: string;
  inventoryData: InventoryPDFData;
  savedAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(INV_STORE)) {
        db.createObjectStore(INV_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveSessionToDB(data: PerSessionData): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[sessionDB] save failed:', e);
  }
}

export async function loadSessionFromDB(id: string): Promise<PerSessionData | null> {
  try {
    const db = await openDB();
    const result = await new Promise<PerSessionData | null>((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as PerSessionData) ?? null);
      req.onerror   = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.warn('[sessionDB] load failed:', e);
    return null;
  }
}

export async function deleteSessionFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[sessionDB] delete failed:', e);
  }
}

// ── Inventory data (Product Locations + Change Log) ───────────────────────────

export async function saveInventoryToDB(id: string, inventoryData: InventoryPDFData): Promise<void> {
  try {
    const db = await openDB();
    const record: PerSessionInventory = { id, inventoryData, savedAt: new Date().toISOString() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INV_STORE, 'readwrite');
      tx.objectStore(INV_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[sessionDB] inventory save failed:', e);
  }
}

export async function loadInventoryFromDB(id: string): Promise<InventoryPDFData | null> {
  try {
    const db = await openDB();
    const result = await new Promise<PerSessionInventory | null>((resolve, reject) => {
      const tx  = db.transaction(INV_STORE, 'readonly');
      const req = tx.objectStore(INV_STORE).get(id);
      req.onsuccess = () => resolve((req.result as PerSessionInventory) ?? null);
      req.onerror   = () => reject(req.error);
    });
    db.close();
    return result?.inventoryData ?? null;
  } catch (e) {
    console.warn('[sessionDB] inventory load failed:', e);
    return null;
  }
}

export async function deleteInventoryFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INV_STORE, 'readwrite');
      tx.objectStore(INV_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[sessionDB] inventory delete failed:', e);
  }
}
