import { useData } from '../context/DataContext';
import { getUniqueCarriers } from '../utils/csvParser';
import { useMemo } from 'react';

export default function FilterPanel() {
  const { rawShipments, warehouses, filters, setFilter, resetFilters } = useData();

  const carriers = useMemo(() => getUniqueCarriers(rawShipments), [rawShipments]);

  const selectClass = "px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all";
  const inputClass = "px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all";

  const hasActiveFilters =
    filters.warehouse !== 'all' ||
    filters.startDate !== '' ||
    filters.endDate !== '' ||
    filters.carrier !== 'all' ||
    filters.zone !== null;

  return (
    <div
      className="rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3"
      style={{ background: '#fff', border: '1px solid #e5e7eb' }}
    >
      {/* Origin Warehouse */}
      <div className="flex flex-col gap-1 min-w-[180px]">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Origin Warehouse</label>
        <select
          value={filters.warehouse}
          onChange={(e) => setFilter('warehouse', e.target.value)}
          className={selectClass}
          style={{ color: '#252F3E' }}
        >
          <option value="all">All Warehouses</option>
          {warehouses.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name.length > 30 ? w.name.substring(0, 30) + '...' : w.name}
            </option>
          ))}
        </select>
      </div>

      {/* Start Date */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Start Date</label>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilter('startDate', e.target.value)}
          className={inputClass}
          style={{ color: '#252F3E' }}
        />
      </div>

      {/* End Date */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">End Date</label>
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilter('endDate', e.target.value)}
          className={inputClass}
          style={{ color: '#252F3E' }}
        />
      </div>

      {/* Carrier */}
      <div className="flex flex-col gap-1 min-w-[140px]">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Carrier</label>
        <select
          value={filters.carrier}
          onChange={(e) => setFilter('carrier', e.target.value)}
          className={selectClass}
          style={{ color: '#252F3E' }}
        >
          <option value="all">All Carriers</option>
          {carriers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* USPS Zone */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">USPS Zone</label>
        <select
          value={filters.zone ?? 'all'}
          onChange={(e) => setFilter('zone', e.target.value === 'all' ? null : parseInt(e.target.value))}
          className={selectClass}
          style={{ color: '#252F3E' }}
        >
          <option value="all">All Zones</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((z) => (
            <option key={z} value={z}>
              Zone {z}
            </option>
          ))}
        </select>
      </div>

      {/* Sort By */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Sort By</label>
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          <button
            onClick={() => setFilter('sortBy', 'shipments')}
            className="px-3 py-2 text-sm font-semibold transition-all"
            style={{
              background: filters.sortBy === 'shipments' ? '#4472E8' : '#fff',
              color: filters.sortBy === 'shipments' ? '#fff' : '#6b7280',
            }}
          >
            # Shipments
          </button>
          <button
            onClick={() => setFilter('sortBy', 'avgCost')}
            className="px-3 py-2 text-sm font-semibold transition-all"
            style={{
              background: filters.sortBy === 'avgCost' ? '#4472E8' : '#fff',
              color: filters.sortBy === 'avgCost' ? '#fff' : '#6b7280',
            }}
          >
            Avg Cost
          </button>
        </div>
      </div>

      {/* Sort Direction */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Direction</label>
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          <button
            onClick={() => setFilter('sortDirection', 'desc')}
            className="px-3 py-2 text-sm font-semibold transition-all"
            style={{
              background: filters.sortDirection === 'desc' ? '#252F3E' : '#fff',
              color: filters.sortDirection === 'desc' ? '#fff' : '#6b7280',
            }}
          >
            ↓ Desc
          </button>
          <button
            onClick={() => setFilter('sortDirection', 'asc')}
            className="px-3 py-2 text-sm font-semibold transition-all"
            style={{
              background: filters.sortDirection === 'asc' ? '#252F3E' : '#fff',
              color: filters.sortDirection === 'asc' ? '#fff' : '#6b7280',
            }}
          >
            ↑ Asc
          </button>
        </div>
      </div>

      {/* Reset Filters */}
      {hasActiveFilters && (
        <button
          onClick={resetFilters}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-80 self-end"
          style={{ background: '#F5F5F0', color: '#6b7280', border: '1px solid #e5e7eb' }}
        >
          Reset Filters
        </button>
      )}
    </div>
  );
}
