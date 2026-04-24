import { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { getLatLngFromZip } from '../utils/uspsZones';

export default function WarehouseConfig() {
  const { warehouses, setWarehouseZip, toggleWarehouseExcluded } = useData();

  // Local draft state — only commits to context once a full 5-digit ZIP resolves
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Seed drafts from already-configured warehouses (e.g. after hot reload)
  useEffect(() => {
    const initial: Record<string, string> = {};
    warehouses.forEach((w) => { initial[w.name] = w.zip || ''; });
    setDrafts(initial);
  }, [warehouses.length]); // only re-seed when warehouse list changes, not on every zip update

  if (warehouses.length === 0) return null;

  const activeWarehouses = warehouses.filter((w) => !w.excluded);
  const allConfigured = activeWarehouses.length > 0 && activeWarehouses.every((w) => w.lat !== undefined && w.lng !== undefined);
  const missingCount = activeWarehouses.filter((w) => w.lat === undefined || w.lng === undefined).length;
  const excludedCount = warehouses.filter((w) => w.excluded).length;

  function handleChange(warehouseName: string, value: string) {
    // Only allow digits and hyphens
    const cleaned = value.replace(/[^\d-]/g, '').slice(0, 10);
    setDrafts((prev) => ({ ...prev, [warehouseName]: cleaned }));

    // Commit to context only when we have at least 5 digits
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length >= 5) {
      setWarehouseZip(warehouseName, cleaned);
    }
  }

  return (
    <div
      className="rounded-xl p-5 mb-4"
      style={{ background: '#fff', border: '1px solid #e5e7eb' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-base" style={{ color: '#252F3E' }}>
            Warehouse Configuration
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Enter zip codes for accurate USPS zone calculations
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {excludedCount > 0 && (
            <div
              className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
              style={{ background: 'rgba(239,82,82,0.08)', color: '#EF5252', border: '1px solid rgba(239,82,82,0.2)' }}
            >
              {excludedCount} excluded
            </div>
          )}
          {!allConfigured && missingCount > 0 && (
            <div
              className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
              style={{ background: 'rgba(245,166,35,0.15)', color: '#c27f0e', border: '1px solid rgba(245,166,35,0.3)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
              </svg>
              {missingCount} warehouse{missingCount > 1 ? 's' : ''} need zip code
            </div>
          )}
          {allConfigured && missingCount === 0 && (
            <div
              className="px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)' }}
            >
              All configured
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {warehouses.map((warehouse) => {
          const draft = drafts[warehouse.name] ?? '';
          const draftDigits = draft.replace(/\D/g, '');
          const isValid = warehouse.lat !== undefined && warehouse.lng !== undefined;
          const hasPartialInput = draftDigits.length > 0 && draftDigits.length < 5;
          const hasFullInput = draftDigits.length >= 5;
          const isExcluded = !!warehouse.excluded;

          return (
            <div
              key={warehouse.name}
              className="flex items-center gap-3 p-3 rounded-lg"
              style={{
                background: isExcluded ? 'rgba(0,0,0,0.02)' : '#F5F5F0',
                border: `1px solid ${isExcluded ? 'rgba(0,0,0,0.08)' : isValid ? 'rgba(34,197,94,0.3)' : '#e5e7eb'}`,
                opacity: isExcluded ? 0.6 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
            >
              {/* Warehouse icon */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: isExcluded ? '#e5e7eb' : isValid ? 'rgba(68,114,232,0.15)' : '#e5e7eb' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isExcluded ? '#9ca3af' : isValid ? '#4472E8' : '#9ca3af'} strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>

              {/* Name & coords */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate" style={{ color: isExcluded ? '#9CA3AF' : '#252F3E' }}>
                  {warehouse.name}
                </div>
                {isValid && !isExcluded && warehouse.lat !== undefined && warehouse.lng !== undefined && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {warehouse.lat.toFixed(3)}°N, {Math.abs(warehouse.lng).toFixed(3)}°W
                  </div>
                )}
                {isExcluded && (
                  <div className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>Excluded from dataset</div>
                )}
                {!isExcluded && hasPartialInput && (
                  <div className="text-xs mt-0.5" style={{ color: '#EF5252' }}>
                    Enter all 5 digits
                  </div>
                )}
                {!isExcluded && hasFullInput && !isValid && (
                  <div className="text-xs mt-0.5" style={{ color: '#ef4444' }}>
                    ZIP not found in database
                  </div>
                )}
              </div>

              {/* ZIP input + status icon */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={draft}
                  onChange={(e) => handleChange(warehouse.name, e.target.value)}
                  placeholder="e.g. 84042"
                  maxLength={10}
                  disabled={isExcluded}
                  className="w-32 px-3 py-1.5 rounded-lg text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                  style={{
                    background: isExcluded ? '#f9fafb' : '#fff',
                    borderColor: isExcluded ? '#e5e7eb' : isValid ? '#86efac' : hasPartialInput ? '#fde68a' : hasFullInput ? '#fca5a5' : '#d1d5db',
                    color: isExcluded ? '#9CA3AF' : '#252F3E',
                    cursor: isExcluded ? 'not-allowed' : 'text',
                  }}
                />
                {!isExcluded && isValid && (
                  <div style={{ color: '#22c55e' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                {!isExcluded && hasFullInput && !isValid && (
                  <div style={{ color: '#ef4444' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                )}
              </div>

              {/* On/Off toggle */}
              <button
                onClick={() => toggleWarehouseExcluded(warehouse.name)}
                title={isExcluded ? 'Enable warehouse' : 'Exclude warehouse from dataset'}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: `1px solid ${isExcluded ? 'rgba(239,82,82,0.25)' : 'rgba(34,197,94,0.3)'}`,
                  background: isExcluded ? 'rgba(239,82,82,0.06)' : 'rgba(34,197,94,0.08)',
                  color: isExcluded ? '#EF5252' : '#16a34a',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: "'Metropolis', sans-serif",
                  transition: 'all 0.15s',
                  letterSpacing: '0.02em',
                }}
              >
                {/* Toggle track */}
                <span
                  style={{
                    display: 'inline-flex',
                    width: 26,
                    height: 14,
                    borderRadius: 7,
                    background: isExcluded ? '#EF5252' : '#22C55E',
                    position: 'relative',
                    transition: 'background 0.15s',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: isExcluded ? 2 : 12,
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.15s',
                    }}
                  />
                </span>
                {isExcluded ? 'Off' : 'On'}
              </button>
            </div>
          );
        })}
      </div>

      {!allConfigured && missingCount > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          The map and zone analysis will be available once all active warehouse zip codes are configured
        </p>
      )}
    </div>
  );
}
