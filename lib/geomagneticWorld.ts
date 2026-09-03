import type { MagneticStationSeries } from "./geomagnetism";
import { mad, median, percentile } from "./geomagnetism";
import type { GeomagneticStation } from "./geomagNetwork";

const EARTH_RADIUS_KM = 6371;

export interface GroundMagneticObservation {
  id: string;
  stationCode: string;
  stationName: string;
  source: "USGS" | "INTERMAGNET" | "USGS + INTERMAGNET";
  latitude: number;
  longitude: number;
  strengthNt: number;
  observedAt: string;
  anomalyZ: number;
  baselineNt: number;
  sampleCount: number;
}

export interface MagneticGridCell {
  latitude: number;
  longitude: number;
  sizeDeg: number;
  fieldNt: number;
  intensity01: number;
  supportCount: number;
  nearestKm: number;
}

type ScalarFieldPoint = {
  latitude: number;
  longitude: number;
  strengthNt: number;
};

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function radians(value: number) { return value * Math.PI / 180; }
function scalar(sample: MagneticStationSeries["samples"][number]) {
  return sample.f !== null && Number.isFinite(sample.f) ? Math.abs(sample.f) : Math.hypot(sample.x, sample.y, sample.z);
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const phi1 = radians(lat1); const phi2 = radians(lat2);
  const dPhi = radians(lat2 - lat1); const dLambda = radians(lng2 - lng1);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function observationFromSeries(station: GeomagneticStation, series: MagneticStationSeries): GroundMagneticObservation | null {
  if (station.latitude === null || station.longitude === null || series.samples.length < 20) return null;
  const values = series.samples.map(scalar).filter((value) => Number.isFinite(value) && value > 1_000 && value < 100_000);
  if (values.length < 20) return null;
  const latestSample = series.samples.at(-1);
  if (!latestSample) return null;
  const latest = scalar(latestSample);
  if (!(latest > 1_000 && latest < 100_000)) return null;
  const baseline = median(values);
  const robustSigma = Math.max(0.5, 1.4826 * mad(values));
  const anomalyZ = Math.abs(latest - baseline) / robustSigma;
  return {
    id: `ground:${station.code}`,
    stationCode: station.code,
    stationName: station.name,
    source: station.sources.length > 1 ? "USGS + INTERMAGNET" : station.sources[0] === "USGS" ? "USGS" : "INTERMAGNET",
    latitude: station.latitude,
    longitude: station.longitude,
    strengthNt: latest,
    observedAt: latestSample.timeUtc,
    anomalyZ,
    baselineNt: baseline,
    sampleCount: values.length,
  };
}

/** Selects a geographically distributed subset so the world snapshot remains fast. */
export function selectGlobalGroundStations(stations: GeomagneticStation[], maximum = 32) {
  const candidates = stations.filter((station) => station.latitude !== null && station.longitude !== null);
  const bins = new Map<string, GeomagneticStation>();
  for (const station of candidates) {
    const latBin = Math.floor((station.latitude! + 90) / 20);
    const lngBin = Math.floor((station.longitude! + 180) / 20);
    const key = `${latBin}:${lngBin}`;
    const current = bins.get(key);
    const quality = station.sources.length * 10 + (station.sources.includes("USGS") ? 2 : 0);
    const currentQuality = current ? current.sources.length * 10 + (current.sources.includes("USGS") ? 2 : 0) : -1;
    if (!current || quality > currentQuality) bins.set(key, station);
  }
  const distributed = [...bins.values()];
  distributed.sort((a, b) => {
    const aScore = a.sources.length * 10 + Math.abs(a.latitude ?? 0) / 90;
    const bScore = b.sources.length * 10 + Math.abs(b.latitude ?? 0) / 90;
    return bScore - aScore || a.code.localeCompare(b.code);
  });
  if (distributed.length <= maximum) return distributed;
  const selected: GeomagneticStation[] = [];
  for (let index = 0; index < maximum; index += 1) selected.push(distributed[Math.floor(index * distributed.length / maximum)]);
  return selected;
}

function buildScalarGrid(points: ScalarFieldPoint[], stepDeg: number, supportRadiusKm: number, nearestScaleKm: number, maximumNeighbors: number): MagneticGridCell[] {
  if (!points.length) return [];
  const strengths = points.map((point) => point.strengthNt).filter(Number.isFinite);
  if (!strengths.length) return [];
  const low = percentile(strengths, .08);
  const high = percentile(strengths, .92);
  const span = Math.max(500, high - low);
  const cells: MagneticGridCell[] = [];

  for (let latitude = -85; latitude <= 85; latitude += stepDeg) {
    for (let longitude = -175; longitude <= 175; longitude += stepDeg) {
      const nearby = points
        .map((point) => ({ point, distance: distanceKm(latitude, longitude, point.latitude, point.longitude) }))
        .filter((item) => item.distance <= supportRadiusKm)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maximumNeighbors);
      if (!nearby.length) continue;
      let weighted = 0;
      let totalWeight = 0;
      for (const item of nearby) {
        const weight = 1 / (1 + (item.distance / nearestScaleKm) ** 2);
        weighted += item.point.strengthNt * weight;
        totalWeight += weight;
      }
      if (!(totalWeight > 0)) continue;
      const fieldNt = weighted / totalWeight;
      cells.push({
        latitude,
        longitude,
        sizeDeg: stepDeg,
        fieldNt,
        intensity01: clamp((fieldNt - low) / span, 0, 1),
        supportCount: nearby.length,
        nearestKm: Math.round(nearby[0].distance),
      });
    }
  }
  return cells;
}

export function buildMagneticGrid(observations: GroundMagneticObservation[], stepDeg = 10, supportRadiusKm = 3200): MagneticGridCell[] {
  return buildScalarGrid(observations, stepDeg, supportRadiusKm, 700, 6);
}

/**
 * Current orbital field layer. It deliberately remains separate from ground observations:
 * Swarm measures |F| at satellite altitude, so it is suitable as a spatial fallback/background,
 * not as a direct replacement for a surface magnetometer residual.
 */
export function buildSwarmMagneticGrid(points: ScalarFieldPoint[], stepDeg = 5, supportRadiusKm = 1700): MagneticGridCell[] {
  return buildScalarGrid(points, stepDeg, supportRadiusKm, 420, 10);
}

export function anomalyObservations(observations: GroundMagneticObservation[], threshold = 3) {
  return observations.filter((point) => point.anomalyZ >= threshold).sort((a, b) => b.anomalyZ - a.anomalyZ);
}
