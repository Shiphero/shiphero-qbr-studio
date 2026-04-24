import { useState, useMemo } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps';
import { useData } from '../context/DataContext';
import { ScenarioConfig, ScenarioResult } from '../types';
import { runScenario, formatCurrency, formatNumber } from '../utils/calculations';
import { getZoneColor, getZoneFromCoords } from '../utils/uspsZones';
import { STATE_CENTROIDS } from '../data/stateCentroids';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

const ALL_STATES = Object.keys(STATE_CENTROIDS).filter((s) => s !== 'DC').sort();

export default function ScenarioBuilder() {
  const { rawShipments, warehouses } = useData();
  const [config, setConfig] = useState<ScenarioConfig>({
    zip: '',
    name: 'Hypothetical Warehouse',
    routingMode: 'auto',
    selectedStates: [],
  });
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');

  const configuredWarehouses = warehouses.filter((w) => w.zip && w.lat && w.lng);
  const dataStates = useMemo(() => {
    const s = new Set<string>();
    for (const ship of rawShipments) {
      if (ship.state) s.add(ship.state);
    }
    return Array.from(s).sort();
  }, [rawShipments]);

  const handleRunScenario = async () => {
    if (!config.zip) {
      setError('Please enter a ZIP code for the new warehouse.');
      return;
    }
    if (configuredWarehouses.length === 0) {
      setError('Please configure at least one existing warehouse in the Dashboard first.');
      return;
    }
    setError('');
    setIsRunning(true);
    await new Promise((r) => setTimeout(r, 100)); // allow UI to update
    const r = runScenario(rawShipments, config, configuredWarehouses);
    if (!r) {
      setError('Could not resolve the ZIP code. Please check the entry.');
    } else {
      setResult(r);
    }
    setIsRunning(false);
  };

  const toggleState = (state: string) => {
    setConfig((c) => ({
      ...c,
      selectedStates: c.selectedStates.includes(state)
        ? c.selectedStates.filter((s) => s !== state)
        : [...c.selectedStates, state],
    }));
  };

  const getMapStateColor = (stateAbbr: string): string => {
    if (!result) return '#e5e7eb';
    const assignment = result.stateAssignments[stateAbbr];
    if (!assignment) return '#e5e7eb';
    if (assignment === 'new' && result.newWarehouseLat && result.newWarehouseLng) {
      const zone = getZoneFromCoords(result.newWarehouseLat, result.newWarehouseLng, stateAbbr);
      return getZoneColor(zone);
    }
    // Existing: use first configured warehouse
    const existing = configuredWarehouses[0];
    if (existing?.lat && existing?.lng) {
      const zone = getZoneFromCoords(existing.lat, existing.lng, stateAbbr);
      return getZoneColor(zone);
    }
    return '#e5e7eb';
  };

  const hasData = rawShipments.length > 0;

  if (!hasData) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 py-8 md:px-6">
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        >
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-xl font-black mb-2" style={{ color: '#252F3E' }}>
            Upload Data First
          </h2>
          <p className="text-gray-500">
            Go to the Dashboard tab and upload a ShipHero CSV to use the Scenario Builder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-4 md:px-6">
      <div className="mb-5">
        <h2 className="text-xl font-black" style={{ color: '#252F3E' }}>Scenario Builder</h2>
        <p className="text-sm text-gray-500">Model a hypothetical warehouse to project shipping cost savings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Left: Config panel */}
        <div
          className="rounded-xl p-5"
          style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        >
          <h3 className="font-bold text-base mb-4 flex items-center gap-2" style={{ color: '#252F3E' }}>
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ background: '#4472E8' }}
            >
              1
            </span>
            Hypothetical Warehouse
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Warehouse Name
              </label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                style={{ color: '#252F3E' }}
                placeholder="e.g., East Coast Hub"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                ZIP Code
              </label>
              <input
                type="text"
                value={config.zip}
                onChange={(e) => setConfig((c) => ({ ...c, zip: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                style={{ color: '#252F3E' }}
                placeholder="e.g., 10001"
                maxLength={10}
              />
            </div>

            {/* Routing Mode */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                Routing Mode
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    checked={config.routingMode === 'auto'}
                    onChange={() => setConfig((c) => ({ ...c, routingMode: 'auto', selectedStates: [] }))}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm" style={{ color: '#252F3E' }}>
                      Mode A: Auto (Nearest)
                    </div>
                    <div className="text-xs text-gray-500">
                      Each shipment routes to the closest warehouse
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    checked={config.routingMode === 'manual'}
                    onChange={() => setConfig((c) => ({ ...c, routingMode: 'manual' }))}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm" style={{ color: '#252F3E' }}>
                      Mode B: Manual Region
                    </div>
                    <div className="text-xs text-gray-500">
                      Select which states route to new warehouse
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* State checklist for manual mode */}
            {config.routingMode === 'manual' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                    States for New Warehouse
                  </label>
                  <button
                    onClick={() =>
                      setConfig((c) => ({
                        ...c,
                        selectedStates:
                          c.selectedStates.length === dataStates.length ? [] : [...dataStates],
                      }))
                    }
                    className="text-xs font-semibold"
                    style={{ color: '#4472E8' }}
                  >
                    {config.selectedStates.length === dataStates.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div
                  className="rounded-lg p-2 overflow-y-auto max-h-48 grid grid-cols-3 gap-1"
                  style={{ border: '1px solid #e5e7eb', background: '#F5F5F0' }}
                >
                  {dataStates.map((state) => (
                    <label
                      key={state}
                      className="flex items-center gap-1.5 cursor-pointer hover:bg-white rounded px-1.5 py-0.5 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={config.selectedStates.includes(state)}
                        onChange={() => toggleState(state)}
                        className="w-3 h-3"
                      />
                      <span className="text-xs font-semibold" style={{ color: '#252F3E' }}>
                        {state}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {config.selectedStates.length} of {dataStates.length} states selected
                </div>
              </div>
            )}

            {error && (
              <div
                className="p-3 rounded-lg text-xs font-medium"
                style={{ background: 'rgba(224,82,82,0.1)', color: '#E05252', border: '1px solid rgba(224,82,82,0.2)' }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleRunScenario}
              disabled={isRunning || !config.zip}
              className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{ background: '#4472E8', boxShadow: '0 4px 12px rgba(68,114,232,0.3)' }}
            >
              {isRunning ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running Scenario...
                </span>
              ) : (
                'Run Scenario'
              )}
            </button>

            {/* Existing warehouses */}
            {configuredWarehouses.length > 0 && (
              <div
                className="p-3 rounded-lg"
                style={{ background: '#F5F5F0', border: '1px solid #e5e7eb' }}
              >
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Existing Warehouses
                </div>
                {configuredWarehouses.map((w) => (
                  <div key={w.name} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ background: '#4472E8' }} />
                    <span className="font-medium text-gray-700 truncate">{w.name}</span>
                    <span className="text-gray-400 ml-auto">{w.zip}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Results panel */}
        <div className="lg:col-span-2">
          {result ? (
            <div className="space-y-4">
              {/* Savings headline */}
              <div
                className="rounded-xl p-5"
                style={{
                  background: result.estimatedSavings > 0
                    ? 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%)'
                    : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${result.estimatedSavings > 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}
              >
                <div className="text-sm font-bold text-gray-500 mb-1">Projected Annual Savings</div>
                <div
                  className="text-4xl font-black"
                  style={{ color: result.estimatedSavings > 0 ? '#16a34a' : '#dc2626' }}
                >
                  {result.estimatedSavings >= 0 ? '+' : ''}{formatCurrency(result.estimatedSavings)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Based on {formatNumber(result.shipmentsRerouted)} rerouted shipments (
                  {result.shipmentsReroutedPercent.toFixed(1)}% of total)
                </div>
                <div className="text-xs mt-2 italic" style={{ color: '#6b7280' }}>
                  Actual savings depend on carrier rate cards. This estimate uses $0.65/zone reduction.
                </div>
              </div>

              {/* Breakdown grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Current Avg Zone', value: result.currentAvgZone.toFixed(1), sub: 'zones' },
                  { label: 'Projected Avg Zone', value: result.projectedAvgZone.toFixed(1), sub: 'zones' },
                  {
                    label: 'Shipments Rerouted',
                    value: formatNumber(result.shipmentsRerouted),
                    sub: `${result.shipmentsReroutedPercent.toFixed(1)}%`,
                  },
                  { label: 'Current Total Cost', value: formatCurrency(result.currentTotalCost), sub: '' },
                  { label: 'Projected Total Cost', value: formatCurrency(result.projectedTotalCost), sub: '' },
                  {
                    label: 'Estimated Savings',
                    value: formatCurrency(Math.abs(result.estimatedSavings)),
                    sub: result.estimatedSavings >= 0 ? 'savings' : 'added cost',
                    highlight: true,
                    positive: result.estimatedSavings >= 0,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl p-4"
                    style={{
                      background: '#fff',
                      border: `1px solid ${item.highlight ? (item.positive ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)') : '#e5e7eb'}`,
                    }}
                  >
                    <div className="text-xs font-bold text-gray-500 mb-1">{item.label}</div>
                    <div
                      className="text-xl font-black"
                      style={{
                        color: item.highlight
                          ? item.positive ? '#16a34a' : '#dc2626'
                          : '#252F3E',
                      }}
                    >
                      {item.value}
                    </div>
                    {item.sub && (
                      <div className="text-xs text-gray-400 mt-0.5">{item.sub}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="rounded-xl p-12 text-center h-full flex flex-col items-center justify-center"
              style={{ background: '#fff', border: '1px solid #e5e7eb', minHeight: '300px' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: '#F5F5F0' }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <h3 className="font-bold text-base mb-2" style={{ color: '#252F3E' }}>
                Configure & Run Scenario
              </h3>
              <p className="text-sm text-gray-400 max-w-sm">
                Enter a ZIP code for the hypothetical warehouse, choose a routing mode, then click "Run Scenario" to see projected savings.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Scenario Map */}
      {result && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        >
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #e5e7eb' }}>
            <h3 className="font-bold text-base" style={{ color: '#252F3E' }}>
              Coverage Map — {config.name}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Blue = existing warehouse coverage · Gold star = new warehouse · Colors = USPS zones from that origin
            </p>
          </div>

          <div className="relative">
            <ComposableMap
              projection="geoAlbersUsa"
              style={{ width: '100%', height: 'auto' }}
              projectionConfig={{ scale: 860, center: [-96, 38] }}
            >
              <Geographies geography={GEO_URL}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const fips = geo.id as string;
                    const stateAbbr = FIPS_TO_STATE[fips] || '';
                    const fill = stateAbbr ? getMapStateColor(stateAbbr) : '#e5e7eb';
                    const assignment = stateAbbr ? result.stateAssignments[stateAbbr] : null;
                    const opacity = assignment ? 1 : 0.3;

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke="#ffffff"
                        strokeWidth={0.5}
                        style={{
                          default: { outline: 'none', opacity },
                          hover: { outline: 'none', opacity: 0.85 },
                          pressed: { outline: 'none' },
                        }}
                      />
                    );
                  })
                }
              </Geographies>

              {/* Existing warehouse markers */}
              {configuredWarehouses
                .filter((w) => w.lat && w.lng)
                .map((w) => (
                  <Marker key={w.name} coordinates={[w.lng!, w.lat!]}>
                    <circle r={9} fill="#4472E8" stroke="#fff" strokeWidth={2.5} />
                    <circle r={3.5} fill="#fff" />
                  </Marker>
                ))}

              {/* New warehouse marker - gold star */}
              {result.newWarehouseLat && result.newWarehouseLng && (
                <Marker coordinates={[result.newWarehouseLng, result.newWarehouseLat]}>
                  <polygon
                    points="0,-12 3,-4 11,-4 5,2 7,10 0,5 -7,10 -5,2 -11,-4 -3,-4"
                    fill="#EF5252"
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                </Marker>
              )}
            </ComposableMap>

            {/* Legend */}
            <div
              className="absolute bottom-4 left-4 rounded-xl p-3"
              style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            >
              <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">Legend</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6" fill="#4472E8" stroke="#fff" strokeWidth="1.5" />
                    <circle cx="8" cy="8" r="2.5" fill="#fff" />
                  </svg>
                  <span className="text-xs text-gray-600">Existing warehouse</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 20 20">
                    <polygon
                      points="10,1 12.5,7 19,7 14,11 16,17 10,13 4,17 6,11 1,7 7.5,7"
                      fill="#EF5252"
                      stroke="#fff"
                      strokeWidth="1"
                    />
                  </svg>
                  <span className="text-xs text-gray-600">New warehouse ({config.name})</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ background: '#4472E8', opacity: 0.6 }} />
                  <span className="text-xs text-gray-600">Existing warehouse coverage</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ background: '#EF5252', opacity: 0.8 }} />
                  <span className="text-xs text-gray-600">New warehouse coverage</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
