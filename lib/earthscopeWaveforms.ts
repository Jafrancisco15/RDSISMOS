import type { EarthScopeStation } from "@/lib/earthscopeIntegration";
import { haversineKm } from "@/lib/regions";
import { fetchEarthScopeGeoCsv } from "@/lib/earthscopeDataSelect";

const EARTHSCOPE_STATION_URL = "https://service.earthscope.org/fdsnws/station/1/query";
const USER_AGENT = "RDSISMOS/1.2 EarthScope-observed-waveforms-dataselect";
const MAX_WAVEFORM_STATIONS = 10;
const MAX_POINTS_PER_TRACE = 900;
const PRE_EVENT_SECONDS = 60;
const POST_EVENT_SECONDS = 2 * 60 * 60;

export interface EarthScopeWaveformSource {
  id: string;
  timeUtc: string;
  latitude: number;
  longitude: number;
  magnitude: number;
  depthKm: number;
  place: string;
}

export interface EarthScopeChannel {
  network: string;
  station: string;
  location: string;
  channel: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  sampleRateHz: number | null;
  scaleUnits: string | null;
}

export interface EarthScopeWaveformSample {
  tSec: number;
  value: number;
  normalized: number;
}

export interface EarthScopeObservedTrace {
  network: string;
  station: string;
  location: string;
  channel: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  siteName: string;
  sampleRateHz: number | null;
  units: string;
  calibration: "response-corrected" | "sensitivity-scaled";
  maxAbs: number;
  samples: EarthScopeWaveformSample[];
}

export interface EarthScopeObservedWaveforms {
  provider: "EarthScope NSF SAGE";
  mode: "observed";
  available: boolean;
  source: EarthScopeWaveformSource;
  windowStartUtc: string;
  windowEndUtc: string;
  traces: EarthScopeObservedTrace[];
  requestedStations: number;
  warnings: string[];
  note: string;
}

function finite(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function channelPriority(channel: string) {
  // Prefer moderate-rate broadband data for bounded GeoCSV payloads.
  const order = ["BHZ", "LHZ", "HHZ", "EHZ", "HNZ"];
  const index = order.indexOf(channel.toUpperCase());
  return index === -1 ? 99 : index;
}

function locationPriority(location: string) {
  if (location === "00") return 0;
  if (location === "10") return 1;
  if (!location || location === "--") return 2;
  return 3;
}

export function parseEarthScopeChannels(text: string): EarthScopeChannel[] {
  const result: EarthScopeChannel[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const columns = line.split("|");
    // Channel-level FDSN text columns:
    // Network Station Location Channel Latitude Longitude Elevation Depth
    // Azimuth Dip Instrument Scale ScaleFreq ScaleUnits SampleRate Start End
    if (columns.length < 15) continue;
    const latitude = finite(columns[4]);
    const longitude = finite(columns[5]);
    if (latitude === null || longitude === null) continue;
    result.push({
      network: columns[0]?.trim() || "—",
      station: columns[1]?.trim() || "—",
      location: columns[2]?.trim() || "--",
      channel: columns[3]?.trim() || "—",
      latitude,
      longitude,
      elevationM: finite(columns[6]),
      scaleUnits: columns[13]?.trim() || null,
      sampleRateHz: finite(columns[14]),
    });
  }
  return result;
}

export function choosePreferredChannel(channels: EarthScopeChannel[]) {
  return [...channels]
    .filter((item) => item.channel.toUpperCase().endsWith("Z"))
    .sort((a, b) =>
      channelPriority(a.channel) - channelPriority(b.channel)
      || locationPriority(a.location) - locationPriority(b.location)
      || (a.sampleRateHz ?? 0) - (b.sampleRateHz ?? 0),
    )[0] ?? null;
}

function stationBand(distanceKm: number) {
  if (distanceKm < 800) return 0;
  if (distanceKm < 2_500) return 1;
  if (distanceKm < 5_000) return 2;
  return 3;
}

/** Selects a small geographically diverse subset so observed mode is bounded. */
export function selectWaveformStations(stations: EarthScopeStation[], limit = MAX_WAVEFORM_STATIONS) {
  const unique = new Map<string, EarthScopeStation>();
  for (const station of stations) unique.set(`${station.network}:${station.station}`, station);
  const candidates = [...unique.values()];
  const selected: EarthScopeStation[] = [];
  const seen = new Set<string>();

  for (let band = 0; band < 4; band += 1) {
    const bySector = new Map<number, EarthScopeStation[]>();
    for (const station of candidates.filter((item) => stationBand(item.distanceKm) === band)) {
      const sector = Math.floor((((station.azimuthDeg % 360) + 360) % 360) / 60);
      bySector.set(sector, [...(bySector.get(sector) ?? []), station]);
    }
    for (let sector = 0; sector < 6 && selected.length < limit; sector += 1) {
      const item = (bySector.get(sector) ?? []).sort((a, b) => a.distanceKm - b.distanceKm)[0];
      if (!item) continue;
      const key = `${item.network}:${item.station}`;
      if (!seen.has(key)) {
        selected.push(item);
        seen.add(key);
      }
    }
  }

  for (const station of candidates.sort((a, b) => a.distanceKm - b.distanceKm)) {
    if (selected.length >= limit) break;
    const key = `${station.network}:${station.station}`;
    if (seen.has(key)) continue;
    selected.push(station);
    seen.add(key);
  }
  return selected.slice(0, Math.max(1, Math.min(MAX_WAVEFORM_STATIONS, limit)));
}

export function parseEarthScopeGeoCsv(text: string, eventTimeUtc: string) {
  const eventMs = Date.parse(eventTimeUtc);
  if (!Number.isFinite(eventMs)) return [] as Array<{ tSec: number; value: number }>;
  const points: Array<{ tSec: number; value: number }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || /^time[,|\s]/i.test(line)) continue;
    const match = line.match(/^([^,\s]+)[,\s]+([-+0-9.eE]+)$/);
    if (!match) continue;
    const timeMs = Date.parse(match[1]);
    const value = Number(match[2]);
    if (!Number.isFinite(timeMs) || !Number.isFinite(value)) continue;
    points.push({ tSec: (timeMs - eventMs) / 1000, value });
  }
  return points;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))] ?? 0;
}

export function compactAndNormalizeWaveform(
  points: Array<{ tSec: number; value: number }>,
  maximum = MAX_POINTS_PER_TRACE,
): { samples: EarthScopeWaveformSample[]; maxAbs: number } {
  if (!points.length) return { samples: [], maxAbs: 0 };
  const abs = points.map((point) => Math.abs(point.value)).filter(Number.isFinite);
  const robustScale = Math.max(percentile(abs, 0.99), Number.EPSILON);
  const maxAbs = Math.max(...abs, 0);
  const step = Math.max(1, Math.ceil(points.length / Math.max(1, maximum)));
  const compact: Array<{ tSec: number; value: number }> = [];
  for (let start = 0; start < points.length; start += step) {
    const bucket = points.slice(start, start + step);
    if (!bucket.length) continue;
    let representative = bucket[0];
    for (const point of bucket) {
      if (Math.abs(point.value) > Math.abs(representative.value)) representative = point;
    }
    compact.push(representative);
  }
  return {
    maxAbs,
    samples: compact.map((point) => ({
      tSec: Number(point.tSec.toFixed(2)),
      value: point.value,
      normalized: Number(Math.max(-1, Math.min(1, point.value / robustScale)).toFixed(4)),
    })),
  };
}

async function fetchPreferredChannel(station: EarthScopeStation, eventTimeUtc: string) {
  const event = new Date(eventTimeUtc);
  const end = new Date(event.getTime() + POST_EVENT_SECONDS * 1000);
  const params = new URLSearchParams({
    network: station.network,
    station: station.station,
    channel: "HHZ,BHZ,HNZ,EHZ,LHZ",
    level: "channel",
    format: "text",
    starttime: event.toISOString(),
    endtime: end.toISOString(),
    includerestricted: "false",
    nodata: "404",
  });
  const response = await fetch(`${EARTHSCOPE_STATION_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`${station.network}.${station.station}: metadata HTTP ${response.status}`);
  return choosePreferredChannel(parseEarthScopeChannels(await response.text()));
}

function demean(points: Array<{ tSec: number; value: number }>) {
  if (!points.length) return points;
  const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  return points.map((point) => ({ ...point, value: point.value - mean }));
}

async function fetchTrace(
  station: EarthScopeStation,
  channel: EarthScopeChannel,
  source: EarthScopeWaveformSource,
): Promise<EarthScopeObservedTrace> {
  const eventMs = Date.parse(source.timeUtc);
  const start = new Date(eventMs - PRE_EVENT_SECONDS * 1000).toISOString();
  const end = new Date(eventMs + POST_EVENT_SECONDS * 1000).toISOString();
  const text = await fetchEarthScopeGeoCsv({
    network: channel.network,
    station: channel.station,
    location: channel.location,
    channel: channel.channel,
    startTimeUtc: start,
    endTimeUtc: end,
    userAgent: USER_AGENT,
  });
  const points = demean(parseEarthScopeGeoCsv(text, source.timeUtc));
  if (points.length < 8) throw new Error("EarthScope dataselect: waveform sin muestras suficientes");
  const compact = compactAndNormalizeWaveform(points);
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
    units: channel.scaleUnits || "unidad física según sensibilidad",
    calibration: "sensitivity-scaled",
    maxAbs: compact.maxAbs,
    samples: compact.samples,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R | null>) {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
  return results.filter((item): item is R => item !== null);
}

export async function loadObservedEarthScopeWaveforms(options: {
  source: EarthScopeWaveformSource;
  stations: EarthScopeStation[];
  limit?: number;
}): Promise<EarthScopeObservedWaveforms> {
  const warnings: string[] = [];
  const source = options.source;
  const eventMs = Date.parse(source.timeUtc);
  if (!Number.isFinite(eventMs)) throw new Error("El evento real no tiene una fecha UTC válida.");
  const selected = selectWaveformStations(options.stations, options.limit ?? MAX_WAVEFORM_STATIONS);

  const channelPairs = await mapWithConcurrency(selected, 4, async (station) => {
    try {
      const channel = await fetchPreferredChannel(station, source.timeUtc);
      if (!channel) {
        warnings.push(`${station.network}.${station.station}: sin canal vertical compatible.`);
        return null;
      }
      return { station, channel };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `${station.network}.${station.station}: metadata no disponible.`);
      return null;
    }
  });

  const traces = await mapWithConcurrency(channelPairs, 3, async ({ station, channel }) => {
    try {
      return await fetchTrace(station, channel, source);
    } catch (error) {
      warnings.push(`${station.network}.${station.station}.${channel.channel}: ${error instanceof Error ? error.message : "forma de onda no disponible"}`);
      return null;
    }
  });

  return {
    provider: "EarthScope NSF SAGE",
    mode: "observed",
    available: traces.length > 0,
    source,
    windowStartUtc: new Date(eventMs - PRE_EVENT_SECONDS * 1000).toISOString(),
    windowEndUtc: new Date(eventMs + POST_EVENT_SECONDS * 1000).toISOString(),
    traces,
    requestedStations: selected.length,
    warnings: warnings.slice(0, 20),
    note: "Las amplitudes/signos provienen de waveforms reales EarthScope FDSN dataselect. GeoCSV scale=AUTO aplica la sensibilidad instrumental; la normalización es visual por estación y no representa probabilidad de disparo sísmico.",
  };
}
