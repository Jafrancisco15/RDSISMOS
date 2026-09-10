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
const BGS_ORIGIN = "https://wdcapi.bgs.ac.uk";

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

function resolveBgsUrl(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, BGS_ORIGIN);
    if (!url.hostname.endsWith("bgs.ac.uk")) return null;
    return url.toString();
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
    // The monthly-means endpoint may return the IAGA-style payload directly.
  }

  const expanded = [...chunks];
  for (const chunk of chunks) {
    const decoded = maybeDecodeBase64(chunk);
    if (decoded) expanded.push(decoded);
  }

  const urls = new Set<string>();
  for (const chunk of expanded) {
    const trimmed = chunk.trim();
    if (/^https?:\/\//i.test(trimmed) || /^\//.test(trimmed)) {
      const resolved = resolveBgsUrl(trimmed);
      if (resolved) urls.add(resolved);
    }
    for (const match of chunk.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      const resolved = resolveBgsUrl(match[0]);
      if (resolved) urls.add(resolved);
    }
  }

  return { chunks: expanded, urls: [...urls] };
}

function decimalYearFromIso(dateText: string, timeText?: string) {
  const year = Number(dateText.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const isoTime = timeText && /^\d{2}:\d{2}/.test(timeText) ? timeText.replace(/\|$/, "") : "00:00:00";
  const instant = Date.parse(`${dateText}T${isoTime.endsWith("Z") ? isoTime : `${isoTime}Z`}`);
  if (!Number.isFinite(instant)) return null;
  return year + (instant - start) / (end - start);
}

/**
 * BGS monthly files are a modified IAGA2002-style format. Depending on the API
 * representation, rows may be returned with decimal year first, or with ISO
 * DATE/TIME/DOY fields before XYZ. The core parser intentionally accepts the
 * compact decimal-year layout, so this adapter normalizes both layouts.
 */
function parseBgsMonthlyChunk(text: string): BgsMonthlyPoint[] {
  const direct = parseBgsMonthlyMeansText(text);
  if (direct.length >= 24) return direct;

  const normalized: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("|") || line.startsWith("%")) continue;
    const tokens = line.replace(/\|/g, " ").split(/[\s,;]+/).filter(Boolean);
    if (tokens.length < 4) continue;

    // Some BGS payloads include the decimal-year sample after DATE/TIME.
    const decimalIndex = tokens.findIndex(token => {
      const value = Number(token);
      return Number.isFinite(value) && value >= 1800 && value <= 2100;
    });
    if (decimalIndex >= 0) {
      const decimalYear = Number(tokens[decimalIndex]);
      const values: number[] = [];
      for (const token of tokens.slice(decimalIndex + 1)) {
        const value = Number(token);
        if (Number.isFinite(value)) values.push(value);
        if (values.length >= 3) break;
      }
      if (values.length >= 3 && values.every(value => Math.abs(value) < 99990)) {
        normalized.push(`${decimalYear} ${values[0]} ${values[1]} ${values[2]}`);
        continue;
      }
    }

    // Conventional IAGA-style DATE TIME DOY X Y Z rows: derive decimal year.
    const dateIndex = tokens.findIndex(token => /^\d{4}-\d{2}-\d{2}$/.test(token));
    if (dateIndex < 0) continue;
    const timeToken = /^\d{2}:\d{2}/.test(tokens[dateIndex + 1] ?? "") ? tokens[dateIndex + 1] : undefined;
    const decimalYear = decimalYearFromIso(tokens[dateIndex], timeToken);
    if (decimalYear === null) continue;

    const start = dateIndex + (timeToken ? 2 : 1);
    const numericTail = tokens.slice(start).map(Number).filter(Number.isFinite);
    if (numericTail.length >= 4 && numericTail[0] >= 1 && numericTail[0] <= 366) numericTail.shift();
    if (numericTail.length < 3) continue;
    const [x, y, z] = numericTail;
    if ([x, y, z].some(value => Math.abs(value) >= 99990)) continue;
    normalized.push(`${decimalYear.toFixed(6)} ${x} ${y} ${z}`);
  }

  return parseBgsMonthlyMeansText(normalized.join("\n"));
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
    headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.5", "User-Agent": "RDSISMOS/1.0" },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 24 * 3600 },
  });
  if (!response.ok) throw new Error(`${code.toUpperCase()}: BGS HTTP ${response.status}`);

  const raw = await response.text();
  const { chunks, urls } = parsePayloadText(raw);
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
        points.push(...parseBgsMonthlyChunk(await nested.text()));
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
    experimentVersion: "core-seismic-v0.3",
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
      significance: "A positive out-of-sample score without corrected p < 0.05 is reported as no robust evidence, not as a positive finding.",
      causalClaim: false,
      predictionClaim: false,
    },
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
