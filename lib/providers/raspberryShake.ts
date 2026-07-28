import { isInDominicanRegion, regionForEvent } from "../regions";
import type { DataProvider, SeismicEvent } from "../types";

const DEFAULT_RASPBERRY_SHAKE_URL =
  "https://quakelink.raspberryshake.org/events/query";
const RASPBERRY_SHAKE_FDSN_URL =
  "https://quakelink.raspberryshake.org/fdsnws/event/1/query";
const USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";

interface QueryOptions {
  start: Date;
  end: Date;
  minMagnitude: number;
  limit: number;
  latitude?: number;
  longitude?: number;
  maxRadiusDegrees?: number;
}

interface GeoJsonFeature {
  id?: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: Record<string, unknown>;
}

function annotateEvent(event: SeismicEvent): SeismicEvent {
  const region = regionForEvent(event);
  return {
    ...event,
    regionId: region?.id,
    isDominicanRegion: isInDominicanRegion(event),
  };
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

/**
 * QuakeLink supports three row formats. In production it can return the
 * default 12-column format even when format=2 was requested, so both layouts
 * must be accepted.
 */
function parseRaspberryShakeText(text: string): SeismicEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const values = line.split(";").map((value) => value.trim());
      if (values.length < 12) return null;

      const isExtended = values.length >= 15;
      const timestamp = values[0];
      const originTime = values[1];
      const magnitude = values[2];
      const magnitudeType = values[3];
      const latitude = values[4];
      const longitude = values[5];
      const depth = values[6];
      const agency = values[8];
      const author = isExtended ? values[9] : values[8];
      const type = isExtended ? values[13] : values[10];
      const region = isExtended ? values[14] : values[11];
      const parsedTime = new Date(originTime);

      if (Number.isNaN(parsedTime.getTime()) || type === "not existing") {
        return null;
      }

      const event: SeismicEvent = {
        id: `${timestamp || originTime}-${index}`,
        time: parsedTime.toISOString(),
        magnitude: Number(magnitude),
        magnitudeType: magnitudeType || "M",
        latitude: Number(latitude),
        longitude: Number(longitude),
        depthKm: Number(depth),
        place: region || "Región no especificada",
        agency: author || agency || "Raspberry Shake",
        source: "Raspberry Shake QuakeLink",
      };

      return validEvent(event) ? annotateEvent(event) : null;
    })
    .filter((event): event is SeismicEvent => Boolean(event));
}

function parseEventTime(value: unknown) {
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") return new Date(value);
  return new Date(Number.NaN);
}

function firstString(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(properties[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

/** Parse the GeoJSON-like JSON returned by QuakeLink FDSNWS and USGS. */
function parseGeoJsonFeatures(
  payload: unknown,
  source: DataProvider,
): SeismicEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { features?: GeoJsonFeature[] };
  if (!Array.isArray(record.features)) return [];

  return record.features
    .map((feature, index) => {
      const properties = feature.properties ?? {};
      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 3) return null;

      const time = parseEventTime(
        properties.time ?? properties.datetime ?? properties.originTime,
      );
      if (Number.isNaN(time.getTime())) return null;

      const isoTime = time.toISOString();
      const magnitude = firstNumber(properties, ["mag", "magnitude"]);
      const longitude = Number(coordinates[0]);
      const latitude = Number(coordinates[1]);
      const depthKm = Number(coordinates[2]);

      const event: SeismicEvent = {
        id:
          feature.id ??
          firstString(properties, ["unid", "eventid", "source_id"]) ??
          `${isoTime}-${latitude}-${longitude}-${index}`,
        time: isoTime,
        magnitude,
        magnitudeType:
          firstString(properties, ["magType", "magtype", "magnitudeType"]) ?? "M",
        latitude,
        longitude,
        depthKm,
        place:
          firstString(properties, [
            "place",
            "flynn_region",
            "region",
            "eventLocationName",
          ]) ?? "Región no especificada",
        agency:
          firstString(properties, ["net", "auth", "author", "agency"]) ??
          (source === "USGS fallback" ? "USGS" : "Raspberry Shake"),
        source,
      };

      return validEvent(event) ? annotateEvent(event) : null;
    })
    .filter((event): event is SeismicEvent => Boolean(event));
}

function toQuakeLinkTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

function addSpatialParameters(url: URL, options: QueryOptions, fdsn: boolean) {
  if (
    options.latitude === undefined ||
    options.longitude === undefined ||
    options.maxRadiusDegrees === undefined
  ) {
    return;
  }

  if (fdsn) {
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("maxradius", String(options.maxRadiusDegrees));
  } else {
    url.searchParams.set("lat", String(options.latitude));
    url.searchParams.set("lon", String(options.longitude));
    url.searchParams.set("maxradius", String(options.maxRadiusDegrees));
  }
}

function buildRaspberryShakeLegacyUrl(options: QueryOptions) {
  const url = new URL(
    process.env.RASPBERRY_SHAKE_EVENTS_URL || DEFAULT_RASPBERRY_SHAKE_URL,
  );
  url.searchParams.set("start", toQuakeLinkTime(options.start));
  url.searchParams.set("end", toQuakeLinkTime(options.end));
  url.searchParams.set("minmag", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("sort", "-time");
  url.searchParams.set("format", "2");
  addSpatialParameters(url, options, false);
  return url;
}

function buildRaspberryShakeFdsnUrl(options: QueryOptions) {
  const url = new URL(RASPBERRY_SHAKE_FDSN_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("starttime", options.start.toISOString());
  url.searchParams.set("endtime", options.end.toISOString());
  url.searchParams.set("minmagnitude", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("orderby", "time");
  addSpatialParameters(url, options, true);
  return url;
}

async function fetchText(url: URL) {
  const response = await fetch(url, {
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/0.2" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url: URL) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/0.2" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`respuesta JSON inválida: ${text.slice(0, 80)}`);
  }
}

async function fetchRaspberryShakeQuery(options: QueryOptions) {
  const errors: string[] = [];

  try {
    const events = parseRaspberryShakeText(
      await fetchText(buildRaspberryShakeLegacyUrl(options)),
    );
    if (events.length) return events;
    errors.push("catálogo clásico vacío");
  } catch (error) {
    errors.push(error instanceof Error ? `clásico ${error.message}` : "clásico falló");
  }

  try {
    const events = parseGeoJsonFeatures(
      await fetchJson(buildRaspberryShakeFdsnUrl(options)),
      "Raspberry Shake QuakeLink",
    );
    if (events.length) return events;
    errors.push("FDSN vacío");
  } catch (error) {
    errors.push(error instanceof Error ? `FDSN ${error.message}` : "FDSN falló");
  }

  throw new Error(`Raspberry Shake sin eventos utilizables (${errors.join("; ")})`);
}

async function fetchUsgsQuery(options: QueryOptions): Promise<SeismicEvent[]> {
  const url = new URL(USGS_URL);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", options.start.toISOString());
  url.searchParams.set("endtime", options.end.toISOString());
  url.searchParams.set("minmagnitude", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("orderby", "time");
  url.searchParams.set("eventtype", "earthquake");
  addSpatialParameters(url, options, true);

  return parseGeoJsonFeatures(await fetchJson(url), "USGS fallback");
}

function uniqueEvents(events: SeismicEvent[]) {
  const sorted = [...events].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  );
  const seen = new Set<string>();
  return sorted.filter((event) => {
    const key = `${event.time.slice(0, 19)}:${event.latitude.toFixed(2)}:${event.longitude.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchSeismicCatalog(start: Date, end: Date): Promise<{
  events: SeismicEvent[];
  provider: DataProvider;
  fallbackUsed: boolean;
  warning?: string;
}> {
  const globalQuery: QueryOptions = {
    start,
    end,
    minMagnitude: 4.5,
    limit: 5_000,
  };
  const dominicanQuery: QueryOptions = {
    start,
    end,
    minMagnitude: 2.5,
    limit: 3_000,
    latitude: 18.7357,
    longitude: -70.1627,
    maxRadiusDegrees: 15,
  };

  try {
    const [globalEvents, dominicanEvents] = await Promise.all([
      fetchRaspberryShakeQuery(globalQuery),
      fetchRaspberryShakeQuery(dominicanQuery),
    ]);
    if (!globalEvents.length) {
      throw new Error("Raspberry Shake devolvió un catálogo global vacío");
    }
    return {
      events: uniqueEvents([...globalEvents, ...dominicanEvents]),
      provider: "Raspberry Shake QuakeLink",
      fallbackUsed: false,
    };
  } catch (error) {
    if (process.env.ALLOW_USGS_FALLBACK === "false") throw error;
    const [globalEvents, dominicanEvents] = await Promise.all([
      fetchUsgsQuery(globalQuery),
      fetchUsgsQuery(dominicanQuery),
    ]);
    return {
      events: uniqueEvents([...globalEvents, ...dominicanEvents]),
      provider: "USGS fallback",
      fallbackUsed: true,
      warning:
        error instanceof Error
          ? `Raspberry Shake no respondió con datos utilizables; se muestran datos USGS. Detalle: ${error.message}`
          : "Raspberry Shake no estuvo disponible temporalmente; se muestran datos USGS.",
    };
  }
}
