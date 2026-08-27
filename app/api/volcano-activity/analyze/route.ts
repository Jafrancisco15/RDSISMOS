import { NextRequest, NextResponse } from "next/server";
import { countEarthquakes, queryEarthquakes } from "@/lib/earthquakes/usgs";
import { estimateRegionalEtasBaseline } from "@/lib/geomagneticProbabilistic";
import { analyzeVolcanoActivity, combineEtasWithVolcanoEvidence } from "@/lib/volcanoActivity";
import { loadVolcanoCatalog } from "@/lib/volcanoSources";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const DAY = 86_400_000;

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Falta id del volcán." }, { status: 400 });

  const seismicMinMagnitude = numberParam(request.nextUrl.searchParams.get("seismicMinMagnitude"), 1.5, -1, 6);
  const forecastMagnitude = numberParam(request.nextUrl.searchParams.get("forecastMagnitude"), 4.5, 3, 8);
  const radiusKm = numberParam(request.nextUrl.searchParams.get("radiusKm"), 200, 30, 500);
  const horizonDays = numberParam(request.nextUrl.searchParams.get("horizonDays"), 7, 1, 30);
  const now = new Date();

  try {
    const catalog = await loadVolcanoCatalog();
    const volcano = catalog.volcanoes.find((item) => item.id === id || item.volcanoNumber === id);
    if (!volcano) return NextResponse.json({ error: "Volcán no encontrado en el catálogo actual." }, { status: 404 });

    const recentStart = new Date(now.getTime() - 30 * DAY).toISOString();
    const recentPage = await queryEarthquakes({
      startTime: recentStart,
      endTime: now.toISOString(),
      minMagnitude: seismicMinMagnitude,
      latitude: volcano.latitude,
      longitude: volcano.longitude,
      maxRadiusKm: Math.max(200, radiusKm),
      orderBy: "time-asc",
      limit: 5_000,
      offset: 1,
    });

    const backgroundStart = new Date(now.getTime() - 5 * 365.25 * DAY).toISOString();
    const triggerStart = new Date(now.getTime() - 30 * DAY).toISOString();
    const [backgroundCount, triggerPage] = await Promise.all([
      countEarthquakes({
        startTime: backgroundStart,
        endTime: now.toISOString(),
        minMagnitude: 3,
        latitude: volcano.latitude,
        longitude: volcano.longitude,
        maxRadiusKm: radiusKm,
        limit: 1,
        offset: 1,
      }),
      queryEarthquakes({
        startTime: triggerStart,
        endTime: now.toISOString(),
        minMagnitude: 3,
        latitude: volcano.latitude,
        longitude: volcano.longitude,
        maxRadiusKm: Math.min(500, Math.max(radiusKm * 1.5, 250)),
        orderBy: "time-asc",
        limit: 3_000,
        offset: 1,
      }),
    ]);

    const activity = analyzeVolcanoActivity({ volcano, events: recentPage.events, now });
    const baseline = estimateRegionalEtasBaseline({
      backgroundCount,
      backgroundDays: Math.round(5 * 365.25),
      triggerEvents: triggerPage.events,
      issuedAt: now,
      latitude: volcano.latitude,
      longitude: volcano.longitude,
      radiusKm,
      horizonDays,
      magnitudeMin: forecastMagnitude,
      completenessMagnitude: 3,
    });
    const comparison = combineEtasWithVolcanoEvidence(baseline.probability, activity);

    return NextResponse.json({
      volcano,
      generatedAt: now.toISOString(),
      settings: { seismicMinMagnitude, forecastMagnitude, radiusKm, horizonDays },
      activity,
      baseline,
      comparison,
      events: recentPage.events,
      catalogWarnings: catalog.warnings,
      methodology: {
        baseline: "ETAS/Hawkes regional fijo de RDSISMOS: tasa de fondo + productividad y decaimiento Omori de sismos previos. No es todavía un ajuste ETAS MLE por volcán.",
        volcanoLayer: "Capa experimental de evidencia: aceleración de sismicidad cercana, fracción somera, tendencia de profundidad y señales GVP/USGS cuando existen. No equivale a probabilidad de erupción.",
        completeness: "ComCat no tiene la misma completitud para sismos pequeños en todos los volcanes. Para análisis de unrest serio deben incorporarse catálogos de observatorios locales.",
        causality: "La coexistencia temporal de sismos y unrest no demuestra que un terremoto cause una erupción ni que el volcán cause sismos tectónicos regionales.",
      },
      sources: [
        "Smithsonian Global Volcanism Program VOTW / Weekly Volcanic Activity Report",
        "USGS Volcano Hazards Program HANS (cuando aplica)",
        "USGS ComCat FDSN earthquake catalog",
      ],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falló el análisis volcánico." }, { status: 502 });
  }
}
