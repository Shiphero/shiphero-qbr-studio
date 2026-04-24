import { useData } from '../context/DataContext';
import WarehouseConfig from './WarehouseConfig';
import KPICards from './KPICards';
import FilterPanel from './FilterPanel';
import USMap from './USMap';
import ShipmentTable from './ShipmentTable';
import InsightsPanel from './InsightsPanel';
import ErrorBoundary from './ErrorBoundary';

export default function Dashboard() {
  const { rawShipments, warehouses, filteredShipments, fileName, selectedAccount, setSelectedAccount, uniqueAccounts } = useData();
  const hasData = rawShipments.length > 0;
  // Only consider configured once we have resolved lat/lng — not just a typed string
  const allConfigured = warehouses.length > 0 && warehouses.every((w) => w.lat !== undefined && w.lng !== undefined);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-4 md:px-6">
      {!hasData && (
        /* Welcome screen */
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        >
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: 'rgba(68,114,232,0.1)' }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
            </svg>
          </div>
          <h2 className="text-2xl font-black mb-3" style={{ color: '#252F3E' }}>
            Warehouse Optimizer
          </h2>
          <p className="text-gray-500 max-w-lg mx-auto mb-6 leading-relaxed">
            Upload your ShipHero Shipments CSV in the <strong>Setup</strong> tab to analyze shipping zones, costs, and discover optimal warehouse locations for your brands.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            {[
              {
                icon: '📦',
                title: 'Zone Analysis',
                desc: 'Visualize USPS shipping zones on an interactive US map',
              },
              {
                icon: '💰',
                title: 'Cost Breakdown',
                desc: 'Analyze shipping costs by state, carrier, and zone',
              },
              {
                icon: '🏭',
                title: 'Scenario Builder',
                desc: 'Model hypothetical warehouses to project cost savings',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="p-4 rounded-xl"
                style={{ background: '#F5F5F0', border: '1px solid #e5e7eb' }}
              >
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="font-bold text-sm mb-1" style={{ color: '#252F3E' }}>{f.title}</div>
                <div className="text-xs text-gray-500">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasData && (
        <>
          {/* Warehouse configuration */}
          <WarehouseConfig />

          {/* Dashboard header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-black" style={{ color: '#252F3E' }}>
                Shipping Analytics
              </h2>
              <p className="text-sm text-gray-500">
                Showing {filteredShipments.length.toLocaleString()} shipments
                {fileName ? ` from ${fileName}` : ''}
              </p>
            </div>
            {uniqueAccounts.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Account</span>
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold"
                  style={{ background: '#F5F5F0', border: '1.5px solid #E5E7EB', color: '#252F3E', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="all">All accounts</option>
                  {uniqueAccounts.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {allConfigured ? (
            <>
              <KPICards />
              <FilterPanel />
              {/* Map + Insights side-by-side */}
              <div className="flex gap-4 mb-4" style={{ alignItems: 'stretch' }}>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <ErrorBoundary label="Map">
                    <USMap />
                  </ErrorBoundary>
                </div>
                <div style={{ width: '340px', flexShrink: 0 }}>
                  <ErrorBoundary label="Insights Panel">
                    <InsightsPanel />
                  </ErrorBoundary>
                </div>
              </div>
              <ShipmentTable />
            </>
          ) : (
            <>
              <KPICards />
              <div
                className="rounded-xl p-8 text-center mb-4"
                style={{ background: 'rgba(245,166,35,0.08)', border: '2px dashed rgba(245,166,35,0.4)' }}
              >
                <div className="text-2xl mb-3">📍</div>
                <h3 className="font-bold text-base mb-2" style={{ color: '#252F3E' }}>
                  Configure Warehouse ZIP Codes
                </h3>
                <p className="text-sm text-gray-500">
                  Enter ZIP codes for all warehouses above to enable the zone map and detailed analysis.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
