import { splitInterval, toUsgsParams } from "./query";
import type { EarthquakeEvent, EarthquakeFilters, EarthquakePage } from "./types";

const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const USGS_COUNT = "https://earthquake.usgs.gov/fdsnws/event/1/count";
const USGS_MAX_RESULTS = 20_000;
const MAX_RETRIES = 3;

interface Feature {
  id?: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: Record<string, unknown>;
}

export async function queryEarthquakes(filters: EarthquakeFilters, signal?: AbortSignal): Promise<EarthquakePage> {
  const total = await countEarthquakes(filters, signal);
  const params = toUsgsParams(filters, "geojson");
  const payload = await fetchJson(`${USGS_QUERY}?${params}`, signal) as { features?: Feature[] };
  let events = (payload.features ?? []).map(normalizeFeature).filter(Boolean) as EarthquakeEvent[];
  events = applyLocalFilters(events, filters);
  return {
    events,
    total,
    limit: filters.limit,
    offset: filters.offset,
    hasMore: filters.offset - 1 + events.length < total,
    generatedAt: new Date().toISOString(),
  };
}

export async function queryEarthquakeById(id: string, signal?: AbortSignal) {
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) throw new Error("Identificador inválido.");
  const params = new URLSearchParams({ format: "geojson", eventid: id });
  const payload = await fetchJson(`${USGS_QUERY}?${params}`, signal) as Feature;
  const event = normalizeFeature(payload);
  if (!event) throw new Error("Evento no encontrado.");
  return event;
}

export async function countEarthquakes(filters: EarthquakeFilters, signal?: AbortSignal) {
  const params = toUsgsParams({ ...filters, limit: 1, offset: 1 }, "geojson");
  params.delete("limit");
  params.delete("offset");
  params.delete("orderby");
  const response = await fetchWithRetry(`${USGS_COUNT}?${params}`, signal);
  const value = Number(await response.text());
  if (!Number.isFinite(value)) throw new Error("USGS devolvió un conteo inválido.");
  return value;
}

export async function queryAllPartitioned(
  filters: EarthquakeFilters,
  onBatch: (events: EarthquakeEvent[], range: { start: string; end: string }) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<number> {
  let processed = 0;
  async function visit(start: Date, end: Date): Promise<void> {
    if (signal?.aborted) throw new DOMException("Abortado", "AbortError");
    const rangeFilters = { ...filters, startTime: start.toISOString(), endTime: end.toISOString(), limit: USGS_MAX_RESULTS, offset: 1 };
    const count = await countEarthquakes(rangeFilters, signal);
    if (count > USGS_MAX_RESULTS) {
      if (end.getTime() - start.getTime() < 60_000) throw new Error("Intervalo demasiado denso para dividirlo de forma segura.");
      const [left, right] = splitInterval(start, end);
      await visit(left[0], left[1]);
      await visit(right[0], right[1]);
      return;
    }
    const page = await queryEarthquakes(rangeFilters, signal);
    await onBatch(page.events, { start: rangeFilters.startTime, end: rangeFilters.endTime });
    processed += page.events.length;
  }
  await visit(new Date(filters.startTime), new Date(filters.endTime));
  return processed;
}

export function normalizeFeature(feature: Feature): EarthquakeEvent | null {
  const p = feature.properties ?? {};
  const c = feature.geometry?.coordinates;
  const time = dateFrom(p.time);
  const updated = dateFrom(p.updated);
  if (!feature.id || !c || c.length < 3 || !time || !updated) return null;
  const mag = Number(p.mag);
  if (!Number.isFinite(mag)) return null;
  const place = text(p.place) ?? "Región no especificada";
  return {
    id: feature.id,
    externalId: feature.id,
    sourceCatalog: "USGS ComCat",
    timeUtc: time.toISOString(),
    updatedUtc: updated.toISOString(),
    longitude: Number(c[0]), latitude: Number(c[1]), depthKm: Number(c[2]),
    magnitude: mag,
    magnitudeType: text(p.magType) ?? "M",
    place,
    countryOrRegion: inferRegion(place),
    eventType: text(p.type) ?? "earthquake",
    status: text(p.status) ?? "unknown",
    network: text(p.net) ?? "USGS",
    locationSource: text(p.locationSource), magnitudeSource: text(p.magSource),
    stationCount: numberOrUndefined(p.nst), gap: numberOrUndefined(p.gap), dmin: numberOrUndefined(p.dmin), rms: numberOrUndefined(p.rms),
    horizontalError: numberOrUndefined(p.horizontalError), depthError: numberOrUndefined(p.depthError), magnitudeError: numberOrUndefined(p.magError),
    magnitudeStationCount: numberOrUndefined(p.magNst), sourceUrl: text(p.url) ?? text(p.detail),
  };
}

function applyLocalFilters(events: EarthquakeEvent[], filters: EarthquakeFilters) {
  const search = filters.search?.toLocaleLowerCase();
  return events.filter((event) => {
    if (filters.magnitudeType && event.magnitudeType.toLowerCase() !== filters.magnitudeType.toLowerCase()) return false;
    if (filters.source && !event.network.toLowerCase().includes(filters.source.toLowerCase())) return false;
    if (filters.reviewedOnly && event.status.toLowerCase() !== "reviewed") return false;
    if (search && !`${event.place} ${event.countryOrRegion}`.toLocaleLowerCase().includes(search)) return false;
    return true;
  });
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetchWithRetry(url, signal);
  return response.json() as Promise<unknown>;
}
async function fetchWithRetry(url: string, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" }, cache: "no-store", signal });
      if (response.ok) return response;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`USGS respondió HTTP ${response.status}`);
      lastError = new Error(`USGS respondió HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("USGS no está disponible.");
}
function dateFrom(value: unknown) { const d = new Date(typeof value === "number" || typeof value === "string" ? value : NaN); return Number.isNaN(d.getTime()) ? null : d; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberOrUndefined(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function inferRegion(place: string) { const parts = place.split(","); return (parts.at(-1) ?? place).trim(); }
