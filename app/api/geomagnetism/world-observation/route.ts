import { NextResponse } from "next/server";
import { fetchFederatedGeomagneticSeries, fetchFederatedGeomagneticStations, usgsStationsAsNetwork } from "@/lib/geomagneticProviders";
import { anomalyObservations, buildMagneticGrid, buildSwarmMagneticGrid, observationFromSeries, selectGlobalGroundStations, type GroundMagneticObservation } from "@/lib/geomagneticWorld";
import { fetchUsgsGeomagSeries } from "@/lib/usgsGeomag";
import { fetchRecentSwarmMagnetics } from "@/lib/swarmGeomag";
import { fetchSuperMagContext } from "@/lib/supermag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const LOOKBACK_HOURS = 30;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const USGS_SAFE_LAG_MINUTES = 20;
const USGS_FALLBACK_HOURS = 12;

function dedupeObservations(items: GroundMagneticObservation[]) {
  const byCode = new Map<string, GroundMagneticObservation>();
  for (const item of items) {
    const current = byCode.get(item.stationCode);
    if (!current || Date.parse(item.observedAt) > Date.parse(current.observedAt)) byCode.set(item.stationCode, item);
  }
  return [...byCode.values()];
}

function safeObservationEnd() {
  return new Date(Date.now() - USGS_SAFE_LAG_MINUTES * MINUTE_MS);
}

async function recentFederatedSnapshot(signal?: AbortSignal) {
  const { stations, warnings: networkWarnings } = await fetchFederatedGeomagneticStations(signal);
  const distributed = selectGlobalGroundStations(stations, 24);
  const usgsCodes = new Set(usgsStationsAsNetwork().map((station) => station.code));
  const selected = [
    ...distributed.filter((station) => usgsCodes.has(station.code)),
    ...distributed.filter((station) => !usgsCodes.has(station.code)),
  ].slice(0, 24);
  const end = safeObservationEnd();
  const start = new Date(end.getTime() - LOOKBACK_HOURS * HOUR_MS);
  const observations: GroundMagneticObservation[] = [];
  const warnings = [...networkWarnings];

  for (let offset = 0; offset < selected.length; offset += 6) {
    const batch = selected.slice(offset, offset + 6);
    const settled = await Promise.allSettled(batch.map((station) => fetchFederatedGeomagneticSeries(station, start, end, signal)));
    settled.forEach((result, index) => {
      const station = batch[index];
      if (result.status === "fulfilled") {
        const observation = observationFromSeries(station, result.value);
        if (observation) observations.push(observation);
        else warnings.push(`${station.code}: serie reciente disponible pero insuficiente para el snapshot.`);
      } else {
        warnings.push(`${station.code}: ${result.reason instanceof Error ? result.reason.message : "sin datos recientes"}`);
      }
    });
  }

  return { stations, selected, observations, warnings };
}

/**
 * USGS documentation supports 60 s and 3600 s, but operational guidance notes that
 * 3600 s queries are historically less reliable. Use 60 s over a short, lagged window.
 */
async function usgsMinuteFallback(existingCodes: Set<string>, signal?: AbortSignal) {
  const stations = usgsStationsAsNetwork().filter((station) => !existingCodes.has(station.code));
  if (!stations.length) return { observations: [] as GroundMagneticObservation[], warnings: [] as string[] };
  const end = safeObservationEnd();
  const start = new Date(end.getTime() - USGS_FALLBACK_HOURS * HOUR_MS);
  const observations: GroundMagneticObservation[] = [];
  const warnings: string[] = [];

  for (let offset = 0; offset < stations.length; offset += 7) {
    const batch = stations.slice(offset, offset + 7);
    const settled = await Promise.allSettled(batch.map((station) => fetchUsgsGeomagSeries(station.code, start, end, signal)));
    settled.forEach((result, index) => {
      const station = batch[index];
      if (result.status === "fulfilled") {
        const observation = observationFromSeries(station, result.value);
        if (observation) observations.push(observation);
      } else {
        warnings.push(`${station.code}: fallback USGS 60 s no disponible.`);
      }
    });
  }
  return { observations, warnings };
}

async function groundSnapshot(signal?: AbortSignal) {
  const recent = await recentFederatedSnapshot(signal);
  const freshLimit = LOOKBACK_HOURS * HOUR_MS + 2 * HOUR_MS;
  const recentFresh = recent.observations.filter((point) => Date.now() - Date.parse(point.observedAt) <= freshLimit);
  const existingCodes = new Set(recentFresh.map((point) => point.stationCode));
  const fallback = await usgsMinuteFallback(existingCodes, signal);
  const fallbackFresh = fallback.observations.filter((point) => Date.now() - Date.parse(point.observedAt) <= USGS_FALLBACK_HOURS * HOUR_MS + HOUR_MS);
  const observations = dedupeObservations([...recentFresh, ...fallbackFresh]);

  return {
    stations: recent.stations,
    sampledStations: recent.selected.length + fallbackFresh.length,
    observations,
    anomalies: anomalyObservations(observations, 3),
    warnings: [...recent.warnings, ...fallback.warnings],
    fallbackGroundPoints: fallbackFresh.length,
  };
}

function compactWarnings(items: string[]) {
  const temporal = items.filter((warning) => /sin datos|disponibilidad|insuficiente|fallback USGS/i.test(warning));
  const other = items.filter((warning) => !/sin datos|disponibilidad|insuficiente|fallback USGS/i.test(warning));
  const out: string[] = [];
  if (temporal.length) out.push(`${temporal.length} observatorios no aportaron un snapshot reciente utilizable.`);
  out.push(...other.slice(0, 3));
  return [...new Set(out)];
}

export async function GET() {
  try {
    const [groundResult, swarmResult, supermagResult] = await Promise.allSettled([
      groundSnapshot(),
      fetchRecentSwarmMagnetics(3),
      fetchSuperMagContext(),
    ]);

    if (groundResult.status !== "fulfilled") throw groundResult.reason;
    const ground = groundResult.value;
    const swarm = swarmResult.status === "fulfilled" ? swarmResult.value : { points: [], warnings: [swarmResult.reason instanceof Error ? swarmResult.reason.message : "Swarm no disponible"], datasets: [], hours: 3 };
    const supermag = supermagResult.status === "fulfilled" ? supermagResult.value : null;

    const groundGrid = buildMagneticGrid(ground.observations, 5, 3400);
    const swarmGrid = buildSwarmMagneticGrid(swarm.points, 5, 1800);
    const useGroundField = ground.observations.length >= 4 && groundGrid.length >= 20;
    const fieldMode = useGroundField ? "ground" : swarmGrid.length ? "swarm" : "none";
    const grid = fieldMode === "ground" ? groundGrid : fieldMode === "swarm" ? swarmGrid : [];

    const warningDetails = [
      ...ground.warnings,
      ...swarm.warnings,
      ...(supermagResult.status === "rejected" ? [`SuperMAG: ${supermagResult.reason instanceof Error ? supermagResult.reason.message : "sin datos"}`] : []),
    ];
    if (!useGroundField && swarmGrid.length) warningDetails.push("Campo base mostrado desde Swarm porque la red terrestre reciente no alcanzó cobertura mínima de 4 observatorios.");

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      window: { groundLookbackHours: LOOKBACK_HOURS, usgsFallbackHours: USGS_FALLBACK_HOURS, usgsSafeLagMinutes: USGS_SAFE_LAG_MINUTES, swarmLookbackHours: swarm.hours, earthquakesDays: 30 },
      groundPoints: ground.observations,
      grid,
      groundGrid,
      swarmGrid,
      fieldMode,
      anomalies: ground.anomalies,
      swarmPoints: swarm.points,
      supermag,
      coverage: {
        federatedStations: ground.stations.length,
        sampledGroundStations: ground.sampledStations,
        groundPoints: ground.observations.length,
        fallbackGroundPoints: ground.fallbackGroundPoints,
        swarmPoints: swarm.points.length,
        activeGridCells: grid.length,
      },
      sourceStatus: {
        USGS: ground.observations.some((point) => point.source.includes("USGS")),
        INTERMAGNET: ground.observations.some((point) => point.source.includes("INTERMAGNET")),
        Swarm: swarm.points.length > 0,
        SuperMAG: Boolean(supermag),
      },
      warnings: compactWarnings(warningDetails),
      warningDetails,
      methodology: {
        fieldLayer: fieldMode === "ground"
          ? "|F| magnético absoluto reciente de observatorios terrestres; grilla IDW de 5° limitada a 3400 km de observaciones."
          : fieldMode === "swarm"
            ? "|F| magnético observado por Swarm A/B/C a altitud orbital; grilla IDW de 5° limitada a 1800 km de las trayectorias recientes. Se usa como fallback espacial cuando la cobertura terrestre es insuficiente."
            : "Sin cobertura suficiente para construir un campo observado.",
        groundFallback: "USGS usa datos de 60 s durante una ventana corta con 20 min de retraso para evitar minutos aún no publicados; no se usa el fallback de 3600 s.",
        anomalies: "desviación robusta del último |F| terrestre respecto a la mediana de su propia serie reciente (MAD × 1.4826); z≥3 se marca como anomalía preliminar, no como precursor sísmico.",
        swarm: "Swarm A/B/C FAST MAGx_LR_1B a 1 Hz desde VirES HAPI, decimado aproximadamente a 1 punto/minuto. Sus anomalías no se mezclan con las terrestres por diferencia de altitud.",
        supermag: "SME/SMU/SML desde el espejo público CDPP/AMDA; sirve como contexto de perturbación magnetosférica. Los vectores directos de estaciones SuperMAG requieren acceso propio de SuperMAG.",
      },
      licenseNote: "USGS, INTERMAGNET, ESA Swarm/VirES y SuperMAG/CDPP-AMDA conservan sus respectivos términos, atribuciones y reglas de uso.",
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible construir la observación geomagnética global." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
