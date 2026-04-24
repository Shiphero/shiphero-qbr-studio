import { useMemo } from 'react';
import { useData } from '../context/DataContext';
import InsightGate from './InsightGate';
import { computeWarehouseInsights, formatCurrency, formatNumber } from '../utils/calculations';
import { LocationInsight } from '../types';


const RANK_CONFIG = [
  {
    label: '1st',
    bg: 'linear-gradient(135deg, #EF5252 0%, #E8940A 100%)',
    border: '#EF5252',
    glow: 'rgba(245,166,35,0.15)',
    textColor: '#7A4F00',
  },
  {
    label: '2nd',
    bg: 'linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)',
    border: '#9CA3AF',
    glow: 'rgba(156,163,175,0.15)',
    textColor: '#374151',
  },
  {
    label: '3rd',
    bg: 'linear-gradient(135deg, #CD7F32 0%, #A0522D 100%)',
    border: '#CD7F32',
    glow: 'rgba(205,127,50,0.15)',
    textColor: '#5C2D00',
  },
];

function ZoneArrow({ from, to }: { from: number; to: number }) {
  const improved = to < from;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs font-bold">
      <span style={{ color: '#6B7280' }}>{from.toFixed(1)}</span>
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
        <path d="M1 5h12M9 1l4 4-4 4" stroke={improved ? '#22C55E' : '#EF4444'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ color: improved ? '#22C55E' : '#EF4444' }}>{to.toFixed(1)}</span>
    </span>
  );
}

function InsightCard({ insight, isSelected, onClick }: { insight: LocationInsight; isSelected: boolean; onClick: () => void }) {
  const rank = RANK_CONFIG[insight.rank - 1];
  const zoneImprovement = insight.currentAvgZone - insight.projectedAvgZone;

  return (
    <div
      className="rounded-xl p-4 mb-3 transition-all cursor-pointer"
      onClick={onClick}
      style={{
        background: '#fff',
        border: isSelected ? '2px solid #EF5252' : `1.5px solid ${rank.border}`,
        boxShadow: isSelected ? '0 2px 16px rgba(245,166,35,0.25)' : `0 2px 12px ${rank.glow}`,
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-black shadow-sm flex-shrink-0"
            style={{ background: rank.bg }}
          >
            {insight.rank}
          </div>
          <div>
            <div className="font-black text-base leading-tight" style={{ color: '#252F3E' }}>
              {insight.city}
            </div>
            <div className="text-xs font-semibold" style={{ color: '#6B7280' }}>
              {insight.state} · ZIP {insight.zip}
            </div>
          </div>
        </div>
        {/* Savings badge */}
        <div
          className="text-right flex-shrink-0"
          style={{
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: '8px',
            padding: '4px 8px',
          }}
        >
          <div className="text-xs font-semibold" style={{ color: '#15803D' }}>Saves</div>
          <div className="text-sm font-black" style={{ color: '#15803D' }}>
            {formatCurrency(insight.projectedSavings)}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Zone improvement */}
        <div
          className="rounded-lg p-2.5"
          style={{ background: '#F5F5F0', border: '1px solid #E5E7EB' }}
        >
          <div className="text-xs text-gray-400 mb-1 font-medium">Avg Zone</div>
          <ZoneArrow from={insight.currentAvgZone} to={insight.projectedAvgZone} />
          {zoneImprovement > 0 && (
            <div className="text-xs mt-0.5" style={{ color: '#22C55E' }}>
              ▼ {zoneImprovement.toFixed(1)} zones
            </div>
          )}
        </div>

        {/* Shipments rerouted */}
        <div
          className="rounded-lg p-2.5"
          style={{ background: '#F5F5F0', border: '1px solid #E5E7EB' }}
        >
          <div className="text-xs text-gray-400 mb-1 font-medium">Rerouted</div>
          <div className="text-sm font-black" style={{ color: '#252F3E' }}>
            {formatNumber(insight.shipmentsRerouted)}
          </div>
          <div className="text-xs" style={{ color: '#6B7280' }}>
            {insight.shipmentsReroutedPercent.toFixed(0)}% of shipments
          </div>
        </div>

        {/* CO2 offset */}
        <div
          className="rounded-lg p-2.5"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs">🌱</span>
            <span className="text-xs font-medium" style={{ color: '#166534' }}>CO₂ Offset</span>
          </div>
          <div className="text-sm font-black" style={{ color: '#15803D' }}>
            {insight.co2OffsetKg >= 1000
              ? `${(insight.co2OffsetKg / 1000).toFixed(1)}t`
              : `${formatNumber(Math.round(insight.co2OffsetKg))} kg`}
          </div>
          <div className="text-xs" style={{ color: '#16A34A' }}>per year</div>
        </div>

        {/* Trees planted */}
        <div
          className="rounded-lg p-2.5"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs">🌳</span>
            <span className="text-xs font-medium" style={{ color: '#166534' }}>Trees Equiv.</span>
          </div>
          <div className="text-sm font-black" style={{ color: '#15803D' }}>
            {formatNumber(insight.treesPlanted)}
          </div>
          <div className="text-xs" style={{ color: '#16A34A' }}>trees planted/yr</div>
        </div>
      </div>

      {isSelected && (
        <div
          className="mt-3 text-center text-xs font-bold rounded-lg py-1.5"
          style={{ background: 'rgba(245,166,35,0.12)', color: '#92650a', border: '1px solid rgba(245,166,35,0.3)' }}
        >
          ✓ Previewing on map
        </div>
      )}
    </div>
  );
}

export default function InsightsPanel() {
  const { filteredShipments, warehouses, previewWarehouse, setPreviewWarehouse } = useData();

  const insights = useMemo(
    () => computeWarehouseInsights(filteredShipments, warehouses),
    [filteredShipments, warehouses]
  );

  const allConfigured = warehouses.length > 0 && warehouses.every((w) => w.zip?.trim());

  if (!allConfigured) return null;

  return (
    <div
      className="rounded-2xl flex flex-col"
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
        minWidth: 0,
      }}
    >
      {/* Panel header */}
      <div
        className="px-4 pt-4 pb-3"
        style={{ borderBottom: '1px solid #F0F0EB' }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
              style={{ background: 'rgba(245,166,35,0.12)' }}
            >
              💡
            </div>
            <h3 className="font-black text-base" style={{ color: '#252F3E' }}>
              Warehouse Insights
            </h3>
          </div>
          <InsightGate sectionKey="warehouseInsights" />
        </div>
        <p className="text-xs text-gray-400 leading-relaxed ml-9">
          Top locations to add a warehouse and reduce shipping costs — ranked by projected annual savings.
        </p>
      </div>

      {/* Content */}
      <div className="p-4 flex-1">
        {insights.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-sm text-gray-400">
              No improvement opportunities found. Your warehouse may already be optimally located!
            </p>
          </div>
        ) : (
          <>
            {insights.map((insight) => (
              <InsightCard
                key={insight.zip}
                insight={insight}
                isSelected={previewWarehouse?.zip === insight.zip}
                onClick={() => setPreviewWarehouse(previewWarehouse?.zip === insight.zip ? null : insight)}
              />
            ))}

            <p className="text-xs text-center text-gray-400 mb-2">
              Click a location to preview its impact on the map
            </p>

            {/* Methodology note */}
            <div
              className="rounded-lg p-3 mt-1"
              style={{ background: '#F5F5F0', border: '1px solid #E5E7EB' }}
            >
              <p className="text-xs text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-500">Methodology: </span>
                Savings modeled using nearest-warehouse routing at{' '}
                <span className="font-semibold">$0.65/zone reduction</span> per shipment.
                CO₂ estimated at <span className="font-semibold">0.10–1.55 kg/package</span> by zone (EPA).
                Trees based on <span className="font-semibold">21.77 kg CO₂/tree/year</span> (US Forest Service).
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
