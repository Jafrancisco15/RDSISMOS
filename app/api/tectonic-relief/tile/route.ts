import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const TERRARIUM_ROOT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

function validInteger(value: string | null, minimum: number, maximum: number) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}

export async function GET(request: NextRequest) {
  const z = validInteger(request.nextUrl.searchParams.get("z"), 0, 8);
  if (z === null) return NextResponse.json({ error: "Zoom inválido." }, { status: 400 });

  const maxTile = 2 ** z - 1;
  const x = validInteger(request.nextUrl.searchParams.get("x"), 0, maxTile);
  const y = validInteger(request.nextUrl.searchParams.get("y"), 0, maxTile);
  if (x === null || y === null) return NextResponse.json({ error: "Tile inválido." }, { status: 400 });

  try {
    const upstream = await fetch(`${TERRARIUM_ROOT}/${z}/${x}/${y}.png`, {
      headers: { Accept: "image/png", "User-Agent": "RDSISMOS/1.0" },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 604_800 },
    });
    if (!upstream.ok) throw new Error(`Terrarium respondió HTTP ${upstream.status}`);
    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar el tile de relieve." },
      { status: 502 },
    );
  }
}
