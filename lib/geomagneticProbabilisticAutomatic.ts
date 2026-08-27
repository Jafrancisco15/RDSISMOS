import { countEarthquakes, queryEarthquakes } from "@/lib/earthquakes/usgs";
import type { KpSample } from "@/lib/geomagnetism";
import {
  buildProbabilisticGeomagFeatures,
  combineEtasWithGeomagnetism,
  estimateRegionalEtasBaseline,
  PRIMARY_GEOMAGNETIC_EXPERIMENT,
  type DstSample,
} from "@/lib/geomagneticProbabilistic";
import {
  getProbabilisticGeomagModel,
  insertProbabilisticGeomagForecast,
  probabilisticForecastExists,
} from "@/lib/geomagneticProbabilisticStore";
import { fetchUsgsGeomagHourlySeries, fetchUsgsGeomagSeries } from "@/lib/usgsGeomag";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

type KpPayload = { datetime?: unknown[]; Kp?: unknown[]; kp?: unknown[]; time?: unknown[]; values?: unknown[] };
type UsgsIndexPayload = { times?: unknown[]; values?: Array<{ id?: string; values?: unknown[]; metadata?: Record<string, unknown> }> };

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchKp(start: Date, end: Date, signal?: AbortSignal): Promise<KpSample[]> {
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), index: "Kp" });
    const response = await fetch(`https://kp.gfz.de/app/json/?${params}`, {
      signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) return [];
    const text = await response.text();
    const payload = JSON.parse(text) as KpPayload;
    const times = Array.isArray(payload.datetime) ? payload.datetime : Array.isArray(payload.time) ? payload.time : [];
    const values = Array.isArray(payload.Kp) ? payload.Kp : Array.isArray(payload.kp) ? payload.kp : Array.isArray(payload.values) ? payload.values : [];
    return times.map((time, index) => ({ timeUtc: String(time), value: numeric(values[index]) ?? NaN }))
      .filter((row) => Number.isFinite(row.value) && !Number.isNaN(Date.parse(row.timeUtc)));
  } catch {
    return [];
  }
}

async function fetchDst(start: Date, end: Date, signal?: AbortSignal): Promise<DstSample[]> {
  try {
    const params = new URLSearchParams({
      id: "USGS",
      elements: "DST",
      sampling_period: "3600",
      format: "json",
      starttime: start.toISOString(),
      endtime: end.toISOString(),
    });
    const response = await fetch(`https://geomag.usgs.gov/ws/data/?${params}`, {
      signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) return [];
    const payload = await response.json() as UsgsIndexPayload;
    const stream = (payload.values ?? []).find((value) => String(value.id ?? value.metadata?.element ?? "").toUpperCase().includes("DST")) ?? payload.values?.[0];
    const times = Array.isArray(payload.times) ? payload.times : [];
    return times.map((time, index) => ({ timeUtc: String(time), value: numeric(stream?.values?.[index]) ?? NaN }))
      .filter((row) => Number.isFinite(row.value) && !Number.isNaN(Date.parse(row.timeUtc)));
  } catch {
    return [];
  }
}

function dailyForecastId(date: Date) {
  return `${PRIMARY_GEOMAGNETIC_EXPERIMENT.id}:${date.toISOString().slice(0, 10)}`;
}

export async function runProbabilisticGeomagGeneration(options: { signal?: AbortSignal } = {}) {
  const experiment = PRIMARY_GEOMAGNETIC_EXPERIMENT;
  const issuedAt = new Date();
  const id = dailyForecastId(issuedAt);
  const model = await getProbabilisticGeomagModel();
  if (await probabilisticForecastExists(id)) {
    return { generatedAt: issuedAt.toISOString(), skipped: true, reason: "La proyección UTC de hoy ya está congelada.", id, model };
  }

  const currentStart = new Date(issuedAt.getTime() - experiment.featureLookbackHours * HOUR_MS);
  const historyStart = new Date(issuedAt.getTime() - experiment.sqBaselineDays * DAY_MS);
  const triggerStart = new Date(issuedAt.getTime() - experiment.etasTriggerDays * DAY_MS);
  const backgroundStart = new Date(issuedAt.getTime() - experiment.etasBackgroundYears * 365.25 * DAY_MS);

  const referencePromises = experiment.referenceCodes.map((code) => fetchUsgsGeomagSeries(code, currentStart, issuedAt, options.signal));
  const [target, history27dHourly, kp, dst, backgroundCount, triggerPage, referenceSettled] = await Promise.all([
    fetchUsgsGeomagSeries(experiment.stationCode, currentStart, issuedAt, options.signal),
    fetchUsgsGeomagHourlySeries(experiment.stationCode, historyStart, issuedAt, options.signal),
    fetchKp(currentStart, issuedAt, options.signal),
    fetchDst(currentStart, issuedAt, options.signal),
    countEarthquakes({
      startTime: backgroundStart.toISOString(), endTime: issuedAt.toISOString(), minMagnitude: experiment.magnitudeMin,
      latitude: experiment.latitude, longitude: experiment.longitude, maxRadiusKm: experiment.radiusKm,
      limit: 1, offset: 1,
    }, options.signal),
    queryEarthquakes({
      startTime: triggerStart.toISOString(), endTime: issuedAt.toISOString(), minMagnitude: 3,
      latitude: experiment.latitude, longitude: experiment.longitude, maxRadiusKm: 1_000,
      limit: 2_000, offset: 1, orderBy: "time-asc",
    }, options.signal),
    Promise.allSettled(referencePromises),
  ]);

  const references = referenceSettled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchUsgsGeomagSeries>>> => result.status === "fulfilled")
    .map((result) => result.value);
  if (references.length < 2) throw new Error(`Solo ${references.length} referencias geomagnéticas USGS disponibles; se requieren al menos 2.`);

  const features = buildProbabilisticGeomagFeatures({
    target,
    references,
    history27dHourly,
    longitude: experiment.longitude,
    kp,
    dst,
  });
  const backgroundDays = Math.max(1, (issuedAt.getTime() - backgroundStart.getTime()) / DAY_MS);
  const baseline = estimateRegionalEtasBaseline({
    backgroundCount,
    backgroundDays,
    triggerEvents: triggerPage.events,
    issuedAt,
    latitude: experiment.latitude,
    longitude: experiment.longitude,
    radiusKm: experiment.radiusKm,
    horizonDays: experiment.horizonDays,
    magnitudeMin: experiment.magnitudeMin,
    completenessMagnitude: 3,
  });
  const combined = combineEtasWithGeomagnetism(baseline.probability, features.vector, model.weights);
  const windowStart = issuedAt.toISOString();
  const windowEnd = new Date(issuedAt.getTime() + experiment.horizonDays * DAY_MS).toISOString();
  const persisted = await insertProbabilisticGeomagForecast({
    id,
    model,
    issuedAt: issuedAt.toISOString(),
    windowStart,
    windowEnd,
    baselineProbability: baseline.probability,
    combinedProbability: combined.probability,
    baselineExpectedCount: baseline.expectedCount,
    geomagLogOddsDelta: combined.deltaLogOdds,
    features,
    diagnostics: {
      experiment,
      etas: baseline,
      triggerCatalogCount: triggerPage.events.length,
      backgroundCatalogCount: backgroundCount,
      referenceCodes: references.map((reference) => reference.code),
      geomagneticSource: "USGS Geomagnetism Data Web Service",
      seismicSource: "USGS ComCat",
      kpSource: "GFZ Kp",
      dstSource: "USGS geomagnetism DST index",
      spectralBandHz: [0.001, 0.008],
      spectralLimitation: "Con muestreo de 60 s Nyquist ≈ 0.00833 Hz; no se representa 0.008–0.1 Hz.",
      causalHistory: `${experiment.sqBaselineDays} días anteriores a la emisión, muestreados cada hora para plantilla Sq/tendencia.`,
    },
  });

  return {
    generatedAt: issuedAt.toISOString(), id, skipped: false, persisted,
    experiment, modelVersion: model.version,
    baselineProbability: baseline.probability,
    combinedProbability: combined.probability,
    deltaProbabilityPoints: combined.deltaProbabilityPoints,
    geomagLogOddsDelta: combined.deltaLogOdds,
    features,
    references: references.map((reference) => reference.code),
    windowStart, windowEnd,
  };
}
