import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ItemLocationRow, InventoryChangeRow } from '../utils/inventoryParser';
import { useData } from './DataContext';
import { saveInventoryToDB, loadInventoryFromDB, deleteInventoryFromDB } from '../utils/sessionDB';

export type ExpiryTierPDF = 'critical' | 'warning' | 'watch' | 'ok';
export type DOHStatusPDF = 'critical' | 'low' | 'ok' | 'overstocked' | 'no-movement';

export interface ExpiryAlertRowPDF extends ItemLocationRow {
  tier: ExpiryTierPDF;
}

export interface DaysOnHandRowPDF {
  client: string;
  sku: string;
  item: string;
  currentUnits: number;
  totalOutbound: number;
  dailyVelocity: number;
  doh: number | null;
  status: DOHStatusPDF;
}

export interface POCadenceRowPDF {
  client: string;
  poCount: number;
  totalUnitsIn: number;
  avgUnitsPerPO: number;
  lastReceived: string;
}

export type ManualAdjRowPDF = InventoryChangeRow;

export interface InventoryPDFData {
  expiryAlerts: ExpiryAlertRowPDF[];
  daysOnHand: DaysOnHandRowPDF[];
  poCadence: POCadenceRowPDF[];
  manualAdjRows: ManualAdjRowPDF[];
  /** Raw product-location rows — persisted so InventoryHealthTab survives refresh */
  locRows?: ItemLocationRow[];
  /** Original filename for the product-locations upload */
  locFileName?: string;
  /** Per-file change-log entry (fileName + rows) — persisted for refresh survival */
  changeFileEntries?: { id: string; fileName: string; rows: InventoryChangeRow[] }[];
}

interface PDFContextValue {
  inventoryData: InventoryPDFData | null;
  /** True once the IDB load attempt has completed (whether or not data was found) */
  inventoryIdbReady: boolean;
  locLoaded: boolean;
  setLocLoaded: (v: boolean) => void;
  registerInventoryData: (data: InventoryPDFData) => void;
  clearInventoryData: () => void;
}

const PDFContext = createContext<PDFContextValue | null>(null);

export function PDFProvider({ children }: { children: React.ReactNode }) {
  const [inventoryData, setInventoryData] = useState<InventoryPDFData | null>(null);
  const [inventoryIdbReady, setInventoryIdbReady] = useState(false);
  const [locLoaded, setLocLoaded] = useState(false);

  // Access the session ID from DataContext (PDFProvider is mounted inside DataProvider)
  const { currentSessionId } = useData();

  // ── Auto-restore: load inventory from IDB when session changes ────────────
  const lastRestoredIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentSessionId || currentSessionId === lastRestoredIdRef.current) return;
    lastRestoredIdRef.current = currentSessionId;
    setInventoryIdbReady(false); // reset while we load the new session

    loadInventoryFromDB(currentSessionId).then(saved => {
      if (saved) {
        setInventoryData(saved);
        // If we have expiryAlerts or daysOnHand data, mark the location file as loaded
        if (saved.expiryAlerts?.length || saved.daysOnHand?.length || saved.poCadence?.length) {
          setLocLoaded(true);
        }
      }
      setInventoryIdbReady(true);
    });
  }, [currentSessionId]);

  // ── Auto-save: debounce inventory writes to IDB ───────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentSessionId || !inventoryData) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveInventoryToDB(currentSessionId, inventoryData);
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [currentSessionId, inventoryData]);

  // ── Flush on page close so debounce never eats the last write ────────────
  useEffect(() => {
    const flush = () => {
      if (!currentSessionId || !inventoryData) return;
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      saveInventoryToDB(currentSessionId, inventoryData);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [currentSessionId, inventoryData]);

  // ── API ───────────────────────────────────────────────────────────────────
  const registerInventoryData = useCallback((data: InventoryPDFData) => {
    setInventoryData(data);
    // Write to IDB immediately — don't rely on the debounce timer.
    // The debounce effect will also fire after state settles, but the
    // immediate write ensures data survives a fast refresh (< 500 ms).
    if (currentSessionId) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      saveInventoryToDB(currentSessionId, data);
    }
  }, [currentSessionId]);

  const clearInventoryData = useCallback(() => {
    setInventoryData(null);
    setLocLoaded(false);
    // Flush save timer and remove from IDB so stale data doesn't re-appear
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (currentSessionId) {
      deleteInventoryFromDB(currentSessionId);
    }
  }, [currentSessionId]);

  return (
    <PDFContext.Provider value={{ inventoryData, inventoryIdbReady, locLoaded, setLocLoaded, registerInventoryData, clearInventoryData }}>
      {children}
    </PDFContext.Provider>
  );
}

export function usePDF(): PDFContextValue {
  const ctx = useContext(PDFContext);
  if (!ctx) throw new Error('usePDF must be used within PDFProvider');
  return ctx;
}
