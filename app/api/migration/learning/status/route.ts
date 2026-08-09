import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadProjectionBacklogState } from "@/lib/learning/reconcile";
import { getLearningStatus } from "@/lib/learning/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingLearningSchema(message?: string) {
  if (!message) return false;
  return /relation\s+["']?(migration_capsules|migration_country_predictions|migration_outcomes|migration_model_metrics|migration_model_versions)["']?\s+does not exist/i.test(message);
}

function isoOrNull(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function loadPipelineFreshness() {
  const sql = getDb();
  if (!sql) {
    return {
      latestCapsuleCreatedAt: null,
      latestSourceTime: null,
      latestOutcomeEvaluatedAt: null,
      latestPredictionUpdatedAt: null,
      error: "DATABASE_URL no está configurada.",
    };
  }
  try {
    const [row] = await sql`
      SELECT
        (SELECT MAX(created_at) FROM migration_capsules) AS latest_capsule_created_at,
        (SELECT MAX(source_time) FROM migration_capsules) AS latest_source_time,
        (SELECT MAX(evaluated_at) FROM migration_outcomes) AS latest_outcome_evaluated_at,
        (SELECT MAX(updated_at) FROM migration_country_predictions) AS latest_prediction_updated_at
    `;
    return {
      latestCapsuleCreatedAt: isoOrNull(row?.latest_capsule_created_at),
      latestSourceTime: isoOrNull(row?.latest_source_time),
      latestOutcomeEvaluatedAt: isoOrNull(row?.latest_outcome_evaluated_at),
      latestPredictionUpdatedAt: isoOrNull(row?.latest_prediction_updated_at),
      error: null,
    };
  } catch (error) {
    return {
      latestCapsuleCreatedAt: null,
      latestSourceTime: null,
      latestOutcomeEvaluatedAt: null,
      latestPredictionUpdatedAt: null,
      error: error instanceof Error ? error.message : "No fue posible consultar la frescura del pipeline.",
    };
  }
}

export async function GET() {
  const [status, pipeline, reconciliation] = await Promise.all([
    getLearningStatus(),
    loadPipelineFreshness(),
    loadProjectionBacklogState().catch(() => ({
      dueCapsules: 0,
      duePredictions: 0,
      legacyOutcomesPendingAudit: 0,
      oldestDueAt: null,
    })),
  ]);
  const migrationPending = isMissingLearningSchema(status.message ?? pipeline.error ?? undefined);
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const scheduler = {
    generationCronSchedule: "30 14 * * *",
    evaluationCronSchedule: "0 15 * * *",
    reconciliationCronSchedule: "15 17 * * *",
  };
  const response = migrationPending
    ? {
        ...status,
        pipeline,
        reconciliation,
        migrationPending: true,
        cronSecretConfigured,
        ...scheduler,
        message:
          "Supabase está conectado, pero falta ejecutar database/learning.sql en el mismo proyecto y esquema public usados por DATABASE_URL.",
      }
    : {
        ...status,
        pipeline,
        reconciliation,
        migrationPending: false,
        cronSecretConfigured,
        ...scheduler,
        schedulerWarning: cronSecretConfigured
          ? undefined
          : "CRON_SECRET no está configurado. Las llamadas nativas de Vercel usan un fallback limitado; conviene configurar el secreto en Production.",
      };

  return NextResponse.json(response, {
    status: status.databaseConnected || !status.databaseConfigured || migrationPending ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
