import { NextResponse } from "next/server";
import {
  GEOMAGNETIC_JERKS,
  analyzeHistoricalAssociation,
  buildAnnualCoreSeismic,
  combineStationSecularAcceleration,
  deriveStationSecularAcceleration,
  parseBgsMonthlyMeansText,
  type BgsMonthlyPoint,
  type SeismicEventPoint,
} from "@/lib/coreSeismicMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USGS_EVENT_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const BGS_MONTHLY_URL = "https://wdcapi.bgs.ac.uk/monthly-means";

const BGS_STATIONS = [
  { code: "esk", name: "Eskdalemuir" },
  { code: "clf", name: "Chambon-la-Forêt" },
  { code: "ngk", name: "Niemegk" },
  { code: "kak", name: "Kakioka" },
  { code: "hon", name: "Honolulu" },
  { code: "sjg", name: "San Juan" },
  { code: "tuc", name: "Tucson" },
  { code: "her", name: "Hermanus" },
  { code: "sit", name: "Sitka" },
  { code: "api", name: "Apia" },
] as const;

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, output);
  }
  return output;
}

function maybeDecodeBase64(value: string) {
  if (value.length < 300 || value.includes(" ") || !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.includes("\n") ? decoded : null;
  } catch {
    return null;
  }
}

function parsePayloadText(raw: string): { chunks: string[]; urls: string[] } {
  let chunks = [raw];
  try {
    const parsed = JSON.parse(raw) as unknown;
    chunks = collectStrings(parsed);
  } catch {
    // Some WDC endpoints can return plain text; keep the raw response in that case.
  }
  const expanded = [...chunks];
  for (const chunk of chunks) {
    const decoded = maybeDecodeBase64(chunk);
    if (decoded) expanded.push(decoded);
  }
  const urls = expanded.filter(value => /^https?:\/\//i.test(value));
  return { chunks: expanded, urls };
}

function dedupeMonthly(points: BgsMonthlyPoint[]) {
  const seen = new Set<string>();
  return points
    .sort((a, b) => a.decimalYear - b.decimalYear)
    .filter(point => {
      const key = point.decimalYear.toFixed(4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadBgsStation(code: string) {
  const response = await fetch(`${BGS_MONTHLY_URL}?obs_code=${encodeURIComponent(code)}`, {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 24 * 3600 },
  });
  if (!response.ok) throw new Error(`${code.toUpperCase()}: BGS HTTP ${response.status}`);
  const raw = await response.text();
  const { chunks, urls } = parsePayloadText(raw);
  let points = chunks.flatMap(parseBgsMonthlyMeansText);

  if (points.length < 24) {
    for (const candidate of urls.slice(0, 3)) {
      try {
        const url = new URL(candidate);
        if (!url.hostname.endsWith("bgs.ac.uk")) continue;
        const nested = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
          next: { revalidate: 24 * 3600 },
        });
        if (!nested.ok) continue;
        points.push(...parseBgsMonthlyMeansText(await nested.text()));
      } catch {
        // Keep trying other candidate files.
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
    }))
    .filter(item => item.secularAcceleration.length >= 3);

  const series = combineStationSecularAcceleration(usable.map(item => item.secularAcceleration), 2);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => String(result.reason));

  return {
    series,
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
    features?: Array<{ properties?: { mag?: number | null; time?: number | null; type?: string | null } }>;
  };
  let latest: number | null = null;
  const events: SeismicEventPoint[] = [];
  for (const feature of body.features ?? []) {
    const p = feature.properties ?? {};
    const magnitude = Number(p.mag), time = Number(p.time);
    if (!Number.isFinite(magnitude) || !Number.isFinite(time) || magnitude < 7) continue;
    if (p.type && p.type !== "earthquake") continue;
    events.push({ year: new Date(time).getUTCFullYear(), magnitude });
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

  const sa = saResult.status === "fulfilled" ? saResult.value : { series: [], stations: [], failures: [String(saResult.reason)] };
  if (!sa.series.length) warnings.push("Aceleración secular BGS no disponible en esta ejecución; no se sustituye con aceleración del polo ni con IGRF derivado.");
  if (sa.failures.length) warnings.push(`${sa.failures.length} observatorio(s) BGS no aportaron una serie utilizable.`);

  const annual = buildAnnualCoreSeismic(seismicResult.value.events, sa.series, 1904, currentYear);
  const latestSaYear = sa.series.at(-1)?.year ?? null;
  const firstSaYear = sa.series[0]?.year ?? null;
  const saThrough = latestSaYear === null ? null : Math.min(lastCompletedYear, latestSaYear);
  const jerkThrough = lastCompletedYear;

  const analyses = [
    saThrough === null ? null : analyzeHistoricalAssociation(annual, "secularAccelerationNtYr2", saThrough),
    analyzeHistoricalAssociation(annual, "jerkIntensity", jerkThrough),
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const historicalM7Events = seismicResult.value.events.filter(event => event.year <= lastCompletedYear).length;
  const currentYearM7Observed = annual.find(row => row.year === currentYear)?.countM7 ?? 0;
  const latestSaStationCount = latestSaYear === null ? 0 : sa.series.find(point => point.year === latestSaYear)?.stationCount ?? 0;

  return NextResponse.json({
    generatedAtUtc: now.toISOString(),
    experimentVersion: "core-seismic-v0.2",
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
    analyses,
    jerkEpochs: GEOMAGNETIC_JERKS,
    stations: sa.stations,
    sources: {
      secularAcceleration: {
        name: "British Geological Survey · WDC geomagnetic observatory monthly means",
        url: "https://wdc.bgs.ac.uk/monthlymeans/",
        service: BGS_MONTHLY_URL,
        method: "Monthly X/Y/Z → annual component means → second finite difference; yearly network value = median |d²B/dt²| across available long-record observatories.",
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
      causalClaim: false,
      predictionClaim: false,
    },
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
