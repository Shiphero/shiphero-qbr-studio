import { useState, useMemo } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps';
import { useData } from '../context/DataContext';
import InsightGate from './InsightGate';
import { getZoneColor, getZoneFromOriginToState, getZoneFromCoords, findNearestWarehouse } from '../utils/uspsZones';
import { STATE_CENTROIDS } from '../data/stateCentroids';
import { formatCurrency, formatNumber } from '../utils/calculations';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

interface TooltipData {
  x: number;
  y: number;
  stateName: string;
  zone: number;
  shipments: number;
  avgCost: number;
}

// FIPS code to state abbreviation mapping
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

export default function USMap() {
  const { warehouses, filters, stateStats, previewWarehouse, setPreviewWarehouse } = useData();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const selectedWarehouse = filters.warehouse !== 'all'
    ? warehouses.find((w) => w.name === filters.warehouse)
    : warehouses[0];

  const originZip = selectedWarehouse?.zip || '';

  // Build state stats lookup
  const statsMap = useMemo(() => {
    const m = new Map<string, { count: number; totalCost: number }>();
    for (const s of stateStats) {
      m.set(s.state, { count: s.shipmentCount, totalCost: s.totalCost });
    }
    return m;
  }, [stateStats]);

  // Max shipments for bubble sizing
  const maxShipments = useMemo(() => {
    let max = 0;
    for (const s of stateStats) {
      if (s.shipmentCount > max) max = s.shipmentCount;
    }
    return max;
  }, [stateStats]);

  // Precompute which states route to the preview warehouse
  const previewStates = useMemo(() => {
    if (!previewWarehouse) return new Set<string>();
    const existingCoords = warehouses
      .filter((w) => w.lat !== undefined && w.lng !== undefined)
      .map((w) => ({ name: w.name, lat: w.lat!, lng: w.lng! }));
    const allWh = [
      ...existingCoords,
      { name: '__preview__', lat: previewWarehouse.lat, lng: previewWarehouse.lng },
    ];
    const s = new Set<string>();
    Object.keys(STATE_CENTROIDS).forEach((state) => {
      const nearest = findNearestWarehouse(state, allWh);
      if (nearest?.name === '__preview__') s.add(state);
    });
    return s;
  }, [previewWarehouse, warehouses]);

  const getStateColor = (stateAbbr: string): string => {
    if (previewWarehouse) {
      const existingCoords = warehouses
        .filter((w) => w.lat !== undefined && w.lng !== undefined)
        .map((w) => ({ name: w.name, lat: w.lat!, lng: w.lng! }));
      const allWarehouses = [
        ...existingCoords,
        { name: '__preview__', lat: previewWarehouse.lat, lng: previewWarehouse.lng },
      ];
      const nearest = findNearestWarehouse(stateAbbr, allWarehouses);
      if (!nearest) return '#e5e7eb';
      const zone = getZoneFromCoords(nearest.lat, nearest.lng, stateAbbr);
      return getZoneColor(zone);
    }
    if (!originZip) return '#e5e7eb';
    const zone = getZoneFromOriginToState(originZip, stateAbbr);
    return getZoneColor(zone);
  };

  const getBubbleRadius = (count: number): number => {
    if (maxShipments === 0) return 0;
    return 4 + (count / maxShipments) * 16;
  };

  // Warehouse markers for non-AK/HI
  const warehouseMarkers = useMemo(() => {
    return warehouses
      .filter((w) => w.lat && w.lng && w.zip)
      .filter((w) => {
        // Exclude Alaska and Hawaii from main map markers (they'd be off)
        return !(w.lat! > 50) && !(w.lat! < 25 && w.lng! < -150);
      });
  }, [warehouses]);

  const handleMouseEnter = (stateAbbr: string, e: React.MouseEvent<SVGPathElement>) => {
    const stats = statsMap.get(stateAbbr);
    const centroid = STATE_CENTROIDS[stateAbbr];
    const zone = originZip ? getZoneFromOriginToState(originZip, stateAbbr) : 0;

    setTooltip({
      x: e.clientX,
      y: e.clientY,
      stateName: centroid?.name || stateAbbr,
      zone,
      shipments: stats?.count || 0,
      avgCost: stats && stats.count > 0 ? stats.totalCost / stats.count : 0,
    });
  };

  const handleMouseLeave = () => setTooltip(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tooltip) {
      setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null);
    }
  };

  // Zone legend entries
  const zoneLegend = [1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <div
      className="rounded-xl overflow-hidden mb-4 relative"
      style={{ background: '#fff', border: '1px solid #e5e7eb' }}
      onMouseMove={handleMouseMove}
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div>
          <h3 className="font-bold text-base" style={{ color: '#252F3E' }}>
            USPS Zone Distribution Map
          </h3>
          {selectedWarehouse?.zip && (
            <p className="text-xs text-gray-500 mt-0.5">
              Origin: {selectedWarehouse.name} • ZIP {selectedWarehouse.zip}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <InsightGate sectionKey="zoneMap" />
          {!originZip && (
            <div
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(245,166,35,0.15)', color: '#c27f0e' }}
            >
              Configure warehouse ZIP to view zones
            </div>
          )}
        </div>
      </div>

      {/* Preview banner */}
      {previewWarehouse && (
        <div
          className="px-5 py-2 flex items-center justify-between text-sm"
          style={{ background: 'rgba(245,166,35,0.1)', borderBottom: '1px solid rgba(245,166,35,0.3)' }}
        >
          <span style={{ color: '#92650a', fontWeight: 700 }}>
            ⭐ Previewing: {previewWarehouse.city}, {previewWarehouse.state} — bright states route to new warehouse, dimmed states stay with existing
          </span>
          <button
            onClick={() => setPreviewWarehouse(null)}
            className="text-xs font-bold px-2 py-1 rounded"
            style={{ background: 'rgba(245,166,35,0.2)', color: '#92650a' }}
          >
            Clear
          </button>
        </div>
      )}

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
                const fill = stateAbbr ? getStateColor(stateAbbr) : '#e5e7eb';
                const stats = statsMap.get(stateAbbr);
                const hasData = (stats?.count || 0) > 0;

                const routesToPreview = previewWarehouse
                  ? previewStates.has(stateAbbr)
                  : true;

                const defaultOpacity = previewWarehouse
                  ? (routesToPreview ? 1.0 : 0.45)
                  : (hasData ? 1 : 0.6);

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#ffffff"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none', opacity: defaultOpacity },
                      hover: { outline: 'none', opacity: 0.8, cursor: 'pointer' },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={(e) => stateAbbr && handleMouseEnter(stateAbbr, e)}
                    onMouseLeave={handleMouseLeave}
                  />
                );
              })
            }
          </Geographies>

          {/* Shipment density bubbles at state centroids */}
          {stateStats.map((stat) => {
            const centroid = STATE_CENTROIDS[stat.state];
            if (!centroid) return null;
            // Skip AK/HI on main map
            if (stat.state === 'AK' || stat.state === 'HI') return null;
            const r = getBubbleRadius(stat.shipmentCount);
            if (r < 1) return null;

            return (
              <Marker key={stat.state} coordinates={[centroid.lng, centroid.lat]}>
                <circle
                  r={r}
                  fill="rgba(255,255,255,0.85)"
                  stroke="#4472E8"
                  strokeWidth={1.5}
                  style={{ pointerEvents: 'none' }}
                />
              </Marker>
            );
          })}

          {/* Warehouse markers */}
          {warehouseMarkers.map((w) => (
            <Marker key={w.name} coordinates={[w.lng!, w.lat!]}>
              <circle r={8} fill="#4472E8" stroke="#fff" strokeWidth={2} />
              <circle r={3} fill="#fff" />
            </Marker>
          ))}

          {/* Preview warehouse star marker */}
          {previewWarehouse && !(previewWarehouse.lat > 50) && (
            <Marker coordinates={[previewWarehouse.lng, previewWarehouse.lat]}>
              <polygon
                points="0,-10 2.4,-3.3 9.5,-3.3 4,1.3 6.2,8 0,4.1 -6.2,8 -4,1.3 -9.5,-3.3 -2.4,-3.3"
                fill="#EF5252"
                stroke="#fff"
                strokeWidth={1.5}
              />
              <text y={22} textAnchor="middle" fontSize={9} fill="#252F3E" fontWeight="bold" fontFamily="'Metropolis', sans-serif">
                {previewWarehouse.city}
              </text>
            </Marker>
          )}
        </ComposableMap>

        {/* Zone legend */}
        <div
          className="absolute bottom-4 left-4 rounded-xl p-3"
          style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
        >
          <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">USPS Zones</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {zoneLegend.map((zone) => (
              <div key={zone} className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: getZoneColor(zone) }}
                />
                <span className="text-xs text-gray-600 font-medium">Zone {zone}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 flex items-center gap-1.5" style={{ borderTop: '1px solid #e5e7eb' }}>
            <svg width="14" height="14" viewBox="0 0 14 14">
              <circle cx="7" cy="7" r="5" fill="rgba(255,255,255,0.85)" stroke="#4472E8" strokeWidth="1.5" />
            </svg>
            <span className="text-xs text-gray-500">= Shipment volume</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14">
              <circle cx="7" cy="7" r="5" fill="#4472E8" stroke="#fff" strokeWidth="1.5" />
              <circle cx="7" cy="7" r="2" fill="#fff" />
            </svg>
            <span className="text-xs text-gray-500">= Warehouse</span>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 10,
            transform: 'translateY(-100%)',
          }}
        >
          <div
            className="rounded-xl p-3 shadow-xl"
            style={{ background: '#252F3E', border: '1px solid rgba(255,255,255,0.15)', minWidth: '160px' }}
          >
            <div className="font-bold text-sm text-white mb-2">{tooltip.stateName}</div>
            {tooltip.zone > 0 && (
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: getZoneColor(tooltip.zone) }}
                />
                <span className="text-xs text-gray-300">Zone {tooltip.zone}</span>
              </div>
            )}
            <div className="text-xs text-gray-400">
              <span className="font-semibold text-white">{formatNumber(tooltip.shipments)}</span> shipments
            </div>
            {tooltip.avgCost > 0 && (
              <div className="text-xs text-gray-400">
                Avg cost: <span className="font-semibold text-white">{formatCurrency(tooltip.avgCost)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
