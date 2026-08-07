import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { calculateForecastMetrics } from "./metrics";
import { OPERATIONAL_MINIMUM_MAGNITUDE } from "./operationalProjection";
import { regionalEtasRegistryAvailable } from "./etasStore";

export interface EffectivenessObservation {
  probabilityPct: number;
  baselinePct: number;
  occurred: boolean;
}

export interface ProjectionEffectivenessMetric {
  key: "combined" | "statistical_migration" | "regional_etas";
  label: string;
  issuedCount: number;
  resolvedCount: number;
  pendingCount: number;
  positiveCount: number;
  averageProbabilityPct: number;
  observedRatePct: number;
  brierScore: number | null;
  baselineBrierScore: number | null;
  brierSkillScorePct: number | null;
  accuracyAt50Pct: number | null;
  calibrationGapPct: number | null;
}

export interface ProjectionEffectivenessResponse {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  calculatedAt: string;
  criteria: string;
  combined: ProjectionEffectivenessMetric;
  historical: ProjectionEffectivenessMetric;
  regionalEtas: ProjectionEffectivenessMetric;
  legacyEtasResolvedExcluded: number;
  message?: string;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export function calculateProjectionEffectiveness(
  key: ProjectionEffectivenessMetric["key"],
  label: string,
  observations: EffectivenessObservation[],
  issuedCount: number,
): ProjectionEffectivenessMetric {
  const resolvedCount = observations.length;
  if (!resolvedCount) {
    return {
      key,
      label,
      issuedCount,
      resolvedCount: 0,
      pendingCount: Math.max(0, issuedCount),
      positiveCount: 0,
      averageProbabilityPct: 0,
      observedRatePct: 0,
      brierScore: null,
      baselineBrierScore: null,
      brierSkillScorePct: null,
      accuracyAt50Pct: null,
      calibrationGapPct: null,
    };
  }

  const modelMetrics = calculateForecastMetrics(observations.map((item) => ({
    probabilityPct: item.probabilityPct,
    occurred: item.occurred,
  })));
  const baselineMetrics = calculateForecastMetrics(observations.map((item) => ({
    probabilityPct: item.baselinePct,
    occurred: item.occurred,
  })));
  const skill = baselineMetrics.brierScore > 0
    ? (1 - modelMetrics.brierScore / baselineMetrics.brierScore) * 100
    : null;

  return {
    key,
    label,
    issuedCount,
    resolvedCount,
    pendingCount: Math.max(0, issuedCount - resolvedCount),
    positiveCount: modelMetrics.positiveCount,
    averageProbabilityPct: round(modelMetrics.averageProbability * 100),
    observedRatePct: round(modelMetrics.observedRate * 100),
    brierScore: modelMetrics.brierScore,
    baselineBrierScore: baselineMetrics.brierScore,
    brierSkillScorePct: skill === null ? null : round(skill),
    accuracyAt50Pct: round(modelMetrics.accuracyAt50 * 100),
    calibrationGapPct: round(
      (modelMetrics.averageProbability - modelMetrics.observedRate) * 100,
    ),
  };
}

const EMPTY = (key: ProjectionEffectivenessMetric["key"], label: string) =>
  calculateProjectionEffectiveness(key, label, [], 0);

export async function loadProjectionEffectiveness(): Promise<ProjectionEffectivenessResponse> {
  const calculatedAt = new Date().toISOString();
  const base: ProjectionEffectivenessResponse = {
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: false,
    calculatedAt,
    criteria:
      "Solo proyecciones operacionales resueltas. Brier menor es mejor; Brier Skill positivo significa que el pronóstico supera su propia línea base.",
    combined: EMPTY("combined", "Todos los pronósticos auditables"),
    historical: EMPTY("statistical_migration", "Migración estadística"),
    regionalEtas: EMPTY("regional_etas", "ETAS regional inmutable"),
    legacyEtasResolvedExcluded: 0,
  };

  const sql = getDb();
  if (!sql) return { ...base, message: "DATABASE_URL no está configurada." };

  try {
    const [historicalIssuedRow] = await sql`
      SELECT COUNT(*)::int AS count
      FROM migration_country_predictions p
      WHERE p.probability_pct > 0
        AND p.excess_probability_pct > 0
        AND p.magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
    `;
    const historicalRows = await sql`
      SELECT p.probability_pct, p.baseline_probability_pct, o.occurred
      FROM migration_country_predictions p
      JOIN migration_outcomes o ON o.prediction_id = p.id
      WHERE p.probability_pct > 0
        AND p.excess_probability_pct > 0
        AND p.magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
        AND p.surveillance_end <= NOW()
        AND COALESCE(o.evaluation_payload, '{}'::jsonb) @> ${sql.json({ criteriaVersion: 3 })}
    `;
    const historicalObservations: EffectivenessObservation[] = historicalRows.map((row) => ({
      probabilityPct: number(row.probability_pct),
      baselinePct: number(row.baseline_probability_pct),
      occurred: Boolean(row.occurred),
    }));
    const historicalIssued = number(historicalIssuedRow?.count);

    let etasIssued = 0;
    let legacyEtasResolvedExcluded = 0;
    let etasObservations: EffectivenessObservation[] = [];
    if (await regionalEtasRegistryAvailable()) {
      const [etasIssuedRow] = await sql`
        SELECT COUNT(*)::int AS count
        FROM regional_etas_projections
        WHERE probability_pct > 0
          AND excess_probability_pct > 0
          AND magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
          AND COALESCE(evaluation_payload, '{}'::jsonb) @> ${sql.json({
            issuancePolicyVersion: 1,
            immutableIssuance: true,
          })}
      `;
      etasIssued = number(etasIssuedRow?.count);
      const etasRows = await sql`
        SELECT probability_pct, baseline_probability_pct, status
        FROM regional_etas_projections
        WHERE probability_pct > 0
          AND excess_probability_pct > 0
          AND magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
          AND resolved_at IS NOT NULL
          AND COALESCE(evaluation_payload, '{}'::jsonb) @> ${sql.json({
            issuancePolicyVersion: 1,
            immutableIssuance: true,
          })}
      `;
      etasObservations = etasRows.map((row) => ({
        probabilityPct: number(row.probability_pct),
        baselinePct: number(row.baseline_probability_pct),
        occurred: String(row.status) === "fulfilled",
      }));
      const [legacyRow] = await sql`
        SELECT COUNT(*)::int AS count
        FROM regional_etas_projections
        WHERE resolved_at IS NOT NULL
          AND probability_pct > 0
          AND excess_probability_pct > 0
          AND magnitude_max >= ${OPERATIONAL_MINIMUM_MAGNITUDE}
          AND NOT (COALESCE(evaluation_payload, '{}'::jsonb) @> ${sql.json({
            issuancePolicyVersion: 1,
            immutableIssuance: true,
          })})
      `;
      legacyEtasResolvedExcluded = number(legacyRow?.count);
    }

    const historical = calculateProjectionEffectiveness(
      "statistical_migration",
      "Migración estadística",
      historicalObservations,
      historicalIssued,
    );
    const regionalEtas = calculateProjectionEffectiveness(
      "regional_etas",
      "ETAS regional inmutable",
      etasObservations,
      etasIssued,
    );
    const combinedObservations = [...historicalObservations, ...etasObservations];
    const combined = calculateProjectionEffectiveness(
      "combined",
      "Todos los pronósticos auditables",
      combinedObservations,
      historicalIssued + etasIssued,
    );

    return {
      ...base,
      databaseConnected: true,
      combined,
      historical,
      regionalEtas,
      legacyEtasResolvedExcluded,
      message: legacyEtasResolvedExcluded
        ? `${legacyEtasResolvedExcluded} resultados ETAS anteriores se excluyen del scoring estricto porque su probabilidad emitida pudo haber sido recalculada después de la emisión.`
        : undefined,
    };
  } catch (error) {
    return {
      ...base,
      databaseConnected: false,
      message: error instanceof Error
        ? error.message
        : "No fue posible calcular la efectividad de las proyecciones.",
    };
  }
}
