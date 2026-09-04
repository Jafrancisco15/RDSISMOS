import type { EarthScopeStation } from "./earthscopeIntegration";
import { haversineKm } from "./regions";
import {
  compactAndNormalizeWaveform,
  parseEarthScopeChannels,
  parseEarthScopeGeoCsv,
  selectWaveformStations,
  type EarthScopeChannel,
  type EarthScopeObservedTrace,
  type EarthScopeWaveformSource,
} from "./earthscopeWaveforms";

const STATION_URL = "https://service.earthscope.org/fdsnws/station/1/query";
const TIMESERIES_URL = "https://service.earthscope.org/irisws/timeseries/1/query";
const USER_AGENT = "RDSISMOS/1.1 Tectonic-State-4D-phase2";
const PRE_EVENT_SECONDS = 60;
const POST_EVENT_SECONDS = 45 * 60;

export interface EarthScopeThreeComponentStation {
  network: string;
  station: string;
  location: string;
  band: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  azimuthDeg: number;
  siteName: string;
  complete: boolean;
  components: EarthScopeObservedTrace[];
}

export interface EarthScopeThreeComponentWaveforms {
  provider: "EarthScope NSF SAGE";
  mode: "observed-3c";
  available: boolean;
  source: EarthScopeWaveformSource;
  stations: EarthScopeThreeComponentStation[];
  requestedStations: number;
  completeStations: number;
  traceCount: number;
  windowStartUtc: string;
  windowEndUtc: string;
  warnings: string[];
  note: string;
}

function bandPriority(value: string) {
  const order = ["HH", "BH", "HN", "EH", "LH"];
  const index = order.indexOf(value.toUpperCase());
  return index < 0 ? 99 : index;
}

function locationPriority(value: string) {
  if (value === "00") return 0;
  if (value === "10") return 1;
  if (!value || value === "--") return 2;
  return 3;
}

function componentRank(channel: string) {
  const component = channel.toUpperCase().slice(-1);
  if (component === "Z") return 0;
  if (component === "N") return 1;
  if (component === "E") return 2;
  if (component === "1") return 3;
  if (component === "2") return 4;
  return 99;
}

export function chooseThreeComponentGroup(channels: EarthScopeChannel[]) {
  const groups = new Map<string, EarthScopeChannel[]>();
  for (const channel of channels) {
    const code = channel.channel.toUpperCase();
    if (code.length < 3) continue;
    const band = code.slice(0, 2);
    if (!["HH", "BH", "HN", "EH", "LH"].includes(band)) continue;
    const component = code.slice(-1);
    if (!["Z", "N", "E", "1", "2"].includes(component)) continue;
    const key = `${channel.network}.${channel.station}.${channel.location}.${band}`;
    groups.set(key, [...(groups.get(key) ?? []), channel]);
  }

  const ranked = [...groups.entries()].map(([key, items]) => {
    const vertical = items.find((item) => item.channel.toUpperCase().endsWith("Z"));
    const north = items.find((item) => item.channel.toUpperCase().endsWith("N"))
      ?? items.find((item) => item.channel.toUpperCase().endsWith("1"));
    const east = items.find((item) => item.channel.toUpperCase().endsWith("E"))
      ?? items.find((item) => item.channel.toUpperCase().endsWith("2"));
    const chosen = [vertical, north, east].filter((item): item is EarthScopeChannel => Boolean(item));
    const exemplar = chosen[0] ?? items[0];
    return {
      key,
      band: exemplar?.channel.slice(0, 2).toUpperCase() ?? "",
      location: exemplar?.location ?? "--",
      channels: chosen.sort((a, b) => componentRank(a.channel) - componentRank(b.channel)),
      complete: Boolean(vertical && north && east),
      sampleRateHz: Math.max(0, ...chosen.map((item) => item.sampleRateHz ?? 0)),
    };
  }).filter((group) => group.channels.length > 0);

  return ranked.sort((a, b) =>
    Number(b.complete) - Number(a.complete)
    || bandPriority(a.band) - bandPriority(b.band)
    || locationPriority(a.location) - locationPriority(b.location)
    || b.sampleRateHz - a.sampleRateHz,
  )[0] ?? null;
}

function locationParam(value: string) {
  return !value || value === "--" ? "--" : value;
}

async function preferredGroup(station: EarthScopeStation, eventTimeUtc: string, signal?: AbortSignal) {
  const event = new Date(eventTimeUtc);
  const end = new Date(event.getTime() + POST_EVENT_SECONDS * 1000);
  const params = new URLSearchParams({
    network: station.network,
    station: station.station,
    channel: "HH?,BH?,HN?,EH?,LH?",
    level: "channel",
    format: "text",
    starttime: event.toISOString(),
    endtime: end.toISOString(),
    includerestricted: "false",
    nodata: "404",
  });
  const response = await fetch(`${STATION_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${station.network}.${station.station}: metadata 3C HTTP ${response.status}`);
  return chooseThreeComponentGroup(parseEarthScopeChannels(await response.text()));
}

async function fetchComponentTrace(
  station: EarthScopeStation,
  channel: EarthScopeChannel,
  source: EarthScopeWaveformSource,
  signal?: AbortSignal,
): Promise<EarthScopeObservedTrace> {
  const eventMs = Date.parse(source.timeUtc);
  const start = new Date(eventMs - PRE_EVENT_SECONDS * 1000).toISOString();
  const end = new Date(eventMs + POST_EVENT_SECONDS * 1000).toISOString();

  async function request(corrected: boolean) {
    const params = new URLSearchParams({
      net: channel.network,
      sta: channel.station,
      loc: locationParam(channel.location),
      cha: channel.channel,
      starttime: start,
      endtime: end,
      format: "geocsv.tspair",
      demean: "true",
      deci: "2.0",
    });
    if (corrected) {
      params.set("correct", "true");
      params.set("units", "VEL");
    } else {
      params.set("scale", "AUTO");
    }
    const response = await fetch(`${TIMESERIES_URL}?${params}`, {
      headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`waveform HTTP ${response.status}`);
    const points = parseEarthScopeGeoCsv(await response.text(), source.timeUtc);
    if (points.length < 8) throw new Error("waveform sin muestras suficientes");
    return points;
  }

  let calibration: EarthScopeObservedTrace["calibration"] = "response-corrected";
  let units = "m/s";
  let points: Array<{ tSec: number; value: number }>;
  try {
    points = await request(true);
  } catch {
    points = await request(false);
    calibration = "sensitivity-scaled";
    units = channel.scaleUnits || "unidad física según sensibilidad";
  }
  const compact = compactAndNormalizeWaveform(points, 500);
  return {
    network: channel.network,
    station: channel.station,
    location: channel.location,
    channel: channel.channel,
    latitude: channel.latitude,
    longitude: channel.longitude,
    distanceKm: Number(haversineKm(source.latitude, source.longitude, channel.latitude, channel.longitude).toFixed(1)),
    siteName: station.siteName,
    sampleRateHz: channel.sampleRateHz,
    units,
    calibration,
    maxAbs: compact.maxAbs,
    samples: compact.samples,
  };
}

async function withConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R | null>) {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
  return results.filter((item): item is R => item !== null);
}

export async function loadEarthScopeThreeComponentWaveforms(options: {
  source: EarthScopeWaveformSource;
  stations: EarthScopeStation[];
  limit?: number;
  signal?: AbortSignal;
}): Promise<EarthScopeThreeComponentWaveforms> {
  const warnings: string[] = [];
  const selected = selectWaveformStations(options.stations, Math.max(1, Math.min(5, options.limit ?? 4)));
  const grouped = await withConcurrency(selected, 3, async (station) => {
    try {
      const group = await preferredGroup(station, options.source.timeUtc, options.signal);
      if (!group) {
        warnings.push(`${station.network}.${station.station}: sin familia de canales 3C compatible.`);
        return null;
      }
      const traces = await withConcurrency(group.channels, 3, async (channel) => {
        try {
          return await fetchComponentTrace(station, channel, options.source, options.signal);
        } catch (error) {
          warnings.push(`${station.network}.${station.station}.${channel.channel}: ${error instanceof Error ? error.message : "traza no disponible"}`);
          return null;
        }
      });
      if (!traces.length) return null;
      const suffixes = new Set(traces.map((trace) => trace.channel.slice(-1).toUpperCase()));
      const complete = suffixes.has("Z") && (suffixes.has("N") || suffixes.has("1")) && (suffixes.has("E") || suffixes.has("2"));
      return {
        network: station.network,
        station: station.station,
        location: group.location,
        band: group.band,
        latitude: station.latitude,
        longitude: station.longitude,
        distanceKm: station.distanceKm,
        azimuthDeg: station.azimuthDeg,
        siteName: station.siteName,
        complete,
        components: traces,
      } satisfies EarthScopeThreeComponentStation;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `${station.network}.${station.station}: 3C no disponible.`);
      return null;
    }
  });

  const eventMs = Date.parse(options.source.timeUtc);
  return {
    provider: "EarthScope NSF SAGE",
    mode: "observed-3c",
    available: grouped.length > 0,
    source: options.source,
    stations: grouped,
    requestedStations: selected.length,
    completeStations: grouped.filter((station) => station.complete).length,
    traceCount: grouped.reduce((sum, station) => sum + station.components.length, 0),
    windowStartUtc: new Date(eventMs - PRE_EVENT_SECONDS * 1000).toISOString(),
    windowEndUtc: new Date(eventMs + POST_EVENT_SECONDS * 1000).toISOString(),
    warnings: warnings.slice(0, 30),
    note: "Fase 2 usa registros reales Z/N/E (o Z/1/2) de EarthScope. La corrección de respuesta se intenta por componente; la normalización es únicamente para visualización.",
  };
}
