import type { EarthquakeEvent } from "./earthquakes/types";
import type { MantleTomographyCell } from "./mantleTomography";
import type { SeismicMechanism } from "./seismicMechanisms";

const DAY_MS = 86_400_000;

export interface TectonicStateDepthBand {
  id: "crust" | "upper-mantle" | "deep" | "all";
  label: string;
  minKm: number;
  maxKm: number;
}

export const TECTONIC_STATE_DEPTH_BANDS: TectonicStateDepthBand[] = [
  { id: "crust", label: "0–70 km", minKm: 0, maxKm: 70 },
  { id: "upper-mantle", label: "70–300 km", minKm: 70, maxKm: 300 },
  { id: "deep", label: "300–700 km", minKm: 300, maxKm: 700 },
  { id: "all", label: "0–700 km", minKm: 0, maxKm: 700 },
];

export interface TectonicStateCell {
  id: string;
  latitude: number;
  longitude: number;
  sizeDeg: number;
  earlyCount: number;
  recentCount: number;
  totalCount: number;
  earlyMomentNm: number;
  recentMomentNm: number;
  momentChangeLog10: number;
  activityChange: number;
  signedChange: number;
  changeStrength01: number;
  mechanismCount: number;
  tomographyDvsPct: number | null;
  supportScore: number;
  supportLabel: "low" | "medium" | "high";
  maxMagnitude: number;
  meanDepthKm: number;
}

export interface TectonicStateSummary {
  eventCount: number;
  earlyEvents: number;
  recentEvents: number;
  mechanismCount: number;
  tomographyCells: number;
  activeCells: number;
  wellSupportedCells: number;
  splitTimeUtc: string;
  coverageScore: number;
  coverageLabel: "low" | "medium" | "high";
  strongestChanges: TectonicStateCell[];
}

export interface TectonicStateResult {
  cells: TectonicStateCell[];
  summary: TectonicStateSummary;
}

export interface TectonicStateOptions {
  startTime: Date;
  endTime: Date;
  depthBand: TectonicStateDepthBand;
  gridSizeDeg?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function scalarMomentFromMagnitude(magnitude: number) {
  return 10 ** (1.5 * magnitude + 9.1);
}

function cellCenter(value: number, size: number, minimum: number) {
  return minimum + (Math.floor((value - minimum) / size) + 0.5) * size;
}

function cellKey(latitude: number, longitude: number, size: number) {
  const lat = clamp(cellCenter(latitude, size, -90), -90 + size / 2, 90 - size / 2);
  const lon = normalizeLongitude(cellCenter(normalizeLongitude(longitude), size, -180));
  return { key: `${lat.toFixed(2)}:${lon.toFixed(2)}`, latitude: lat, longitude: lon };
}

function relativeChange(recent: number, early: number) {
  return (recent - early) / Math.max(1, recent + early);
}

function logMomentChange(recent: number, early: number) {
  if (!(recent > 0) && !(early > 0)) return 0;
  const floor = 1e13;
  return clamp(Math.log10((recent + floor) / (early + floor)), -3, 3);
}

function nearestTomography(latitude: number, longitude: number, cells: MantleTomographyCell[]) {
  let best: MantleTomographyCell | null = null;
  let bestD2 = Infinity;
  for (const cell of cells) {
    const dLat = cell.latitude - latitude;
    const dLonRaw = Math.abs(cell.longitude - longitude);
    const dLon = Math.min(dLonRaw, 360 - dLonRaw) * Math.cos(latitude * Math.PI / 180);
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestD2) { bestD2 = d2; best = cell; }
  }
  return bestD2 <= 12 * 12 ? best?.dvsPct ?? null : null;
}

function coverageScore(totalEvents: number, mechanisms: number, tomographyCells: number, supportedCells: number, activeCells: number) {
  const catalog = clamp(Math.log10(1 + totalEvents) / 3.3, 0, 1);
  const mechanism = clamp(mechanisms / 24, 0, 1);
  const tomography = tomographyCells > 100 ? 1 : clamp(tomographyCells / 100, 0, 1);
  const localSupport = activeCells > 0 ? clamp(supportedCells / activeCells, 0, 1) : 0;
  return Math.round(100 * (0.34 * catalog + 0.26 * mechanism + 0.18 * tomography + 0.22 * localSupport));
}

export function reconstructTectonicState4D(
  events: EarthquakeEvent[],
  mechanisms: SeismicMechanism[],
  tomography: MantleTomographyCell[],
  options: TectonicStateOptions,
): TectonicStateResult {
  const gridSizeDeg = clamp(options.gridSizeDeg ?? 8, 3, 20);
  const startMs = options.startTime.getTime();
  const endMs = options.endTime.getTime();
  const splitMs = startMs + (endMs - startMs) / 2;
  const usableEvents = events.filter((event) => {
    const time = Date.parse(event.timeUtc);
    return Number.isFinite(time)
      && time >= startMs && time <= endMs
      && event.depthKm >= options.depthBand.minKm
      && event.depthKm <= options.depthBand.maxKm;
  });
  const usableMechanisms = mechanisms.filter((mechanism) => {
    const time = Date.parse(mechanism.timeUtc);
    return Number.isFinite(time)
      && time >= startMs && time <= endMs
      && mechanism.depthKm >= options.depthBand.minKm
      && mechanism.depthKm <= options.depthBand.maxKm;
  });

  type MutableCell = {
    latitude: number; longitude: number; early: EarthquakeEvent[]; recent: EarthquakeEvent[]; mechanisms: number;
  };
  const grouped = new Map<string, MutableCell>();
  for (const event of usableEvents) {
    const cell = cellKey(event.latitude, event.longitude, gridSizeDeg);
    let bucket = grouped.get(cell.key);
    if (!bucket) {
      bucket = { latitude: cell.latitude, longitude: cell.longitude, early: [], recent: [], mechanisms: 0 };
      grouped.set(cell.key, bucket);
    }
    (Date.parse(event.timeUtc) < splitMs ? bucket.early : bucket.recent).push(event);
  }
  for (const mechanism of usableMechanisms) {
    const cell = cellKey(mechanism.latitude, mechanism.longitude, gridSizeDeg);
    const bucket = grouped.get(cell.key);
    if (bucket) bucket.mechanisms += 1;
  }

  const cells: TectonicStateCell[] = [];
  for (const [id, bucket] of grouped) {
    const earlyMomentNm = bucket.early.reduce((sum, event) => sum + scalarMomentFromMagnitude(event.magnitude), 0);
    const recentMomentNm = bucket.recent.reduce((sum, event) => sum + scalarMomentFromMagnitude(event.magnitude), 0);
    const activityChange = relativeChange(bucket.recent.length, bucket.early.length);
    const momentChangeLog10 = logMomentChange(recentMomentNm, earlyMomentNm);
    const momentSigned = clamp(momentChangeLog10 / 2, -1, 1);
    const signedChange = clamp(0.62 * momentSigned + 0.38 * activityChange, -1, 1);
    const totalEvents = [...bucket.early, ...bucket.recent];
    const tomographyDvsPct = nearestTomography(bucket.latitude, bucket.longitude, tomography);
    const independentKinds = (totalEvents.length > 0 ? 1 : 0) + (bucket.mechanisms > 0 ? 1 : 0) + (tomographyDvsPct !== null ? 1 : 0);
    const density = clamp(Math.log10(1 + totalEvents.length) / 1.7, 0, 1);
    const supportScore = Math.round(100 * (0.48 * density + 0.22 * Math.min(1, bucket.mechanisms / 3) + 0.30 * independentKinds / 3));
    const supportLabel = supportScore >= 67 ? "high" : supportScore >= 38 ? "medium" : "low";
    const maxMagnitude = totalEvents.length ? Math.max(...totalEvents.map((event) => event.magnitude)) : 0;
    const meanDepthKm = totalEvents.length ? totalEvents.reduce((sum, event) => sum + event.depthKm, 0) / totalEvents.length : 0;
    cells.push({
      id, latitude: bucket.latitude, longitude: bucket.longitude, sizeDeg: gridSizeDeg,
      earlyCount: bucket.early.length, recentCount: bucket.recent.length, totalCount: totalEvents.length,
      earlyMomentNm, recentMomentNm, momentChangeLog10, activityChange, signedChange,
      changeStrength01: Math.abs(signedChange), mechanismCount: bucket.mechanisms,
      tomographyDvsPct, supportScore, supportLabel, maxMagnitude, meanDepthKm,
    });
  }

  cells.sort((a, b) => b.changeStrength01 * b.supportScore - a.changeStrength01 * a.supportScore);
  const wellSupportedCells = cells.filter((cell) => cell.supportScore >= 50).length;
  const score = coverageScore(usableEvents.length, usableMechanisms.length, tomography.length, wellSupportedCells, cells.length);
  const coverageLabel = score >= 70 ? "high" : score >= 42 ? "medium" : "low";
  const earlyEvents = usableEvents.filter((event) => Date.parse(event.timeUtc) < splitMs).length;

  return {
    cells,
    summary: {
      eventCount: usableEvents.length,
      earlyEvents,
      recentEvents: usableEvents.length - earlyEvents,
      mechanismCount: usableMechanisms.length,
      tomographyCells: tomography.length,
      activeCells: cells.length,
      wellSupportedCells,
      splitTimeUtc: new Date(splitMs).toISOString(),
      coverageScore: score,
      coverageLabel,
      strongestChanges: cells.filter((cell) => cell.supportScore >= 25).slice(0, 8),
    },
  };
}

export function tectonicStateWindow(days: number, end = new Date()) {
  const bounded = clamp(Math.round(days), 1, 120);
  return { start: new Date(end.getTime() - bounded * DAY_MS), end };
}
