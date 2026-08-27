import { NextResponse } from "next/server";
import { loadVolcanoCatalog } from "@/lib/volcanoSources";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  try {
    const result = await loadVolcanoCatalog();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (error) {
    return NextResponse.json({
      volcanoes: [],
      warnings: [{ source: "RDSISMOS", message: error instanceof Error ? error.message : "No fue posible cargar volcanes." }],
      sources: [],
      generatedAt: new Date().toISOString(),
    }, { status: 200 });
  }
}
