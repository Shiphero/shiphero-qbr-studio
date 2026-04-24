import { useRef, useEffect, useState } from 'react';

export interface SortOption {
  key: string;
  label: string;
  /** Label for descending button — defaults to "↓ High" */
  descLabel?: string;
  /** Label for ascending button — defaults to "↑ Low" */
  ascLabel?: string;
}

interface Props {
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string, dir: 'asc' | 'desc') => void;
  options: SortOption[];
  /** Extra content rendered below the sort section (e.g. search input) */
  extraContent?: React.ReactNode;
  /** Whether a non-sort filter is active (keeps button blue) */
  hasActiveFilter?: boolean;
  /** The default sort key — button goes blue only when sort differs from default */
  defaultSortKey?: string;
  /** The default sort direction — defaults to 'desc' */
  defaultSortDir?: 'asc' | 'desc';
}

export default function SortFilterButton({
  sortKey, sortDir, onSort, options,
  extraContent, hasActiveFilter,
  defaultSortKey, defaultSortDir = 'desc',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const effectiveDefaultKey = defaultSortKey ?? options[0]?.key;
  const isActive = open || !!hasActiveFilter || sortKey !== effectiveDefaultKey || sortDir !== defaultSortDir;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center p-1.5 rounded-lg transition-all"
        style={{
          background: isActive ? '#4472E8' : '#F5F5F0',
          color: isActive ? '#fff' : '#252F3E',
          border: isActive ? '1px solid #4472E8' : '1px solid #E5E7EB',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 rounded-xl overflow-hidden"
          style={{
            top: 'calc(100% + 6px)',
            width: 264,
            background: '#fff',
            border: '1px solid #e5e7eb',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          <div
            className="px-4 py-3"
            style={{ borderBottom: extraContent ? '1px solid #f3f4f6' : undefined }}
          >
            <div className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#9CA3AF' }}>
              Sort by
            </div>
            <div className="flex flex-col gap-1">
              {options.map(({ key, label, descLabel = '↓ High', ascLabel = '↑ Low' }) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate" style={{ color: '#374151' }}>
                    {label}
                  </span>
                  <div className="flex gap-1 flex-shrink-0">
                    {(['desc', 'asc'] as const).map(dir => {
                      const active = sortKey === key && sortDir === dir;
                      return (
                        <button
                          key={dir}
                          onClick={() => onSort(key, dir)}
                          className="px-2 py-0.5 rounded text-xs font-bold transition-all"
                          style={{
                            background: active ? '#4472E8' : '#F5F5F0',
                            color: active ? '#fff' : '#6B7280',
                            border: active ? '1px solid #4472E8' : '1px solid #E5E7EB',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {dir === 'desc' ? descLabel : ascLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {extraContent && (
            <div className="px-4 py-3">{extraContent}</div>
          )}
        </div>
      )}
    </div>
  );
}
