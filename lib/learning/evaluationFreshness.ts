import { getDb } from "@/lib/db";
import { evaluateActiveCapsules, evaluateDueCapsules } from "./evaluate";

export interface ProjectionEvaluationRefresh {
  checkedAt: string;
  attempted: boolean;
  staleActive: boolean;
  duePending: boolean;
  incrementalTracking: boolean;
  activeCapsulesScanned: number;
  activePredictionsChecked: number;
  liveFulfillments: number;
  dueCapsulesProcessed: number;
  duePredictionsEvaluated: number;
  positiveOutcomes: number;
  errors: string[];
}

declare global {
  // Avoid duplicate refreshes when two panels on the same server instance load together.
  // eslint-disable-next-line no-var
  var rdsismosProjectionRefresh: Promise<ProjectionEvaluationRefresh> | undefined;
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function incrementalColumnAvailable() {
  const sql = getDb();
  if (!sql) return false;
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'migration_country_predictions'
        AND column_name = 'last_checked_at'
    ) AS available
  `;
  return bool(row?.available);
}

async function projectionEvaluationState(maxAgeMinutes: number) {
  const sql = getDb();
  if (!sql) {
    return { staleActive: false, duePending: false, incrementalTracking: false };
  }

  const incrementalTracking = await incrementalColumnAvailable();
  const [row] = incrementalTracking
    ? await sql`
        SELECT
          EXISTS (
            SELECT 1
            FROM migration_country_predictions p
            LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
            WHERE o.prediction_id IS NULL
              AND p.surveillance_end <= NOW()
          ) AS due_pending,
          EXISTS (
            SELECT 1
            FROM migration_country_predictions p
            JOIN migration_capsules c ON c.id = p.capsule_id
            LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
            WHERE o.prediction_id IS NULL
              AND GREATEST(p.surveillance_start, c.generated_at) <= NOW()
              AND p.surveillance_end > NOW()
              AND (
                p.last_checked_at IS NULL
                OR p.last_checked_at < NOW() - ${maxAgeMinutes} * INTERVAL '1 minute'
              )
          ) AS stale_active
      `
    : await sql`
        SELECT
          EXISTS (
            SELECT 1
            FROM migration_country_predictions p
            LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
            WHERE o.prediction_id IS NULL
              AND p.surveillance_end <= NOW()
          ) AS due_pending,
          EXISTS (
            SELECT 1
            FROM migration_country_predictions p
            JOIN migration_capsules c ON c.id = p.capsule_id
            LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
            WHERE o.prediction_id IS NULL
              AND GREATEST(p.surveillance_start, c.generated_at) <= NOW()
              AND p.surveillance_end > NOW()
              AND c.updated_at < NOW() - ${maxAgeMinutes} * INTERVAL '1 minute'
          ) AS stale_active
      `;

  return {
    staleActive: bool(row?.stale_active),
    duePending: bool(row?.due_pending),
    incrementalTracking,
  };
}

async function performProjectionRefresh(
  signal?: AbortSignal,
  maxAgeMinutes = 15,
): Promise<ProjectionEvaluationRefresh> {
  const checkedAt = new Date().toISOString();
  const base: ProjectionEvaluationRefresh = {
    checkedAt,
    attempted: false,
    staleActive: false,
    duePending: false,
    incrementalTracking: false,
    activeCapsulesScanned: 0,
    activePredictionsChecked: 0,
    liveFulfillments: 0,
    dueCapsulesProcessed: 0,
    duePredictionsEvaluated: 0,
    positiveOutcomes: 0,
    errors: [],
  };

  if (!getDb()) return base;

  try {
    const state = await projectionEvaluationState(Math.max(5, maxAgeMinutes));
    const stateResult = {
      ...base,
      staleActive: state.staleActive,
      duePending: state.duePending,
      incrementalTracking: state.incrementalTracking,
    };
    if (!state.staleActive && !state.duePending) return stateResult;

    const [activeResult, dueResult] = await Promise.allSettled([
      evaluateActiveCapsules(8, signal),
      evaluateDueCapsules(8, signal),
    ]);

    const errors: string[] = [];
    let activeCapsulesScanned = 0;
    let activePredictionsChecked = 0;
    let liveFulfillments = 0;
    let dueCapsulesProcessed = 0;
    let duePredictionsEvaluated = 0;
    let positiveOutcomes = 0;

    if (activeResult.status === "fulfilled") {
      activeCapsulesScanned = activeResult.value.capsulesScanned;
      activePredictionsChecked = activeResult.value.predictionsChecked;
      liveFulfillments = activeResult.value.liveFulfillments;
      errors.push(...activeResult.value.errors);
    } else {
      errors.push(`Evaluación activa: ${activeResult.reason instanceof Error ? activeResult.reason.message : "error desconocido"}`);
    }

    if (dueResult.status === "fulfilled") {
      dueCapsulesProcessed = dueResult.value.capsulesProcessed;
      duePredictionsEvaluated = dueResult.value.predictionsEvaluated;
      positiveOutcomes = dueResult.value.positiveOutcomes;
      errors.push(...dueResult.value.errors);
    } else {
      errors.push(`Evaluación vencida: ${dueResult.reason instanceof Error ? dueResult.reason.message : "error desconocido"}`);
    }

    return {
      ...stateResult,
      attempted: true,
      activeCapsulesScanned,
      activePredictionsChecked,
      liveFulfillments,
      dueCapsulesProcessed,
      duePredictionsEvaluated,
      positiveOutcomes,
      errors,
    };
  } catch (error) {
    return {
      ...base,
      attempted: true,
      errors: [error instanceof Error ? error.message : "No fue posible comprobar la frescura de las proyecciones."],
    };
  }
}

/**
 * Makes History self-healing instead of depending exclusively on the daily cron.
 * The DB timestamps prevent repeated expensive catalogue checks while a page is open.
 */
export async function refreshProjectionEvaluationIfStale(
  signal?: AbortSignal,
  maxAgeMinutes = 15,
) {
  if (globalThis.rdsismosProjectionRefresh) return globalThis.rdsismosProjectionRefresh;
  const running = performProjectionRefresh(signal, maxAgeMinutes)
    .finally(() => {
      if (globalThis.rdsismosProjectionRefresh === running) {
        globalThis.rdsismosProjectionRefresh = undefined;
      }
    });
  globalThis.rdsismosProjectionRefresh = running;
  return running;
}
