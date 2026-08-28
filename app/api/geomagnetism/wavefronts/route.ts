import { NextRequest, NextResponse } from "next/server";
import {
  buildDirectSurfaceCurves,
  deriveDirectShadowZones,
  type TauPJsonResponse,
  type TravelTimeModel,
} from "@/lib/seismicWavefronts";

const TRAVELTIME_URL = "https://service.earthscope.org/irisws/traveltime/1/query";
const USER_AGENT = "RDSISMOS/1.0 TauP-wavefronts";
const MODELS = new Set<TravelTimeModel>(["ak135", "prem", "iasp91"]);
const STEP_DEG = 1.5;

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function modelParam(value: string | null): TravelTimeModel {
  const normalized = (value ?? "ak135").toLowerCase() as TravelTimeModel;
  return MODELS.has(normalized) ? normalized : "ak135";
}

function travelDistances(step = STEP_DEG) {
  const values: number[] = [];
  for (let distance = 0; distance <= 180 + 1e-6; distance += step) values.push(Number(Math.min(180, distance).toFixed(2)));
  if (values[values.length - 1] !== 180) values.push(180);
  return values;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const depthKm = numberParam(request.nextUrl.searchParams.get("depth"), 10, 0, 700);
  const model = modelParam(request.nextUrl.searchParams.get("model"));
  const distances = travelDistances();

  const params = new URLSearchParams({
    distdeg: distances.join(","),
    evdepth: depthKm.toFixed(1),
    model,
    phases: "P,S,PKP",
    format: "json",
  });

  try {
    const response = await fetch(`${TRAVELTIME_URL}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      next: { revalidate: 2_592_000 },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`EarthScope traveltime HTTP ${response.status}`);
    const payload = await response.json() as TauPJsonResponse;
    if (!payload || !Array.isArray(payload.arrivals)) throw new Error("Respuesta TauP sin arrivals válidos.");

    const curves = buildDirectSurfaceCurves(payload.arrivals);
    if (!curves.P.length && !curves.S.length) throw new Error("TauP no devolvió fases P/S directas para esta profundidad.");
    const shadowZones = deriveDirectShadowZones(payload.arrivals, STEP_DEG);

    return NextResponse.json({
      provider: "EarthScope NSF SAGE / TauP",
      model,
      depthKm,
      sampleStepDeg: STEP_DEG,
      generatedAt: new Date().toISOString(),
      curves,
      shadowZones,
      note: "Frentes de llegada superficial calculados con TauP y un modelo terrestre 1-D esférico. Las sombras se derivan de la disponibilidad de P directa, S directa y del comienzo de PKP en la misma profundidad/modelo; resolución angular aproximada ±0.75°.",
      source: "EarthScope IRISWS traveltime v1",
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No fue posible calcular los frentes sísmicos TauP.",
      model,
      depthKm,
    }, { status: 502 });
  }
}
