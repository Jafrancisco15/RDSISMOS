import { NextResponse } from "next/server";
import { fetchFederatedGeomagneticSeries, fetchFederatedGeomagneticStations } from "@/lib/geomagneticProviders";
import { anomalyObservations, buildMagneticGrid, observationFromSeries, selectGlobalGroundStations, type GroundMagneticObservation } from "@/lib/geomagneticWorld";
import { fetchRecentSwarmMagnetics } from "@/lib/swarmGeomag";
import { fetchSuperMagContext } from "@/lib/supermag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const LOOKBACK_HOURS = 72;

async function groundSnapshot(signal?: AbortSignal) {
  const { stations, warnings: networkWarnings } = await fetchFederatedGeomagneticStations(signal);
  const selected = selectGlobalGroundStations(stations, 28);
  const start = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000);
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
        else warnings.push(`${station.code}: serie disponible pero insuficiente para el snapshot.`);
      } else {
        warnings.push(`${station.code}: ${result.reason instanceof Error ? result.reason.message : "sin datos recientes"}`);
      }
    });
  }

  const fresh = observations.filter((point) => Date.now() - Date.parse(point.observedAt) <= 96 * 3_600_000);
  return {
    stations,
    sampledStations: selected.length,
    observations: fresh,
    grid: buildMagneticGrid(fresh, 10, 3200),
    anomalies: anomalyObservations(fresh, 3),
    warnings,
  };
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
    const warnings = [
      ...ground.warnings,
      ...swarm.warnings,
      ...(supermagResult.status === "rejected" ? [`SuperMAG: ${supermagResult.reason instanceof Error ? supermagResult.reason.message : "sin datos"}`] : []),
    ];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      window: { groundLookbackHours: LOOKBACK_HOURS, swarmLookbackHours: swarm.hours, earthquakesDays: 30 },
      groundPoints: ground.observations,
      grid: ground.grid,
      anomalies: ground.anomalies,
      swarmPoints: swarm.points,
      supermag,
      coverage: {
        federatedStations: ground.stations.length,
        sampledGroundStations: ground.sampledStations,
        groundPoints: ground.observations.length,
        swarmPoints: swarm.points.length,
      },
      sourceStatus: {
        USGS: ground.observations.some((point) => point.source.includes("USGS")),
        INTERMAGNET: ground.observations.some((point) => point.source.includes("INTERMAGNET")),
        Swarm: swarm.points.length > 0,
        SuperMAG: Boolean(supermag),
      },
      warnings,
      methodology: {
        fieldLayer: "|F| magnético absoluto reciente de observatorios terrestres; interpolación IDW limitada a 3200 km de observaciones. Amarillo=bajo relativo y rojo=alto relativo dentro del snapshot.",
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
