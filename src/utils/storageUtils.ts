export const STORAGE_KEYS = {
  SESSION:          'shiphero_qbr_session',
  INVENTORY:        'shiphero_inventory_cache',
  PRIOR_PERIOD:     'shiphero_prior_period',
  AUDIT_LOG:        'shiphero_audit_log',
  SETTINGS:         'shiphero_settings',
  SESSIONS:         'shiphero_qbr_sessions',
  STATS_CACHE:      'shiphero_stats_cache',
  INV_LOC_CACHE:    'shiphero_inv_loc_cache',
  INV_CHANGES_CACHE:'shiphero_inv_changes_cache',
} as const;

export type StorageResult = 'ok' | 'quota-exceeded' | 'error';

export function safeSetItem(key: string, value: unknown): StorageResult {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return 'ok';
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
      return 'quota-exceeded';
    }
    return 'error';
  }
}

export function safeGetItem<T>(key: string): T | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    return JSON.parse(item) as T;
  } catch {
    return null;
  }
}

export function removeItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Returns the stored size in KB (reads from actual stored string, not in-memory value). */
export function storedSizeKB(key: string): number {
  try {
    const item = localStorage.getItem(key);
    return item ? Math.round(item.length / 1024) : 0;
  } catch { return 0; }
}

/** Formats a stored ISO timestamp as a relative label, e.g. "2 hours ago". */
export function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch { return ''; }
}
