import { haversineKm, regionForEvent } from "../regions";
import type { CountryTarget, SeismicEvent } from "../types";

const EMSC_FDSN_URL = "https://www.seismicportal.eu/fdsnws/event/1/query";

export interface EmscQueryOptions {
  start: Date;
  end: Date;
  minMagnitude: number;
  limit: number;
  latitude?: number;
  longitude?: number;
  maxRadiusKm?: number;
}

interface GeoJsonFeature {
  id?: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: Record<string, unknown>;
}

function date(value: unknown) {
  const parsed = new Date(typeof value === "number" || typeof value === "string" ? value : Number.NaN);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function text(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function number(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function annotate(event: SeismicEvent, target: CountryTarget): SeismicEvent {
  const region = regionForEvent(event);
  return {
    ...event,
    regionId: region?.id,
    isTargetRegion: haversineKm(
      event.latitude,
      event.longitude,
      target.latitude,
      target.longitude,
    ) <= target.radiusKm + 350,
  };
}

function buildUrl(options: EmscQueryOptions) {
  const url = new URL(EMSC_FDSN_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("starttime", options.start.toISOString());
  url.searchParams.set("endtime", options.end.toISOString());
  url.searchParams.set("minmagnitude", String(options.minMagnitude));
  url.searchParams.set("limit", String(Math.min(20_000, options.limit)));
  url.searchParams.set("orderby", "time");
  if (
    options.latitude !== undefined
    && options.longitude !== undefined
    && options.maxRadiusKm !== undefined
  ) {
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("maxradiuskm", String(options.maxRadiusKm));
  }
  return url;
}

export function parseEmscGeoJson(payload: unknown, target: CountryTarget): SeismicEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as { features?: GeoJsonFeature[] }).features;
  if (!Array.isArray(features)) return [];

  return features.flatMap((feature, index) => {
    const properties = feature.properties ?? {};
    const coordinates = feature.geometry?.coordinates;
    const origin = date(properties.time);
    if (!origin || !coordinates || coordinates.length < 3) return [];

    const magnitude = number(properties, ["mag", "magnitude"]);
    const latitude = Number(coordinates[1]);
    const longitude = Number(coordinates[0]);
    const depthKm = Number(coordinates[2]);
    if (![magnitude, latitude, longitude, depthKm].every(Number.isFinite)) return [];

    const updated = date(properties.lastupdate ?? properties.updated);
    const sourceId = text(properties, ["source_id", "unid", "eventid"]);
    const event: SeismicEvent = {
      id: feature.id ?? sourceId ?? `emsc-${origin.getTime()}-${index}`,
      time: origin.toISOString(),
      updatedAt: updated?.toISOString(),
      magnitude,
      magnitudeType: text(properties, ["magtype", "magType"]) ?? "M",
      latitude,
      longitude,
      depthKm,
      place: text(properties, ["flynn_region", "place", "region"]) ?? "Región no especificada",
      agency: text(properties, ["auth", "author"]) ?? "EMSC",
      source: "EMSC SeismicPortal",
      detailUrl: sourceId ? `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${encodeURIComponent(sourceId)}` : undefined,
    };
    return [annotate(event, target)];
  });
}

export async function fetchEmscEvents(options: EmscQueryOptions, target: CountryTarget) {
  const response = await fetch(buildUrl(options), {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/0.4" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseEmscGeoJson(await response.json() as unknown, target);
}
