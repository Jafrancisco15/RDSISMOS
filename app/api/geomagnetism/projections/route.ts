import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import {
  approximateCalibrationInterval,
  brierScore,
  informationGainBits,
  molchanWindowCurve,
  PRIMARY_GEOMAGNETIC_EXPERIMENT,
  schusterPValue,
  type ForecastMetricsRow,
} from "@/lib/geomagneticProbabilistic";
import {
  mapProbabilisticForecast,
  mapProbabilisticModel,
  type ProbabilisticGeomagForecastRow,
} from "@/lib/geomagneticProbabilisticStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type DbRow = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function metrics(forecasts: ProbabilisticGeomagForecastRow[]) {
  const evaluated = forecasts.filter((forecast) => forecast.status === "evaluated" && forecast.occurred !== null);
  const rows: ForecastMetricsRow[] = evaluated.map((forecast) => ({
    baselineProbability: forecast.baselineProbability,
    combinedProbability: forecast.combinedProbability,
    occurred: Boolean(forecast.occurred),
    phaseRad: forecast.features?.phaseRad ?? null,
  }));
  const baseline = brierScore(rows, "baselineProbability");
  const combined = brierScore(rows, "combinedProbability");
  const skill = baseline !== null && combined !== null && baseline > 0 ? 1 - combined / baseline : null;
  const positivePhases = evaluated
    .filter((forecast) => forecast.occurred && Number.isFinite(forecast.features?.phaseRad))
    .map((forecast) => Number(forecast.features.phaseRad));
  return {
    evaluatedForecasts: evaluated.length,
    positiveWindows: evaluated.filter((forecast) => forecast.occurred).length,
    brierEtas: baseline,
    brierCombined: combined,
    brierSkillScore: skill,
    informationGainBitsPerWindow: informationGainBits(rows),
    molchan: molchanWindowCurve(rows),
    schusterPValue: schusterPValue(positivePhases),
    schusterPositivePhases: positivePhases.length,
    overlappingWindows: true,
  };
}

export async function GET(request: NextRequest) {
  const limit = Math.max(20, Math.min(365, Number(request.nextUrl.searchParams.get("limit") ?? 180) || 180));
  const databaseConfigured = hasDatabaseConfiguration();
  const sql = getDb();

  if (!sql) {
    return NextResponse.json({
      available: false,
      databaseConfigured: false,
      databaseConnected: false,
      experiment: PRIMARY_GEOMAGNETIC_EXPERIMENT,
      model: mapProbabilisticModel(null),
      forecasts: [],
      metrics: metrics([]),
      message: "DATABASE_URL no está configurada; el análisis manual funciona, pero el experimento prospectivo necesita persistencia.",
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  try {
    // Fast read-only path. Never creates or migrates tables: that remains in
    // generator/evaluator writer routes so opening the dashboard cannot 504.
    const rows = await sql`
      SELECT
        (SELECT row_to_json(m) FROM geomagnetic_prob_model m WHERE m.id = ${PRIMARY_GEOMAGNETIC_EXPERIMENT.id}) AS model,
        COALESCE(
          (SELECT json_agg(f ORDER BY f.issued_at DESC)
           FROM (SELECT * FROM geomagnetic_prob_forecasts ORDER BY issued_at DESC LIMIT ${limit}) f),
          '[]'::json
        ) AS forecasts
    `;
    const row = (rows[0] ?? {}) as DbRow;
    const modelRow = parseJson<DbRow | null>(row.model, null);
    const forecastRows = parseJson<DbRow[]>(row.forecasts, []);
    const forecasts = Array.isArray(forecastRows) ? forecastRows.map(mapProbabilisticForecast) : [];
    const model = mapProbabilisticModel(modelRow);
    const summary = metrics(forecasts);
    const latestActive = forecasts.find((forecast) => forecast.status === "active") ?? null;
    const calibrationInterval = latestActive
      ? approximateCalibrationInterval(latestActive.combinedProbability, summary.evaluatedForecasts)
      : null;

    return NextResponse.json({
      available: true,
      databaseConfigured,
      databaseConnected: true,
      experiment: PRIMARY_GEOMAGNETIC_EXPERIMENT,
      model,
      forecasts,
      metrics: summary,
      calibrationInterval,
      generatedAt: new Date().toISOString(),
      methodology: {
        primaryQuestion: "¿ETAS+Geomag mejora prospectivamente a ETAS para M≥4.5 dentro de 200 km de SJG en los próximos 7 días?",
        prospective: "Cada P_ETAS, P_ETAS+Geomag, vector de features y pesos queda congelado al emitirse y nunca se reescribe.",
        baseline: "ETAS/Hawkes regional fijo: tasa de fondo suavizada + productividad espacial y decaimiento Omori de eventos conocidos antes de la emisión. Aún no es un ajuste ETAS MLE completo.",
        geomagneticLayer: "Regresión logística incremental regularizada como ajuste de log-odds sobre P_ETAS. Los pesos iniciales son cero.",
        cleaning: "SJG USGS; plantilla Sq causal por hora solar local usando solo los 27 días anteriores; modo común con estaciones USGS de referencia; penalización Kp/Dst.",
        spectralBand: "Con datos de 60 s solo se analiza ULF 0.001–0.008 Hz (Nyquist ≈0.00833 Hz); 0.008–0.1 Hz requiere datos más rápidos.",
        validation: "Brier, Brier Skill Score, information gain vs ETAS, curva Molchan por ventanas y Schuster de fase cuando haya muestra suficiente.",
        dependence: "Las proyecciones diarias de 7 días se solapan; las ventanas no son independientes. Para inferencia formal posterior se requiere block bootstrap/permutación temporal.",
        interpretation: "Un aporte geomagnético positivo no demuestra precursor ni causalidad; debe superar ETAS fuera de muestra de forma sostenida.",
        storageRead: "Esta ruta es SELECT-only; no ejecuta DDL ni migraciones.",
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error de PostgreSQL";
    return NextResponse.json({
      available: false,
      databaseConfigured,
      databaseConnected: false,
      experiment: PRIMARY_GEOMAGNETIC_EXPERIMENT,
      model: mapProbabilisticModel(null),
      forecasts: [],
      metrics: metrics([]),
      message: `El ledger probabilístico v2 todavía no está inicializado o la persistencia no responde: ${detail}. El mapa y el análisis manual continúan funcionando.`,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
