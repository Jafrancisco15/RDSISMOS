import { NextResponse } from "next/server";
import { fetchFederatedGeomagneticSeries, fetchFederatedGeomagneticStations, usgsStationsAsNetwork } from "@/lib/geomagneticProviders";
import { anomalyObservations, buildMagneticGrid, observationFromSeries, selectGlobalGroundStations, type GroundMagneticObservation } from "@/lib/geomagneticWorld";
import { fetchUsgsGeomagHourlySeries } from "@/lib/usgsGeomag";
import { fetchRecentSwarmMagnetics } from "@/lib/swarmGeomag";
import { fetchSuperMagContext } from "@/lib/supermag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const LOOKBACK_HOURS = 30;
const HOUR_MS = 3_600_000;
const FALLBACK_DAYS = 7;

function dedupeObservations(items: GroundMagneticObservation[]) {
  const byCode = new Map<string, GroundMagneticObservation>();
  for (const item of items) {
    const current = byCode.get(item.stationCode);
    if (!current || Date.parse(item.observedAt) > Date.parse(current.observedAt)) byCode.set(item.stationCode, item);
  }
  return [...byCode.values()];
}

async function recentFederatedSnapshot(signal?: AbortSignal) {
  const { stations, warnings: networkWarnings } = await fetchFederatedGeomagneticStations(signal);
  const distributed = selectGlobalGroundStations(stations, 24);
  const usgsCodes = new Set(usgsStationsAsNetwork().map((station) => station.code));
  const selected = [
    ...distributed.filter((station) => usgsCodes.has(station.code)),
    ...distributed.filter((station) => !usgsCodes.has(station.code)),
  ].slice(0, 24);
  const start = new Date(Date.now() - LOOKBACK_HOURS * HOUR_MS);
  const end = new Date();
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

async function usgsHourlyFallback(existingCodes: Set<string>, signal?: AbortSignal) {
  const stations = usgsStationsAsNetwork().filter((station) => !existingCodes.has(station.code));
  if (!stations.length) return { observations: [] as GroundMagneticObservation[], warnings: [] as string[] };
  const start = new Date(Date.now() - FALLBACK_DAYS * 24 * HOUR_MS);
  const end = new Date();
  const observations: GroundMagneticObservation[] = [];
  const warnings: string[] = [];

  for (let offset = 0; offset < stations.length; offset += 7) {
    const batch = stations.slice(offset, offset + 7);
    const settled = await Promise.allSettled(batch.map((station) => fetchUsgsGeomagHourlySeries(station.code, start, end, signal)));
    settled.forEach((result, index) => {
      const station = batch[index];
      if (result.status === "fulfilled") {
        const observation = observationFromSeries(station, result.value);
        if (observation) observations.push(observation);
      } else {
        warnings.push(`${station.code}: fallback horario USGS no disponible.`);
      }
    });
  }
  return { observations, warnings };
}

async function groundSnapshot(signal?: AbortSignal) {
  const recent = await recentFederatedSnapshot(signal);
  const recentFresh = recent.observations.filter((point) => Date.now() - Date.parse(point.observedAt) <= 96 * HOUR_MS);
  const existingCodes = new Set(recentFresh.map((point) => point.stationCode));
  const fallback = await usgsHourlyFallback(existingCodes, signal);
  const fallbackFresh = fallback.observations.filter((point) => Date.now() - Date.parse(point.observedAt) <= FALLBACK_DAYS * 24 * HOUR_MS + HOUR_MS);
  const observations = dedupeObservations([...recentFresh, ...fallbackFresh]);

  return {
    stations: recent.stations,
    sampledStations: recent.selected.length + fallbackFresh.length,
    observations,
    grid: buildMagneticGrid(observations, 5, 3400),
    anomalies: anomalyObservations(observations, 3),
    warnings: [...recent.warnings, ...fallback.warnings],
    fallbackGroundPoints: fallbackFresh.length,
  };
}

function compactWarnings(items: string[]) {
  const temporal = items.filter((warning) => /sin datos|disponibilidad|insuficiente|fallback horario/i.test(warning));
  const other = items.filter((warning) => !/sin datos|disponibilidad|insuficiente|fallback horario/i.test(warning));
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
    const warningDetails = [
      ...ground.warnings,
      ...swarm.warnings,
      ...(supermagResult.status === "rejected" ? [`SuperMAG: ${supermagResult.reason instanceof Error ? supermagResult.reason.message : "sin datos"}`] : []),
    ];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      window: { groundLookbackHours: LOOKBACK_HOURS, groundFallbackDays: FALLBACK_DAYS, swarmLookbackHours: swarm.hours, earthquakesDays: 30 },
      groundPoints: ground.observations,
      grid: ground.grid,
      anomalies: ground.anomalies,
      swarmPoints: swarm.points,
      supermag,
      coverage: {
        federatedStations: ground.stations.length,
        sampledGroundStations: ground.sampledStations,
        groundPoints: ground.observations.length,
        fallbackGroundPoints: ground.fallbackGroundPoints,
        swarmPoints: swarm.points.length,
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
        fieldLayer: "|F| magnético absoluto reciente de observatorios terrestres; grilla IDW de 5° limitada a 3400 km de observaciones. Amarillo=bajo relativo y rojo=alto relativo dentro del snapshot.",
        fallback: "Si las series recientes federadas no entregan suficiente cobertura, se añaden observatorios USGS con muestreo horario de hasta 7 días. El tiempo exacto de cada punto permanece visible en su popup.",
        anomalies: "desviación robusta del último |F| respecto a la mediana de su propia serie reciente (MAD × 1.4826); z≥3 se marca como anomalía preliminar, no como precursor sísmico.",
        swarm: "Swarm A/B/C FAST MAGx_LR_1B a 1 Hz desde VirES HAPI, decimado aproximadamente a 1 punto/minuto. Se dibuja como cobertura satelital y no se mezcla con el heatmap terrestre por diferencia de altitud.",
        supermag: "SME/SMU/SML desde el espejo público CDPP/AMDA; sirve como contexto de perturbación magnetosférica. Los vectores directos de estaciones SuperMAG requieren acceso propio de SuperMAG.",
      },
      licenseNote: "USGS, INTERMAGNET, ESA Swarm/VirES y SuperMAG/CDPP-AMDA conservan sus respectivos términos, atribuciones y reglas de uso.",
    }, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible construir la observación geomagnética global." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}