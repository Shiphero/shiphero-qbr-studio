import { STATE_CENTROIDS, ZIP3_CENTROIDS, getLatLngFromZip } from '../data/stateCentroids';

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function getUSPSZone(distanceMiles: number): number {
  if (distanceMiles <= 50) return 1;
  if (distanceMiles <= 150) return 2;
  if (distanceMiles <= 300) return 3;
  if (distanceMiles <= 600) return 4;
  if (distanceMiles <= 1000) return 5;
  if (distanceMiles <= 1400) return 6;
  if (distanceMiles <= 1800) return 7;
  return 8;
}

export const ZONE_COLORS: Record<number, string> = {
  1: '#22C55E',
  2: '#84CC16',
  3: '#A3E635',
  4: '#EAB308',
  5: '#F97316',
  6: '#EF4444',
  7: '#DC2626',
  8: '#991B1B',
};

export function getZoneColor(zone: number): string {
  return ZONE_COLORS[zone] || '#6B7280';
}

export function getLatLngFromOriginZip(zip: string): { lat: number; lng: number } | null {
  return getLatLngFromZip(zip);
}

export function getZoneFromOriginToState(originZip: string, destinationState: string): number {
  const originCoords = getLatLngFromZip(originZip);
  if (!originCoords) return 5; // Default middle zone if zip not found

  const destCentroid = STATE_CENTROIDS[destinationState.toUpperCase()];
  if (!destCentroid) return 5;

  const distance = haversineDistance(originCoords.lat, originCoords.lng, destCentroid.lat, destCentroid.lng);
  return getUSPSZone(distance);
}

export function getZoneFromCoords(originLat: number, originLng: number, destinationState: string): number {
  const destCentroid = STATE_CENTROIDS[destinationState.toUpperCase()];
  if (!destCentroid) return 5;

  const distance = haversineDistance(originLat, originLng, destCentroid.lat, destCentroid.lng);
  return getUSPSZone(distance);
}

export function findNearestWarehouse(
  destinationState: string,
  warehouses: Array<{ name: string; lat: number; lng: number }>
): { name: string; lat: number; lng: number } | null {
  const destCentroid = STATE_CENTROIDS[destinationState.toUpperCase()];
  if (!destCentroid || warehouses.length === 0) return null;

  let nearest = warehouses[0];
  let minDistance = haversineDistance(warehouses[0].lat, warehouses[0].lng, destCentroid.lat, destCentroid.lng);

  for (let i = 1; i < warehouses.length; i++) {
    const dist = haversineDistance(warehouses[i].lat, warehouses[i].lng, destCentroid.lat, destCentroid.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = warehouses[i];
    }
  }

  return nearest;
}

// Re-export for use in other files
export { ZIP3_CENTROIDS, getLatLngFromZip };
