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
  const response = migrationPending
    ? {
        ...status,
        migrationPending: true,
        message:
          "Supabase está conectado, pero falta ejecutar database/learning.sql en el mismo proyecto y esquema public usados por DATABASE_URL.",
      }
    : { ...status, migrationPending: false };

  return NextResponse.json(response, {
    status: status.databaseConnected || !status.databaseConfigured || migrationPending ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
