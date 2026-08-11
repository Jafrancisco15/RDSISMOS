import { parseEarthScopeStations } from "@/lib/earthscopeIntegration";
import {
  choosePreferredChannel,
  parseEarthScopeChannels,
} from "@/lib/earthscopeWaveforms";
import type { SeismicEvent } from "@/lib/types";

const EARTHSCOPE_STATION_URL = "https://service.earthscope.org/fdsnws/station/1/query";
const EARTHSCOPE_DATASELECT_URL = "https://service.earthscope.org/fdsnws/dataselect/1/query";
const USER_AGENT = "RDSISMOS/1.1 Scope-historical-evidence";
const MAX_RADIUS_DEG = 20;
const WAVEFORM_SECONDS = 60;

export interface ScopeHistoricalEvidence {
  analogEventId: string;
  stationCount: number;
  azimuthSectors: number;
  nearestStationKm: number | null;
  waveformChecked: boolean;
  waveformConfirmed: boolean;
  waveformStation: string | null;
  evidencePct: number;
  weightFactor: number;
  status: "waveform-confirmed" | "metadata-supported" | "limited";
  note: string;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function locationParam(value: string) {
  return !value || value === "--" ? "--" : value;
}

function stationCoverageScore(stationCount: number) {
  return clamp(Math.log2(stationCount + 1) / 6, 0, 1);
}

function sectorCount(azimuths: number[]) {
  const sectors = new Set<number>();
  for (const azimuth of azimuths) {
    if (!Number.isFinite(azimuth)) continue;
    sectors.add(Math.floor((((azimuth % 360) + 360) % 360) / 45));
  }
  return sectors.size;
}

async function loadStations(event: SeismicEvent) {
  const time = new Date(event.time);
  const end = new Date(time.getTime() + 20 * 60_000);
  const params = new URLSearchParams({
    latitude: event.latitude.toFixed(4),
    longitude: event.longitude.toFixed(4),
    maxradius: String(MAX_RADIUS_DEG),
    starttime: time.toISOString(),
    endtime: end.toISOString(),
    channel: "BH?,HH?,HN?,EH?,LH?",
    level: "station",
    format: "text",
    includerestricted: "false",
    nodata: "204",
  });
  const response = await fetch(`${EARTHSCOPE_STATION_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
    next: { revalidate: 86_400 },
  });
  if (response.status === 204) return [];
  if (!response.ok) throw new Error(`EarthScope Station HTTP ${response.status}`);
  return parseEarthScopeStations(await response.text(), event.latitude, event.longitude)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

async function preferredChannel(
  event: SeismicEvent,
  station: { network: string; station: string },
) {
  const time = new Date(event.time);
  const end = new Date(time.getTime() + WAVEFORM_SECONDS * 1_000);
  const params = new URLSearchParams({
    network: station.network,
    station: station.station,
    channel: "BHZ,HHZ,HNZ,EHZ,LHZ",
    level: "channel",
    format: "text",
    starttime: time.toISOString(),
    endtime: end.toISOString(),
    includerestricted: "false",
    nodata: "204",
  });
  const response = await fetch(`${EARTHSCOPE_STATION_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
    next: { revalidate: 86_400 },
  });
  if (response.status === 204) return null;
  if (!response.ok) return null;
  return choosePreferredChannel(parseEarthScopeChannels(await response.text()));
}

async function probeWaveform(event: SeismicEvent, stations: Awaited<ReturnType<typeof loadStations>>) {
  const candidates = stations.slice(0, 4);
  for (const station of candidates) {
    const channel = await preferredChannel(event, station);
    if (!channel) continue;
    const start = new Date(event.time);
    const end = new Date(start.getTime() + WAVEFORM_SECONDS * 1_000);
    const params = new URLSearchParams({
      net: channel.network,
      sta: channel.station,
      loc: locationParam(channel.location),
      cha: channel.channel,
      start: start.toISOString(),
      end: end.toISOString(),
      format: "geocsv.inline",
      scale: "AUTO",
      nodata: "204",
    });
    const response = await fetch(`${EARTHSCOPE_DATASELECT_URL}?${params}`, {
      headers: { Accept: "text/plain", "User-Agent": USER_AGENT },
      next: { revalidate: 86_400 },
    });
    if (response.status === 204 || !response.ok) continue;
    const text = await response.text();
    const dataLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !/^time[,|\s]/i.test(line));
    if (dataLines.length >= 4) {
      return `${channel.network}.${channel.station}.${channel.channel}`;
    }
  }
  return null;
}

export async function loadScopeHistoricalEvidence(
  event: SeismicEvent,
  options: { probeWaveform?: boolean } = {},
): Promise<ScopeHistoricalEvidence> {
  try {
    const stations = await loadStations(event);
    const stationCount = stations.length;
    const sectors = sectorCount(stations.map((station) => station.azimuthDeg));
    const nearest = stations[0]?.distanceKm ?? null;
    const waveformChecked = options.probeWaveform === true && stations.length > 0;
    const waveformStation = waveformChecked ? await probeWaveform(event, stations) : null;
    const waveformConfirmed = Boolean(waveformStation);

    const countScore = stationCoverageScore(stationCount);
    const sectorScore = clamp(sectors / 8, 0, 1);
    const nearestScore = nearest === null ? 0 : clamp(1 - nearest / 2_000, 0, 1);
    const baseScore = waveformChecked
      ? countScore * 0.35 + sectorScore * 0.25 + nearestScore * 0.15 + (waveformConfirmed ? 1 : 0) * 0.25
      : countScore * 0.50 + sectorScore * 0.30 + nearestScore * 0.20;
    const evidencePct = Math.round(clamp(baseScore * 100, 0, 100));
    const weightFactor = Number((0.35 + evidencePct / 100 * 0.65).toFixed(4));
    const status: ScopeHistoricalEvidence["status"] = waveformConfirmed
      ? "waveform-confirmed"
      : evidencePct >= 45
        ? "metadata-supported"
        : "limited";

    return {
      analogEventId: event.id,
      stationCount,
      azimuthSectors: sectors,
      nearestStationKm: nearest === null ? null : Number(nearest.toFixed(1)),
      waveformChecked,
      waveformConfirmed,
      waveformStation,
      evidencePct,
      weightFactor,
      status,
      note: waveformConfirmed
        ? `EarthScope conserva forma de onda para ${waveformStation} y ${stationCount} estaciones activas alrededor del análogo.`
        : stationCount > 0
          ? `${stationCount} estaciones EarthScope estaban activas alrededor del análogo; ${waveformChecked ? "no se confirmó una traza en la muestra acotada" : "la traza no se sondeó para limitar solicitudes"}.`
          : "No se resolvió cobertura EarthScope cercana para la fecha del análogo; el análogo conserva un peso mínimo y no se descarta automáticamente.",
    };
  } catch (error) {
    return {
      analogEventId: event.id,
      stationCount: 0,
      azimuthSectors: 0,
      nearestStationKm: null,
      waveformChecked: options.probeWaveform === true,
      waveformConfirmed: false,
      waveformStation: null,
      evidencePct: 0,
      weightFactor: 0.35,
      status: "limited",
      note: error instanceof Error ? `EarthScope no pudo verificar este análogo: ${error.message}` : "EarthScope no pudo verificar este análogo.",
    };
  }
}
