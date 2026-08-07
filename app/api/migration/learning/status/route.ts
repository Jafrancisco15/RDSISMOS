import { NextResponse } from "next/server";
import { getLearningStatus } from "@/lib/learning/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingLearningSchema(message?: string) {
  if (!message) return false;
  return /relation\s+["']?(migration_capsules|migration_country_predictions|migration_outcomes|migration_model_metrics|migration_model_versions)["']?\s+does not exist/i.test(message);
}

export async function GET() {
  const status = await getLearningStatus();
  const migrationPending = isMissingLearningSchema(status.message);
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const response = migrationPending
    ? {
        ...status,
        migrationPending: true,
        cronSecretConfigured,
        cronSchedule: "15 3 * * *",
        message:
          "Supabase está conectado, pero falta ejecutar database/learning.sql en el mismo proyecto y esquema public usados por DATABASE_URL.",
      }
    : {
        ...status,
        migrationPending: false,
        cronSecretConfigured,
        cronSchedule: "15 3 * * *",
        schedulerWarning: cronSecretConfigured
          ? undefined
          : "CRON_SECRET no está configurado. El cron nativo de Vercel no podrá autenticar de forma segura el evaluador mientras exista protección administrativa.",
      };

  return NextResponse.json(response, {
    status: status.databaseConnected || !status.databaseConfigured || migrationPending ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
