import { isInDominicanRegion, regionForEvent } from "../regions";
import type { DataProvider, SeismicEvent } from "../types";

const DEFAULT_RASPBERRY_SHAKE_URL =
  "https://quakelink.raspberryshake.org/events/query";
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

function annotateEvent(event: SeismicEvent): SeismicEvent {
  const region = regionForEvent(event);
  return {
    ...event,
    regionId: region?.id,
    isDominicanRegion: isInDominicanRegion(event),
  };
}

function parseRaspberryShakeText(text: string): SeismicEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const values = line.split(";");
      if (values.length < 15) return null;
      const [timestamp, originTime, magnitude, magnitudeType, latitude, longitude, depth, , agency, author, , , , type, region] = values;
      const parsedTime = new Date(originTime);
      if (Number.isNaN(parsedTime.getTime())) return null;
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
      if (
        type === "not existing" ||
        !Number.isFinite(event.magnitude) ||
        !Number.isFinite(event.latitude) ||
        !Number.isFinite(event.longitude) ||
        Number.isNaN(new Date(event.time).getTime())
      ) {
        return null;
      }
      return annotateEvent(event);
    })
    .filter((event): event is SeismicEvent => Boolean(event));
}

function toQuakeLinkTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

function buildRaspberryShakeUrl(options: QueryOptions) {
  const url = new URL(process.env.RASPBERRY_SHAKE_EVENTS_URL || DEFAULT_RASPBERRY_SHAKE_URL);
  url.searchParams.set("start", toQuakeLinkTime(options.start));
  url.searchParams.set("end", toQuakeLinkTime(options.end));
  url.searchParams.set("minmag", String(options.minMagnitude));
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("sort", "-time");
  url.searchParams.set("format", "2");
  if (
    options.latitude !== undefined &&
    options.longitude !== undefined &&
    options.maxRadiusDegrees !== undefined
  ) {
    url.searchParams.set("lat", String(options.latitude));
    url.searchParams.set("lon", String(options.longitude));
    url.searchParams.set("maxradius", String(options.maxRadiusDegrees));
  }
  return url;
}

async function fetchRaspberryShakeQuery(options: QueryOptions) {
  const response = await fetch(buildRaspberryShakeUrl(options), {
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/0.1" },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Raspberry Shake respondió HTTP ${response.status}`);
  }

  return parseRaspberryShakeText(await response.text());
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
  if (
    options.latitude !== undefined &&
    options.longitude !== undefined &&
    options.maxRadiusDegrees !== undefined
  ) {
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("maxradius", String(options.maxRadiusDegrees));
  }

  const response = await fetch(url, {
    headers: { Accept: "application/geo+json", "User-Agent": "RDSISMOS/0.1" },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 60 },
  });
  if (!response.ok) throw new Error(`USGS respondió HTTP ${response.status}`);

  const data = (await response.json()) as {
    features?: Array<{
      id: string;
      geometry: { coordinates: [number, number, number] };
      properties: { time: number; mag: number; magType?: string; place?: string; net?: string };
    }>;
  };

  return (data.features ?? []).map((feature) =>
    annotateEvent({
      id: feature.id,
      time: new Date(feature.properties.time).toISOString(),
      magnitude: feature.properties.mag,
      magnitudeType: feature.properties.magType || "M",
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1],
      depthKm: feature.geometry.coordinates[2],
      place: feature.properties.place || "Región no especificada",
      agency: feature.properties.net || "USGS",
      source: "USGS fallback",
    }),
  );
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
      throw new Error("QuakeLink devolvió un catálogo global vacío o con formato inesperado");
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
          ? `QuakeLink no estuvo disponible: ${error.message}`
          : "QuakeLink no estuvo disponible temporalmente.",
    };
  }
}
