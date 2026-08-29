import { NextRequest, NextResponse } from "next/server";
import { buildAntipodalFocus } from "@/lib/antipodalSeismic";
import type { TravelTimeModel } from "@/lib/seismicWavefronts";

const MODELS = new Set<TravelTimeModel>(["ak135", "prem", "iasp91"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function modelParam(value: string | null): TravelTimeModel {
  const model = (value ?? "ak135").toLowerCase() as TravelTimeModel;
  return MODELS.has(model) ? model : "ak135";
}

export async function GET(request: NextRequest) {
  const depthKm = boundedNumber(request.nextUrl.searchParams.get("depth"), 10, 0, 700);
  const model = modelParam(request.nextUrl.searchParams.get("model"));
  try {
    return NextResponse.json(buildAntipodalFocus(model, depthKm), {
      headers: { "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=7776000" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No fue posible calcular la focalización antipodal.",
      model,
      depthKm,
    }, { status: 500 });
  }
}
