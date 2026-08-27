import { analyzeMagneticLocality, type KpSample, type MagneticSample, type MagneticStationSeries } from "@/lib/geomagnetism";
import {
  geomagneticForecastWindow,
  MONITORED_MAGNETIC_STATIONS,
  shouldEmitGeomagneticProjection,
} from "@/lib/geomagneticProjection";
import { getGeomagneticModelState, insertGeomagneticTrial } from "@/lib/geomagneticLearningStore";

const HAPI_BASE = "https://imag-data.bgs.ac.uk/GIN_V1/hapi";
const DAY_MS = 86_400_000;

type HapiInfo = { parameters?: Array<{ name?: string }> };
type HapiData = { data?: unknown[][] };
type KpPayload = { datetime?: unknown[]; Kp?: unknown[]; kp?: unknown[]; time?: unknown[]; values?: unknown[] };

function numeric(value: unknown) { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function usableField(value: number | null) { return value !== null && Math.abs(value) < 90_000; }

async function fetchSeries(code: string, start: Date, end: Date, signal?: AbortSignal): Promise<MagneticStationSeries> {
  const lower = code.toLowerCase();
  const candidates = [
    `${lower}/best-avail/PT1M/xyzf`, `${lower}/quasi-def/PT1M/xyzf`,
    `${lower}/adjusted/PT1M/xyzf`, `${lower}/definitive/PT1M/xyzf`,
  ];
  const errors: string[] = [];
  for (const datasetId of candidates) {
    try {
      const infoResponse = await fetch(`${HAPI_BASE}/info?id=${encodeURIComponent(datasetId)}`, {
        signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
      });
      if (!infoResponse.ok) { errors.push(`${datasetId}: info ${infoResponse.status}`); continue; }
      const info = await infoResponse.json() as HapiInfo;
      const names = (info.parameters ?? []).map((parameter) => String(parameter.name ?? "").toUpperCase());
      const timeIndex = Math.max(0, names.findIndex((name) => name === "TIME"));
      const xIndex = names.findIndex((name) => name === "X"); const yIndex = names.findIndex((name) => name === "Y"); const zIndex = names.findIndex((name) => name === "Z");
      const fIndex = names.findIndex((name) => name === "F" || name === "S");
      if (xIndex < 0 || yIndex < 0 || zIndex < 0) continue;
      const params = new URLSearchParams({ id: datasetId, "time.min": start.toISOString(), "time.max": end.toISOString(), format: "json" });
      const response = await fetch(`${HAPI_BASE}/data?${params}`, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
      if (!response.ok) { errors.push(`${datasetId}: data ${response.status}`); continue; }
      const payload = await response.json() as HapiData;
      const samples: MagneticSample[] = [];
      for (const row of payload.data ?? []) {
        if (!Array.isArray(row)) continue;
        const timeUtc = String(row[timeIndex] ?? ""); const x = numeric(row[xIndex]); const y = numeric(row[yIndex]); const z = numeric(row[zIndex]); const f = fIndex >= 0 ? numeric(row[fIndex]) : null;
        if (!timeUtc || Number.isNaN(Date.parse(timeUtc)) || !usableField(x) || !usableField(y) || !usableField(z)) continue;
        samples.push({ timeUtc, x: x!, y: y!, z: z!, f: usableField(f) ? f : null });
      }
      if (samples.length >= 120) return { code, datasetId, samples };
    } catch (error) { errors.push(error instanceof Error ? error.message : "error"); }
  }
  throw new Error(`${code}: sin serie reciente suficiente. ${errors.slice(0, 2).join("; ")}`);
}

async function fetchKp(start: Date, end: Date, signal?: AbortSignal): Promise<KpSample[]> {
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), index: "Kp" });
    const response = await fetch(`https://kp.gfz.de/app/json/?${params}`, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
    if (!response.ok) return [];
    const payload = await response.json() as KpPayload;
    const times = Array.isArray(payload.datetime) ? payload.datetime : Array.isArray(payload.time) ? payload.time : [];
    const values = Array.isArray(payload.Kp) ? payload.Kp : Array.isArray(payload.kp) ? payload.kp : Array.isArray(payload.values) ? payload.values : [];
    return times.map((time, index) => ({ timeUtc: String(time), value: numeric(values[index]) ?? NaN })).filter((row) => Number.isFinite(row.value) && !Number.isNaN(Date.parse(row.timeUtc)));
  } catch { return []; }
}

function sixHourBucket(date: Date) {
  const hour = Math.floor(date.getUTCHours() / 6) * 6;
  return `${date.toISOString().slice(0, 10).replaceAll("-", "") }T${String(hour).padStart(2, "0")}`;
}

export async function runAutomaticGeomagneticGeneration(options: { targetLimit?: number; lookbackHours?: number; signal?: AbortSignal } = {}) {
  const now = new Date();
  const lookbackHours = Math.max(6, Math.min(48, options.lookbackHours ?? 24));
  const start = new Date(now.getTime() - lookbackHours * 3_600_000);
  const model = await getGeomagneticModelState();
  const targetLimit = Math.max(1, Math.min(MONITORED_MAGNETIC_STATIONS.length, options.targetLimit ?? 2));
  const rotation = Math.floor(now.getTime() / (6 * 3_600_000)) % MONITORED_MAGNETIC_STATIONS.length;
  const targets = Array.from({ length: targetLimit }, (_, index) => MONITORED_MAGNETIC_STATIONS[(rotation + index) % MONITORED_MAGNETIC_STATIONS.length]);
  const kp = await fetchKp(start, now, options.signal);
  const generated: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (const station of targets) {
    try {
      const settled = await Promise.allSettled([
        fetchSeries(station.code, start, now, options.signal),
        ...station.references.map((code) => fetchSeries(code, start, now, options.signal)),
      ]);
      const target = settled[0];
      if (target.status !== "fulfilled") throw target.reason;
      const references = settled.slice(1).filter((result): result is PromiseFulfilledResult<MagneticStationSeries> => result.status === "fulfilled").map((result) => result.value);
      if (references.length < 2) throw new Error(`Solo ${references.length} referencias con datos; se requieren al menos 2.`);
      const metrics = analyzeMagneticLocality(target.value, references, kp);
      const emitted = shouldEmitGeomagneticProjection(metrics.localityScore, metrics.referenceCount, model.emissionThreshold);
      const window = geomagneticForecastWindow(now, model.windowHours);
      const id = `${model.id}:${station.code}:${sixHourBucket(now)}`;
      const persisted = await insertGeomagneticTrial({
        id, modelVersion: model.version, stationCode: station.code, stationName: station.name,
        latitude: station.latitude, longitude: station.longitude, issuedAt: now.toISOString(),
        surveillanceStart: window.start, surveillanceEnd: window.end, radiusKm: model.radiusKm,
        magnitudeMin: model.magnitudeMin, localityScore: metrics.localityScore,
        thresholdSnapshot: model.emissionThreshold, emitted, referenceCodes: references.map((series) => series.code), metrics,
      });
      generated.push({ id, station: station.code, localityScore: metrics.localityScore, emitted, inserted: persisted.inserted, references: references.map((series) => series.code) });
    } catch (error) {
      warnings.push(`${station.code}: ${error instanceof Error ? error.message : "falló el análisis automático"}`);
    }
  }
  return { generatedAt: now.toISOString(), model, generated, warnings };
}
