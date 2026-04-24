import { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import InsightGate from './InsightGate';
import SortFilterButton from './SortFilterButton';
import { getZoneColor } from '../utils/uspsZones';
import { formatCurrency, formatNumber } from '../utils/calculations';
import { StateStats } from '../types';

const ROWS_PER_PAGE = 25;

function exportToCSV(data: StateStats[], filename: string) {
  const headers = ['State', 'State Name', 'USPS Zone', 'Shipments', 'Avg Cost', 'Total Cost', '% of Total'];
  const rows = data.map(r => [
    r.state,
    r.stateName,
    `Zone ${r.zone}`,
    r.shipmentCount,
    r.avgCost.toFixed(2),
    r.totalCost.toFixed(2),
    r.percentOfTotal.toFixed(2) + '%',
  ]);
  const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type SortKey = 'stateName' | 'zone' | 'shipmentCount' | 'avgCost' | 'totalCost' | 'percentOfTotal';

export default function ShipmentTable() {
  const { stateStats, filters } = useData();
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>(
    filters.sortBy === 'shipments' ? 'shipmentCount' : 'avgCost'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(filters.sortDirection);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setCurrentPage(1);
  };

  const sorted = useMemo(() => {
    return [...stateStats].sort((a, b) => {
      const getVal = (row: StateStats): string | number => {
        switch (sortKey) {
          case 'stateName': return row.stateName;
          case 'zone': return row.zone;
          case 'shipmentCount': return row.shipmentCount;
          case 'avgCost': return row.avgCost;
          case 'totalCost': return row.totalCost;
          case 'percentOfTotal': return row.percentOfTotal;
          default: return row.shipmentCount;
        }
      };
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [stateStats, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageData = sorted.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const totals = useMemo(() => ({
    shipments: stateStats.reduce((sum, s) => sum + s.shipmentCount, 0),
    totalCost: stateStats.reduce((sum, s) => sum + s.totalCost, 0),
    avgCost: stateStats.length > 0
      ? stateStats.reduce((sum, s) => sum + s.totalCost, 0) / stateStats.reduce((sum, s) => sum + s.shipmentCount, 0)
      : 0,
  }), [stateStats]);

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className="ml-1 opacity-60">
      {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  );

  const thClass = "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide cursor-pointer select-none hover:bg-gray-50 transition-colors whitespace-nowrap";

  if (stateStats.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: '#fff', border: '1px solid #e5e7eb' }}
      >
        <p className="text-gray-400 font-medium">No data to display. Configure warehouses to see zone analysis.</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#fff', border: '1px solid #e5e7eb' }}
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <h3 className="font-bold text-base" style={{ color: '#252F3E' }}>
          Shipments by State
        </h3>
        <div className="flex items-center gap-3">
          <InsightGate sectionKey="shipmentsByState" />
          <span className="text-sm text-gray-500">
            {sorted.length} states • Page {page} of {totalPages}
          </span>
          <button
            onClick={() => exportToCSV(sorted, 'shipments-by-state.csv')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90"
            style={{ border: '1.5px solid #4472E8', color: '#4472E8', background: '#fff' }}
          >
            ↓ Export CSV
          </button>
          <SortFilterButton
            sortKey={sortKey}
            sortDir={sortDir}
            defaultSortKey="shipmentCount"
            defaultSortDir="desc"
            onSort={(k, d) => { setSortKey(k as SortKey); setSortDir(d); setCurrentPage(1); }}
            options={[
              { key: 'stateName',      label: 'State',        descLabel: 'Z→A', ascLabel: 'A→Z' },
              { key: 'zone',           label: 'Zone',         descLabel: '↓ High', ascLabel: '↑ Low' },
              { key: 'shipmentCount',  label: '# Shipments',  descLabel: '↓ Most', ascLabel: '↑ Fewest' },
              { key: 'avgCost',        label: 'Avg Cost',     descLabel: '↓ High', ascLabel: '↑ Low' },
              { key: 'totalCost',      label: 'Total Cost',   descLabel: '↓ High', ascLabel: '↑ Low' },
              { key: 'percentOfTotal', label: '% of Total',   descLabel: '↓ High', ascLabel: '↑ Low' },
            ]}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ background: '#F5F5F0', borderBottom: '1px solid #e5e7eb' }}>
              <th className={thClass} onClick={() => handleSort('stateName')} style={{ color: '#252F3E' }}>
                State <SortIcon col="stateName" />
              </th>
              <th className={thClass} onClick={() => handleSort('zone')} style={{ color: '#252F3E', minWidth: '90px' }}>
                Zone <SortIcon col="zone" />
              </th>
              <th className={thClass + " text-right"} onClick={() => handleSort('shipmentCount')} style={{ color: '#252F3E' }}>
                # Shipments <SortIcon col="shipmentCount" />
              </th>
              <th className={thClass + " text-right"} onClick={() => handleSort('avgCost')} style={{ color: '#252F3E' }}>
                Avg Cost <SortIcon col="avgCost" />
              </th>
              <th className={thClass + " text-right"} onClick={() => handleSort('totalCost')} style={{ color: '#252F3E' }}>
                Total Cost <SortIcon col="totalCost" />
              </th>
              <th className={thClass} onClick={() => handleSort('percentOfTotal')} style={{ color: '#252F3E' }}>
                % of Total <SortIcon col="percentOfTotal" />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, idx) => (
              <StateRow key={row.state} row={row} isEven={idx % 2 === 0} />
            ))}
          </tbody>
          {/* Summary row */}
          <tfoot>
            <tr style={{ background: '#252F3E', color: '#fff' }}>
              <td className="px-4 py-3 font-bold text-sm" colSpan={2}>
                Total / Summary
              </td>
              <td className="px-4 py-3 font-bold text-sm text-right">
                {formatNumber(totals.shipments)}
              </td>
              <td className="px-4 py-3 font-bold text-sm text-right">
                {formatCurrency(totals.avgCost)}
              </td>
              <td className="px-4 py-3 font-bold text-sm text-right">
                {formatCurrency(totals.totalCost)}
              </td>
              <td className="px-4 py-3 font-bold text-sm">
                100%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderTop: '1px solid #e5e7eb' }}
        >
          <span className="text-sm text-gray-500">
            Showing {((page - 1) * ROWS_PER_PAGE) + 1}–{Math.min(page * ROWS_PER_PAGE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={page === 1}
              className="px-2 py-1 rounded text-sm font-semibold disabled:opacity-30 hover:bg-gray-100 transition-colors"
              style={{ color: '#252F3E' }}
            >
              «
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-1 rounded text-sm font-semibold disabled:opacity-30 hover:bg-gray-100 transition-colors"
              style={{ color: '#252F3E' }}
            >
              ‹
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = startPage + i;
              return (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  className="px-2.5 py-1 rounded text-sm font-semibold transition-colors"
                  style={{
                    background: p === page ? '#4472E8' : 'transparent',
                    color: p === page ? '#fff' : '#252F3E',
                  }}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-1 rounded text-sm font-semibold disabled:opacity-30 hover:bg-gray-100 transition-colors"
              style={{ color: '#252F3E' }}
            >
              ›
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1 rounded text-sm font-semibold disabled:opacity-30 hover:bg-gray-100 transition-colors"
              style={{ color: '#252F3E' }}
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StateRow({ row, isEven }: { row: StateStats; isEven: boolean }) {
  const zoneColor = getZoneColor(row.zone);

  return (
    <tr style={{ background: isEven ? '#fff' : 'rgba(68,114,232,0.03)' }}>
      <td className="px-4 py-3 text-sm font-semibold" style={{ color: '#252F3E' }}>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ background: '#F5F5F0', color: '#6b7280' }}
          >
            {row.state}
          </span>
          {row.stateName}
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-block px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
          style={{
            background: zoneColor + '20',
            color: zoneColor,
            border: `1px solid ${zoneColor}40`,
          }}
        >
          Zone {row.zone}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-right" style={{ color: '#252F3E' }}>
        {formatNumber(row.shipmentCount)}
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-right" style={{ color: '#252F3E' }}>
        {formatCurrency(row.avgCost)}
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-right" style={{ color: '#252F3E' }}>
        {formatCurrency(row.totalCost)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#F5F5F0', minWidth: '60px' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, row.percentOfTotal)}%`, background: '#4472E8' }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-600 w-10 text-right">
            {row.percentOfTotal.toFixed(1)}%
          </span>
        </div>
      </td>
    </tr>
  );
}
