import { Shipment, StateStats, FilterState, WarehouseConfig, ScenarioConfig, ScenarioResult, LocationInsight } from '../types';
import { getZoneFromOriginToState, getZoneFromCoords, findNearestWarehouse, getLatLngFromZip, haversineDistance } from './uspsZones';
import { STATE_CENTROIDS } from '../data/stateCentroids';

// CO2 emitted per package per USPS zone (kg), based on EPA ground shipping estimates
const CO2_PER_ZONE_KG: Record<number, number> = {
  1: 0.10,
  2: 0.20,
  3: 0.35,
  4: 0.55,
  5: 0.80,
  6: 1.05,
  7: 1.30,
  8: 1.55,
};

// kg of CO2 one tree absorbs per year (US Forest Service)
const CO2_KG_PER_TREE_PER_YEAR = 21.77;

// Candidate warehouse locations — major US logistics hubs
const CANDIDATE_WAREHOUSES = [
  { city: 'Memphis',       state: 'TN', zip: '38103', lat: 35.1495, lng: -90.0490 },
  { city: 'Louisville',    state: 'KY', zip: '40203', lat: 38.2527, lng: -85.7585 },
  { city: 'Indianapolis',  state: 'IN', zip: '46204', lat: 39.7684, lng: -86.1581 },
  { city: 'Kansas City',   state: 'MO', zip: '64108', lat: 39.0997, lng: -94.5786 },
  { city: 'Nashville',     state: 'TN', zip: '37203', lat: 36.1627, lng: -86.7816 },
  { city: 'Columbus',      state: 'OH', zip: '43215', lat: 39.9612, lng: -82.9988 },
  { city: 'Chicago',       state: 'IL', zip: '60607', lat: 41.8781, lng: -87.6298 },
  { city: 'Dallas',        state: 'TX', zip: '75201', lat: 32.7767, lng: -96.7970 },
  { city: 'Atlanta',       state: 'GA', zip: '30309', lat: 33.7490, lng: -84.3880 },
  { city: 'Denver',        state: 'CO', zip: '80203', lat: 39.7392, lng: -104.9903 },
  { city: 'Phoenix',       state: 'AZ', zip: '85004', lat: 33.4484, lng: -112.0740 },
  { city: 'St. Louis',     state: 'MO', zip: '63101', lat: 38.6270, lng: -90.1994 },
  { city: 'Cincinnati',    state: 'OH', zip: '45202', lat: 39.1031, lng: -84.5120 },
  { city: 'Charlotte',     state: 'NC', zip: '28202', lat: 35.2271, lng: -80.8431 },
  { city: 'Harrisburg',    state: 'PA', zip: '17101', lat: 40.2732, lng: -76.8867 },
  { city: 'Raleigh',       state: 'NC', zip: '27601', lat: 35.7796, lng: -78.6382 },
  { city: 'Salt Lake City',state: 'UT', zip: '84101', lat: 40.7608, lng: -111.8910 },
  { city: 'Albuquerque',   state: 'NM', zip: '87102', lat: 35.0844, lng: -106.6504 },
  { city: 'Oklahoma City', state: 'OK', zip: '73102', lat: 35.4676, lng: -97.5164 },
  { city: 'Omaha',         state: 'NE', zip: '68102', lat: 41.2565, lng: -95.9345 },
  { city: 'Minneapolis',   state: 'MN', zip: '55401', lat: 44.9778, lng: -93.2650 },
  { city: 'Cleveland',     state: 'OH', zip: '44113', lat: 41.4993, lng: -81.6944 },
  { city: 'Pittsburgh',    state: 'PA', zip: '15222', lat: 40.4406, lng: -79.9959 },
  { city: 'Richmond',      state: 'VA', zip: '23219', lat: 37.5407, lng: -77.4360 },
  { city: 'Birmingham',    state: 'AL', zip: '35203', lat: 33.5186, lng: -86.8104 },
  { city: 'Little Rock',   state: 'AR', zip: '72201', lat: 34.7465, lng: -92.2896 },
  { city: 'Des Moines',    state: 'IA', zip: '50309', lat: 41.5868, lng: -93.6250 },
  { city: 'Wichita',       state: 'KS', zip: '67202', lat: 37.6872, lng: -97.3301 },
  { city: 'Las Vegas',     state: 'NV', zip: '89101', lat: 36.1699, lng: -115.1398 },
  { city: 'Sacramento',    state: 'CA', zip: '95814', lat: 38.5816, lng: -121.4944 },
  { city: 'Portland',      state: 'OR', zip: '97201', lat: 45.5051, lng: -122.6750 },
  { city: 'Jacksonville',  state: 'FL', zip: '32202', lat: 30.3322, lng: -81.6557 },
  { city: 'New Orleans',   state: 'LA', zip: '70112', lat: 29.9511, lng: -90.0715 },
  { city: 'Detroit',       state: 'MI', zip: '48226', lat: 42.3314, lng: -83.0457 },
  { city: 'Buffalo',       state: 'NY', zip: '14202', lat: 42.8864, lng: -78.8784 },
];

export function applyFilters(shipments: Shipment[], filters: FilterState, warehouses: WarehouseConfig[]): Shipment[] {
  let filtered = [...shipments];

  if (filters.warehouse && filters.warehouse !== 'all') {
    filtered = filtered.filter((s) => s.warehouse === filters.warehouse);
  }

  if (filters.startDate) {
    filtered = filtered.filter((s) => s.orderDate >= filters.startDate);
  }

  if (filters.endDate) {
    filtered = filtered.filter((s) => s.orderDate <= filters.endDate);
  }

  if (filters.carrier && filters.carrier !== 'all') {
    filtered = filtered.filter((s) => s.carrier === filters.carrier);
  }

  if (filters.zone !== null) {
    const originWarehouse = warehouses.find((w) =>
      filters.warehouse !== 'all' ? w.name === filters.warehouse : true
    );
    if (originWarehouse?.zip) {
      filtered = filtered.filter((s) => {
        const zone = getZoneFromOriginToState(originWarehouse.zip, s.state);
        return zone === filters.zone;
      });
    }
  }

  return filtered;
}

export function computeStateStats(
  shipments: Shipment[],
  originZip: string
): StateStats[] {
  const stateMap = new Map<string, { count: number; totalCost: number }>();

  for (const s of shipments) {
    const key = s.state;
    if (!key) continue;
    const existing = stateMap.get(key) || { count: 0, totalCost: 0 };
    existing.count += 1;
    existing.totalCost += s.labelCost;
    stateMap.set(key, existing);
  }

  const totalShipments = shipments.length;
  const stats: StateStats[] = [];

  for (const [state, data] of stateMap.entries()) {
    const centroid = STATE_CENTROIDS[state];
    const stateName = centroid?.name || state;
    const zone = getZoneFromOriginToState(originZip, state);
    const avgCost = data.count > 0 ? data.totalCost / data.count : 0;

    stats.push({
      state,
      stateName,
      zone,
      shipmentCount: data.count,
      totalCost: data.totalCost,
      avgCost,
      percentOfTotal: totalShipments > 0 ? (data.count / totalShipments) * 100 : 0,
    });
  }

  return stats;
}

export function computeKPIs(shipments: Shipment[]): {
  totalShipments: number;
  totalCost: number;
  avgCostPerShipment: number;
  statesReached: number;
  dateRange: { min: string; max: string };
} {
  const totalShipments = shipments.length;
  const totalCost = shipments.reduce((sum, s) => sum + s.labelCost, 0);
  const avgCostPerShipment = totalShipments > 0 ? totalCost / totalShipments : 0;
  const states = new Set(shipments.map((s) => s.state).filter(Boolean));

  let min = '';
  let max = '';
  for (const s of shipments) {
    if (!s.orderDate) continue;
    if (!min || s.orderDate < min) min = s.orderDate;
    if (!max || s.orderDate > max) max = s.orderDate;
  }

  return {
    totalShipments,
    totalCost,
    avgCostPerShipment,
    statesReached: states.size,
    dateRange: { min, max },
  };
}

export function runScenario(
  shipments: Shipment[],
  scenario: ScenarioConfig,
  existingWarehouses: WarehouseConfig[]
): ScenarioResult | null {
  const newCoords = getLatLngFromZip(scenario.zip);
  if (!newCoords) return null;

  const existingWithCoords = existingWarehouses
    .filter((w) => w.lat !== undefined && w.lng !== undefined)
    .map((w) => ({ name: w.name, lat: w.lat!, lng: w.lng! }));

  if (existingWithCoords.length === 0) return null;

  const stateAssignments: Record<string, 'new' | 'existing'> = {};
  let totalCurrentCost = 0;
  let totalProjectedCost = 0;
  let currentZoneSum = 0;
  let projectedZoneSum = 0;
  let shipmentsRerouted = 0;

  // Get all unique states in the shipments
  const stateShipments = new Map<string, Shipment[]>();
  for (const s of shipments) {
    if (!s.state) continue;
    const existing = stateShipments.get(s.state) || [];
    existing.push(s);
    stateShipments.set(s.state, existing);
  }

  for (const [state, stateShips] of stateShipments.entries()) {
    let routeToNew = false;

    if (scenario.routingMode === 'manual') {
      routeToNew = scenario.selectedStates.includes(state);
    } else {
      // Auto mode: find nearest warehouse (including new one)
      const allWarehouses = [
        ...existingWithCoords,
        { name: '__new__', lat: newCoords.lat, lng: newCoords.lng },
      ];
      const nearest = findNearestWarehouse(state, allWarehouses);
      routeToNew = nearest?.name === '__new__';
    }

    stateAssignments[state] = routeToNew ? 'new' : 'existing';

    for (const ship of stateShips) {
      // Current cost and zone from existing warehouse
      const existingWarehouse = existingWithCoords.length === 1
        ? existingWithCoords[0]
        : findNearestWarehouse(state, existingWithCoords)!;

      const currentZone = getZoneFromCoords(existingWarehouse.lat, existingWarehouse.lng, state);
      const currentCost = ship.labelCost;
      totalCurrentCost += currentCost;
      currentZoneSum += currentZone;

      if (routeToNew) {
        const newZone = getZoneFromCoords(newCoords.lat, newCoords.lng, state);
        const zoneDiff = currentZone - newZone;
        const savings = zoneDiff * 0.65;
        const projectedCost = Math.max(0, currentCost - savings);
        totalProjectedCost += projectedCost;
        projectedZoneSum += newZone;
        shipmentsRerouted += 1;
      } else {
        totalProjectedCost += currentCost;
        projectedZoneSum += currentZone;
      }
    }
  }

  const totalShips = shipments.length;
  const avgZoneDivisor = totalShips > 0 ? totalShips : 1;

  return {
    projectedSavings: totalCurrentCost - totalProjectedCost,
    currentAvgZone: currentZoneSum / avgZoneDivisor,
    projectedAvgZone: projectedZoneSum / avgZoneDivisor,
    shipmentsRerouted,
    shipmentsReroutedPercent: totalShips > 0 ? (shipmentsRerouted / totalShips) * 100 : 0,
    currentTotalCost: totalCurrentCost,
    projectedTotalCost: totalProjectedCost,
    estimatedSavings: totalCurrentCost - totalProjectedCost,
    stateAssignments,
    newWarehouseLat: newCoords.lat,
    newWarehouseLng: newCoords.lng,
  };
}

export function computeWarehouseInsights(
  shipments: Shipment[],
  existingWarehouses: WarehouseConfig[]
): LocationInsight[] {
  const existingWithCoords = existingWarehouses
    .filter((w) => w.lat !== undefined && w.lng !== undefined)
    .map((w) => ({ name: w.name, lat: w.lat!, lng: w.lng! }));

  if (existingWithCoords.length === 0 || shipments.length === 0) return [];

  // Pre-group shipments by state
  const stateShipments = new Map<string, Shipment[]>();
  for (const s of shipments) {
    if (!s.state) continue;
    const arr = stateShipments.get(s.state) || [];
    arr.push(s);
    stateShipments.set(s.state, arr);
  }

  // Current cost + CO2 baseline (using nearest existing warehouse per state)
  let currentTotalCost = 0;
  let currentTotalCO2 = 0;
  let currentZoneSumBase = 0;
  const totalShips = shipments.filter((s) => s.state).length;

  for (const [state, stateShips] of stateShipments.entries()) {
    const warehouse = findNearestWarehouse(state, existingWithCoords);
    if (!warehouse) continue; // skip states not in centroids DB (PR, VI, etc.)
    const zone = getZoneFromCoords(warehouse.lat, warehouse.lng, state);
    const co2PerPkg = CO2_PER_ZONE_KG[zone] ?? 0.55;
    for (const ship of stateShips) {
      currentTotalCost += ship.labelCost;
      currentTotalCO2 += co2PerPkg;
      currentZoneSumBase += zone;
    }
  }

  const results: LocationInsight[] = [];

  for (const candidate of CANDIDATE_WAREHOUSES) {
    // Skip candidates that are within 100 miles of an existing warehouse
    const tooClose = existingWithCoords.some(
      (w) => haversineDistance(w.lat, w.lng, candidate.lat, candidate.lng) < 100
    );
    if (tooClose) continue;

    const allWarehouses = [
      ...existingWithCoords,
      { name: '__candidate__', lat: candidate.lat, lng: candidate.lng },
    ];

    let projectedTotalCost = 0;
    let projectedTotalCO2 = 0;
    let projectedZoneSum = 0;
    let shipmentsRerouted = 0;

    for (const [state, stateShips] of stateShipments.entries()) {
      const nearest = findNearestWarehouse(state, allWarehouses);
      if (!nearest) continue; // skip unknown states

      const routeToNew = nearest.name === '__candidate__';

      // Current zone from nearest existing warehouse
      const existingWarehouse = findNearestWarehouse(state, existingWithCoords);
      if (!existingWarehouse) continue;

      const currentZone = getZoneFromCoords(existingWarehouse.lat, existingWarehouse.lng, state);
      const newZone = routeToNew
        ? getZoneFromCoords(candidate.lat, candidate.lng, state)
        : currentZone;

      const co2PerPkg = CO2_PER_ZONE_KG[newZone] ?? 0.55;

      for (const ship of stateShips) {
        const zoneDiff = currentZone - newZone;
        const savings = Math.max(0, zoneDiff * 0.65);
        projectedTotalCost += Math.max(0, ship.labelCost - savings);
        projectedTotalCO2 += co2PerPkg;
        projectedZoneSum += newZone;
        if (routeToNew) shipmentsRerouted++;
      }
    }

    const projectedSavings = currentTotalCost - projectedTotalCost;
    const co2OffsetKg = currentTotalCO2 - projectedTotalCO2;
    const treesPlanted = Math.max(0, Math.floor(co2OffsetKg / CO2_KG_PER_TREE_PER_YEAR));

    if (projectedSavings > 0) {
      results.push({
        rank: 0,
        city: candidate.city,
        state: candidate.state,
        zip: candidate.zip,
        lat: candidate.lat,
        lng: candidate.lng,
        projectedSavings,
        currentAvgZone: totalShips > 0 ? currentZoneSumBase / totalShips : 0,
        projectedAvgZone: totalShips > 0 ? projectedZoneSum / totalShips : 0,
        co2OffsetKg,
        treesPlanted,
        shipmentsRerouted,
        shipmentsReroutedPercent: totalShips > 0 ? (shipmentsRerouted / totalShips) * 100 : 0,
      });
    }
  }

  // Sort by projected savings descending, return top 3
  results.sort((a, b) => b.projectedSavings - a.projectedSavings);
  return results.slice(0, 3).map((r, i) => ({ ...r, rank: i + 1 }));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
