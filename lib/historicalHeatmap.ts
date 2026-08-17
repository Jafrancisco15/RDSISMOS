export interface HistoricalHeatmapEvent {
  id: string;
  latitude: number;
  longitude: number;
  magnitude: number;
  depthKm: number;
  timeUtc: string;
  place: string;
}

export interface HistoricalHeatmapCell {
  id: string;
  latitude: number;
  longitude: number;
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
  eventCount: number;
  maximumMagnitude: number;
  averageMagnitude: number;
  averageDepthKm: number;
}

export interface HistoricalHeatmapResponse {
  year: number;
  generatedAt: string;
  startTime: string;
  endTime: string;
  provider: "USGS ComCat";
  minimumMagnitude: number;
  totalEvents: number;
  cellSizeDeg: number;
  cells: HistoricalHeatmapCell[];
  strongestEvent: HistoricalHeatmapEvent | null;
  averageMagnitude: number | null;
  averageDepthKm: number | null;
  warnings: string[];
}

export const HISTORICAL_HEATMAP_CELL_SIZE_DEG = 1.5;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function aggregateHistoricalHeatmap(
  events: HistoricalHeatmapEvent[],
  cellSizeDeg = HISTORICAL_HEATMAP_CELL_SIZE_DEG,
): HistoricalHeatmapCell[] {
  const safeCellSize = clamp(cellSizeDeg, 0.5, 10);
  const latitudeBins = Math.round(180 / safeCellSize);
  const longitudeBins = Math.round(360 / safeCellSize);
  const cells = new Map<string, {
    latitudeIndex: number;
    longitudeIndex: number;
    count: number;
    magnitudeSum: number;
    depthSum: number;
    maximumMagnitude: number;
  }>();

  for (const event of events) {
    const latitude = clamp(event.latitude, -89.999999, 89.999999);
    const longitude = clamp(event.longitude, -179.999999, 179.999999);
    const latitudeIndex = clamp(Math.floor((latitude + 90) / safeCellSize), 0, latitudeBins - 1);
    const longitudeIndex = clamp(Math.floor((longitude + 180) / safeCellSize), 0, longitudeBins - 1);
    const key = `${latitudeIndex}:${longitudeIndex}`;
    const cell = cells.get(key) ?? {
      latitudeIndex,
      longitudeIndex,
      count: 0,
      magnitudeSum: 0,
      depthSum: 0,
      maximumMagnitude: Number.NEGATIVE_INFINITY,
    };
    cell.count += 1;
    cell.magnitudeSum += event.magnitude;
    cell.depthSum += event.depthKm;
    cell.maximumMagnitude = Math.max(cell.maximumMagnitude, event.magnitude);
    cells.set(key, cell);
  }

  return [...cells.values()].map((cell) => {
    const minLatitude = -90 + cell.latitudeIndex * safeCellSize;
    const minLongitude = -180 + cell.longitudeIndex * safeCellSize;
    const maxLatitude = Math.min(90, minLatitude + safeCellSize);
    const maxLongitude = Math.min(180, minLongitude + safeCellSize);
    return {
      id: `${cell.latitudeIndex}:${cell.longitudeIndex}`,
      latitude: (minLatitude + maxLatitude) / 2,
      longitude: (minLongitude + maxLongitude) / 2,
      minLatitude,
      maxLatitude,
      minLongitude,
      maxLongitude,
      eventCount: cell.count,
      maximumMagnitude: Number(cell.maximumMagnitude.toFixed(2)),
      averageMagnitude: Number((cell.magnitudeSum / cell.count).toFixed(2)),
      averageDepthKm: Number((cell.depthSum / cell.count).toFixed(1)),
    };
  }).sort((a, b) => b.maximumMagnitude - a.maximumMagnitude || b.eventCount - a.eventCount);
}

export function historicalCoverageNote(year: number) {
  if (year < 1970) {
    return "El catálogo mundial antiguo es mucho más completo para terremotos moderados y grandes que para eventos pequeños; una baja densidad histórica puede reflejar menor instrumentación.";
  }
  if (year < 2000) {
    return "La detección global de magnitudes pequeñas todavía es menos uniforme que en la era instrumental moderna; compara densidades con cautela entre décadas.";
  }
  return "La cobertura instrumental moderna es mucho mayor, pero la detectabilidad de sismos pequeños todavía varía entre redes y regiones.";
}
