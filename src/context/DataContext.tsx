import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Shipment, WarehouseConfig, FilterState, StateStats, LocationInsight } from '../types/index';
import { parseCSV, getUniqueWarehouses, getDateRange } from '../utils/csvParser';
import { applyFilters, computeStateStats } from '../utils/calculations';
import { getLatLngFromZip } from '../utils/uspsZones';
import { safeSetItem, safeGetItem, removeItem, storedSizeKB, STORAGE_KEYS } from '../utils/storageUtils';
import { PriorPeriodSummary, buildPriorPeriodSummary } from '../utils/periodComparison';
import type { MonthlyStatRow } from '../utils/statsParser';
import { saveSessionToDB, loadSessionFromDB, deleteSessionFromDB } from '../utils/sessionDB';

export type CacheStatus = 'ok' | 'quota-exceeded' | 'metadata-only' | 'none';

export interface QBRSessionMeta {
  id: string;
  clientName: string;
  cashId: string;
  clientLogo?: string | null;
  period?: string;
  createdAt: string;
  lastModified: string;
  filesLoaded: {
    shipments: boolean;
    priorPeriod: boolean;
    stats: boolean;
  };
  /** History of generated PPTX exports for this session */
  deckOutputs?: { generatedAt: string; slideCount: number; period: string }[];
}

/** Portable bundle for transferring a session between team members / machines. */
export interface SessionBundle {
  version: 1;
  exportedAt: string;
  clientName: string;
  cashId: string;
  reportingPeriod: string;
  clientLogo: string | null;
  warehouses: WarehouseConfig[];
  priorPeriod: PriorPeriodSummary | null;
  statsRows: MonthlyStatRow[];
  statsFileName: string | null;
  rawShipments: Shipment[];
  fileName: string | null;
  /** JSON string from localStorage key 'shiphero_deck_v1' */
  deckState: string | null;
  /** JSON string from localStorage key 'shiphero_builder_v1' */
  builderState: string | null;
}

interface DataContextValue {
  rawShipments: Shipment[];
  warehouses: WarehouseConfig[];
  filters: FilterState;
  filteredShipments: Shipment[];
  stateStats: StateStats[];
  isLoading: boolean;
  error: string | null;
  fileName: string | null;
  uploadCSV: (file: File) => Promise<{ errors: string[]; warnings: string[] }>;
  setFilter: (key: keyof FilterState, value: FilterState[keyof FilterState]) => void;
  resetFilters: () => void;
  setWarehouseZip: (warehouseName: string, zip: string) => void;
  toggleWarehouseExcluded: (warehouseName: string) => void;
  clearData: () => void;
  previewWarehouse: LocationInsight | null;
  setPreviewWarehouse: (w: LocationInsight | null) => void;

  // Client profile
  clientName: string;
  setClientName: (v: string) => void;
  clientLogo: string | null;
  setClientLogo: (v: string | null) => void;

  // Session identity
  cashId: string;
  setCashId: (v: string) => void;
  sessionActive: boolean;
  currentSessionId: string | null;
  startSession: (name: string, cashId: string, logo: string | null) => void;
  resumeSession: (id: string) => void;
  goHome: () => void;

  // Past sessions
  sessions: QBRSessionMeta[];
  saveSessionMeta: () => void;
  deleteSession: (id: string) => void;

  // Pending file hand-offs (set in modal, consumed by tabs on mount)
  pendingStatsFile: File | null;
  setPendingStatsFile: (f: File | null) => void;
  pendingLocFile: File | null;
  setPendingLocFile: (f: File | null) => void;
  pendingChangeFiles: File[];
  setPendingChangeFiles: (files: File[]) => void;

  // Stats (Monthly Statistics CSV — moved here for cross-session persistence)
  statsRows: MonthlyStatRow[];
  filteredStatsRows: MonthlyStatRow[];
  setStatsRows: (rows: MonthlyStatRow[]) => void;
  statsFileName: string | null;
  setStatsFileName: (v: string | null) => void;

  // Readiness
  statsLoaded: boolean;
  setStatsLoaded: (v: boolean) => void;

  // Period / filters
  reportingPeriod: string;
  setReportingPeriod: (v: string) => void;
  selectedAccount: string;
  setSelectedAccount: (v: string) => void;
  uniqueAccounts: string[];

  priorPeriod: PriorPeriodSummary | null;
  uploadPriorCSV: (file: File) => Promise<{ errors: string[]; warnings: string[] }>;
  mergeShipmentsCSV: (file: File) => Promise<{ errors: string[]; warnings: string[] }>;
  clearPriorPeriod: () => void;
  shipmentFileCount: number;

  cacheStatus: CacheStatus;
  cachedAt: string | null;
  cacheStoredKB: number;
  wipeStorage: () => void;

  // Session bundle (export / import)
  recordDeckExport: (slideCount: number) => void;
  exportSessionBundle: () => void;
  importSessionBundle: (bundle: SessionBundle) => Promise<void>;
}

const defaultFilters: FilterState = {
  warehouse: 'all',
  startDate: '',
  endDate: '',
  carrier: 'all',
  zone: null,
  sortBy: 'shipments',
  sortDirection: 'desc',
};

const DataContext = createContext<DataContextValue | null>(null);

function deriveReportingPeriod(min: string, max: string): string {
  if (!min || !max) return '';
  try {
    const start = new Date(min);
    const end = new Date(max);
    const startQ = Math.ceil((start.getMonth() + 1) / 3);
    const endQ = Math.ceil((end.getMonth() + 1) / 3);
    const year = end.getFullYear();
    if (startQ === endQ) return `Q${endQ} ${year}`;
    return `Q${startQ}–Q${endQ} ${year}`;
  } catch {
    return '';
  }
}

interface SessionData {
  rawShipments: Shipment[];
  warehouses: WarehouseConfig[];
  fileName: string | null;
  reportingPeriod: string;
  cachedAt: string;
  clientName?: string;
  clientLogo?: string | null;
  cashId?: string;
  sessionId?: string;
  sessionActive?: boolean;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [rawShipments, setRawShipments] = useState<Shipment[]>([]);
  const [shipmentFileCount, setShipmentFileCount] = useState(0);
  const [warehouses, setWarehouses] = useState<WarehouseConfig[]>([]);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewWarehouse, setPreviewWarehouseState] = useState<LocationInsight | null>(null);
  const [reportingPeriod, setReportingPeriodState] = useState('');
  const [selectedAccount, setSelectedAccountState] = useState('all');
  const [priorPeriod, setPriorPeriod] = useState<PriorPeriodSummary | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>('none');
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [clientName, setClientNameState] = useState('');
  const [clientLogo, setClientLogoState] = useState<string | null>(null);
  const [statsLoaded, setStatsLoadedState] = useState(false);
  const [cashId, setCashIdState] = useState('');
  const [sessionActive, setSessionActiveState] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<QBRSessionMeta[]>([]);
  const [pendingStatsFile, setPendingStatsFileState] = useState<File | null>(null);
  const [pendingLocFile, setPendingLocFileState] = useState<File | null>(null);
  const [pendingChangeFiles, setPendingChangeFilesState] = useState<File[]>([]);
  const [statsRows, setStatsRowsState] = useState<MonthlyStatRow[]>([]);
  const [statsFileName, setStatsFileNameState] = useState<string | null>(null);

  // ── Restore on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    const savedSessions = safeGetItem<QBRSessionMeta[]>(STORAGE_KEYS.SESSIONS);
    if (savedSessions) setSessions(savedSessions);

    const saved = safeGetItem<SessionData>(STORAGE_KEYS.SESSION);
    if (saved) {
      if (Array.isArray(saved.rawShipments) && saved.rawShipments.length > 0) {
        setRawShipments(saved.rawShipments);
        setWarehouses(saved.warehouses ?? []);
        setFileName(saved.fileName ?? null);
        setReportingPeriodState(saved.reportingPeriod ?? '');
        setCachedAt(saved.cachedAt ?? null);
        setCacheStatus('ok');
      }
      setClientNameState(saved.clientName ?? '');
      setClientLogoState(saved.clientLogo ?? null);
      setCashIdState(saved.cashId ?? '');
      setCurrentSessionId(saved.sessionId ?? null);
      setSessionActiveState(saved.sessionActive ?? false);

      // Restore large data from IDB — this is now the primary (and only) source for
      // rawShipments and statsRows since we no longer write them to localStorage.
      if (saved.sessionId) {
        loadSessionFromDB(saved.sessionId).then(idb => {
          if (!idb) return;
          if (idb.statsRows?.length) {
            setStatsRowsState(idb.statsRows);
            setStatsFileNameState(idb.statsFileName ?? null);
            setStatsLoadedState(true);
          }
          if (idb.rawShipments?.length) {
            setRawShipments(idb.rawShipments);
            // Merge IDB warehouses with any exclusion flags in localStorage (localStorage
            // is updated synchronously so may be more current than the debounced IDB save).
            setWarehouses(prev => {
              const idbWarehouses = idb.warehouses ?? [];
              if (!idbWarehouses.length) return prev;
              return idbWarehouses.map(w => ({
                ...w,
                excluded: prev.find(p => p.name === w.name)?.excluded ?? w.excluded ?? false,
              }));
            });
            setFileName(idb.fileName ?? saved.fileName ?? null);
            setReportingPeriodState(idb.reportingPeriod || saved.reportingPeriod || '');
            // Use IDB savedAt as the data timestamp when localStorage doesn't have it
            if (!saved.cachedAt) setCachedAt(idb.savedAt ?? null);
            setCacheStatus('ok');
          }
          // IDB prior period may have the expanded breakdown fields added in a later session
          if (idb.priorPeriod) setPriorPeriod(idb.priorPeriod);
        });
      }
    }

    const savedPrior = safeGetItem<PriorPeriodSummary>(STORAGE_KEYS.PRIOR_PERIOD);
    if (savedPrior) setPriorPeriod(savedPrior);
  }, []);

  // ── Persist session (metadata only) ─────────────────────────────────────────
  // Raw shipments, stats rows, and inventory are too large for localStorage (5 MB limit).
  // IDB (IndexedDB) is the authoritative store for all large data.
  // localStorage only carries lightweight metadata so session identity survives a reload.
  useEffect(() => {
    if (rawShipments.length === 0 && !sessionActive) return;
    const payload: SessionData = {
      rawShipments: [],   // never write large data to localStorage — IDB handles it
      warehouses,
      fileName,
      reportingPeriod,
      cachedAt: cachedAt ?? new Date().toISOString(),
      clientName,
      clientLogo,
      cashId,
      sessionId: currentSessionId ?? undefined,
      sessionActive,
    };
    const result = safeSetItem(STORAGE_KEYS.SESSION, payload);
    if (result === 'ok') {
      if (rawShipments.length > 0) setCacheStatus('ok');
      if (!cachedAt) setCachedAt(new Date().toISOString());
    } else if (result === 'quota-exceeded') {
      // Even metadata failed — storage is critically full; user should wipe via Settings
      setCacheStatus('quota-exceeded');
    }
  }, [rawShipments, warehouses, fileName, reportingPeriod, clientName, clientLogo, cashId, sessionActive, currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── IDB auto-save (per-session large data) ───────────────────────────────────
  // Use a ref to debounce: save 500 ms after last change to avoid excessive writes
  const idbSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentSessionId) return;
    if (!rawShipments.length && !statsRows.length && !priorPeriod) return;
    if (idbSaveTimer.current) clearTimeout(idbSaveTimer.current);
    idbSaveTimer.current = setTimeout(() => {
      saveSessionToDB({
        id: currentSessionId,
        rawShipments,
        warehouses,
        fileName,
        reportingPeriod,
        priorPeriod,
        statsRows,
        statsFileName,
        savedAt: new Date().toISOString(),
      });
    }, 500);
    return () => { if (idbSaveTimer.current) clearTimeout(idbSaveTimer.current); };
  }, [currentSessionId, rawShipments, warehouses, fileName, reportingPeriod, priorPeriod, statsRows, statsFileName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── beforeunload: flush pending IDB save so data survives tab-close ──────────
  // IDB writes are async so a debounced save might not fire before the tab closes.
  // We synchronously kick off the save on beforeunload (best-effort; browser may cancel it).
  useEffect(() => {
    const flush = () => {
      if (!currentSessionId) return;
      if (!rawShipments.length && !statsRows.length && !priorPeriod) return;
      if (idbSaveTimer.current) { clearTimeout(idbSaveTimer.current); idbSaveTimer.current = null; }
      saveSessionToDB({
        id: currentSessionId,
        rawShipments,
        warehouses,
        fileName,
        reportingPeriod,
        priorPeriod,
        statsRows,
        statsFileName,
        savedAt: new Date().toISOString(),
      });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [currentSessionId, rawShipments, warehouses, fileName, reportingPeriod, priorPeriod, statsRows, statsFileName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────────
  const uniqueAccounts = useMemo(() => {
    const set = new Set<string>();
    for (const s of rawShipments) {
      if (s.customer3pl) set.add(s.customer3pl);
    }
    return Array.from(set).sort();
  }, [rawShipments]);

  const filteredShipments = useMemo(() => {
    const activeWarehouses = warehouses.filter(w => !w.excluded);
    let base = applyFilters(rawShipments, filters, activeWarehouses);
    // Exclude shipments from excluded warehouses
    const excludedNames = new Set(warehouses.filter(w => w.excluded).map(w => w.name));
    if (excludedNames.size > 0) {
      base = base.filter(s => !excludedNames.has(s.warehouse ?? ''));
    }
    if (selectedAccount !== 'all') {
      base = base.filter(s => s.customer3pl === selectedAccount);
    }
    return base;
  }, [rawShipments, filters, warehouses, selectedAccount]);

  // Stats rows filtered to match active warehouse exclusions
  const filteredStatsRows = useMemo(() => {
    const excludedIds = new Set(warehouses.filter(w => w.excluded).map(w => w.warehouseId));
    if (excludedIds.size === 0) return statsRows;
    return statsRows.filter(r => !excludedIds.has(r.warehouseId));
  }, [statsRows, warehouses]);

  const stateStats = useMemo(() => {
    const selectedWarehouse = filters.warehouse !== 'all'
      ? warehouses.find((w) => w.name === filters.warehouse)
      : warehouses[0];
    const originZip = selectedWarehouse?.zip || '';
    if (!originZip) return [];
    return computeStateStats(filteredShipments, originZip);
  }, [filteredShipments, filters.warehouse, warehouses]);

  const cacheStoredKB = useMemo(
    () => Object.values(STORAGE_KEYS).reduce((sum, key) => sum + storedSizeKB(key), 0),
    [rawShipments.length, statsRows.length], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Upload handlers ──────────────────────────────────────────────────────────
  const uploadCSV = useCallback(async (file: File): Promise<{ errors: string[]; warnings: string[] }> => {
    setIsLoading(true);
    setError(null);
    try {
      const { rows: shipments, errors, warnings } = await parseCSV(file);
      if (errors.length > 0) {
        setError(errors.join('\n'));
        return { errors, warnings };
      }
      setRawShipments(shipments);
      setShipmentFileCount(1);
      setFileName(file.name);
      const uniqueW = getUniqueWarehouses(shipments);
      setWarehouses(uniqueW.map(w => ({ name: w.name, warehouseId: w.warehouseId, zip: '' })));
      setFilters(defaultFilters);
      setSelectedAccountState('all');
      const { min, max } = getDateRange(shipments);
      const derived = deriveReportingPeriod(min, max);
      if (derived) setReportingPeriodState(derived);
      const now = new Date().toISOString();
      setCachedAt(now);
      return { errors: [], warnings };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse CSV';
      setError(msg);
      return { errors: [msg], warnings: [] };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const mergeShipmentsCSV = useCallback(async (file: File): Promise<{ errors: string[]; warnings: string[] }> => {
    setIsLoading(true);
    setError(null);
    try {
      const { rows: newShipments, errors, warnings } = await parseCSV(file);
      if (errors.length > 0) {
        setError(errors.join('\n'));
        return { errors, warnings };
      }
      // Merge rows and update derived state in a single functional updater
      setRawShipments(prev => {
        const merged = [...prev, ...newShipments];
        // Derive expanded reporting period from the full merged date range
        const { min, max } = getDateRange(merged);
        const derived = deriveReportingPeriod(min, max);
        if (derived) setReportingPeriodState(derived);
        return merged;
      });
      setShipmentFileCount(prev => prev + 1);
      // Extend warehouses list with any new warehouses from this file
      setWarehouses(prev => {
        const existingNames = new Set(prev.map(w => w.name));
        const newW = getUniqueWarehouses(newShipments).filter(w => !existingNames.has(w.name));
        if (newW.length === 0) return prev;
        return [...prev, ...newW.map(w => ({ name: w.name, warehouseId: w.warehouseId, zip: '' }))];
      });
      setCachedAt(new Date().toISOString());
      return { errors: [], warnings };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse CSV';
      setError(msg);
      return { errors: [msg], warnings: [] };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const uploadPriorCSV = useCallback(async (file: File): Promise<{ errors: string[]; warnings: string[] }> => {
    setIsLoading(true);
    try {
      const { rows: shipments, errors, warnings } = await parseCSV(file);
      if (errors.length > 0) return { errors, warnings };
      const summary = buildPriorPeriodSummary(shipments, file.name);
      setPriorPeriod(summary);
      safeSetItem(STORAGE_KEYS.PRIOR_PERIOD, summary);
      return { errors: [], warnings };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse prior period CSV';
      return { errors: [msg], warnings: [] };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearPriorPeriod = useCallback(() => {
    setPriorPeriod(null);
    removeItem(STORAGE_KEYS.PRIOR_PERIOD);
  }, []);

  // ── Session management ───────────────────────────────────────────────────────
  const saveSessionMeta = useCallback(() => {
    if (!clientName && !cashId) return;
    const id = currentSessionId ?? crypto.randomUUID();
    const meta: QBRSessionMeta = {
      id,
      clientName,
      cashId,
      clientLogo: clientLogo ?? null,
      period: reportingPeriod || undefined,
      createdAt: cachedAt || new Date().toISOString(),
      lastModified: new Date().toISOString(),
      filesLoaded: {
        shipments: rawShipments.length > 0,
        priorPeriod: priorPeriod !== null,
        stats: statsLoaded,
      },
    };
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const updated = idx >= 0
        ? prev.map((s, i) => i === idx ? meta : s)
        : [meta, ...prev];
      safeSetItem(STORAGE_KEYS.SESSIONS, updated);
      return updated;
    });
  }, [clientName, cashId, clientLogo, reportingPeriod, cachedAt, rawShipments.length, priorPeriod, statsLoaded, currentSessionId]);

  const startSession = useCallback((name: string, id: string, logo: string | null) => {
    const newId = crypto.randomUUID();
    setClientNameState(name);
    setCashIdState(id);
    setClientLogoState(logo);
    setCurrentSessionId(newId);
    setSessionActiveState(true);
  }, []);

  const resumeSession = useCallback((id: string) => {
    const savedSessions = safeGetItem<QBRSessionMeta[]>(STORAGE_KEYS.SESSIONS) ?? [];
    const meta = savedSessions.find(s => s.id === id);
    if (!meta) return;

    // Set identity immediately so the session opens right away
    setClientNameState(meta.clientName);
    setCashIdState(meta.cashId);
    setClientLogoState(meta.clientLogo ?? null);
    setCurrentSessionId(id);
    setReportingPeriodState(meta.period ?? '');
    setSessionActiveState(true);

    // Clear stale state from the previous session
    setRawShipments([]);
    setWarehouses([]);
    setFileName(null);
    setCachedAt(null);
    setCacheStatus('none');
    setPriorPeriod(null);
    setStatsRowsState([]);
    setStatsFileNameState(null);
    setStatsLoadedState(false);

    // Try localStorage first (fast, same session) then fall back to IDB
    const stored = safeGetItem<SessionData>(STORAGE_KEYS.SESSION);
    if (stored && stored.sessionId === id && stored.rawShipments?.length) {
      setRawShipments(stored.rawShipments);
      setWarehouses(stored.warehouses ?? []);
      setFileName(stored.fileName ?? null);
      setReportingPeriodState(stored.reportingPeriod ?? '');
      setCachedAt(stored.cachedAt ?? null);
      setCacheStatus('ok');
      const savedPrior = safeGetItem<PriorPeriodSummary>(STORAGE_KEYS.PRIOR_PERIOD);
      if (savedPrior) setPriorPeriod(savedPrior);
    }

    // Always load from IDB — may have more data (stats, or fresher shipments)
    loadSessionFromDB(id).then(idb => {
      if (!idb) return;
      if (idb.rawShipments?.length) {
        setRawShipments(idb.rawShipments);
        // Merge IDB warehouse list with any exclusion flags already in memory
        // (localStorage is saved synchronously on every change; IDB is debounced,
        // so IDB may lag behind and not yet have the latest exclusions.)
        setWarehouses(prev => {
          const idbWarehouses = idb.warehouses ?? [];
          if (!idbWarehouses.length) return prev;
          return idbWarehouses.map(w => ({
            ...w,
            excluded: prev.find(p => p.name === w.name)?.excluded ?? w.excluded ?? false,
          }));
        });
        setFileName(idb.fileName ?? null);
        setReportingPeriodState(idb.reportingPeriod || meta.period || '');
        setCacheStatus('ok');
      }
      if (idb.priorPeriod) setPriorPeriod(idb.priorPeriod);
      if (idb.statsRows?.length) {
        setStatsRowsState(idb.statsRows);
        setStatsFileNameState(idb.statsFileName ?? null);
        setStatsLoadedState(true);
      }
    });
  }, []);

  const goHome = useCallback(() => {
    // Flush any pending IDB debounce save immediately before clearing state
    if (idbSaveTimer.current) {
      clearTimeout(idbSaveTimer.current);
      idbSaveTimer.current = null;
    }
    if (currentSessionId && (rawShipments.length || statsRows.length || priorPeriod)) {
      saveSessionToDB({
        id: currentSessionId,
        rawShipments,
        warehouses,
        fileName,
        reportingPeriod,
        priorPeriod,
        statsRows,
        statsFileName,
        savedAt: new Date().toISOString(),
      });
    }
    // Save metadata before clearing
    if (clientName || cashId) {
      const id = currentSessionId ?? crypto.randomUUID();
      const meta: QBRSessionMeta = {
        id,
        clientName,
        cashId,
        clientLogo: clientLogo ?? null,
        period: reportingPeriod || undefined,
        createdAt: cachedAt || new Date().toISOString(),
        lastModified: new Date().toISOString(),
        filesLoaded: {
          shipments: rawShipments.length > 0,
          priorPeriod: priorPeriod !== null,
          stats: statsLoaded,
        },
      };
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === id);
        const updated = idx >= 0
          ? prev.map((s, i) => i === idx ? meta : s)
          : [meta, ...prev];
        safeSetItem(STORAGE_KEYS.SESSIONS, updated);
        return updated;
      });
    }
    // Reset everything
    setRawShipments([]);
    setWarehouses([]);
    setFilters(defaultFilters);
    setFileName(null);
    setError(null);
    setReportingPeriodState('');
    setSelectedAccountState('all');
    setPriorPeriod(null);
    setCacheStatus('none');
    setCachedAt(null);
    setClientNameState('');
    setClientLogoState(null);
    setCashIdState('');
    setCurrentSessionId(null);
    setStatsLoadedState(false);
    setStatsRowsState([]);
    setStatsFileNameState(null);
    setSessionActiveState(false);
    removeItem(STORAGE_KEYS.SESSION);
    removeItem(STORAGE_KEYS.PRIOR_PERIOD);
    removeItem(STORAGE_KEYS.STATS_CACHE);
    removeItem(STORAGE_KEYS.INV_LOC_CACHE);
    removeItem(STORAGE_KEYS.INV_CHANGES_CACHE);
  }, [clientName, cashId, clientLogo, reportingPeriod, cachedAt, rawShipments, warehouses, fileName, priorPeriod, statsRows, statsFileName, statsLoaded, currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSession = useCallback((id: string) => {
    deleteSessionFromDB(id); // fire-and-forget
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      safeSetItem(STORAGE_KEYS.SESSIONS, updated);
      return updated;
    });
  }, []);

  /** Record a successful PPTX export against the current session's history. */
  const recordDeckExport = useCallback((slideCount: number) => {
    if (!currentSessionId) return;
    const id = currentSessionId;
    const entry = { generatedAt: new Date().toISOString(), slideCount, period: reportingPeriod };
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const updated = prev.map((s, i) =>
        i === idx ? { ...s, deckOutputs: [...(s.deckOutputs ?? []), entry] } : s
      );
      safeSetItem(STORAGE_KEYS.SESSIONS, updated);
      return updated;
    });
  }, [currentSessionId, reportingPeriod]);

  /** Download all session data as a portable .qbr.json bundle. */
  const exportSessionBundle = useCallback(() => {
    const bundle: SessionBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      clientName, cashId, reportingPeriod,
      clientLogo: clientLogo ?? null,
      warehouses, priorPeriod,
      statsRows, statsFileName,
      rawShipments, fileName,
      deckState: localStorage.getItem('shiphero_deck_v1'),
      builderState: localStorage.getItem('shiphero_builder_v1'),
    };
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ShipHero_QBR_${(clientName || 'session').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.qbr.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [clientName, cashId, reportingPeriod, clientLogo, warehouses, priorPeriod, statsRows, statsFileName, rawShipments, fileName]);

  /** Restore a session from a previously exported bundle. */
  const importSessionBundle = useCallback(async (bundle: SessionBundle): Promise<void> => {
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Restore data state
    setClientNameState(bundle.clientName ?? '');
    setCashIdState(bundle.cashId ?? '');
    setReportingPeriodState(bundle.reportingPeriod ?? '');
    setClientLogoState(bundle.clientLogo ?? null);
    setWarehouses(bundle.warehouses ?? []);
    setPriorPeriod(bundle.priorPeriod ?? null);
    setStatsRowsState(bundle.statsRows ?? []);
    setStatsFileNameState(bundle.statsFileName ?? null);
    setStatsLoadedState((bundle.statsRows ?? []).length > 0);
    setRawShipments(bundle.rawShipments ?? []);
    setFileName(bundle.fileName ?? null);
    // Reset transient UI state so previous session's filters don't bleed through
    setFilters(defaultFilters);
    setSelectedAccountState('all');
    setError(null);
    setShipmentFileCount((bundle.rawShipments ?? []).length > 0 ? 1 : 0);
    setCurrentSessionId(newId);
    setSessionActiveState(true);
    setCachedAt(now);
    if ((bundle.rawShipments ?? []).length > 0) setCacheStatus('ok');

    if (bundle.priorPeriod) safeSetItem(STORAGE_KEYS.PRIOR_PERIOD, bundle.priorPeriod);
    // Write builder state so QBRDeckBuilder reads it on first mount
    if (bundle.builderState) {
      try { localStorage.setItem('shiphero_builder_v1', bundle.builderState); } catch { /* quota */ }
    }
    // Deck state (sections/customSlides/execSummary) is applied by Layout via DeckContext.applyImportedDeckState

    // Persist to IDB immediately
    await saveSessionToDB({
      id: newId,
      rawShipments: bundle.rawShipments ?? [],
      warehouses: bundle.warehouses ?? [],
      fileName: bundle.fileName ?? null,
      reportingPeriod: bundle.reportingPeriod ?? '',
      priorPeriod: bundle.priorPeriod ?? null,
      statsRows: bundle.statsRows ?? [],
      statsFileName: bundle.statsFileName ?? null,
      savedAt: now,
    });
  }, []);

  // ── Mutators ─────────────────────────────────────────────────────────────────
  const setWarehouseZip = useCallback((warehouseName: string, zip: string) => {
    const coords = getLatLngFromZip(zip);
    setWarehouses(prev =>
      prev.map(w => w.name === warehouseName ? { ...w, zip, lat: coords?.lat, lng: coords?.lng } : w)
    );
  }, []);

  const toggleWarehouseExcluded = useCallback((warehouseName: string) => {
    setWarehouses(prev =>
      prev.map(w => w.name === warehouseName ? { ...w, excluded: !w.excluded } : w)
    );
  }, []);

  const setFilter = useCallback((key: keyof FilterState, value: FilterState[keyof FilterState]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);
  const setPreviewWarehouse = useCallback((w: LocationInsight | null) => setPreviewWarehouseState(w), []);
  const setReportingPeriod = useCallback((v: string) => setReportingPeriodState(v), []);
  const setSelectedAccount = useCallback((v: string) => setSelectedAccountState(v), []);
  const setClientName = useCallback((v: string) => setClientNameState(v), []);
  const setClientLogo = useCallback((v: string | null) => setClientLogoState(v), []);
  const setCashId = useCallback((v: string) => setCashIdState(v), []);
  const setStatsLoaded = useCallback((v: boolean) => setStatsLoadedState(v), []);
  const setStatsRows   = useCallback((rows: MonthlyStatRow[]) => setStatsRowsState(rows), []);
  const setStatsFileName = useCallback((v: string | null) => setStatsFileNameState(v), []);
  const setPendingStatsFile = useCallback((f: File | null) => setPendingStatsFileState(f), []);
  const setPendingLocFile = useCallback((f: File | null) => setPendingLocFileState(f), []);
  const setPendingChangeFiles = useCallback((files: File[]) => setPendingChangeFilesState(files), []);

  const clearData = useCallback(() => {
    setRawShipments([]);
    setShipmentFileCount(0);
    setWarehouses([]);
    setFilters(defaultFilters);
    setFileName(null);
    setError(null);
    setReportingPeriodState('');
    setSelectedAccountState('all');
    setCacheStatus('none');
    setCachedAt(null);
    removeItem(STORAGE_KEYS.SESSION);
  }, []);

  const wipeStorage = useCallback(() => {
    Object.values(STORAGE_KEYS).forEach(key => removeItem(key));
    setRawShipments([]);
    setWarehouses([]);
    setFilters(defaultFilters);
    setFileName(null);
    setError(null);
    setReportingPeriodState('');
    setSelectedAccountState('all');
    setPriorPeriod(null);
    setCacheStatus('none');
    setCachedAt(null);
    setClientNameState('');
    setClientLogoState(null);
    setCashIdState('');
    setCurrentSessionId(null);
    setStatsLoadedState(false);
    setStatsRowsState([]);
    setStatsFileNameState(null);
    setSessionActiveState(false);
    setSessions([]);
  }, []);

  const value: DataContextValue = {
    rawShipments,
    warehouses,
    filters,
    filteredShipments,
    stateStats,
    isLoading,
    error,
    fileName,
    uploadCSV,
    setFilter,
    resetFilters,
    setWarehouseZip,
    toggleWarehouseExcluded,
    clearData,
    previewWarehouse,
    setPreviewWarehouse,
    reportingPeriod,
    setReportingPeriod,
    selectedAccount,
    setSelectedAccount,
    uniqueAccounts,
    priorPeriod,
    uploadPriorCSV,
    mergeShipmentsCSV,
    shipmentFileCount,
    clearPriorPeriod,
    cacheStatus,
    cachedAt,
    cacheStoredKB,
    wipeStorage,
    clientName,
    setClientName,
    clientLogo,
    setClientLogo,
    statsRows,
    filteredStatsRows,
    setStatsRows,
    statsFileName,
    setStatsFileName,
    statsLoaded,
    setStatsLoaded,
    cashId,
    setCashId,
    sessionActive,
    currentSessionId,
    startSession,
    resumeSession,
    goHome,
    sessions,
    saveSessionMeta,
    deleteSession,
    pendingStatsFile,
    setPendingStatsFile,
    pendingLocFile,
    setPendingLocFile,
    pendingChangeFiles,
    setPendingChangeFiles,
    recordDeckExport,
    exportSessionBundle,
    importSessionBundle,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
