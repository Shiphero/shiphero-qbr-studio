import { useData } from '../context/DataContext';
import { computeKPIs, formatCurrency, formatNumber } from '../utils/calculations';
import InsightGate, { StatDeckButton } from './InsightGate';

interface KPICardProps {
  label: string;
  value: string;
  subLabel?: string;
  icon: React.ReactNode;
  deckBtn?: React.ReactNode;
}

function KPICard({ label, value, subLabel, icon, deckBtn }: KPICardProps) {
  return (
    <div
      className="rounded-xl p-5 flex items-start gap-4"
      style={{
        background: '#fff',
        borderLeft: '4px solid #4472E8',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        position: 'relative',
      }}
    >
      {deckBtn}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'rgba(68,114,232,0.1)' }}
      >
        {icon}
      </div>
      <div>
        <div className="font-black text-2xl" style={{ color: '#252F3E', lineHeight: 1.1 }}>
          {value}
        </div>
        <div className="font-semibold text-sm text-gray-500 mt-1">{label}</div>
        {subLabel && (
          <div className="text-xs text-gray-400 mt-0.5">{subLabel}</div>
        )}
      </div>
    </div>
  );
}

export default function KPICards() {
  const { filteredShipments } = useData();
  const kpis = computeKPIs(filteredShipments);

  const dateSubLabel = kpis.dateRange.min && kpis.dateRange.max
    ? `${kpis.dateRange.min} – ${kpis.dateRange.max}`
    : undefined;

  return (
    <>
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Shipping Analytics</span>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      <KPICard
        label="Total Shipments"
        value={formatNumber(kpis.totalShipments)}
        subLabel={dateSubLabel}
        deckBtn={<StatDeckButton sectionKey="shippingKPIs" statId="totalShipments" />}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2">
            <path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        }
      />
      <KPICard
        label="Total Shipping Cost"
        value={formatCurrency(kpis.totalCost)}
        deckBtn={<StatDeckButton sectionKey="shippingKPIs" statId="totalLabelCost" />}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
        }
      />
      <KPICard
        label="Avg Cost Per Shipment"
        value={formatCurrency(kpis.avgCostPerShipment)}
        deckBtn={<StatDeckButton sectionKey="shippingKPIs" statId="avgLabelCost" />}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        }
      />
      <KPICard
        label="States Reached"
        value={formatNumber(kpis.statesReached)}
        subLabel="destination states"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
          </svg>
        }
      />
    </div>
    </>
  );
}
