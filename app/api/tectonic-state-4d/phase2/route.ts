import { NextRequest, NextResponse } from "next/server";
import { parseEarthScopeStations, type EarthScopeStation } from "@/lib/earthscopeIntegration";
import { selectWaveformStations, type EarthScopeWaveformSource } from "@/lib/earthscopeWaveforms";
import { loadEarthScopeThreeComponentWaveforms } from "@/lib/earthscopeThreeComponent";
import { buildTectonicStatePhase2Coverage } from "@/lib/tectonicStatePhase2";
import { invertTectonicStatePhase3 } from "@/lib/tectonicStatePhase3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATION_URL = "https://service.earthscope.org/fdsnws/station/1/query";

function finite(value: unknown, fallback = Number.NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value: unknown, maximum = 280) {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, maximum) : "";
}

function sourceFrom(value: unknown): EarthScopeWaveformSource | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = clean(raw.externalId ?? raw.id, 120);
  const timeUtc = clean(raw.timeUtc, 80);
  const latitude = finite(raw.latitude);
  const longitude = finite(raw.longitude);
  const magnitude = finite(raw.magnitude);
  const depthKm = finite(raw.depthKm, 0);
  if (!id || !timeUtc || !Number.isFinite(Date.parse(timeUtc))) return null;
  if (![latitude, longitude, magnitude, depthKm].every(Number.isFinite)) return null;
  return {
    id,
    timeUtc: new Date(timeUtc).toISOString(),
    latitude,
    longitude,
    magnitude,
    depthKm: Math.max(0, depthKm),
    place: clean(raw.place, 260) || "Evento sísmico",
  };
}

async function loadStations(source: EarthScopeWaveformSource, signal: AbortSignal) {
  const start = new Date(source.timeUtc);
  const end = new Date(start.getTime() + 45 * 60_000);
  const params = new URLSearchParams({
    format: "text",
    level: "station",
    latitude: source.latitude.toFixed(4),
    longitude: source.longitude.toFixed(4),
    maxradius: "100",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    includerestricted: "false",
    nodata: "404",
  });
  const response = await fetch(`${STATION_URL}?${params}`, {
    headers: { Accept: "text/plain", "User-Agent": "RDSISMOS/1.3 Tectonic-State-4D-phase3" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`EarthScope estaciones HTTP ${response.status}.`);
  const parsed = parseEarthScopeStations(await response.text(), source.latitude, source.longitude);
  return selectWaveformStations(parsed, 24);
}

function stationsFromWaveforms(
  sourceStations: EarthScopeStation[],
  waveStations: Array<{
    network: string;
    station: string;
    latitude: number;
    longitude: number;
    distanceKm: number;
    azimuthDeg: number;
    siteName: string;
  }>,
) {
  const original = new Map(sourceStations.map((station) => [`${station.network}.${station.station}`, station]));
  return waveStations.map((station) => {
    const source = original.get(`${station.network}.${station.station}`);
    return {
      network: station.network,
      station: station.station,
      latitude: station.latitude,
      longitude: station.longitude,
      elevationM: source?.elevationM ?? null,
      siteName: station.siteName,
      distanceKm: station.distanceKm,
      azimuthDeg: station.azimuthDeg,
    } satisfies EarthScopeStation;
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const source = sourceFrom(body.event);
    if (!source) {
      return NextResponse.json(
        { error: "Fase 2/3 requiere un evento real con ID, tiempo, posición, profundidad y magnitud válidos." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const stations = await loadStations(source, request.signal);
    if (!stations.length) {
      return NextResponse.json({
        phase: 2,
        generatedAt: new Date().toISOString(),
        source,
        available: false,
        waveforms: null,
        rayCoverage: null,
        phase3: null,
        warnings: ["EarthScope no devolvió estaciones abiertas para la ventana del evento."],
      }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const waveforms = await loadEarthScopeThreeComponentWaveforms({
      source,
      stations,
      limit: 4,
      signal: request.signal,
    });
    const rayStations = stationsFromWaveforms(stations, waveforms.stations);
    const rayCoverage = buildTectonicStatePhase2Coverage(source, rayStations, {
      horizontalSizeDeg: 4,
      depthSizeKm: 50,
    });
    const phase3 = invertTectonicStatePhase3(waveforms, {
      horizontalSizeDeg: 4,
      depthSizeKm: 50,
    });

    return NextResponse.json({
      phase: 2,
      generatedAt: new Date().toISOString(),
      source,
      available: waveforms.available,
      stationCandidates: stations.length,
      waveforms,
      rayCoverage,
      phase3,
      warnings: [...waveforms.warnings, ...phase3.warnings].slice(0, 36),
      methodology: {
        observedWavefield: "EarthScope fdsnws-dataselect GeoCSV, 3 componentes cuando están disponibles; scale=AUTO aplica sensibilidad instrumental",
        rayGeometry: "RDSISMOS spherical ray tracer, iasp91",
        voxelGrid: "4° × 4° × 50 km",
        inversionStatus: "arrival-time-backprojection-v0.1",
      },
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible ejecutar Fase 2/3." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
