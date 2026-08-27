import { NextRequest, NextResponse } from "next/server";
import { getGeomagneticLearningStatus } from "@/lib/geomagneticLearningStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const limit = Math.max(10, Math.min(150, Number(request.nextUrl.searchParams.get("limit") ?? 60) || 60));
  const status = await getGeomagneticLearningStatus(limit);
  return NextResponse.json({
    ...status,
    generatedAt: new Date().toISOString(),
    methodology: {
      prospective: "Cada ensayo se congela antes del resultado; el umbral_snapshot nunca se reescribe.",
      eventDefinition: "Al menos un terremoto M3.0+ dentro del radio y ventana congelados del ensayo.",
      outcomes: "ACIERTO = señal + evento; FALLO = señal sin evento; OMISIÓN = no señal + evento; RECHAZO CORRECTO = no señal y no evento.",
      calibration: "El umbral futuro se recalibra con ensayos evaluados emitidos y no emitidos; el cambio máximo es ±3 puntos por ciclo.",
    },
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
