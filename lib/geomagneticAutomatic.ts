import { analyzeMagneticLocality, type KpSample, type MagneticStationSeries } from "@/lib/geomagnetism";
import {
  geomagneticForecastWindow,
  MONITORED_MAGNETIC_STATIONS,
  shouldEmitGeomagneticProjection,
} from "@/lib/geomagneticProjection";
import { getGeomagneticModelState, insertGeomagneticTrial } from "@/lib/geomagneticLearningStore";
import { fetchUsgsGeomagSeries } from "@/lib/usgsGeomag";

type KpPayload = { datetime?: unknown[]; Kp?: unknown[]; kp?: unknown[]; time?: unknown[]; values?: unknown[] };

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchKp(start: Date, end: Date, signal?: AbortSignal): Promise<KpSample[]> {
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), index: "Kp" });
    const response = await fetch(`https://kp.gfz.de/app/json/?${params}`, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) return [];
    const text = await response.text();
    const payload = JSON.parse(text) as KpPayload;
    const times = Array.isArray(payload.datetime) ? payload.datetime : Array.isArray(payload.time) ? payload.time : [];
    const values = Array.isArray(payload.Kp) ? payload.Kp : Array.isArray(payload.kp) ? payload.kp : Array.isArray(payload.values) ? payload.values : [];
    return times
      .map((time, index) => ({ timeUtc: String(time), value: numeric(values[index]) ?? NaN }))
      .filter((row) => Number.isFinite(row.value) && !Number.isNaN(Date.parse(row.timeUtc)));
  } catch {
    return [];
  }
}

function threeHourBucket(date: Date) {
  const hour = Math.floor(date.getUTCHours() / 3) * 3;
  return `${date.toISOString().slice(0, 10).replaceAll("-", "")}T${String(hour).padStart(2, "0")}`;
}

export async function runAutomaticGeomagneticGeneration(options: { targetLimit?: number; lookbackHours?: number; signal?: AbortSignal } = {}) {
  const now = new Date();
  const lookbackHours = Math.max(6, Math.min(48, options.lookbackHours ?? 24));
  const start = new Date(now.getTime() - lookbackHours * 3_600_000);
  const model = await getGeomagneticModelState();
  const targetLimit = Math.max(1, Math.min(MONITORED_MAGNETIC_STATIONS.length, options.targetLimit ?? 2));
  const rotation = Math.floor(now.getTime() / (3 * 3_600_000)) % MONITORED_MAGNETIC_STATIONS.length;
  const targets = Array.from({ length: targetLimit }, (_, index) => MONITORED_MAGNETIC_STATIONS[(rotation + index) % MONITORED_MAGNETIC_STATIONS.length]);
  const kp = await fetchKp(start, now, options.signal);
  const generated: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (const station of targets) {
    try {
      const settled = await Promise.allSettled([
        fetchUsgsGeomagSeries(station.code, start, now, options.signal),
        ...station.references.map((code) => fetchUsgsGeomagSeries(code, start, now, options.signal)),
      ]);
      const target = settled[0];
      if (target.status !== "fulfilled") throw target.reason;
      const references = settled
        .slice(1)
        .filter((result): result is PromiseFulfilledResult<MagneticStationSeries> => result.status === "fulfilled")
        .map((result) => result.value);
      if (references.length < 2) throw new Error(`Solo ${references.length} referencias USGS con datos; se requieren al menos 2.`);

      const metrics = analyzeMagneticLocality(target.value, references, kp);
      const emitted = shouldEmitGeomagneticProjection(metrics.localityScore, metrics.referenceCount, model.emissionThreshold);
      const window = geomagneticForecastWindow(now, model.windowHours);
      const id = `${model.id}:${station.code}:${threeHourBucket(now)}`;
      const persisted = await insertGeomagneticTrial({
        id,
        modelVersion: model.version,
        stationCode: station.code,
        stationName: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        issuedAt: now.toISOString(),
        surveillanceStart: window.start,
        surveillanceEnd: window.end,
        radiusKm: model.radiusKm,
        magnitudeMin: model.magnitudeMin,
        localityScore: metrics.localityScore,
        thresholdSnapshot: model.emissionThreshold,
        emitted,
        referenceCodes: references.map((series) => series.code),
        metrics,
      });
      generated.push({
        id,
        station: station.code,
        localityScore: metrics.localityScore,
        emitted,
        inserted: persisted.inserted,
        references: references.map((series) => series.code),
        source: "USGS Geomagnetism",
      });
    } catch (error) {
      warnings.push(`${station.code}: ${error instanceof Error ? error.message : "falló el análisis automático"}`);
    }
  }
  return { generatedAt: now.toISOString(), model, generated, warnings, source: "USGS Geomagnetism Data Web Service" };
}
