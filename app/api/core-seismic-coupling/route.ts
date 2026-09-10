import { decodeBgsPayload, parsePayloadText, parseBgsMonthlyChunk, dedupeMonthly } from "@/lib/bgsMonthly";
import poleHistory from "@/lib/data/northMagneticPole.json";
import { NextResponse } from "next/server";
import {
  GEOMAGNETIC_JERKS,
  analyzeHistoricalAssociation,
  buildAnnualCoreSeismic,
  combineStationSecularAcceleration,
  deriveStationSecularAcceleration,
  type BgsMonthlyPoint,
  type SeismicEventPoint,
} from "@/lib/coreSeismicMonitor";
import {
  buildRelativeCoreSeismicStudy,
  combineMonthlyStationSecularAcceleration,
  deriveMonthlyStationSecularAcceleration,
} from "@/lib/coreSeismicRelative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USGS_EVENT_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const BGS_MONTHLY_URL = "https://wdcapi.bgs.ac.uk/monthly-means";

// Long-record observatories highlighted in the BGS monthly-means database paper,
// plus several geographically complementary long-running stations.
const BGS_STATIONS = [
  { code: "esk", name: "Eskdalemuir" },
  { code: "sit", name: "Sitka" },
  { code: "hon", name: "Honolulu" },
  { code: "tuc", name: "Tucson" },
  { code: "sod", name: "Sodankylä" },
  { code: "kak", name: "Kakioka" },
  { code: "abg", name: "Alibag" },
  { code: "sjg", name: "San Juan" },
  { code: "her", name: "Hermanus" },
  { code: "gdh", name: "Qeqertarsuaq / Godhavn" },
] as const;

async function loadBgsStation(code: string) {
  const response = await fetch(`${BGS_MONTHLY_URL}?obs_code=${encodeURIComponent(code)}`, {
    headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.5", "User-Agent": "RDSISMOS/1.0" },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 24 * 3600 },
  });
  if (!response.ok) throw new Error(`${code.toUpperCase()}: BGS HTTP ${response.status}`);

  const payloads = decodeBgsPayload(new Uint8Array(await response.arrayBuffer())).map(parsePayloadText);
  const chunks = payloads.flatMap(p => p.chunks), urls = payloads.flatMap(p => p.urls);
  let points = chunks.flatMap(parseBgsMonthlyChunk);

  if (points.length < 24) {
    for (const candidate of urls.slice(0, 5)) {
      try {
        const nested = await fetch(candidate, {
          headers: { Accept: "text/plain,application/json;q=0.9,*/*;q=0.5", "User-Agent": "RDSISMOS/1.0" },
          signal: AbortSignal.timeout(10_000),
          next: { revalidate: 24 * 3600 },
        });
        if (!nested.ok) continue;
        points.push(...decodeBgsPayload(new Uint8Array(await nested.arrayBuffer())).flatMap(parseBgsMonthlyChunk));
      } catch {
        // Keep trying candidate data files returned by the BGS API.
      }
    }
  }

  points = dedupeMonthly(points);
  if (points.length < 24) throw new Error(`${code.toUpperCase()}: formato mensual no reconocido o cobertura insuficiente`);
  return points;
}

async function loadSecularAcceleration() {
  const results = await Promise.allSettled(BGS_STATIONS.map(async station => ({
    station,
    points: await loadBgsStation(station.code),
  })));
  const usable = results
    .filter((result): result is PromiseFulfilledResult<{ station: typeof BGS_STATIONS[number]; points: BgsMonthlyPoint[] }> => result.status === "fulfilled")
    .map(result => ({
      ...result.value,
      secularAcceleration: deriveStationSecularAcceleration(result.value.points),
      monthlySecularAcceleration: deriveMonthlyStationSecularAcceleration(result.value.points),
    }))
    .filter(item => item.secularAcceleration.length >= 3 || item.monthlySecularAcceleration.length >= 3);

  const series = combineStationSecularAcceleration(usable.map(item => item.secularAcceleration), 2);
  const monthly = combineMonthlyStationSecularAcceleration(usable.map(item => item.monthlySecularAcceleration), 2);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => String(result.reason));
  for (const result of results) {
    if (result.status === "fulfilled" && !usable.some(item => item.station.code === result.value.station.code)) {
      failures.push(`${result.value.station.code.toUpperCase()}: registros mensuales recibidos, pero menos de tres puntos de aceleración utilizables`);
    }
  }

  return {
    series,
    monthly,
    stations: usable.map(item => ({
      code: item.station.code.toUpperCase(),
      name: item.station.name,
      firstYear: item.secularAcceleration[0]?.year ?? null,
      lastYear: item.secularAcceleration.at(-1)?.year ?? null,
    })),
    failures,
  };
}

async function loadGlobalM7(now: Date): Promise<{ events: SeismicEventPoint[]; latestEventUtc: string | null }> {
  const tomorrow = new Date(now.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    format: "geojson",
    starttime: "1904-01-01",
    endtime: tomorrow,
    minmagnitude: "7",
    orderby: "time-asc",
    limit: "20000",
  });
  const response = await fetch(`${USGS_EVENT_URL}?${params}`, {
    signal: AbortSignal.timeout(25_000),
    next: { revalidate: 6 * 3600 },
    headers: { Accept: "application/geo+json" },
  });
  if (!response.ok) throw new Error(`USGS FDSN event service HTTP ${response.status}`);
  const body = await response.json() as {
    features?: Array<{ id?: string; geometry?: { coordinates?: number[] }; properties?: { mag?: number | null; magType?: string | null; time?: number | null; type?: string | null } }>;
  };
  let latest: number | null = null;
  const events: SeismicEventPoint[] = [];
  for (const feature of body.features ?? []) {
    const p = feature.properties ?? {};
    const magnitude = Number(p.mag), time = Number(p.time);
    if (!Number.isFinite(magnitude) || !Number.isFinite(time) || magnitude < 7) continue;
    if (p.type && p.type !== "earthquake") continue;
    const coords = feature.geometry?.coordinates;
    events.push({ id: feature.id ?? undefined, year: new Date(time).getUTCFullYear(), magnitude, magnitudeType: p.magType ?? null, timeUtc: new Date(time).toISOString(),
      ...(coords && coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Math.abs(coords[1]) <= 90 && Math.abs(coords[0]) <= 180
        ? { lon: coords[0], lat: coords[1] } : {}) });
    latest = latest === null ? time : Math.max(latest, time);
  }
  return { events, latestEventUtc: latest === null ? null : new Date(latest).toISOString() };
}

function yearExposure(now: Date) {
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  return Math.max(0, Math.min(1, (now.getTime() - start) / (end - start)));
}

export async function GET() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const lastCompletedYear = currentYear - 1;
  const warnings: string[] = [];

  const [seismicResult, saResult] = await Promise.allSettled([loadGlobalM7(now), loadSecularAcceleration()]);
  if (seismicResult.status === "rejected") {
    return NextResponse.json({ error: `No se pudo cargar el catálogo sísmico real: ${String(seismicResult.reason)}` }, { status: 502 });
  }

  const sa = saResult.status === "fulfilled" ? saResult.value : { series: [], monthly: [], stations: [], failures: [String(saResult.reason)] };
  if (!sa.series.length && !sa.monthly.length) warnings.push("Aceleración secular BGS no disponible en esta ejecución; no se sustituye con aceleración del polo ni con IGRF derivado.");
  else if (!sa.series.length && sa.monthly.length) warnings.push("La serie anual BGS no alcanzó cobertura suficiente, pero la serie mensual sí está disponible para el experimento relativo por evento.");
  if (sa.failures.length) warnings.push(`${sa.failures.length} observatorio(s) BGS no aportaron una serie utilizable.`);

  const annual = buildAnnualCoreSeismic(seismicResult.value.events, sa.series, 1904, currentYear);
  const relativeStudy = buildRelativeCoreSeismicStudy(seismicResult.value.events, sa.monthly, 5);
  const latestSaYear = sa.series.at(-1)?.year ?? null;
  const firstSaYear = sa.series[0]?.year ?? null;
  const saThrough = latestSaYear === null ? null : Math.min(lastCompletedYear, latestSaYear);
  const jerkThrough = lastCompletedYear;

  // A positive OOS likelihood delta alone is not evidence. If the corrected
  // lag search is non-significant, the public-facing verdict remains
  // "sin evidencia robusta" even when an exploratory OOS metric is positive.
  const analyses = [
    saThrough === null ? null : analyzeHistoricalAssociation(annual, "secularAccelerationNtYr2", saThrough),
    analyzeHistoricalAssociation(annual, "jerkIntensity", jerkThrough),
  ]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map(item => item.lagCorrectedP >= 0.05 ? { ...item, interpretation: "sin-evidencia-robusta" as const } : item);

  const historicalM7Events = seismicResult.value.events.filter(event => event.year <= lastCompletedYear).length;
  const currentYearM7Observed = annual.find(row => row.year === currentYear)?.countM7 ?? 0;
  const latestSaStationCount = latestSaYear === null ? 0 : sa.series.find(point => point.year === latestSaYear)?.stationCount ?? 0;

  return NextResponse.json({
    generatedAtUtc: now.toISOString(),
    experimentVersion: "core-seismic-v0.5",
    historicalStartYear: 1904,
    currentYear,
    summary: {
      historicalM7Events,
      currentYearM7Observed,
      currentYearExposure: yearExposure(now),
      latestEventUtc: seismicResult.value.latestEventUtc,
      firstSaYear,
      latestSaYear,
      latestSaStationCount,
      bgsStationsUsed: sa.stations.length,
      jerkCount: GEOMAGNETIC_JERKS.length,
    },
    annual,
    globe: { poles: poleHistory, events: seismicResult.value.events },
    diagnostics: {
      failures: sa.failures,
      saYearsAvailable: annual.filter(r => r.year <= lastCompletedYear && r.secularAccelerationNtYr2 !== null).length,
      monthlySaObservations: sa.monthly.length,
      minimumYears: 50,
      relativeStudy: {
        status: relativeStudy.status,
        eligibleEvents: relativeStudy.eligibleEvents,
        eligibleControls: relativeStudy.eligibleControls,
        independentEventClusters: relativeStudy.independentEventClusters,
      },
    },
    relativeStudy,
    analyses,
    jerkEpochs: GEOMAGNETIC_JERKS,
    stations: sa.stations,
    sources: {
      secularAcceleration: {
        name: "British Geological Survey · WDC geomagnetic observatory monthly means",
        url: "https://wdc.bgs.ac.uk/monthlymeans/",
        service: BGS_MONTHLY_URL,
        method: "Monthly X/Y/Z → annual component means → second finite difference for the secondary annual view. The primary event study retains monthly means, uses a time-aware centered second derivative, then takes a robust network median and aligns it at τ = 0 for every M7+ event.",
        units: "nT/year²",
        caveat: "Observatory ensemble, not a global spherical-harmonic SA field. Requires at least two usable stations per year; coverage is shown explicitly.",
      },
      jerks: {
        name: "Versioned literature-consensus geomagnetic jerk epochs",
        epochs: GEOMAGNETIC_JERKS,
        caveat: "Jerks are not assumed globally simultaneous. The 2024 entry remains down-weighted/provisional in this experiment.",
      },
      seismicity: {
        name: "USGS ANSS ComCat / FDSN Event",
        url: "https://earthquake.usgs.gov/fdsnws/event/1/",
        filter: "natural earthquakes, M≥7, 1904–present",
      },
    },
    warnings,
    interpretationRules: {
      positiveLag: "A positive lag means the geomagnetic change precedes the M≥7 response by that many years.",
      negativeLag: "A negative lag means the M≥7 response precedes the geomagnetic change; this is a reverse-direction falsification test.",
      relativeEventStudy: "Each M7+ earthquake is assigned τ = 0. Profiles use bins from −5 to +5 years, with deterministic coverage-matched non-event control epochs. Counts and uncertainty are clustered by calendar year to avoid treating overlapping sequences as independent.",
      historicalReplication: "The 2–5-year replication uses exact Ms labels when at least three are available; otherwise it reports M≥8 from the USGS magnitude field as a sensitivity analysis and does not equate Mw with Ms.",
      significance: "A positive out-of-sample score without corrected p < 0.05 is reported as no robust evidence, not as a positive finding.",
      causalClaim: false,
      predictionClaim: false,
    },
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
