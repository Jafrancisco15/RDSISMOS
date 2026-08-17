export interface HistoricalHeatmapEvent {
  id: string;
  latitude: number;
  longitude: number;
  magnitude: number;
  depthKm: number;
  timeUtc: string;
  place: string;
}

export interface HistoricalHeatmapResponse {
  year: number;
  generatedAt: string;
  startTime: string;
  endTime: string;
  provider: "USGS ComCat";
  minimumMagnitude: number;
  totalEvents: number;
  events: HistoricalHeatmapEvent[];
  strongestEvent: HistoricalHeatmapEvent | null;
  averageMagnitude: number | null;
  averageDepthKm: number | null;
  warnings: string[];
}

export function visualMagnitudeWeight(magnitude: number, minimumMagnitude = 2.5) {
  const delta = Math.max(0, magnitude - minimumMagnitude);
  return Number((1 + delta * delta * 0.85).toFixed(4));
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
