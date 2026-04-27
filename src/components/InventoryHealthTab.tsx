import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import {
  parseItemLocationsCSV,
  parseInventoryChangeCSV,
  parseProductCatalogCSV,
  ItemLocationRow,
  InventoryChangeRow,
  ProductCatalogRow,
  ChangeCategory,
  normalizeReason,
} from '../utils/inventoryParser';
import ExportButton from './ExportButton';
import { usePDF } from '../context/PDFContext';
import { useData } from '../context/DataContext';
import type { ExpiryAlertRowPDF, DaysOnHandRowPDF, POCadenceRowPDF } from '../context/PDFContext';
import { safeGetItem, STORAGE_KEYS } from '../utils/storageUtils';
import InsightGate from './InsightGate';
import SortFilterButton from './SortFilterButton';

// ─── Palette & constants ───────────────────────────────────────────────────────

const PALETTE = [
  '#4472E8', '#EF5252', '#22C55E', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#EC4899', '#14B8A6', '#A78BFA',
];

const CATEGORY_COLORS: Record<ChangeCategory, string> = {
  'DTC Order':        '#4472E8',
  'B2B / Wholesale':  '#8B5CF6',
  'Inbound PO':       '#22C55E',
  'Manual Adjustment':'#EF5252',
  'Kit Update':       '#06B6D4',
  'Product Update':   '#94A3B8',
  'Damage':           '#EF4444',
  'Other':            '#CBD5E1',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtN(n: number) { return n.toLocaleString(); }
function fmtBig(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}
function fmtDollar(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(n: number) { return n.toFixed(1) + '%'; }

type ExpiryTier = 'critical' | 'warning' | 'watch' | 'ok';

function expiryTier(days: number): ExpiryTier {
  if (days < 30) return 'critical';
  if (days < 90) return 'warning';
  if (days < 180) return 'watch';
  return 'ok';
}

const TIER_CFG: Record<ExpiryTier, { label: string; bg: string; text: string; border: string }> = {
  critical: { label: '🔴 < 30 days', bg: 'rgba(239,68,68,0.08)',   text: '#b91c1c', border: 'rgba(239,68,68,0.3)' },
  warning:  { label: '🟠 30–90 days', bg: 'rgba(245,166,35,0.1)',  text: '#92650a', border: 'rgba(245,166,35,0.3)' },
  watch:    { label: '🟡 90–180 days', bg: 'rgba(234,179,8,0.1)',  text: '#854d0e', border: 'rgba(234,179,8,0.3)' },
  ok:       { label: '✓ OK',           bg: 'rgba(34,197,94,0.1)',  text: '#15803D', border: 'rgba(34,197,94,0.3)' },
};

type DOHStatus = 'critical' | 'low' | 'ok' | 'overstocked' | 'no-movement';
const DOH_CFG: Record<DOHStatus, { label: string; bg: string; text: string; border: string }> = {
  'critical':     { label: '⚠ Critical',    bg: 'rgba(239,68,68,0.08)',  text: '#b91c1c', border: 'rgba(239,68,68,0.3)' },
  'low':          { label: '↓ Low',         bg: 'rgba(245,166,35,0.1)',  text: '#92650a', border: 'rgba(245,166,35,0.3)' },
  'ok':           { label: '✓ Healthy',     bg: 'rgba(34,197,94,0.1)',   text: '#15803D', border: 'rgba(34,197,94,0.3)' },
  'overstocked':  { label: '↑ Overstocked', bg: 'rgba(68,114,232,0.08)', text: '#1d4ed8', border: 'rgba(68,114,232,0.3)' },
  'no-movement':  { label: '— No Movement', bg: '#F5F5F0',               text: '#6B7280', border: '#E5E7EB' },
};

function dohStatus(days: number | null): DOHStatus {
  if (days === null) return 'no-movement';
  if (days < 14)  return 'critical';
  if (days < 30)  return 'low';
  if (days < 180) return 'ok';
  return 'overstocked';
}

type CarryStatus = 'red' | 'yellow' | 'green' | 'no-revenue';
const CARRY_CFG: Record<CarryStatus, { label: string; bg: string; text: string; border: string }> = {
  'red':        { label: '🔴 High Risk', bg: 'rgba(239,68,68,0.08)',  text: '#b91c1c', border: 'rgba(239,68,68,0.3)' },
  'yellow':     { label: '🟡 Watch',     bg: 'rgba(245,166,35,0.1)',  text: '#92650a', border: 'rgba(245,166,35,0.3)' },
  'green':      { label: '✓ Healthy',   bg: 'rgba(34,197,94,0.1)',   text: '#15803D', border: 'rgba(34,197,94,0.3)' },
  'no-revenue': { label: '— No Sales',  bg: '#F5F5F0',               text: '#6B7280', border: '#E5E7EB' },
};

function carryStatus(pct: number | null, redT: number, yellowT: number): CarryStatus {
  if (pct === null) return 'no-revenue';
  if (pct > redT) return 'red';
  if (pct > yellowT) return 'yellow';
  return 'green';
}

type CarryCostRow = {
  client: string; sku: string; name: string;
  unitsSold: number; totalRevenue: number;
  avgUnitsInStorage: number; totalStorageFees: number;
  carryCostPct: number | null; status: CarryStatus;
};

type SortDir = 'asc' | 'desc';

function sortRows<T>(arr: T[], key: string, dir: SortDir): T[] {
  return [...arr].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
    return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

function SortTh({ label, col, sortKey, sortDir, onSort, align = 'left', color }: {
  label: string; col: string; sortKey: string; sortDir: SortDir;
  onSort: (col: string) => void; align?: 'left' | 'right' | 'center'; color?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2.5 text-${align} text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap`}
      style={{ color: active ? '#4472E8' : (color ?? '#252F3E') }}
    >
      {label}
      <span className="ml-1 font-normal" style={{ opacity: active ? 1 : 0.3 }}>
        {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-black" style={{ color: accent || '#252F3E' }}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl overflow-hidden mb-6 ${className}`}
      style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      {children}
    </div>
  );
}

function SectionHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
      style={{ borderBottom: '1px solid #e5e7eb' }}>
      <div>
        <h3 className="font-black text-base" style={{ color: '#252F3E' }}>{title}</h3>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function ExpandButton({ expanded, total, onToggle }: { expanded: boolean; total: number; onToggle: () => void }) {
  return (
    <div className="py-2.5 text-center" style={{ borderTop: '1px solid #f3f4f6' }}>
      <button onClick={onToggle}
        className="text-xs font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-80"
        style={{ background: '#F5F5F0', color: '#4472E8', border: '1px solid #e5e7eb' }}>
        {expanded ? '↑ Show less' : `↓ Show all ${total} rows`}
      </button>
    </div>
  );
}

// DropZone removed — uploads are handled in the Setup tab

// ─── Main component ───────────────────────────────────────────────────────────

interface ChangeFileEntry {
  id: string;
  fileName: string;
  rows: InventoryChangeRow[];
  error: string | null;
  loading: boolean;
}

export default function InventoryHealthTab() {
  const { pendingLocFile, pendingChangeFiles, setPendingLocFile, setPendingChangeFiles } = useData();
  // Declared early so restore effects below can reference inventoryData / inventoryIdbReady
  const { registerInventoryData, setLocLoaded, inventoryData, inventoryIdbReady } = usePDF();

  const [locRows,      setLocRows]      = useState<ItemLocationRow[]>([]);
  const [locFile,      setLocFile]      = useState<string | null>(null);
  const [locError,     setLocError]     = useState<string | null>(null);
  const [locLoading,   setLocLoading]   = useState(false);
  const [changeFiles,  setChangeFiles]  = useState<ChangeFileEntry[]>([]);

  // Flat merge of all uploaded change reports
  const changeRows = useMemo(
    () => changeFiles.flatMap(f => f.rows),
    [changeFiles]
  );

  // Expand/collapse states
  const [expiryExpanded, setExpiryExpanded] = useState(false);
  const [dohExpanded,    setDohExpanded]    = useState(false);
  const [adjExpanded,    setAdjExpanded]    = useState(false);

  // Table sort states
  const [expirySortKey, setExpirySortKey] = useState('daysToExpire');
  const [expirySortDir, setExpirySortDir] = useState<SortDir>('asc');
  const [dohSortKey, setDohSortKey] = useState('doh');
  const [dohSortDir, setDohSortDir] = useState<SortDir>('asc');
  const [poSortKey, setPoSortKey] = useState('totalUnitsIn');
  const [poSortDir, setPoSortDir] = useState<SortDir>('desc');
  const [adjSortKey, setAdjSortKey] = useState('date');
  const [adjSortDir, setAdjSortDir] = useState<SortDir>('desc');
  const [adjCategoryFilter, setAdjCategoryFilter] = useState<Set<string>>(() => new Set(['Manual Adjustment']));

  // ── Carry Cost section ────────────────────────────────────────────────────
  const [productRows,       setProductRows]       = useState<ProductCatalogRow[]>([]);
  const [productFile,       setProductFile]       = useState<string | null>(null);
  const [productLoading,    setProductLoading]    = useState(false);
  const [productError,      setProductError]      = useState<string | null>(null);
  const [storageRate,       setStorageRate]       = useState(0.50);   // $/unit/month
  const [redThreshold,      setRedThreshold]      = useState(30);
  const [yellowThreshold,   setYellowThreshold]   = useState(15);
  const [carryExpanded,     setCarryExpanded]     = useState(false);
  const [carrySortKey,      setCarrySortKey]      = useState('carryCostPct');
  const [carrySortDir,      setCarrySortDir]      = useState<SortDir>('desc');
  const [carryInternalOnly, setCarryInternalOnly] = useState(false);
  const productFileRef = useRef<HTMLInputElement>(null);

  const handleTableSort = useCallback((
    col: string, key: string, setKey: (k: string) => void,
    dir: SortDir, setDir: (d: SortDir) => void
  ) => {
    if (col === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else { setKey(col); setDir('asc'); }
  }, []);

  // Restore on mount: wait for IDB check to finish, then restore from IDB or fall back to localStorage.
  const [idbRestored, setIdbRestored] = useState(false);
  useEffect(() => {
    if (idbRestored) return;
    if (!inventoryIdbReady) return; // IDB check still in progress — wait
    setIdbRestored(true);

    if (inventoryData?.locRows?.length) {
      // Primary path: raw rows survived refresh via IDB
      setLocRows(inventoryData.locRows);
      setLocFile(inventoryData.locFileName ?? 'Loaded');
      if (inventoryData.changeFileEntries?.length) {
        setChangeFiles(inventoryData.changeFileEntries.map(f => ({ ...f, error: null, loading: false })));
      }
    } else {
      // Fallback: try localStorage (small files that fit within 5MB quota)
      const cachedLoc = safeGetItem<{ rows: ItemLocationRow[]; fileName: string }>(STORAGE_KEYS.INV_LOC_CACHE);
      if (cachedLoc?.rows?.length) { setLocRows(cachedLoc.rows); setLocFile(cachedLoc.fileName); }
      const cachedChanges = safeGetItem<{ id: string; fileName: string; rows: InventoryChangeRow[] }[]>(STORAGE_KEYS.INV_CHANGES_CACHE);
      if (cachedChanges?.length) setChangeFiles(cachedChanges.map(f => ({ ...f, error: null, loading: false })));
    }
  }, [inventoryIdbReady, inventoryData, idbRestored]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-process files queued from modal or Setup tab.
  // Guard refs prevent double-invocation from React StrictMode / tab re-mount.
  const processingLocRef = useRef(false);
  useEffect(() => {
    if (pendingLocFile && !processingLocRef.current) {
      processingLocRef.current = true;
      handleLocFile(pendingLocFile).then(() => {
        setPendingLocFile(null);
        processingLocRef.current = false;
      });
    }
  }, [pendingLocFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const processingChangeRef = useRef(false);
  useEffect(() => {
    if (pendingChangeFiles.length > 0 && !processingChangeRef.current) {
      processingChangeRef.current = true;
      pendingChangeFiles.forEach(f => handleAddChangeFile(f));
      setPendingChangeFiles([]);
      processingChangeRef.current = false;
    }
  }, [pendingChangeFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inventory change files are persisted in IDB (via PDFContext.registerInventoryData).
  // We no longer write to INV_CHANGES_CACHE in localStorage to preserve storage quota.

  const hasLocData    = locRows.length > 0;
  const hasChangeData = changeRows.length > 0;

  const handleLocFile = useCallback(async (file: File) => {
    setLocError(null); setLocLoading(true);
    try {
      const parsed = await parseItemLocationsCSV(file);
      setLocRows(parsed); setLocFile(file.name);
      // Inventory is persisted in IDB (via PDFContext.registerInventoryData) — no localStorage write needed.
    } catch (err) {
      setLocError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally { setLocLoading(false); }
  }, []);

  const handleAddChangeFile = useCallback(async (file: File) => {
    // Prevent duplicate filenames
    if (changeFiles.some(f => f.fileName === file.name)) return;
    const id = `${Date.now()}-${file.name}`;
    setChangeFiles(prev => [...prev, { id, fileName: file.name, rows: [], error: null, loading: true }]);
    try {
      const parsed = await parseInventoryChangeCSV(file);
      setChangeFiles(prev => prev.map(f =>
        f.id === id ? { ...f, rows: parsed, loading: false } : f
      ));
    } catch (err) {
      setChangeFiles(prev => prev.map(f =>
        f.id === id
          ? { ...f, error: err instanceof Error ? err.message : 'Failed to parse file', loading: false }
          : f
      ));
    }
  }, [changeFiles]);

  const handleRemoveChangeFile = useCallback((id: string) => {
    setChangeFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const handleProductFile = useCallback(async (file: File) => {
    setProductError(null); setProductLoading(true);
    try {
      const parsed = await parseProductCatalogCSV(file);
      setProductRows(parsed); setProductFile(file.name);
    } catch (err) {
      setProductError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally { setProductLoading(false); }
  }, []);

  // ── KPIs from Item Locations ──────────────────────────────────────────────
  const locKPIs = useMemo(() => {
    if (!hasLocData) return null;
    const goodLoc = locRows.filter(r =>
      !['Damages', 'Receiving', 'Transfer'].includes(r.locationType)
    );
    const skus = new Set(goodLoc.map(r => `${r.client}::${r.sku}`));
    const units = goodLoc.reduce((s, r) => s + r.units, 0);
    const expiringCritical = locRows.filter(
      r => r.daysToExpire !== null && r.daysToExpire < 30
    ).length;
    const expiring90 = locRows.filter(
      r => r.daysToExpire !== null && r.daysToExpire < 90
    ).length;
    return { activeSkus: skus.size, totalUnits: units, expiringCritical, expiring90 };
  }, [locRows, hasLocData]);

  // ── KPIs from Change Report ───────────────────────────────────────────────
  const changeKPIs = useMemo(() => {
    if (!hasChangeData) return null;
    const manualAdj = changeRows.filter(r => r.reasonCategory === 'Manual Adjustment').length;
    return { manualAdj };
  }, [changeRows, hasChangeData]);

  // ── Date range from change report ─────────────────────────────────────────
  const dateRange = useMemo(() => {
    if (!hasChangeData) return null;
    let min = changeRows[0].date;
    let max = changeRows[0].date;
    for (const r of changeRows) {
      if (r.date < min) min = r.date;
      if (r.date > max) max = r.date;
    }
    const minD = new Date(min);
    const maxD = new Date(max);
    const periodDays = Math.max(
      1,
      (maxD.getTime() - minD.getTime()) / (1000 * 60 * 60 * 24)
    );
    return { min, max, periodDays };
  }, [changeRows, hasChangeData]);

  // ── Carry Cost rows (needs dateRange, so declared here) ───────────────────
  const carryCostRows = useMemo((): CarryCostRow[] => {
    if (productRows.length === 0) return [];

    const outboundMap = new Map<string, number>();
    for (const r of changeRows) {
      if (r.unitDelta >= 0) continue;
      if (!['DTC Order', 'B2B / Wholesale'].includes(r.reasonCategory)) continue;
      const key = `${r.client}::${r.sku}`;
      outboundMap.set(key, (outboundMap.get(key) ?? 0) + Math.abs(r.unitDelta));
    }

    const periodMonths = dateRange ? Math.max(dateRange.periodDays / 30, 0.5) : 1;

    return productRows
      .filter(r => r.active && r.price > 0)
      .map(r => {
        const key           = `${r.client}::${r.sku}`;
        const unitsSold     = outboundMap.get(key) ?? 0;
        const totalRevenue  = unitsSold * r.price;
        const avgUnitsInStorage = r.onHand;
        const totalStorageFees  = avgUnitsInStorage * storageRate * periodMonths;
        const carryCostPct  = totalRevenue > 0 ? (totalStorageFees / totalRevenue) * 100 : null;
        return {
          client: r.client, sku: r.sku, name: r.name,
          unitsSold, totalRevenue, avgUnitsInStorage, totalStorageFees,
          carryCostPct,
          status: carryStatus(carryCostPct, redThreshold, yellowThreshold),
        };
      });
  }, [productRows, changeRows, storageRate, dateRange, redThreshold, yellowThreshold]);

  const carryKPIs = useMemo(() => {
    if (carryCostRows.length === 0) return null;
    const redSkus     = carryCostRows.filter(r => r.status === 'red');
    const withRevenue = carryCostRows.filter(r => r.carryCostPct !== null);
    const totalFees   = carryCostRows.reduce((s, r) => s + r.totalStorageFees, 0);
    const totalRev    = carryCostRows.reduce((s, r) => s + r.totalRevenue, 0);
    const avg         = withRevenue.length > 0
      ? withRevenue.reduce((s, r) => s + r.carryCostPct!, 0) / withRevenue.length
      : null;
    const revenueAtRisk = redSkus.reduce((s, r) => s + r.totalStorageFees, 0);
    return { redCount: redSkus.length, totalFees, totalRev, avg, revenueAtRisk, totalSkus: carryCostRows.length };
  }, [carryCostRows]);

  // ── Expiry alerts (from Item Locations) ───────────────────────────────────
  const expiryAlerts = useMemo(() => {
    if (!hasLocData) return [];
    return locRows
      .filter(r => r.daysToExpire !== null && r.daysToExpire < 180)
      .map(r => ({ ...r, tier: expiryTier(r.daysToExpire!) }));
  }, [locRows, hasLocData]);

  // ── Days on Hand (requires both files) ────────────────────────────────────
  const daysOnHand = useMemo(() => {
    if (!hasLocData || !hasChangeData || !dateRange) return [];

    // Current stock: sum per (client, sku) — excluding non-sellable locations
    const stockMap = new Map<string, { units: number; item: string }>();
    for (const r of locRows) {
      if (['Damages', 'Receiving', 'Transfer', 'Digital'].includes(r.locationType)) continue;
      const key = `${r.client}::${r.sku}`;
      const ex = stockMap.get(key) ?? { units: 0, item: r.item };
      stockMap.set(key, { units: ex.units + r.units, item: ex.item || r.item });
    }

    // Outbound velocity: sum |delta| for DTC + B2B outbound moves
    const outboundMap = new Map<string, number>();
    for (const r of changeRows) {
      if (r.unitDelta >= 0) continue; // only outbound (negative delta)
      if (!['DTC Order', 'B2B / Wholesale'].includes(r.reasonCategory)) continue;
      const key = `${r.client}::${r.sku}`;
      outboundMap.set(key, (outboundMap.get(key) ?? 0) + Math.abs(r.unitDelta));
    }

    const results: {
      client: string; sku: string; item: string;
      currentUnits: number; totalOutbound: number;
      dailyVelocity: number; doh: number | null; status: DOHStatus;
    }[] = [];

    for (const [key, { units, item }] of stockMap.entries()) {
      const [client, sku] = key.split('::');
      const totalOut = outboundMap.get(key) ?? 0;
      const velocity = totalOut > 0 ? totalOut / dateRange.periodDays : 0;
      const doh = velocity > 0 ? units / velocity : null;
      results.push({
        client, sku, item, currentUnits: units,
        totalOutbound: totalOut, dailyVelocity: velocity,
        doh, status: dohStatus(doh),
      });
    }

    return results;
  }, [locRows, changeRows, hasLocData, hasChangeData, dateRange]);

  // ── Fulfillment mix by client (from change report) ────────────────────────
  const fulfillmentMix = useMemo(() => {
    if (!hasChangeData) return [];
    const map = new Map<string, { dtc: number; b2b: number }>();
    for (const r of changeRows) {
      if (!['DTC Order', 'B2B / Wholesale'].includes(r.reasonCategory)) continue;
      if (r.unitDelta >= 0) continue; // only actual shipments (outbound)
      const ex = map.get(r.client) ?? { dtc: 0, b2b: 0 };
      if (r.reasonCategory === 'DTC Order') ex.dtc++;
      else ex.b2b++;
      map.set(r.client, ex);
    }
    return [...map.entries()]
      .map(([client, { dtc, b2b }]) => ({
        name: client.length > 20 ? client.slice(0, 18) + '…' : client,
        fullName: client,
        'DTC Orders': dtc,
        'B2B / Wholesale': b2b,
        total: dtc + b2b,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [changeRows, hasChangeData]);

  // ── Inbound PO cadence (from change report) ───────────────────────────────
  const poCadence = useMemo(() => {
    if (!hasChangeData) return [];
    // Only positive deltas (receiving into bins) from Inbound PO
    const map = new Map<string, { pos: Set<string>; units: number; lastDate: string }>();
    for (const r of changeRows) {
      if (r.reasonCategory !== 'Inbound PO') continue;
      if (r.unitDelta <= 0) continue;
      // Extract PO reference from clean reason: last "word" after "Purchase Order"
      const match = r.reason.match(/Purchase Order\s+([\w-]+)/i);
      const poRef = match ? match[1] : 'Unknown';
      const ex = map.get(r.client) ?? { pos: new Set(), units: 0, lastDate: '' };
      ex.pos.add(poRef);
      ex.units += r.unitDelta;
      if (!ex.lastDate || r.date > ex.lastDate) ex.lastDate = r.date;
      map.set(r.client, ex);
    }
    return [...map.entries()]
      .map(([client, { pos, units, lastDate }]) => ({
        client,
        poCount: pos.size,
        totalUnitsIn: units,
        avgUnitsPerPO: pos.size > 0 ? Math.round(units / pos.size) : 0,
        lastReceived: lastDate.slice(0, 10),
      }));
  }, [changeRows, hasChangeData]);

  // ── Manual adjustments (from change report) ───────────────────────────────
  const manualAdjRows = useMemo(() => {
    if (!hasChangeData) return [];
    return changeRows.filter(
      r => !['DTC Order', 'B2B / Wholesale', 'Inbound PO', 'Kit Update', 'Product Update'].includes(r.reasonCategory)
    );
  }, [changeRows, hasChangeData]);

  const reasonSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of manualAdjRows) {
      const key = normalizeReason(r.reason) || '(blank)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [manualAdjRows]);

  // ── Avg DOH KPI ───────────────────────────────────────────────────────────
  const avgDOH = useMemo(() => {
    const moving = daysOnHand.filter(r => r.doh !== null);
    if (moving.length === 0) return null;
    return Math.round(moving.reduce((s, r) => s + r.doh!, 0) / moving.length);
  }, [daysOnHand]);

  // ── Sorted display arrays ─────────────────────────────────────────────────
  const sortedExpiry = useMemo(
    () => sortRows(expiryAlerts, expirySortKey, expirySortDir),
    [expiryAlerts, expirySortKey, expirySortDir]
  );
  const sortedDOH = useMemo(
    () => sortRows(daysOnHand, dohSortKey, dohSortDir),
    [daysOnHand, dohSortKey, dohSortDir]
  );
  const sortedPO = useMemo(
    () => sortRows(poCadence, poSortKey, poSortDir),
    [poCadence, poSortKey, poSortDir]
  );
  const adjCategoryOptions = useMemo(
    () => [...new Set(manualAdjRows.map(r => r.reasonCategory))].sort(),
    [manualAdjRows]
  );
  const filteredAdjRows = useMemo(
    () => adjCategoryFilter.size === 0
      ? manualAdjRows
      : manualAdjRows.filter(r => adjCategoryFilter.has(r.reasonCategory)),
    [manualAdjRows, adjCategoryFilter]
  );
  const sortedAdj = useMemo(
    () => sortRows(filteredAdjRows, adjSortKey, adjSortDir),
    [filteredAdjRows, adjSortKey, adjSortDir]
  );

  useEffect(() => {
    if (hasLocData) setLocLoaded(true);
  }, [hasLocData, setLocLoaded]);
  useEffect(() => {
    if (!hasLocData && !hasChangeData) return;
    // Don't write while any change file is still parsing — the entry would be
    // filtered out (loading: true) and we'd persist an empty changeFileEntries
    // list, which would overwrite any previously-saved data.  We wait until all
    // files are either loaded or errored so the write always contains the full set.
    if (changeFiles.some(f => f.loading)) return;
    registerInventoryData({
      expiryAlerts: expiryAlerts as ExpiryAlertRowPDF[],
      daysOnHand: daysOnHand as DaysOnHandRowPDF[],
      poCadence,
      manualAdjRows,
      locRows,
      locFileName: locFile ?? undefined,
      changeFileEntries: changeFiles
        .filter(f => !f.loading && !f.error)
        .map(({ id, fileName, rows }) => ({ id, fileName, rows })),
    });
  }, [expiryAlerts, daysOnHand, poCadence, manualAdjRows, locRows, changeFiles, registerInventoryData, hasLocData, hasChangeData]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'Metropolis', sans-serif", color: '#252F3E' }}>

      <div className="p-6 max-w-screen-2xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black" style={{ color: '#252F3E' }}>Inventory Insights</h1>
        <p className="text-sm text-gray-500 mt-1">
          Expiry alerts, days on hand, fulfillment mix, inbound cadence, and manual adjustment analysis.
        </p>
      </div>

      {/* Empty state */}
      {!hasLocData && !hasChangeData && (
        <div className="rounded-xl p-10 text-center" style={{ background: 'rgba(68,114,232,0.04)', border: '1px dashed rgba(68,114,232,0.3)' }}>
          <div className="text-4xl mb-3">📦</div>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Upload your Product Locations and Inventory Change Report CSVs in the <strong>Setup</strong> tab to view expiry alerts, days on hand, fulfillment mix, inbound cadence, and manual adjustment insights.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      {(hasLocData || hasChangeData) && (
        <>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Inventory Summary</span>
          <InsightGate sectionKey="inventoryKPIs" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <KPICard
            label="Active SKUs"
            value={locKPIs ? fmtN(locKPIs.activeSkus) : '—'}
            sub="unique client+SKU pairs"
            accent="#4472E8"
          />
          <KPICard
            label="Total Units on Hand"
            value={locKPIs ? fmtBig(locKPIs.totalUnits) : '—'}
            sub="excl. damages & receiving"
          />
          <KPICard
            label="Expiring < 90 Days"
            value={locKPIs ? fmtN(locKPIs.expiring90) : '—'}
            sub={locKPIs && locKPIs.expiringCritical > 0 ? `${locKPIs.expiringCritical} critical (<30d)` : 'lot-tracked items'}
            accent={locKPIs && locKPIs.expiringCritical > 0 ? '#EF4444' : '#EF5252'}
          />
          <KPICard
            label="Avg Days on Hand"
            value={avgDOH !== null ? `${avgDOH}d` : '—'}
            sub="moving SKUs only"
            accent="#22C55E"
          />
          <KPICard
            label="Manual Adjustments"
            value={changeKPIs ? fmtN(changeKPIs.manualAdj) : '—'}
            sub={dateRange ? `${Math.round(dateRange.periodDays)}d period` : 'in period'}
            accent="#8B5CF6"
          />
        </div>
        </>
      )}

      {/* ── Expiry Alerts ──────────────────────────────────────────────────── */}
      {hasLocData && expiryAlerts.length > 0 && (
        <SectionCard>
          <SectionHeader
            title="Expiry Alerts"
            sub={`${expiryAlerts.length} lot-tracked items expiring within 180 days · sorted by urgency`}
          >
            <div className="flex items-center gap-2">
              <InsightGate sectionKey="expiryAlerts" />
              <ExportButton
                data={expiryAlerts.map(r => ({
                  Client: r.client,
                  SKU: r.sku,
                  Item: r.item,
                  Warehouse: r.warehouse,
                  Location: r.location,
                  Units: r.units,
                  'Lot Name': r.lotName,
                  'Exp Date': r.expDate,
                  'Days to Expire': r.daysToExpire,
                  Tier: TIER_CFG[r.tier].label,
                }))}
                filename="expiry_alerts"
              />
              <SortFilterButton
                sortKey={expirySortKey} sortDir={expirySortDir}
                defaultSortKey="daysToExpire" defaultSortDir="asc"
                onSort={(k, d) => { setExpirySortKey(k); setExpirySortDir(d); }}
                options={[
                  { key: 'client',       label: 'Client',    descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'item',         label: 'Item',      descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'sku',          label: 'SKU',       descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'units',        label: 'Units',     descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'daysToExpire', label: 'Days',      descLabel: '↓ Far', ascLabel: '↑ Soon' },
                  { key: 'tier',         label: 'Status',    descLabel: '↓ OK', ascLabel: '↑ Critical' },
                ]}
              />
            </div>
          </SectionHeader>
          {/* Expiry legend */}
          <div className="px-5 py-2 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid #f3f4f6', background: '#FAFAF8' }}>
            <span className="text-xs font-semibold text-gray-400 mr-1">Status:</span>
            {(Object.entries(TIER_CFG) as [ExpiryTier, typeof TIER_CFG[ExpiryTier]][]).map(([tier, cfg]) => (
              <span key={tier} className="inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                {cfg.label}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '720px' }}>
              <thead>
                <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                  {([
                    { col: 'client', label: 'Client' },
                    { col: 'item', label: 'Item' },
                    { col: 'sku', label: 'SKU' },
                    { col: 'location', label: 'Location' },
                    { col: 'units', label: 'Units', align: 'right' as const },
                    { col: 'lotName', label: 'Lot' },
                    { col: 'expDate', label: 'Exp Date' },
                    { col: 'daysToExpire', label: 'Days', align: 'right' as const },
                    { col: 'tier', label: 'Status' },
                  ] as { col: string; label: string; align?: 'left' | 'right' | 'center' }[]).map(({ col, label, align = 'left' }) => (
                    <SortTh key={col} col={col} label={label} align={align}
                      sortKey={expirySortKey} sortDir={expirySortDir}
                      onSort={c => handleTableSort(c, expirySortKey, setExpirySortKey, expirySortDir, setExpirySortDir)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {(expiryExpanded ? sortedExpiry : sortedExpiry.slice(0, 5)).map((r, idx) => {
                  const cfg = TIER_CFG[r.tier];
                  return (
                    <tr key={`${r.sku}-${r.location}-${idx}`} style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)', borderBottom: '1px solid #f3f4f6' }}>
                      <td className="px-3 py-2.5 font-semibold text-xs" style={{ color: '#252F3E' }}>{r.client}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 max-w-xs truncate" title={r.item}>{r.item.slice(0, 40)}{r.item.length > 40 ? '…' : ''}</td>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{r.sku}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{r.location}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-xs" style={{ color: '#252F3E' }}>{fmtN(r.units)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 font-mono">{r.lotName || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{r.expDate || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-black text-xs" style={{ color: cfg.text }}>{r.daysToExpire}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                          style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {expiryAlerts.length > 5 && (
            <ExpandButton expanded={expiryExpanded} total={expiryAlerts.length} onToggle={() => setExpiryExpanded(e => !e)} />
          )}
        </SectionCard>
      )}

      {/* ── Days on Hand ───────────────────────────────────────────────────── */}
      {hasLocData && hasChangeData && daysOnHand.length > 0 && (
        <SectionCard>
          <SectionHeader
            title="Days on Hand by SKU"
            sub={`Current stock ÷ daily shipment velocity · ${Math.round(dateRange?.periodDays ?? 0)}-day period`}
          >
            <div className="flex items-center gap-2">
              <InsightGate sectionKey="daysOnHand" />
              <ExportButton
                data={daysOnHand.map(r => ({
                  Client: r.client,
                  SKU: r.sku,
                  Item: r.item,
                  'Units on Hand': r.currentUnits,
                  'Total Shipped (period)': r.totalOutbound,
                  'Daily Velocity': parseFloat(r.dailyVelocity.toFixed(2)),
                  'Days on Hand': r.doh !== null ? Math.round(r.doh) : '',
                  Status: DOH_CFG[r.status].label,
                }))}
                filename="days_on_hand"
              />
              <SortFilterButton
                sortKey={dohSortKey} sortDir={dohSortDir}
                defaultSortKey="doh" defaultSortDir="asc"
                onSort={(k, d) => { setDohSortKey(k); setDohSortDir(d); }}
                options={[
                  { key: 'client',        label: 'Client',        descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'sku',           label: 'SKU',           descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'currentUnits',  label: 'On Hand',       descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'totalOutbound', label: 'Shipped',       descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'dailyVelocity', label: 'Daily Velocity',descLabel: '↓ Fast', ascLabel: '↑ Slow' },
                  { key: 'doh',           label: 'Days on Hand',  descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'status',        label: 'Status',        descLabel: 'Z→A', ascLabel: 'A→Z' },
                ]}
              />
            </div>
          </SectionHeader>
          {/* DOH legend */}
          <div className="px-5 py-2 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid #f3f4f6', background: '#FAFAF8' }}>
            <span className="text-xs font-semibold text-gray-400 mr-1">Status:</span>
            {([
              { cfg: DOH_CFG.critical,    threshold: '< 14 days' },
              { cfg: DOH_CFG.low,         threshold: '14–30 days' },
              { cfg: DOH_CFG.ok,          threshold: '30–180 days' },
              { cfg: DOH_CFG.overstocked, threshold: '> 180 days' },
              { cfg: DOH_CFG['no-movement'], threshold: 'no outbound' },
            ] as { cfg: typeof DOH_CFG[DOHStatus]; threshold: string }[]).map(({ cfg, threshold }) => (
              <span key={cfg.label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                {cfg.label}
                <span className="font-normal opacity-75">({threshold})</span>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '720px' }}>
              <thead>
                <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                  {([
                    { col: 'client', label: 'Client' },
                    { col: 'sku', label: 'SKU' },
                    { col: 'item', label: 'Item' },
                    { col: 'currentUnits', label: 'On Hand', align: 'right' as const },
                    { col: 'totalOutbound', label: 'Shipped (Period)', align: 'right' as const },
                    { col: 'dailyVelocity', label: 'Daily Velocity', align: 'right' as const },
                    { col: 'doh', label: 'Days on Hand', align: 'right' as const },
                    { col: 'status', label: 'Status' },
                  ] as { col: string; label: string; align?: 'left' | 'right' | 'center' }[]).map(({ col, label, align = 'left' }) => (
                    <SortTh key={col} col={col} label={label} align={align}
                      sortKey={dohSortKey} sortDir={dohSortDir}
                      onSort={c => handleTableSort(c, dohSortKey, setDohSortKey, dohSortDir, setDohSortDir)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {(dohExpanded ? sortedDOH : sortedDOH.slice(0, 5)).map((r, idx) => {
                  const cfg = DOH_CFG[r.status];
                  return (
                    <tr key={`${r.client}-${r.sku}`} style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)', borderBottom: '1px solid #f3f4f6' }}>
                      <td className="px-3 py-2.5 font-semibold text-xs" style={{ color: '#252F3E' }}>{r.client}</td>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{r.sku}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 max-w-xs truncate" title={r.item}>{r.item.slice(0, 36)}{r.item.length > 36 ? '…' : ''}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-xs" style={{ color: '#252F3E' }}>{fmtN(r.currentUnits)}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-500">{fmtN(r.totalOutbound)}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-500">{r.dailyVelocity.toFixed(1)}/day</td>
                      <td className="px-3 py-2.5 text-right font-black text-xs" style={{ color: cfg.text }}>
                        {r.doh !== null ? Math.round(r.doh) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                          style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {daysOnHand.length > 5 && (
            <ExpandButton expanded={dohExpanded} total={daysOnHand.length} onToggle={() => setDohExpanded(e => !e)} />
          )}
          <div className="px-5 py-3" style={{ borderTop: '1px solid #f3f4f6', background: '#FAFAF8' }}>
            <p className="text-xs text-gray-400">
              <span className="font-semibold text-gray-500">Methodology: </span>
              Daily velocity = units shipped (DTC + B2B) ÷ report period days.
              SKUs with no outbound movement show "No Movement" — may be new arrivals or paused products.
              Critical &lt;14 days · Low 14–30 · Healthy 30–180 · Overstocked &gt;180.
            </p>
          </div>
        </SectionCard>
      )}

      {hasLocData && !hasChangeData && (
        <div className="rounded-xl p-5 mb-6 text-sm font-semibold" style={{ background: 'rgba(68,114,232,0.04)', border: '1px dashed rgba(68,114,232,0.3)', color: '#4472E8' }}>
          📋 Upload an Inventory Change Report to unlock Days on Hand, Fulfillment Mix, Inbound PO Cadence, and Manual Adjustments.
        </div>
      )}

      {/* ── Fulfillment Mix ────────────────────────────────────────────────── */}
      {hasChangeData && fulfillmentMix.length > 0 && (
        <SectionCard>
          <SectionHeader
            title="Fulfillment Mix by Client"
            sub="DTC vs B2B/Wholesale outbound events — shows operational complexity per account"
          >
            <ExportButton
              data={fulfillmentMix.map(r => ({
                Client: r.fullName,
                'DTC Orders': r['DTC Orders'],
                'B2B / Wholesale': r['B2B / Wholesale'],
                Total: r.total,
              }))}
              filename="fulfillment_mix_by_client"
            />
          </SectionHeader>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={Math.max(240, fulfillmentMix.length * 40)}>
              <BarChart data={fulfillmentMix} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={fmtN} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: '#252F3E' }} />
                <RTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const item = fulfillmentMix.find(r => r.name === label);
                    return (
                      <div className="rounded-xl p-3 shadow-xl text-sm" style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: 180 }}>
                        <div className="font-bold text-white mb-2 truncate">{item?.fullName || label}</div>
                        {payload.map((p, i) => (
                          <div key={i} style={{ color: p.color as string }}>
                            {p.name}: <span className="text-white font-semibold">{fmtN(p.value as number)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="DTC Orders" fill={CATEGORY_COLORS['DTC Order']} radius={[0, 3, 3, 0]} stackId="a" />
                <Bar dataKey="B2B / Wholesale" fill={CATEGORY_COLORS['B2B / Wholesale']} radius={[0, 3, 3, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {/* ── Inbound PO Cadence ─────────────────────────────────────────────── */}
      {hasChangeData && poCadence.length > 0 && (
        <SectionCard>
          <SectionHeader
            title="Inbound PO Cadence"
            sub="Purchase orders received during the report period"
          >
            <div className="flex items-center gap-2">
              <ExportButton
                data={poCadence.map(r => ({
                  Client: r.client,
                  '# POs': r.poCount,
                  'Total Units Received': r.totalUnitsIn,
                  'Avg Units / PO': r.avgUnitsPerPO,
                  'Last Received': r.lastReceived,
                }))}
                filename="inbound_po_cadence"
              />
              <SortFilterButton
                sortKey={poSortKey} sortDir={poSortDir}
                defaultSortKey="totalUnitsIn" defaultSortDir="desc"
                onSort={(k, d) => { setPoSortKey(k); setPoSortDir(d); }}
                options={[
                  { key: 'client',       label: 'Client',          descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'poCount',      label: '# POs',           descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'totalUnitsIn', label: 'Total Units In',  descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'avgUnitsPerPO',label: 'Avg Units / PO',  descLabel: '↓ Most', ascLabel: '↑ Fewest' },
                  { key: 'lastReceived', label: 'Last Received',   descLabel: '↓ Recent', ascLabel: '↑ Oldest' },
                ]}
              />
            </div>
          </SectionHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                  {([
                    { col: 'client', label: 'Client' },
                    { col: 'poCount', label: '# POs', align: 'right' as const },
                    { col: 'totalUnitsIn', label: 'Total Units In', align: 'right' as const },
                    { col: 'avgUnitsPerPO', label: 'Avg Units / PO', align: 'right' as const },
                    { col: 'lastReceived', label: 'Last Received' },
                  ] as { col: string; label: string; align?: 'left' | 'right' | 'center' }[]).map(({ col, label, align = 'left' }) => (
                    <SortTh key={col} col={col} label={label} align={align}
                      sortKey={poSortKey} sortDir={poSortDir}
                      onSort={c => handleTableSort(c, poSortKey, setPoSortKey, poSortDir, setPoSortDir)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPO.map((r, idx) => (
                  <tr key={r.client} style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)', borderBottom: '1px solid #f3f4f6' }}>
                    <td className="px-4 py-2.5 font-bold text-sm" style={{ color: '#252F3E' }}>{r.client}</td>
                    <td className="px-4 py-2.5 font-semibold text-sm text-center" style={{ color: '#4472E8' }}>{r.poCount}</td>
                    <td className="px-4 py-2.5 font-semibold text-sm" style={{ color: '#252F3E' }}>{fmtN(r.totalUnitsIn)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{fmtN(r.avgUnitsPerPO)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{r.lastReceived}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Manual Adjustments ─────────────────────────────────────────────── */}
      {hasChangeData && manualAdjRows.length > 0 && (
        <SectionCard>
          <SectionHeader
            title="Manual Adjustments"
            sub={`${filteredAdjRows.length} of ${manualAdjRows.length} non-automated inventory changes · excludes orders, POs, kit updates, and product catalog syncs`}
          >
            <div className="flex items-center gap-2">
              <InsightGate sectionKey="manualAdjustments" />
              <ExportButton
                data={manualAdjRows.map(r => ({
                  Date: r.date.slice(0, 10),
                  Client: r.client,
                  SKU: r.sku,
                  Item: r.name,
                  'Δ Units': r.unitDelta,
                  'Previous On Hand': r.previousOnHand,
                  'Updated On Hand': r.updatedOnHand,
                  Category: r.reasonCategory,
                  Reason: r.reason,
                  'Changed By': r.changedBy,
                }))}
                filename="manual_adjustments"
              />
              <SortFilterButton
                sortKey={adjSortKey} sortDir={adjSortDir}
                defaultSortKey="date" defaultSortDir="desc"
                hasActiveFilter={adjCategoryFilter.size > 0 && adjCategoryFilter.size < adjCategoryOptions.length}
                onSort={(k, d) => { setAdjSortKey(k); setAdjSortDir(d); }}
                options={[
                  { key: 'date',           label: 'Date',      descLabel: '↓ Recent', ascLabel: '↑ Oldest' },
                  { key: 'client',         label: 'Client',    descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'sku',            label: 'SKU',       descLabel: 'Z→A', ascLabel: 'A→Z' },
                  { key: 'unitDelta',      label: 'Δ Units',   descLabel: '↓ High', ascLabel: '↑ Low' },
                  { key: 'reasonCategory', label: 'Category',  descLabel: 'Z→A', ascLabel: 'A→Z' },
                ]}
                extraContent={
                  <div>
                    <div className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#9CA3AF' }}>
                      Filter by Category
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {adjCategoryOptions.map(cat => {
                        const checked = adjCategoryFilter.size === 0 || adjCategoryFilter.has(cat);
                        const color = CATEGORY_COLORS[cat as ChangeCategory] ?? '#6B7280';
                        return (
                          <label key={cat} className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setAdjCategoryFilter(prev => {
                                  // If size === 0 (show all), switching one off means hide just that one
                                  const base = prev.size === 0 ? new Set(adjCategoryOptions) : new Set(prev);
                                  if (base.has(cat)) base.delete(cat); else base.add(cat);
                                  // If all checked, treat as "show all" (empty set)
                                  return base.size === adjCategoryOptions.length ? new Set() : base;
                                });
                              }}
                              className="rounded"
                              style={{ accentColor: color }}
                            />
                            <span
                              className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                              style={{ background: color + '18', color, border: `1px solid ${color}44` }}
                            >
                              {cat}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {adjCategoryFilter.size > 0 && adjCategoryFilter.size < adjCategoryOptions.length && (
                      <button
                        onClick={() => setAdjCategoryFilter(new Set())}
                        className="mt-2 text-xs font-semibold"
                        style={{ color: '#4472E8' }}
                      >
                        Show all categories
                      </button>
                    )}
                  </div>
                }
              />
            </div>
          </SectionHeader>

          {/* Reason summary chart */}
          {reasonSummary.length > 0 && (
            <div className="px-5 pt-5 pb-2">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">
                Most Common Reasons
              </div>
              <ResponsiveContainer width="100%" height={Math.max(160, reasonSummary.length * 36)}>
                <BarChart data={reasonSummary} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    width={260}
                    tick={{ fontSize: 10, fill: '#252F3E' }}
                    tickFormatter={(v: string) => v.length > 42 ? v.slice(0, 40) + '…' : v}
                  />
                  <RTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as typeof reasonSummary[0];
                      return (
                        <div className="rounded-xl p-3 shadow-xl text-xs" style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', maxWidth: 320 }}>
                          <div className="text-white font-semibold mb-1">{d.reason}</div>
                          <div className="text-gray-300">Count: <span className="text-white font-bold">{d.count}</span></div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {reasonSummary.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail table */}
          <div className="overflow-x-auto" style={{ borderTop: '1px solid #f3f4f6' }}>
            <table className="w-full text-sm" style={{ minWidth: '860px' }}>
              <thead>
                <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                  {([
                    { col: 'date', label: 'Date' },
                    { col: 'client', label: 'Client' },
                    { col: 'sku', label: 'SKU' },
                    { col: 'name', label: 'Item' },
                    { col: 'unitDelta', label: 'Δ Units', align: 'right' as const },
                    { col: 'reasonCategory', label: 'Category' },
                    { col: 'reason', label: 'Reason' },
                    { col: 'changedBy', label: 'Changed By' },
                  ] as { col: string; label: string; align?: 'left' | 'right' | 'center' }[]).map(({ col, label, align = 'left' }) => (
                    <SortTh key={col} col={col} label={label} align={align}
                      sortKey={adjSortKey} sortDir={adjSortDir}
                      onSort={c => handleTableSort(c, adjSortKey, setAdjSortKey, adjSortDir, setAdjSortDir)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {(adjExpanded ? sortedAdj : sortedAdj.slice(0, 5)).map((r, idx) => {
                  const catColor = CATEGORY_COLORS[r.reasonCategory];
                  return (
                    <tr key={r.date + r.sku + idx} style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)', borderBottom: '1px solid #f3f4f6' }}>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-500 whitespace-nowrap">{r.date.slice(0, 10)}</td>
                      <td className="px-3 py-2.5 font-semibold text-xs" style={{ color: '#252F3E' }}>{r.client}</td>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{r.sku}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 max-w-xs truncate" title={r.name}>{r.name.slice(0, 32)}{r.name.length > 32 ? '…' : ''}</td>
                      <td className="px-3 py-2.5 text-right font-black text-xs" style={{ color: r.unitDelta > 0 ? '#22C55E' : r.unitDelta < 0 ? '#EF4444' : '#6B7280' }}>
                        {r.unitDelta > 0 ? '+' : ''}{fmtN(r.unitDelta)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                          style={{ background: catColor + '18', color: catColor, border: `1px solid ${catColor}44` }}>
                          {r.reasonCategory}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600 max-w-xs" style={{ maxWidth: '260px' }}>
                        <span title={r.reason}>{r.reason.slice(0, 60)}{r.reason.length > 60 ? '…' : ''}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{r.changedBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredAdjRows.length > 5 && (
            <ExpandButton expanded={adjExpanded} total={filteredAdjRows.length} onToggle={() => setAdjExpanded(e => !e)} />
          )}
        </SectionCard>
      )}

      {/* ── Carry Cost % of Revenue ──────────────────────────────────────────── */}
      <div style={{ marginTop: 8 }}>
        {/* Section title row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#252F3E' }}>
              Carry Cost % of Revenue
            </span>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>storage fees as a % of SKU revenue</span>
            {productFile && (
              <span style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>{productFile}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {productRows.length > 0 && (
              <button
                onClick={() => setCarryInternalOnly(v => !v)}
                title={carryInternalOnly ? 'Mark visible to client' : 'Mark as internal only (hide from client exports)'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 7, border: '1px solid',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'Metropolis', sans-serif",
                  background: carryInternalOnly ? 'rgba(139,92,246,0.08)' : 'rgba(34,197,94,0.08)',
                  color: carryInternalOnly ? '#7C3AED' : '#15803D',
                  borderColor: carryInternalOnly ? 'rgba(139,92,246,0.3)' : 'rgba(34,197,94,0.3)',
                }}
              >
                {carryInternalOnly ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    Internal Only
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Visible to Client
                  </>
                )}
              </button>
            )}
            {productRows.length > 0 && (
              <button
                onClick={() => { setProductRows([]); setProductFile(null); setProductError(null); }}
                style={{ fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
                title="Remove product catalog"
              >
                ✕ Remove
              </button>
            )}
          </div>
        </div>

        {/* Upload prompt */}
        {productRows.length === 0 && (
          <div
            className="rounded-xl p-8 text-center"
            style={{ background: 'rgba(68,114,232,0.04)', border: '1px dashed rgba(68,114,232,0.3)', marginBottom: 8 }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>💰</div>
            <p className="text-sm font-semibold" style={{ color: '#252F3E', marginBottom: 4 }}>
              Upload Product Catalog to calculate Carry Cost %
            </p>
            <p className="text-xs text-gray-400 max-w-sm mx-auto mb-5">
              Export your ShipHero product/inventory list (CSV). Needs: <strong>SKU</strong>, <strong>3PL Customer</strong>, <strong>On Hand</strong>, <strong>Price</strong> columns.
              {!hasChangeData && ' Also upload an Inventory Change Report for units-sold data.'}
            </p>
            <input
              ref={productFileRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleProductFile(f); e.target.value = ''; }}
            />
            {productLoading ? (
              <span style={{ fontSize: 13, color: '#4472E8' }}>Parsing…</span>
            ) : (
              <button
                onClick={() => productFileRef.current?.click()}
                className="px-5 py-2 rounded-lg font-bold text-sm transition-all hover:opacity-80"
                style={{ background: '#4472E8', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
              >
                Upload Product Catalog CSV
              </button>
            )}
            {productError && (
              <p style={{ color: '#EF4444', fontSize: 12, marginTop: 8 }}>{productError}</p>
            )}
          </div>
        )}

        {/* Main section — shown when product data is loaded */}
        {productRows.length > 0 && (
          <>
            {/* Settings bar */}
            <div style={{
              background: '#F9FAFB', border: '1px solid #e5e7eb', borderRadius: 10,
              padding: '10px 16px', marginBottom: 14,
              display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Settings</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#374151' }}>
                Storage fee rate
                <input
                  type="number"
                  min={0} step={0.01}
                  value={storageRate}
                  onChange={e => setStorageRate(Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ width: 68, padding: '3px 7px', borderRadius: 6, border: '1.5px solid #D1D5DB', fontSize: 12, fontFamily: "'Metropolis', sans-serif" }}
                />
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>$/unit/month</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#374151' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} />
                Red above
                <input
                  type="number"
                  min={1} max={200}
                  value={redThreshold}
                  onChange={e => setRedThreshold(Math.max(1, parseInt(e.target.value) || 30))}
                  style={{ width: 52, padding: '3px 7px', borderRadius: 6, border: '1.5px solid #D1D5DB', fontSize: 12, fontFamily: "'Metropolis', sans-serif" }}
                />
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>%</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#374151' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
                Yellow above
                <input
                  type="number"
                  min={1} max={200}
                  value={yellowThreshold}
                  onChange={e => setYellowThreshold(Math.max(1, parseInt(e.target.value) || 15))}
                  style={{ width: 52, padding: '3px 7px', borderRadius: 6, border: '1.5px solid #D1D5DB', fontSize: 12, fontFamily: "'Metropolis', sans-serif" }}
                />
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>%</span>
              </label>
              {!hasChangeData && (
                <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>
                  ⚠ No change report — units sold shown as 0
                </span>
              )}
              {dateRange && (
                <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' }}>
                  Period: {Math.round(dateRange.periodDays)}d ({(dateRange.periodDays / 30).toFixed(1)} mo)
                </span>
              )}
            </div>

            {/* KPI callout row */}
            {carryKPIs && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <KPICard
                  label="SKUs in the Red"
                  value={`${carryKPIs.redCount} / ${carryKPIs.totalSkus}`}
                  sub={`carry cost > ${redThreshold}%`}
                  accent={carryKPIs.redCount > 0 ? '#EF4444' : '#22C55E'}
                />
                <KPICard
                  label="Total Storage Fees"
                  value={fmtDollar(carryKPIs.totalFees)}
                  sub="across all SKUs in period"
                  accent="#EF5252"
                />
                <KPICard
                  label="Total Revenue"
                  value={fmtDollar(carryKPIs.totalRev)}
                  sub="units sold × selling price"
                  accent="#4472E8"
                />
                <KPICard
                  label="Avg Carry Cost %"
                  value={carryKPIs.avg !== null ? fmtPct(carryKPIs.avg) : '—'}
                  sub="revenue-generating SKUs"
                  accent={carryKPIs.avg !== null && carryKPIs.avg > redThreshold ? '#EF4444' : carryKPIs.avg !== null && carryKPIs.avg > yellowThreshold ? '#F59E0B' : '#22C55E'}
                />
              </div>
            )}

            {/* Table */}
            <SectionCard>
              <SectionHeader
                title="Carry Cost by SKU"
                sub="Ranked worst → best. Red = storage eating >30% of revenue."
              >
                <div className="flex items-center gap-2">
                  {/* Legend */}
                  <div className="flex items-center gap-3">
                    {(Object.entries(CARRY_CFG) as [CarryStatus, typeof CARRY_CFG[CarryStatus]][])
                      .filter(([k]) => k !== 'no-revenue')
                      .map(([, cfg]) => (
                        <span key={cfg.label} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                          {cfg.label}
                        </span>
                      ))}
                  </div>
                  <ExportButton
                    data={carryCostRows.map(r => ({
                      Client: r.client,
                      SKU: r.sku,
                      Item: r.name,
                      'Units Sold': r.unitsSold,
                      'Avg Units in Storage': r.avgUnitsInStorage,
                      'Total Revenue ($)': r.totalRevenue.toFixed(2),
                      'Total Storage Fees ($)': r.totalStorageFees.toFixed(2),
                      'Carry Cost %': r.carryCostPct !== null ? r.carryCostPct.toFixed(1) : 'N/A',
                      Status: CARRY_CFG[r.status].label,
                    }))}
                    filename="carry_cost_by_sku"
                  />
                </div>
              </SectionHeader>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
                      {([
                        { col: 'sku',             label: 'SKU' },
                        { col: 'name',            label: 'Item' },
                        { col: 'client',          label: 'Client' },
                        { col: 'unitsSold',       label: 'Units Sold',        align: 'right' as const },
                        { col: 'avgUnitsInStorage', label: 'Avg in Storage',  align: 'right' as const },
                        { col: 'totalRevenue',    label: 'Revenue',           align: 'right' as const },
                        { col: 'totalStorageFees', label: 'Storage Fees',     align: 'right' as const },
                        { col: 'carryCostPct',    label: 'Carry Cost %',      align: 'right' as const },
                        { col: 'status',          label: 'Status' },
                      ] as { col: string; label: string; align?: 'left' | 'right' | 'center' }[]).map(({ col, label, align = 'left' }) => (
                        <SortTh key={col} col={col} label={label} align={align}
                          sortKey={carrySortKey} sortDir={carrySortDir}
                          onSort={c => handleTableSort(c, carrySortKey, setCarrySortKey, carrySortDir, setCarrySortDir)}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(carryExpanded
                      ? sortRows(carryCostRows, carrySortKey, carrySortDir)
                      : sortRows(carryCostRows, carrySortKey, carrySortDir).slice(0, 10)
                    ).map((r, idx) => {
                      const cfg = CARRY_CFG[r.status];
                      return (
                        <tr key={r.client + r.sku}
                          style={{
                            background: idx % 2 === 0 ? '#fff' : 'rgba(68,114,232,0.025)',
                            borderBottom: '1px solid #f3f4f6',
                            borderLeft: `3px solid ${r.status === 'no-revenue' ? 'transparent' : cfg.border}`,
                          }}>
                          <td className="px-3 py-2.5 text-xs font-mono text-gray-500 whitespace-nowrap">{r.sku}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-700 max-w-xs" style={{ maxWidth: 200 }}>
                            <span title={r.name}>{r.name.slice(0, 36)}{r.name.length > 36 ? '…' : ''}</span>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: '#252F3E' }}>{r.client}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-mono" style={{ color: '#374151' }}>{fmtN(r.unitsSold)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-mono" style={{ color: '#374151' }}>{fmtN(r.avgUnitsInStorage)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-mono" style={{ color: '#4472E8', fontWeight: 700 }}>{fmtDollar(r.totalRevenue)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-mono" style={{ color: '#EF5252', fontWeight: 700 }}>{fmtDollar(r.totalStorageFees)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="font-black text-sm" style={{ color: cfg.text }}>
                              {r.carryCostPct !== null ? fmtPct(r.carryCostPct) : '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                              style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                              {cfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {carryCostRows.length > 10 && (
                <ExpandButton expanded={carryExpanded} total={carryCostRows.length} onToggle={() => setCarryExpanded(e => !e)} />
              )}
              <div className="px-5 py-3" style={{ borderTop: '1px solid #f3f4f6', background: '#FAFAFA' }}>
                <p className="text-xs text-gray-400">
                  <strong>Formula:</strong> Carry Cost % = (Units on Hand × ${storageRate.toFixed(2)}/unit/mo × period months) ÷ (Units Sold × Selling Price) × 100.
                  Units on Hand from product catalog snapshot. Units Sold from inventory change report (DTC + B2B outbound).
                </p>
              </div>
            </SectionCard>
          </>
        )}
      </div>

      </div>
    </div>
  );
}
