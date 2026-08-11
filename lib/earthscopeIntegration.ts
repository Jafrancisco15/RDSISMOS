import { haversineKm } from "@/lib/regions";

const EARTHSCOPE_STATION_URL = "https://service.earthscope.org/fdsnws/station/1/query";
const EARTHSCOPE_TRAVELTIME_URL = "https://service.earthscope.org/irisws/traveltime/1/query";
const EARTHSCOPE_SITE = "https://www.earthscope.org";
const MAX_STATIONS = 120;
const STATION_RADIUS_DEG = 100;
const SURFACE_WAVE_SPEED_KM_S = 3.6;

export interface EarthScopeSourceEvent {
  id: string;
  timeUtc: string;
  place: string;
  sourceCatalog?: string;
  sourceUrl?: string;
}

export interface EarthScopeStation {
  network: string;
  station: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  siteName: string;
  distanceKm: number;
  azimuthDeg: number;
}

export interface EarthScopeTravelTime {
  distanceKm: number;
  distanceDeg: number;
  pMinutes: number | null;
  sMinutes: number | null;
  surfaceMinutes: number;
}

export interface EarthScopeProducts {
  eventPageUrl: string | null;
  gmvUrl: string | null;
  dataAccessUrl: string | null;
}

export interface EarthScopeIntegration {
  provider: "EarthScope NSF SAGE";
  available: boolean;
  stationRadiusDeg: number;
  stations: EarthScopeStation[];
  travelTimes: EarthScopeTravelTime[];
  travelTimeModel: "iasp91";
  products: EarthScopeProducts;
  warnings: string[];
}

function finite(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLongitude(value: number) {
  return ((value + 540) % 360) - 180;
}

function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const deg = Math.PI / 180;
  const lat1 = fromLat * deg;
  const lat2 = toLat * deg;
  const deltaLng = (toLng - fromLng) * deg;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalizeLongitude(Math.atan2(y, x) / deg + 180) + 180;
}

export function parseEarthScopeStations(
  text: string,
  sourceLatitude: number,
  sourceLongitude: number,
): EarthScopeStation[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const parsed: EarthScopeStation[] = [];
  for (const row of rows) {
    const columns = row.split("|");
    if (columns.length < 6) continue;
    const latitude = finite(columns[2]);
    const longitude = finite(columns[3]);
    if (latitude === null || longitude === null) continue;
    const distanceKm = haversineKm(sourceLatitude, sourceLongitude, latitude, longitude);
    parsed.push({
      network: columns[0]?.trim() || "—",
      station: columns[1]?.trim() || "—",
      latitude,
      longitude,
      elevationM: finite(columns[4]),
      siteName: columns[5]?.trim() || "Estación sísmica",
      distanceKm: Number(distanceKm.toFixed(1)),
      azimuthDeg: Number(bearingDeg(sourceLatitude, sourceLongitude, latitude, longitude).toFixed(1)),
    });
  }
  return parsed;
}

function diverseStations(stations: EarthScopeStation[], limit = MAX_STATIONS) {
  if (stations.length <= limit) return stations.sort((a, b) => a.distanceKm - b.distanceKm);
  const sectors = new Map<number, EarthScopeStation[]>();
  for (const station of stations) {
    const sector = Math.floor(((station.azimuthDeg % 360) + 360) % 360 / 15);
    if (!sectors.has(sector)) sectors.set(sector, []);
    sectors.get(sector)?.push(station);
  }
  const selected: EarthScopeStation[] = [];
  for (let sector = 0; sector < 24; sector += 1) {
    const items = (sectors.get(sector) ?? []).sort((a, b) => a.distanceKm - b.distanceKm);
    selected.push(...items.slice(0, 4));
  }
  const seen = new Set(selected.map((station) => `${station.network}:${station.station}`));
  for (const station of [...stations].sort((a, b) => a.distanceKm - b.distanceKm)) {
    if (selected.length >= limit) break;
    const key = `${station.network}:${station.station}`;
    if (seen.has(key)) continue;
    selected.push(station);
    seen.add(key);
  }
  return selected.slice(0, limit).sort((a, b) => a.distanceKm - b.distanceKm);
}

export function parseEarthScopeTravelTimes(text: string) {
  const result = new Map<number, { pSeconds: number | null; sSeconds: number | null }>();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/^[0-9.\-]/.test(line)) continue;
    const columns = line.split(/\s+/);
    if (columns.length < 4) continue;
    const distanceDeg = Number(columns[0]);
    const phase = columns[2];
    const travelSeconds = Number(columns[3]);
    if (!Number.isFinite(distanceDeg) || !Number.isFinite(travelSeconds)) continue;
    const distanceKm = Math.round(distanceDeg * 111.195);
    const current = result.get(distanceKm) ?? { pSeconds: null, sSeconds: null };
    if (phase === "P" || phase === "Pdiff" || phase === "PKP" || phase === "PKIKP") {
      if (current.pSeconds === null || travelSeconds < current.pSeconds) current.pSeconds = travelSeconds;
    }
    if (phase === "S" || phase === "Sdiff" || phase === "SKS" || phase === "SKIKS") {
      if (current.sSeconds === null || travelSeconds < current.sSeconds) current.sSeconds = travelSeconds;
    }
    result.set(distanceKm, current);
  }
  return result;
}

function nearestTravel(
  distanceKm: number,
  travelMap: Map<number, { pSeconds: number | null; sSeconds: number | null }>,
) {
  let bestKey: number | null = null;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const key of travelMap.keys()) {
    const difference = Math.abs(key - distanceKm);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestKey = key;
    }
  }
  return bestKey === null ? null : travelMap.get(bestKey) ?? null;
}

function representativeDistances(distancesKm: number[]) {
  const values = new Set<number>([250, 500, 1_000, 2_500, 5_000, 7_500, 10_000, 15_000, 18_000]);
  for (const distance of distancesKm) {
    if (!Number.isFinite(distance) || distance <= 0) continue;
    values.add(Math.max(25, Math.min(19_900, Math.round(distance / 25) * 25)));
  }
  return [...values].sort((a, b) => a - b).slice(0, 70);
}

async function fetchStations(
  latitude: number,
  longitude: number,
  eventTimeUtc?: string,
) {
  const params = new URLSearchParams({
    format: "text",
    level: "station",
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    maxradius: String(STATION_RADIUS_DEG),
    includerestricted: "false",
    nodata: "404",
  });
  if (eventTimeUtc) {
    const eventDate = new Date(eventTimeUtc);
    if (!Number.isNaN(eventDate.getTime())) {
      const end = new Date(eventDate.getTime() + 3 * 60 * 60_000);
      params.set("starttime", eventDate.toISOString());
      params.set("endtime", end.toISOString());
    }
  }
  const response = await fetch(`${EARTHSCOPE_STATION_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/0.9 EarthScope-wave-integration" },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`EarthScope estaciones HTTP ${response.status}`);
  return diverseStations(parseEarthScopeStations(await response.text(), latitude, longitude));
}

async function fetchTravelTimes(depthKm: number, distancesKm: number[]) {
  const distances = representativeDistances(distancesKm);
  const params = new URLSearchParams({
    distkm: distances.join(","),
    evdepth: Math.max(0, Math.min(700, depthKm)).toFixed(1),
    model: "iasp91",
    phases: "P,S,Pdiff,Sdiff,PKP,SKS,PKIKP,SKIKS",
    format: "text",
    noheader: "true",
    mintimeonly: "true",
  });
  const response = await fetch(`${EARTHSCOPE_TRAVELTIME_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/0.9 EarthScope-wave-integration" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`EarthScope traveltime HTTP ${response.status}`);
  const map = parseEarthScopeTravelTimes(await response.text());
  return distances.map((distanceKm) => {
    const travel = nearestTravel(distanceKm, map);
    return {
      distanceKm,
      distanceDeg: Number((distanceKm / 111.195).toFixed(2)),
      pMinutes: travel?.pSeconds === null || travel?.pSeconds === undefined
        ? null
        : Number((travel.pSeconds / 60).toFixed(2)),
      sMinutes: travel?.sSeconds === null || travel?.sSeconds === undefined
        ? null
        : Number((travel.sSeconds / 60).toFixed(2)),
      surfaceMinutes: Number((distanceKm / SURFACE_WAVE_SPEED_KM_S / 60).toFixed(2)),
    } satisfies EarthScopeTravelTime;
  });
}

function firstMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.replaceAll("&amp;", "&") ?? null;
}

async function discoverProducts(sourceEvent?: EarthScopeSourceEvent): Promise<EarthScopeProducts> {
  if (!sourceEvent?.id) return { eventPageUrl: null, gmvUrl: null, dataAccessUrl: null };
  const eventId = sourceEvent.id.trim();
  const dataAccessUrl = `https://observablehq.com/@earthscope/event-data-access?eventid=%22${encodeURIComponent(eventId)}%22&sensitivity=2`;
  try {
    const searchResponse = await fetch(`${EARTHSCOPE_SITE}/?s=${encodeURIComponent(eventId)}`, {
      headers: { Accept: "text/html", "User-Agent": "RDSISMOS/0.9 EarthScope-product-discovery" },
      next: { revalidate: 3_600 },
    });
    if (!searchResponse.ok) return { eventPageUrl: null, gmvUrl: null, dataAccessUrl };
    const searchHtml = await searchResponse.text();
    const eventPageUrl = firstMatch(
      searchHtml,
      /href=["'](https:\/\/www\.earthscope\.org\/geophysical-event\/[^"']+)["']/i,
    );
    if (!eventPageUrl) return { eventPageUrl: null, gmvUrl: null, dataAccessUrl };
    const pageResponse = await fetch(eventPageUrl, {
      headers: { Accept: "text/html", "User-Agent": "RDSISMOS/0.9 EarthScope-product-discovery" },
      next: { revalidate: 3_600 },
    });
    if (!pageResponse.ok) return { eventPageUrl, gmvUrl: null, dataAccessUrl };
    const pageHtml = await pageResponse.text();
    const gmvUrl = firstMatch(pageHtml, /href=["'](https:\/\/www\.earthscope\.org\/app\/uploads\/[^"']+\.mp4)["']/i);
    const observableUrl = firstMatch(pageHtml, /href=["'](https:\/\/observablehq\.com\/@earthscope\/event-data-access[^"']*)["']/i);
    return { eventPageUrl, gmvUrl, dataAccessUrl: observableUrl ?? dataAccessUrl };
  } catch {
    return { eventPageUrl: null, gmvUrl: null, dataAccessUrl };
  }
}

export async function loadEarthScopeIntegration(options: {
  latitude: number;
  longitude: number;
  depthKm: number;
  interactionDistancesKm: number[];
  sourceEvent?: EarthScopeSourceEvent;
}): Promise<EarthScopeIntegration> {
  const warnings: string[] = [];
  const [stationsResult, travelResult, products] = await Promise.all([
    fetchStations(options.latitude, options.longitude, options.sourceEvent?.timeUtc)
      .catch((error) => {
        warnings.push(error instanceof Error ? error.message : "EarthScope: estaciones no disponibles.");
        return [] as EarthScopeStation[];
      }),
    fetchTravelTimes(options.depthKm, options.interactionDistancesKm)
      .catch((error) => {
        warnings.push(error instanceof Error ? error.message : "EarthScope: tiempos de viaje no disponibles.");
        return [] as EarthScopeTravelTime[];
      }),
    discoverProducts(options.sourceEvent),
  ]);

  return {
    provider: "EarthScope NSF SAGE",
    available: stationsResult.length > 0 || travelResult.length > 0,
    stationRadiusDeg: STATION_RADIUS_DEG,
    stations: stationsResult,
    travelTimes: travelResult,
    travelTimeModel: "iasp91",
    products,
    warnings,
  };
}

export function closestEarthScopeTravelTime(
  distanceKm: number,
  samples: EarthScopeTravelTime[],
) {
  return samples.reduce<EarthScopeTravelTime | null>((best, sample) => {
    if (!best) return sample;
    return Math.abs(sample.distanceKm - distanceKm) < Math.abs(best.distanceKm - distanceKm)
      ? sample
      : best;
  }, null);
}
