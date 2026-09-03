import type { MagneticStationSeries } from "./geomagnetism";
import { mad, median, percentile } from "./geomagnetism";
import type { GeomagneticStation } from "./geomagNetwork";
import { expectedMainFieldNt } from "./geomagneticReference";

const EARTH_RADIUS_KM = 6371;

export type MagneticGridMetric = "reference" | "change" | "anomaly" | "orbital";

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
  signedAnomalyZ: number;
  baselineNt: number;
  changeNt: number;
  expectedMainFieldNt: number | null;
  modelResidualNt: number | null;
  sampleCount: number;
}

export interface MagneticGridCell {
  latitude: number;
  longitude: number;
  sizeDeg: number;
  fieldNt: number;
  intensity01: number;
  signed01: number;
  metric: MagneticGridMetric;
  supportCount: number;
  nearestKm: number;
  scaleAbs?: number;
}

type ScalarFieldPoint = {
  latitude: number;
  longitude: number;
  value: number;
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
  const signedAnomalyZ = (latest - baseline) / robustSigma;
  const when = new Date(latestSample.timeUtc);
  const expected = expectedMainFieldNt(station.latitude, station.longitude, 0, Number.isNaN(when.getTime()) ? new Date() : when);
  return {
    id: `ground:${station.code}`,
    stationCode: station.code,
    stationName: station.name,
    source: station.sources.length > 1 ? "USGS + INTERMAGNET" : station.sources[0] === "USGS" ? "USGS" : "INTERMAGNET",
    latitude: station.latitude,
    longitude: station.longitude,
    strengthNt: latest,
    observedAt: latestSample.timeUtc,
    anomalyZ: Math.abs(signedAnomalyZ),
    signedAnomalyZ,
    baselineNt: baseline,
    changeNt: latest - baseline,
    expectedMainFieldNt: expected,
    modelResidualNt: expected === null ? null : latest - expected,
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

function buildObservedGrid(
  points: ScalarFieldPoint[],
  metric: MagneticGridMetric,
  stepDeg: number,
  supportRadiusKm: number,
  nearestScaleKm: number,
  maximumNeighbors: number,
  minimumScale: number,
): MagneticGridCell[] {
  if (!points.length) return [];
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (!values.length) return [];
  const absScale = Math.max(minimumScale, percentile(values.map(Math.abs), .90));
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
        weighted += item.point.value * weight;
        totalWeight += weight;
      }
      if (!(totalWeight > 0)) continue;
      const value = weighted / totalWeight;
      const signed01 = clamp(value / absScale, -1, 1);
      cells.push({
        latitude,
        longitude,
        sizeDeg: stepDeg,
        fieldNt: value,
        intensity01: Math.abs(signed01),
        signed01,
        metric,
        supportCount: nearby.length,
        nearestKm: Math.round(nearby[0].distance),
        scaleAbs: absScale,
      });
    }
  }
  return cells;
}

let referenceCacheKey = "";
let referenceCache: MagneticGridCell[] = [];

/** WMM2025 expected main field. Continuous global context, never interpreted as anomaly. */
export function buildReferenceFieldGrid(when = new Date(), stepDeg = 5): MagneticGridCell[] {
  const key = `${when.toISOString().slice(0, 10)}:${stepDeg}`;
  if (referenceCacheKey === key && referenceCache.length) return referenceCache;
  const raw: Array<{ latitude: number; longitude: number; fieldNt: number }> = [];
  for (let latitude = -85; latitude <= 85; latitude += stepDeg) {
    for (let longitude = -175; longitude <= 175; longitude += stepDeg) {
      const fieldNt = expectedMainFieldNt(latitude, longitude, 0, when);
      if (fieldNt !== null) raw.push({ latitude, longitude, fieldNt });
    }
  }
  const fields = raw.map((item) => item.fieldNt);
  const low = percentile(fields, .05);
  const high = percentile(fields, .95);
  const span = Math.max(1, high - low);
  referenceCache = raw.map((item) => ({
    latitude: item.latitude,
    longitude: item.longitude,
    sizeDeg: stepDeg,
    fieldNt: item.fieldNt,
    intensity01: clamp((item.fieldNt - low) / span, 0, 1),
    signed01: 0,
    metric: "reference" as const,
    supportCount: 0,
    nearestKm: 0,
  }));
  referenceCacheKey = key;
  return referenceCache;
}

/** Default map: recent temporal change, latest F minus each station's own recent median. */
export function buildRecentChangeGrid(observations: GroundMagneticObservation[], stepDeg = 5, supportRadiusKm = 2400): MagneticGridCell[] {
  return buildObservedGrid(
    observations.map((point) => ({ latitude: point.latitude, longitude: point.longitude, value: point.changeNt })),
    "change", stepDeg, supportRadiusKm, 620, 6, 5,
  );
}

/** Robust standardized temporal deviation. Magnitude is meaningful only near supporting stations. */
export function buildRobustAnomalyGrid(observations: GroundMagneticObservation[], stepDeg = 5, supportRadiusKm = 1700): MagneticGridCell[] {
  return buildObservedGrid(
    observations.map((point) => ({ latitude: point.latitude, longitude: point.longitude, value: point.signedAnomalyZ })),
    "anomaly", stepDeg, supportRadiusKm, 480, 5, 3,
  );
}

/** Legacy absolute observed field grid retained for diagnostics, not used as the default map. */
export function buildMagneticGrid(observations: GroundMagneticObservation[], stepDeg = 10, supportRadiusKm = 3200): MagneticGridCell[] {
  const points = observations.map((point) => ({ latitude: point.latitude, longitude: point.longitude, value: point.strengthNt }));
  if (!points.length) return [];
  const strengths = points.map((point) => point.value);
  const low = percentile(strengths, .08);
  const high = percentile(strengths, .92);
  const span = Math.max(500, high - low);
  const cells: MagneticGridCell[] = [];
  for (let latitude = -85; latitude <= 85; latitude += stepDeg) {
    for (let longitude = -175; longitude <= 175; longitude += stepDeg) {
      const nearby = points.map((point) => ({ point, distance: distanceKm(latitude, longitude, point.latitude, point.longitude) })).filter((item) => item.distance <= supportRadiusKm).sort((a, b) => a.distance - b.distance).slice(0, 6);
      if (!nearby.length) continue;
      let weighted = 0; let totalWeight = 0;
      for (const item of nearby) { const weight = 1 / (1 + (item.distance / 700) ** 2); weighted += item.point.value * weight; totalWeight += weight; }
      if (!(totalWeight > 0)) continue;
      const fieldNt = weighted / totalWeight;
      cells.push({ latitude, longitude, sizeDeg: stepDeg, fieldNt, intensity01: clamp((fieldNt - low) / span, 0, 1), signed01: 0, metric: "orbital", supportCount: nearby.length, nearestKm: Math.round(nearby[0].distance) });
    }
  }
  return cells;
}

export function buildSwarmMagneticGrid(points: Array<{ latitude: number; longitude: number; strengthNt: number }>, stepDeg = 5, supportRadiusKm = 1700): MagneticGridCell[] {
  const scalarPoints = points.map((point) => ({ latitude: point.latitude, longitude: point.longitude, value: point.strengthNt }));
  if (!scalarPoints.length) return [];
  const strengths = scalarPoints.map((point) => point.value);
  const low = percentile(strengths, .08); const high = percentile(strengths, .92); const span = Math.max(500, high - low);
  return buildObservedGrid(scalarPoints.map((point) => ({ ...point, value: (point.value - low) / span })), "orbital", stepDeg, supportRadiusKm, 420, 10, .1);
}

export function anomalyObservations(observations: GroundMagneticObservation[], threshold = 3) {
  return observations.filter((point) => point.anomalyZ >= threshold).sort((a, b) => b.anomalyZ - a.anomalyZ);
}
