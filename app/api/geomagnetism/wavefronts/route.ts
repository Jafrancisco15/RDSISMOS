import { NextRequest, NextResponse } from "next/server";
import { buildLocalWavefrontTable } from "@/lib/localSeismicRayTracer";
import type { TravelTimeModel } from "@/lib/seismicWavefronts";

const MODELS = new Set<TravelTimeModel>(["ak135", "prem", "iasp91"]);

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function modelParam(value: string | null): TravelTimeModel {
  const normalized = (value ?? "ak135").toLowerCase() as TravelTimeModel;
  return MODELS.has(normalized) ? normalized : "ak135";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const depthKm = numberParam(request.nextUrl.searchParams.get("depth"), 10, 0, 700);
  const model = modelParam(request.nextUrl.searchParams.get("model"));

  try {
    const table = buildLocalWavefrontTable(model, depthKm);
    if (!table.curves.P.length && !table.curves.S.length) {
      throw new Error("El trazador local no produjo ramas P/S directas para esta profundidad.");
    }
    return NextResponse.json({
      ...table,
      source: "RDSISMOS local 1-D spherical ray tracer · model knots from standard ObsPy/TauP AK135/PREM/IASP91 files",
    }, {
      headers: { "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=7776000" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No fue posible calcular los frentes sísmicos locales.",
      model,
      depthKm,
    }, { status: 500 });
  }
}
