import { getDb } from "@/lib/db";
import { evaluateDueCapsules, evaluateLearningCycle } from "./evaluate";

export interface ProjectionBacklogState {
  dueCapsules: number;
  duePredictions: number;
  legacyOutcomesPendingAudit: number;
  oldestDueAt: string | null;
}

export interface ProjectionReconciliationOptions {
  batchSize?: number;
  maxBatches?: number;
  activeLimit?: number;
  timeBudgetMs?: number;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoOrNull(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function loadProjectionBacklogState(): Promise<ProjectionBacklogState> {
  const sql = getDb();
  if (!sql) {
    return {
      dueCapsules: 0,
      duePredictions: 0,
      legacyOutcomesPendingAudit: 0,
      oldestDueAt: null,
    };
  }

  const [row] = await sql`
    SELECT
      COUNT(DISTINCT p.capsule_id) FILTER (
        WHERE p.surveillance_end <= NOW() AND o.prediction_id IS NULL
      )::int AS due_capsules,
      COUNT(*) FILTER (
        WHERE p.surveillance_end <= NOW() AND o.prediction_id IS NULL
      )::int AS due_predictions,
      MIN(p.surveillance_end) FILTER (
        WHERE p.surveillance_end <= NOW() AND o.prediction_id IS NULL
      ) AS oldest_due_at,
      COUNT(*) FILTER (
        WHERE o.prediction_id IS NOT NULL
          AND NOT (COALESCE(o.evaluation_payload, '{}'::jsonb) @> ${sql.json({ criteriaVersion: 2 })})
      )::int AS legacy_outcomes_pending_audit
    FROM migration_country_predictions p
    LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
  `;

  return {
    dueCapsules: number(row?.due_capsules),
    duePredictions: number(row?.due_predictions),
    legacyOutcomesPendingAudit: number(row?.legacy_outcomes_pending_audit),
    oldestDueAt: isoOrNull(row?.oldest_due_at),
  };
}

export async function reconcileProjectionBacklog(
  rawOptions: ProjectionReconciliationOptions = {},
  signal?: AbortSignal,
) {
  const startedAt = new Date();
  const batchSize = Math.min(8, Math.max(1, Math.trunc(Number(rawOptions.batchSize ?? 4))));
  const maxBatches = Math.min(10, Math.max(1, Math.trunc(Number(rawOptions.maxBatches ?? 6))));
  const activeLimit = Math.min(8, Math.max(1, Math.trunc(Number(rawOptions.activeLimit ?? 2))));
  const timeBudgetMs = Math.min(50_000, Math.max(10_000, Math.trunc(Number(rawOptions.timeBudgetMs ?? 46_000))));

  const before = await loadProjectionBacklogState();
  const batches: Array<{
    index: number;
    capsulesProcessed: number;
    predictionsEvaluated: number;
    positiveOutcomes: number;
    outsideRangeOutcomes: number;
    errors: string[];
  }> = [];

  let activePredictionsChecked = 0;
  let liveFulfillments = 0;
  let legacyOutcomesChecked = 0;
  let legacyOutcomesConfirmed = 0;
  let legacyOutcomesInvalidated = 0;
  let stoppedByTimeBudget = false;

  if (signal?.aborted) throw new Error("La reconciliación fue cancelada antes de comenzar.");

  // The first pass also audits legacy outcomes and checks a small active batch.
  const first = await evaluateLearningCycle(activeLimit, batchSize, signal);
  activePredictionsChecked = first.activePredictionsChecked;
  liveFulfillments = first.liveFulfillments;
  legacyOutcomesChecked = first.legacyOutcomesChecked;
  legacyOutcomesConfirmed = first.legacyOutcomesConfirmed;
  legacyOutcomesInvalidated = first.legacyOutcomesInvalidated;
  batches.push({
    index: 1,
    capsulesProcessed: first.capsulesProcessed,
    predictionsEvaluated: first.predictionsEvaluated,
    positiveOutcomes: first.positiveOutcomes,
    outsideRangeOutcomes: first.outsideRangeOutcomes,
    errors: first.errors,
  });

  let current = await loadProjectionBacklogState();

  for (let index = 2; index <= maxBatches && current.duePredictions > 0; index += 1) {
    if (signal?.aborted) break;
    if (Date.now() - startedAt.getTime() >= timeBudgetMs) {
      stoppedByTimeBudget = true;
      break;
    }

    const result = await evaluateDueCapsules(batchSize, signal);
    batches.push({
      index,
      capsulesProcessed: result.capsulesProcessed,
      predictionsEvaluated: result.predictionsEvaluated,
      positiveOutcomes: result.positiveOutcomes,
      outsideRangeOutcomes: result.outsideRangeOutcomes,
      errors: result.errors,
    });

    if (result.capsulesProcessed === 0) break;
    current = await loadProjectionBacklogState();
  }

  const after = await loadProjectionBacklogState();
  const totals = batches.reduce((summary, batch) => ({
    capsulesProcessed: summary.capsulesProcessed + batch.capsulesProcessed,
    predictionsEvaluated: summary.predictionsEvaluated + batch.predictionsEvaluated,
    positiveOutcomes: summary.positiveOutcomes + batch.positiveOutcomes,
    outsideRangeOutcomes: summary.outsideRangeOutcomes + batch.outsideRangeOutcomes,
    errors: [...summary.errors, ...batch.errors],
  }), {
    capsulesProcessed: 0,
    predictionsEvaluated: 0,
    positiveOutcomes: 0,
    outsideRangeOutcomes: 0,
    errors: [] as string[],
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    configuration: { batchSize, maxBatches, activeLimit, timeBudgetMs },
    before,
    after,
    batches,
    ...totals,
    activePredictionsChecked,
    liveFulfillments,
    legacyOutcomesChecked,
    legacyOutcomesConfirmed,
    legacyOutcomesInvalidated,
    backlogReducedBy: Math.max(0, before.duePredictions - after.duePredictions),
    complete: after.duePredictions === 0 && after.legacyOutcomesPendingAudit === 0,
    stoppedByTimeBudget,
  };
}
