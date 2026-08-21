import { NextRequest, NextResponse } from "next/server";
import { fetchSlab2Context } from "@/lib/slab2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function coordinate(value: string | null, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export async function GET(request: NextRequest) {
  const latitude = coordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  const longitude = coordinate(request.nextUrl.searchParams.get("lon"), -180, 180);
  const depthKm = coordinate(request.nextUrl.searchParams.get("depth"), 0, 750);
  if (latitude === null || longitude === null || depthKm === null) {
    return NextResponse.json(
      { error: "Use lat, lon y depth con valores válidos." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const context = await fetchSlab2Context({ latitude, longitude, depthKm }, request.signal);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    context,
    methodology: "Se interpola localmente la superficie Slab2 y se compara su profundidad con el hipocentro. La clase tectónica es una inferencia geométrica, no una atribución definitiva de falla.",
  }, {
    headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
