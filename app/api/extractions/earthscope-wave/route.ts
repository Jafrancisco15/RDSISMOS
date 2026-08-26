import { NextRequest, NextResponse } from "next/server";
import { estimateWaveArrivals } from "@/lib/frackingWaveAnalysis";
import { haversineKm } from "@/lib/extractions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATION_URL = "https://service.earthscope.org/fdsnws/station/1/query";
const DATASELECT_URL = "https://service.earthscope.org/fdsnws/dataselect/1/query";

type Channel = {
  network: string;
  station: string;
  location: string;
  channel: string;
  latitude: number;
  longitude: number;
  siteName?: string;
  units?: string;
  sampleRate?: number;
  distanceKm: number;
};

function numberParam(value: string | null, name: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} inválido.`);
  return parsed;
}

function textParam(value: string | null, name: string) {
  if (!value) throw new Error(`${name} es requerido.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} inválido.`);
  return parsed.toISOString();
}

function parseChannels(text: string, siteLat: number, siteLon: number): Channel[] {
  const channels: Channel[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("|");
    if (fields.length < 17) continue;
    const latitude = Number(fields[4]);
    const longitude = Number(fields[5]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    channels.push({
      network: fields[0],
      station: fields[1],
      location: fields[2] || "--",
      channel: fields[3],
      latitude,
      longitude,
      siteName: fields[10] || undefined,
      units: fields[13] || undefined,
      sampleRate: Number.isFinite(Number(fields[14])) ? Number(fields[14]) : undefined,
      distanceKm: haversineKm(siteLat, siteLon, latitude, longitude),
    });
  }
  return channels.sort((a, b) => a.distanceKm - b.distanceKm);
}

async function stationChannels(siteLat: number, siteLon: number, start: string, end: string, signal: AbortSignal) {
  const params = new URLSearchParams({
    latitude: String(siteLat),
    longitude: String(siteLon),
    maxradius: "4",
    channel: "BHZ,HHZ,EHZ",
    level: "channel",
    format: "text",
    includerestricted: "false",
    nodata: "404",
    starttime: start,
    endtime: end,
  });
  const response = await fetch(`${STATION_URL}?${params}`, {
    cache: "no-store",
    signal,
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/1.0 EarthScope analysis" },
  });
  if (response.status === 204 || response.status === 404) return [] as Channel[];
  if (!response.ok) throw new Error(`EarthScope station HTTP ${response.status}`);
  return parseChannels(await response.text(), siteLat, siteLon);
}

function uniqueStationCount(channels: Channel[]) {
  return new Set(channels.map((channel) => `${channel.network}.${channel.station}`)).size;
}

function waveformValues(text: string) {
  const values: number[] = [];
  let units: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const match = line.match(/unit[s]?\s*[:=]\s*([^,;]+)/i);
      if (match) units = match[1].trim();
      continue;
    }
    const parts = line.split(/[\s,|]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const value = Number(parts[parts.length - 1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return { values, units };
}

function rms(values: number[]) {
  if (!values.length) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

async function waveformEvidence(channel: Channel, surfaceArrivalUtc: string, signal: AbortSignal) {
  const arrivalMs = new Date(surfaceArrivalUtc).getTime();
  const start = new Date(arrivalMs - 90_000).toISOString();
  const end = new Date(arrivalMs + 180_000).toISOString();
  const params = new URLSearchParams({
    net: channel.network,
    sta: channel.station,
    loc: channel.location === "--" ? "--" : channel.location,
    cha: channel.channel,
    starttime: start,
    endtime: end,
    format: "geocsv",
    scale: "AUTO",
    nodata: "404",
  });
  const response = await fetch(`${DATASELECT_URL}?${params}`, {
    cache: "no-store",
    signal,
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/1.0 EarthScope analysis" },
  });
  if (response.status === 204 || response.status === 404) return { available: false as const };
  if (!response.ok) throw new Error(`EarthScope dataselect HTTP ${response.status}`);
  const parsed = waveformValues(await response.text());
  if (parsed.values.length < 20) return { available: false as const };
  const baselineCount = Math.max(10, Math.floor(parsed.values.length / 3));
  const baseline = rms(parsed.values.slice(0, baselineCount));
  const peak = Math.max(...parsed.values.map((value) => Math.abs(value)));
  return {
    available: true as const,
    sampleCount: parsed.values.length,
    peakAbs: peak,
    baselineRms: baseline,
    peakToBaseline: baseline && baseline > 0 ? peak / baseline : null,
    units: parsed.units ?? channel.units ?? null,
    startUtc: start,
    endUtc: end,
  };
}

export async function GET(request: NextRequest) {
  try {
    const siteLat = numberParam(request.nextUrl.searchParams.get("siteLat"), "siteLat");
    const siteLon = numberParam(request.nextUrl.searchParams.get("siteLon"), "siteLon");
    const sourceLat = numberParam(request.nextUrl.searchParams.get("sourceLat"), "sourceLat");
    const sourceLon = numberParam(request.nextUrl.searchParams.get("sourceLon"), "sourceLon");
    const sourceDepthKm = numberParam(request.nextUrl.searchParams.get("sourceDepthKm"), "sourceDepthKm");
    const magnitude = numberParam(request.nextUrl.searchParams.get("magnitude"), "magnitude");
    const sourceTime = textParam(request.nextUrl.searchParams.get("sourceTime"), "sourceTime");

    const arrivals = estimateWaveArrivals({ latitude: sourceLat, longitude: sourceLon, depthKm: sourceDepthKm, timeUtc: sourceTime }, { latitude: siteLat, longitude: siteLon });
    const surfaceMs = new Date(arrivals.surfaceArrivalUtc).getTime();
    const historicalStart = new Date(surfaceMs - 10 * 60_000).toISOString();
    const historicalEnd = new Date(surfaceMs + 10 * 60_000).toISOString();
    const now = new Date();
    const currentStart = new Date(now.getTime() - 60 * 60_000).toISOString();
    const currentEnd = now.toISOString();

    const warnings: string[] = [];
    let historical: Channel[] = [];
    let current: Channel[] = [];
    try {
      [historical, current] = await Promise.all([
        stationChannels(siteLat, siteLon, historicalStart, historicalEnd, request.signal),
        stationChannels(siteLat, siteLon, currentStart, currentEnd, request.signal),
      ]);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "No fue posible consultar estaciones EarthScope.");
    }

    let waveform: Awaited<ReturnType<typeof waveformEvidence>> = { available: false };
    const nearest = historical[0] ?? null;
    if (nearest) {
      try {
        waveform = await waveformEvidence(nearest, arrivals.surfaceArrivalUtc, request.signal);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "No fue posible recuperar la forma de onda EarthScope.");
      }
    }

    return NextResponse.json({
      source: { latitude: sourceLat, longitude: sourceLon, depthKm: sourceDepthKm, magnitude, timeUtc: sourceTime },
      arrivals,
      earthscope: {
        historicalStationCount: uniqueStationCount(historical),
        currentStationCount: uniqueStationCount(current),
        nearestHistoricalStation: nearest ? {
          network: nearest.network,
          station: nearest.station,
          location: nearest.location,
          channel: nearest.channel,
          latitude: nearest.latitude,
          longitude: nearest.longitude,
          distanceKm: nearest.distanceKm,
          siteName: nearest.siteName ?? null,
          sampleRate: nearest.sampleRate ?? null,
        } : null,
        waveform,
      },
      warnings,
      methodology: {
        eventCatalog: "USGS/NEIC via RDSISMOS",
        stationAndWaveform: "EarthScope FDSN station + dataselect",
        waveModel: "Approximate constant velocities P=8.0 km/s, S=4.6 km/s, surface=3.5 km/s; not TauP.",
      },
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible ejecutar el análisis EarthScope." }, { status: 400 });
  }
}
