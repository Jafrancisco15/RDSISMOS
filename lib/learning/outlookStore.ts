import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import type { HistoricalMigrationCapsule } from "@/lib/types";

function isCapsule(value: unknown): value is HistoricalMigrationCapsule {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    record.id
    && record.sourceEvent
    && record.targetCountry
    && Array.isArray(record.destinations),
  );
}

/**
 * Returns capsules only when the selected country still has an unresolved,
 * currently active prediction inside them. This keeps the country projection
 * synchronized with the active globe and the per-prediction history.
 */
export async function loadActiveCountryCapsules(countryCode: string, limit = 12): Promise<{
  databaseConfigured: boolean;
  databaseConnected: boolean;
  capsules: HistoricalMigrationCapsule[];
  warning?: string;
}> {
  const sql = getDb();
  if (!sql) {
    return {
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      capsules: [],
      warning: "DATABASE_URL no está configurada.",
    };
  }

  try {
    const rows = await sql`
      WITH active_capsules AS (
        SELECT DISTINCT
          c.id,
          c.generated_at,
          c.capsule_payload
        FROM migration_capsules c
        JOIN migration_country_predictions p ON p.capsule_id = c.id
        LEFT JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE p.country_code = ${countryCode}
          AND c.generated_at <= NOW()
          AND p.surveillance_start <= NOW()
          AND p.surveillance_end > NOW()
          AND o.prediction_id IS NULL
        ORDER BY c.generated_at DESC
        LIMIT ${Math.min(30, Math.max(1, limit))}
      )
      SELECT capsule_payload
      FROM active_capsules
      ORDER BY generated_at DESC
    `;

    return {
      databaseConfigured: true,
      databaseConnected: true,
      capsules: rows
        .map((row) => row.capsule_payload as unknown)
        .filter(isCapsule),
    };
  } catch (error) {
    return {
      databaseConfigured: true,
      databaseConnected: false,
      capsules: [],
      warning: error instanceof Error ? error.message : "No fue posible cargar las proyecciones activas.",
    };
  }
}
