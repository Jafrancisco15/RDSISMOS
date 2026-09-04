export interface GnssEventSource {
  id: string;
  timeUtc: string;
  latitude: number;
  longitude: number;
  magnitude: number;
  depthKm: number;
  place: string;
}

export type NglProduct = "rapid-24h" | "final-24h";

export interface NglHolding {
  code: string;
  latitude: number;
  longitude: number;
  heightM: number;
  startUtc: string;
  endUtc: string;
  solutions: number;
}

export interface NglPositionPoint {
  timeUtc: string;
  eastM: number;
  northM: number;
  upM: number;
  sigmaEastM: number;
  sigmaNorthM: number;
  sigmaUpM: number;
  latitude: number;
  longitude: number;
  heightM: number;
}

export interface Phase4GnssSeriesPoint {
  timeUtc: string;
  relativeDay: number;
  eastMm: number;
  northMm: number;
  upMm: number;
  sigmaEastMm: number;
  sigmaNorthMm: number;
  sigmaUpMm: number;
}

export interface Phase4GnssStation {
  code: string;
  latitude: number;
  longitude: number;
  heightM: number;
  distanceKm: number;
  azimuthDeg: number;
  sourceProduct: NglProduct;
  referenceFrame: "IGS20";
  preSampleCount: number;
  postSampleCount: number;
  sampleCount: number;
  eastMm: number;
  northMm: number;
  upMm: number;
  horizontalMm: number;
  vectorMm: number;
  uncertaintyEastMm: number;
  uncertaintyNorthMm: number;
  uncertaintyUpMm: number;
  vectorUncertaintyMm: number;
  qualityScore: number;
  series: Phase4GnssSeriesPoint[];
}

export interface NglGnssResult {
  provider: "Nevada Geodetic Laboratory";
  referenceFrame: "IGS20";
  product: NglProduct | null;
  available: boolean;
  generatedAt: string;
  candidateCount: number;
  stationCount: number;
  stations: Phase4GnssStation[];
  note: string;
  warnings: string[];
}

const FINAL_HOLDINGS = "https://geodesy.unr.edu/NGLStationPages/DataHoldings.txt";
const RAPID_HOLDINGS = "https://geodesy.unr.edu/NGLStationPages/DataHoldingsRapid24hr.txt";
const FINAL_BASE = "https://geodesy.unr.edu/gps_timeseries/IGS20/tenv3/IGS20";
const RAPID_BASE = "https://geodesy.unr.edu/gps_timeseries/IGS20/rapids/IGS20";
const DAY_MS = 86_400_000;

function finite(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizeLongitude(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
function mad(values: number[], center = median(values)) {
  return median(values.map((value) => Math.abs(value - center)));
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function greatCircleDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dp = (lat2 - lat1) * toRad;
  const dl = (lon2 - lon1) * toRad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function initialAzimuthDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dl = (lon2 - lon1) * toRad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function parseNglDataHoldings(text: string): NglHolding[] {
  const output: NglHolding[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 11 || /^Sta$/i.test(parts[0] ?? "")) continue;
    const latitude = finite(parts[1]);
    const longitude = finite(parts[2]);
    const heightM = finite(parts[3]);
    const solutions = finite(parts[10]);
    if (latitude === null || longitude === null || heightM === null || solutions === null) continue;
    const start = Date.parse(`${parts[7]}T00:00:00Z`);
    const end = Date.parse(`${parts[8]}T23:59:59Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    output.push({
      code: (parts[0] ?? "").toUpperCase(),
      latitude,
      longitude: normalizeLongitude(longitude),
      heightM,
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(end).toISOString(),
      solutions: Math.round(solutions),
    });
  }
  return output;
}

export function parseNglTenv3(text: string): NglPositionPoint[] {
  const output: NglPositionPoint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 23) continue;
    const mjd = finite(parts[3]);
    const eastInteger = finite(parts[7]);
    const eastFraction = finite(parts[8]);
    const northInteger = finite(parts[9]);
    const northFraction = finite(parts[10]);
    const upInteger = finite(parts[11]);
    const upFraction = finite(parts[12]);
    const sigmaEastM = finite(parts[14]);
    const sigmaNorthM = finite(parts[15]);
    const sigmaUpM = finite(parts[16]);
    const latitude = finite(parts[20]);
    const longitude = finite(parts[21]);
    const heightM = finite(parts[22]);
    if ([mjd, eastInteger, eastFraction, northInteger, northFraction, upInteger, upFraction, sigmaEastM, sigmaNorthM, sigmaUpM, latitude, longitude, heightM].some((value) => value === null)) continue;
    const timeMs = ((mjd as number) - 40_587) * DAY_MS;
    if (!Number.isFinite(timeMs)) continue;
    output.push({
      timeUtc: new Date(timeMs).toISOString(),
      eastM: (eastInteger as number) + (eastFraction as number),
      northM: (northInteger as number) + (northFraction as number),
      upM: (upInteger as number) + (upFraction as number),
      sigmaEastM: Math.abs(sigmaEastM as number),
      sigmaNorthM: Math.abs(sigmaNorthM as number),
      sigmaUpM: Math.abs(sigmaUpM as number),
      latitude: latitude as number,
      longitude: normalizeLongitude(longitude as number),
      heightM: heightM as number,
    });
  }
  return output.sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
}

type ComponentKey = "eastM" | "northM" | "upM";
type SigmaKey = "sigmaEastM" | "sigmaNorthM" | "sigmaUpM";

type Trend = { intercept: number; slopePerDay: number; originMs: number };

function fitWeightedTrend(points: NglPositionPoint[], key: ComponentKey, sigmaKey: SigmaKey, originMs: number): Trend | null {
  if (points.length < 3) return null;
  const rows = points.map((point) => {
    const x = (Date.parse(point.timeUtc) - originMs) / DAY_MS;
    const sigma = Math.max(0.0005, point[sigmaKey]);
    return { x, y: point[key], w: 1 / (sigma * sigma) };
  });
  const sw = rows.reduce((sum, row) => sum + row.w, 0);
  if (!(sw > 0)) return null;
  const mx = rows.reduce((sum, row) => sum + row.w * row.x, 0) / sw;
  const my = rows.reduce((sum, row) => sum + row.w * row.y, 0) / sw;
  const denominator = rows.reduce((sum, row) => sum + row.w * (row.x - mx) ** 2, 0);
  const slope = denominator > 1e-12 ? rows.reduce((sum, row) => sum + row.w * (row.x - mx) * (row.y - my), 0) / denominator : 0;
  return { intercept: my - slope * mx, slopePerDay: slope, originMs };
}

function trendAt(trend: Trend, timeUtc: string) {
  return trend.intercept + trend.slopePerDay * ((Date.parse(timeUtc) - trend.originMs) / DAY_MS);
}

function componentStep(pre: NglPositionPoint[], post: NglPositionPoint[], key: ComponentKey, sigmaKey: SigmaKey, eventMs: number) {
  const trend = fitWeightedTrend(pre, key, sigmaKey, eventMs);
  if (!trend) return null;
  const postResiduals = post.map((point) => point[key] - trendAt(trend, point.timeUtc));
  const preResiduals = pre.map((point) => point[key] - trendAt(trend, point.timeUtc));
  const stepM = median(postResiduals);
  const scatterM = 1.4826 * mad(preResiduals, median(preResiduals));
  const postSigmaM = median(post.map((point) => point[sigmaKey]));
  const uncertaintyM = Math.sqrt((scatterM ** 2) / Math.max(1, pre.length) + (postSigmaM ** 2) / Math.max(1, post.length));
  return { trend, stepM, uncertaintyM: Math.max(0.0005, uncertaintyM) };
}

function buildStation(source: GnssEventSource, holding: NglHolding, points: NglPositionPoint[], product: NglProduct): Phase4GnssStation | null {
  const eventMs = Date.parse(source.timeUtc);
  const usable = points.filter((point) => {
    const relativeDay = (Date.parse(point.timeUtc) - eventMs) / DAY_MS;
    return relativeDay >= -45 && relativeDay <= 20 && point.sigmaEastM < 0.2 && point.sigmaNorthM < 0.2 && point.sigmaUpM < 0.4;
  });
  const pre = usable.filter((point) => {
    const day = (Date.parse(point.timeUtc) - eventMs) / DAY_MS;
    return day >= -30 && day <= -2;
  });
  const post = usable.filter((point) => {
    const day = (Date.parse(point.timeUtc) - eventMs) / DAY_MS;
    return day >= 0.75 && day <= 12;
  });
  if (pre.length < 4 || post.length < 2) return null;

  const east = componentStep(pre, post, "eastM", "sigmaEastM", eventMs);
  const north = componentStep(pre, post, "northM", "sigmaNorthM", eventMs);
  const up = componentStep(pre, post, "upM", "sigmaUpM", eventMs);
  if (!east || !north || !up) return null;

  const eastMm = east.stepM * 1000;
  const northMm = north.stepM * 1000;
  const upMm = up.stepM * 1000;
  const uncertaintyEastMm = east.uncertaintyM * 1000;
  const uncertaintyNorthMm = north.uncertaintyM * 1000;
  const uncertaintyUpMm = up.uncertaintyM * 1000;
  const horizontalMm = Math.hypot(eastMm, northMm);
  const vectorMm = Math.hypot(horizontalMm, upMm);
  const vectorUncertaintyMm = Math.hypot(uncertaintyEastMm, uncertaintyNorthMm, uncertaintyUpMm);
  if (!Number.isFinite(vectorMm) || vectorMm > 5000) return null;

  const distanceKm = greatCircleDistanceKm(source.latitude, source.longitude, holding.latitude, holding.longitude);
  const dataScore = 0.34 * clamp(pre.length / 12, 0, 1) + 0.24 * clamp(post.length / 6, 0, 1);
  const precisionScore = 0.27 * Math.exp(-vectorUncertaintyMm / 35);
  const distanceScore = 0.15 * Math.exp(-distanceKm / 1600);
  const qualityScore = Math.round(100 * clamp(dataScore + precisionScore + distanceScore, 0, 1));

  const series = usable.map((point) => ({
    timeUtc: point.timeUtc,
    relativeDay: Number(((Date.parse(point.timeUtc) - eventMs) / DAY_MS).toFixed(3)),
    eastMm: Number(((point.eastM - trendAt(east.trend, point.timeUtc)) * 1000).toFixed(2)),
    northMm: Number(((point.northM - trendAt(north.trend, point.timeUtc)) * 1000).toFixed(2)),
    upMm: Number(((point.upM - trendAt(up.trend, point.timeUtc)) * 1000).toFixed(2)),
    sigmaEastMm: Number((point.sigmaEastM * 1000).toFixed(2)),
    sigmaNorthMm: Number((point.sigmaNorthM * 1000).toFixed(2)),
    sigmaUpMm: Number((point.sigmaUpM * 1000).toFixed(2)),
  }));

  return {
    code: holding.code,
    latitude: holding.latitude,
    longitude: holding.longitude,
    heightM: holding.heightM,
    distanceKm: Number(distanceKm.toFixed(1)),
    azimuthDeg: Number(initialAzimuthDeg(source.latitude, source.longitude, holding.latitude, holding.longitude).toFixed(1)),
    sourceProduct: product,
    referenceFrame: "IGS20",
    preSampleCount: pre.length,
    postSampleCount: post.length,
    sampleCount: usable.length,
    eastMm: Number(eastMm.toFixed(2)),
    northMm: Number(northMm.toFixed(2)),
    upMm: Number(upMm.toFixed(2)),
    horizontalMm: Number(horizontalMm.toFixed(2)),
    vectorMm: Number(vectorMm.toFixed(2)),
    uncertaintyEastMm: Number(uncertaintyEastMm.toFixed(2)),
    uncertaintyNorthMm: Number(uncertaintyNorthMm.toFixed(2)),
    uncertaintyUpMm: Number(uncertaintyUpMm.toFixed(2)),
    vectorUncertaintyMm: Number(vectorUncertaintyMm.toFixed(2)),
    qualityScore,
    series,
  };
}

async function fetchText(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/1.5 Phase4-GNSS" },
  });
  if (!response.ok) throw new Error(`NGL HTTP ${response.status}`);
  return response.text();
}

function holdingCandidates(holdings: NglHolding[], source: GnssEventSource) {
  const eventMs = Date.parse(source.timeUtc);
  return holdings.filter((holding) => {
    const start = Date.parse(holding.startUtc);
    const end = Date.parse(holding.endUtc);
    return start <= eventMs - 5 * DAY_MS && end >= eventMs + 2 * DAY_MS;
  }).map((holding) => ({
    holding,
    distanceKm: greatCircleDistanceKm(source.latitude, source.longitude, holding.latitude, holding.longitude),
  })).filter((item) => item.distanceKm <= 2500)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
}

export function emptyNglGnssResult(warning?: string): NglGnssResult {
  return {
    provider: "Nevada Geodetic Laboratory",
    referenceFrame: "IGS20",
    product: null,
    available: false,
    generatedAt: new Date().toISOString(),
    candidateCount: 0,
    stationCount: 0,
    stations: [],
    note: "Sin solución GNSS utilizable para esta ventana.",
    warnings: warning ? [warning] : [],
  };
}

export async function loadNglGnssDeformation(source: GnssEventSource, options: { signal?: AbortSignal; maxStations?: number } = {}): Promise<NglGnssResult> {
  const warnings: string[] = [];
  const [rapidResult, finalResult] = await Promise.allSettled([
    fetchText(RAPID_HOLDINGS, options.signal),
    fetchText(FINAL_HOLDINGS, options.signal),
  ]);
  const rapid = rapidResult.status === "fulfilled" ? parseNglDataHoldings(rapidResult.value) : [];
  const final = finalResult.status === "fulfilled" ? parseNglDataHoldings(finalResult.value) : [];
  if (rapidResult.status === "rejected") warnings.push("NGL rapid holdings no disponible; se intentó producto final.");
  if (finalResult.status === "rejected") warnings.push("NGL final holdings no disponible.");

  const rapidCandidates = holdingCandidates(rapid, source);
  const finalCandidates = holdingCandidates(final, source);
  const product: NglProduct = rapidCandidates.length >= 3 ? "rapid-24h" : "final-24h";
  const candidates = (product === "rapid-24h" ? rapidCandidates : finalCandidates).slice(0, Math.max(3, options.maxStations ?? 8));
  const base = product === "rapid-24h" ? RAPID_BASE : FINAL_BASE;
  if (!candidates.length) return { ...emptyNglGnssResult("No hay estaciones NGL con cobertura pre/post suficiente a ≤2500 km."), warnings };

  const settled = await Promise.allSettled(candidates.map(async ({ holding }) => {
    const text = await fetchText(`${base}/${encodeURIComponent(holding.code)}.tenv3`, options.signal);
    return buildStation(source, holding, parseNglTenv3(text), product);
  }));
  const stations = settled.flatMap((item) => item.status === "fulfilled" && item.value ? [item.value] : [])
    .sort((a, b) => b.qualityScore - a.qualityScore || a.distanceKm - b.distanceKm)
    .slice(0, options.maxStations ?? 8);
  const failed = settled.filter((item) => item.status === "rejected").length;
  if (failed) warnings.push(`${failed} series GNSS no pudieron recuperarse.`);
  if (stations.length < 3) warnings.push("Menos de tres estaciones GNSS pasaron los filtros pre/post; la geometría de deformación será débil.");

  return {
    provider: "Nevada Geodetic Laboratory",
    referenceFrame: "IGS20",
    product,
    available: stations.length > 0,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    stationCount: stations.length,
    stations,
    note: "El salto E/N/U se estima después de retirar una tendencia lineal pre-evento; no es una diferencia bruta entre dos días.",
    warnings,
  };
}
