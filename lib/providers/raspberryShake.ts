import { haversineKm, regionForEvent } from "../regions";
import type {
  CatalogProvider,
  CountryTarget,
  EventSource,
  SeismicEvent,
} from "../types";

const DEFAULT_RASPBERRY_SHAKE_URL =
  "https://quakelink.raspberryshake.org/events/query";
const RASPBERRY_SHAKE_FDSN_URL =
  "https://quakelink.raspberryshake.org/fdsnws/event/1/query";
const USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const USGS_REALTIME_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

interface QueryOptions {
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

function parseDate(value: unknown): Date | null {
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function validEvent(event: SeismicEvent) {
  return (
    Number.isFinite(event.magnitude) &&
    Number.isFinite(event.latitude) &&
    Number.isFinite(event.longitude) &&
    Number.isFinite(event.depthKm) &&
    !Number.isNaN(new Date(event.time).getTime())
  );
}

function annotateEvent(event: SeismicEvent, target: CountryTarget): SeismicEvent {
  const region = regionForEvent(event);
  return {
    ...event,
    regionId: region?.id,
    isTargetRegion:
      haversineKm(
        event.latitude,
        event.longitude,
        target.latitude,
        target.longitude,
      ) <= target.radiusKm + 350,
  };
}

/** QuakeLink may return either its 12-column or 15-column text layout. */
function parseRaspberryShakeText(
  text: string,
  target: CountryTarget,
): SeismicEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const values = line.split(";").map((value) => value.trim());
      if (values.length < 12) return null;

      const extended = values.length >= 15;
      const originTime = parseDate(values[1]);
      const eventType = extended ? values[13] : values[10];
      if (!originTime || eventType === "not existing") return null;

      const event: SeismicEvent = {
        id: `${values[0] || values[1]}-${index}`,
        time: originTime.toISOString(),
        magnitude: Number(values[2]),
        magnitudeType: values[3] || "M",
        latitude: Number(values[4]),
        longitude: Number(values[5]),
        depthKm: Number(values[6]),
        place: (extended ? values[14] : values[11]) || "Región no especificada",
        agency: (extended ? values[9] : values[8]) || "Raspberry Shake",
        source: "Raspberry Shake QuakeLink",
      };
      return validEvent(event) ? annotateEvent(event, target) : null;
    })
    .filter((event): event is SeismicEvent => Boolean(event));
}

function parseGeoJson(
  payload: unknown,
  source: EventSource,
  target: CountryTarget,
): SeismicEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as { features?: GeoJsonFeature[] }).features;
  if (!Array.isArray(features)) return [];

  return features
    .map((feature, index) => {
      const properties = feature.properties ?? {};
      const coordinates = feature.geometry?.coordinates;
      const eventType = firstString(properties, ["type"]);
      if (eventType && eventType !== "earthquake") return null;
      const time = parseDate(
        properties.time ?? properties.datetime ?? properties.originTime,
      );
      if (!time || !coordinates || coordinates.length < 3) return null;

      const updated = parseDate(properties.updated);
      const event: SeismicEvent = {
        id:
          feature.id ??
          firstString(properties, ["unid", "eventid", "source_id", "code"]) ??
          `${time.toISOString()}-${index}`,
        time: time.toISOString(),
        updatedAt: updated?.toISOString(),
        magnitude: firstNumber(properties, ["mag", "magnitude"]),
        magnitudeType:
          firstString(properties, ["magType", "magtype", "magnitudeType"]) ??
          "M",
        longitude: Number(coordinates[0]),
        latitude: Number(coordinates[1]),
        depthKm: Number(coordinates[2]),
        place:
          firstString(properties, [
            "place",
            "flynn_region",
            "region",
            "eventLocationName",
          ]) ?? "Región no especificada",
        agency:
          firstString(properties, ["net", "auth", "author", "agency"]) ??
          (source.startsWith("USGS") ? "USGS" : "Raspberry Shake"),
        source,
        detailUrl: firstString(properties, ["url", "detail"]),
      };
      return validEvent(event) ? annotateEvent(event, target) : null;
    })
    .filter((event): event is SeismicEvent => Boolean(event));
}

function toQuakeLinkTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

function addSpatialParameters(
  url: URL,
  options: QueryOptions,
  legacy: boolean,
) {
  if (
    options.latitude === undefined ||
    options.longitude === undefined ||
    options.maxRadiusKm === undefined
  ) {
    return;
  }
  if (legacy) {
    url.searchParams.set("lat", String(options.latitude));
    url.searchParams.set("lon", String(options.longitude));
    url.searchParams.set(
      "maxradius",
      String(Math.min(180, options.maxRadiusKm / 111.2)),
    );
  } else {
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("maxradiuskm", String(options.maxRadiusKm));
  }
}

async function fetchText(url: URL) {
  const response = await fetch(url, {
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/0.3" },
    signal: AbortSignal.timeout(18_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url: URL) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/0.3" },
    signal: AbortSignal.timeout(18_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function buildRaspberryLegacyUrl(options: QueryOptions) {
  const url = new URL(
    process.env.RASPBERRY_SHAKE_EVENTS_URL || DEFAULT_RASPBERRY_SHAKE_URL,
  );
  url.searchParams.set("start", toQuakeLinkTime(options.start));
  url.searchParams.set("end", toQuakeLinkTime(options.end));
  url.searchParams.set("minmag", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("sort", "-time");
  url.searchParams.set("format", "2");
  addSpatialParameters(url, options, true);
  return url;
}

function buildRaspberryFdsnUrl(options: QueryOptions) {
  const url = new URL(RASPBERRY_SHAKE_FDSN_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("starttime", options.start.toISOString());
  url.searchParams.set("endtime", options.end.toISOString());
  url.searchParams.set("minmagnitude", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("orderby", "time");
  addSpatialParameters(url, options, false);
  return url;
}

function buildUsgsUrl(options: QueryOptions) {
  const url = new URL(USGS_URL);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", options.start.toISOString());
  url.searchParams.set("endtime", options.end.toISOString());
  url.searchParams.set("minmagnitude", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("orderby", "time");
  url.searchParams.set("eventtype", "earthquake");
  addSpatialParameters(url, options, false);
  return url;
}

async function fetchRaspberryQuery(
  options: QueryOptions,
  target: CountryTarget,
  allowEmpty = false,
) {
  const errors: string[] = [];
  try {
    const events = parseRaspberryShakeText(
      await fetchText(buildRaspberryLegacyUrl(options)),
      target,
    );
    if (events.length) return events;
    errors.push("catálogo clásico vacío");
  } catch (error) {
    errors.push(error instanceof Error ? `clásico ${error.message}` : "clásico falló");
  }

  try {
    const events = parseGeoJson(
      await fetchJson(buildRaspberryFdsnUrl(options)),
      "Raspberry Shake QuakeLink",
      target,
    );
    if (events.length) return events;
    errors.push("FDSN vacío");
  } catch (error) {
    errors.push(error instanceof Error ? `FDSN ${error.message}` : "FDSN falló");
  }
  if (allowEmpty) return [];
  throw new Error(errors.join("; "));
}

async function fetchUsgsQuery(
  options: QueryOptions,
  target: CountryTarget,
) {
  return parseGeoJson(
    await fetchJson(buildUsgsUrl(options)),
    "USGS ComCat",
    target,
  );
}

async function fetchUsgsRealtime(target: CountryTarget) {
  return parseGeoJson(
    await fetchJson(new URL(USGS_REALTIME_URL)),
    "USGS real-time",
    target,
  );
}

function uniqueEvents(events: SeismicEvent[]) {
  const priority: Record<EventSource, number> = {
    "USGS real-time": 3,
    "USGS ComCat": 2,
    "Raspberry Shake QuakeLink": 1,
  };
  const ordered = [...events].sort((a, b) => {
    const timeDifference = new Date(b.time).getTime() - new Date(a.time).getTime();
    if (timeDifference !== 0) return timeDifference;
    return priority[b.source] - priority[a.source];
  });
  const seen = new Set<string>();
  return ordered.filter((event) => {
    const timeBucket = Math.round(new Date(event.time).getTime() / 30_000);
    const key = `${timeBucket}:${event.latitude.toFixed(2)}:${event.longitude.toFixed(2)}:${event.magnitude.toFixed(1)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchSeismicCatalog(
  start: Date,
  end: Date,
  target: CountryTarget,
): Promise<{
  events: SeismicEvent[];
  provider: CatalogProvider;
  providerStatus: string[];
  warning?: string;
}> {
  const globalQuery: QueryOptions = {
    start,
    end,
    minMagnitude: 4.5,
    limit: 8_000,
  };
  const targetQuery: QueryOptions = {
    start,
    end,
    minMagnitude: 2,
    limit: 8_000,
    latitude: target.latitude,
    longitude: target.longitude,
    maxRadiusKm: Math.min(4_000, target.radiusKm + 1_500),
  };

  const requests = [
    { name: "Raspberry Shake global", source: "rs", promise: fetchRaspberryQuery(globalQuery, target) },
    { name: "Raspberry Shake regional", source: "rs", promise: fetchRaspberryQuery(targetQuery, target, true) },
    { name: "USGS ComCat global", source: "usgs", promise: fetchUsgsQuery(globalQuery, target) },
    { name: "USGS ComCat regional", source: "usgs", promise: fetchUsgsQuery(targetQuery, target) },
    { name: "USGS últimas 24 horas", source: "usgs", promise: fetchUsgsRealtime(target) },
  ] as const;

  const results = await Promise.allSettled(requests.map((request) => request.promise));
  const events: SeismicEvent[] = [];
  const providerStatus: string[] = [];
  let raspberryAvailable = false;
  let usgsAvailable = false;

  results.forEach((result, index) => {
    const request = requests[index];
    if (result.status === "fulfilled") {
      events.push(...result.value);
      providerStatus.push(`${request.name}: ${result.value.length} eventos`);
      if (request.source === "rs") raspberryAvailable = true;
      if (request.source === "usgs") usgsAvailable = true;
    } else {
      providerStatus.push(
        `${request.name}: no disponible (${result.reason instanceof Error ? result.reason.message : "error"})`,
      );
    }
  });

  const unique = uniqueEvents(events);
  if (!unique.length) throw new Error("Ningún proveedor devolvió eventos utilizables.");

  const provider: CatalogProvider =
    raspberryAvailable && usgsAvailable
      ? "Raspberry Shake + USGS"
      : raspberryAvailable
        ? "Raspberry Shake"
        : "USGS";
  const failures = providerStatus.filter((status) => status.includes("no disponible"));

  return {
    events: unique,
    provider,
    providerStatus,
    warning: failures.length ? failures.join(" · ") : undefined,
  };
}
