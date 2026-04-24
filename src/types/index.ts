export interface RawShipment {
  'Shipping Label ID': string;
  'Order date': string;
  'Warehouse': string;
  'Warehouse ID': string;
  'Carrier': string;
  'Shipping Method': string;
  'Zip': string;
  'State': string;
  'Country': string;
  'Label Cost': string;
  'Weight (lb)': string;
  'Total Shipping Charged': string;
  [key: string]: string;
}

export interface Shipment {
  id: string;
  orderDate: string;
  warehouse: string;
  warehouseId: string;
  carrier: string;
  shippingMethod: string;
  zip: string;
  state: string;
  country: string;
  labelCost: number;
  weight: number;
  totalShippingCharged: number;
  customer3pl: string;
}

export interface WarehouseConfig {
  name: string;
  warehouseId: string;
  zip: string;
  lat?: number;
  lng?: number;
  excluded?: boolean;
}

export interface StateStats {
  state: string;
  stateName: string;
  zone: number;
  shipmentCount: number;
  totalCost: number;
  avgCost: number;
  percentOfTotal: number;
}

export interface FilterState {
  warehouse: string;
  startDate: string;
  endDate: string;
  carrier: string;
  zone: number | null;
  sortBy: 'shipments' | 'avgCost';
  sortDirection: 'asc' | 'desc';
}

export interface ScenarioConfig {
  zip: string;
  name: string;
  routingMode: 'auto' | 'manual';
  selectedStates: string[];
}

export interface ScenarioResult {
  projectedSavings: number;
  currentAvgZone: number;
  projectedAvgZone: number;
  shipmentsRerouted: number;
  shipmentsReroutedPercent: number;
  currentTotalCost: number;
  projectedTotalCost: number;
  estimatedSavings: number;
  stateAssignments: Record<string, 'new' | 'existing'>;
  newWarehouseLat?: number;
  newWarehouseLng?: number;
}

export interface LocationInsight {
  rank: number;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  projectedSavings: number;
  currentAvgZone: number;
  projectedAvgZone: number;
  co2OffsetKg: number;
  treesPlanted: number;
  shipmentsRerouted: number;
  shipmentsReroutedPercent: number;
}

export interface User {
  email: string;
  name: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}
