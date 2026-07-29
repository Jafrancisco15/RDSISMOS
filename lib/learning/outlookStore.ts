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
      SELECT capsule_payload
      FROM migration_capsules
      WHERE target_country_code = ${countryCode}
        AND surveillance_end > NOW()
        AND status IN ('active', 'due')
      ORDER BY generated_at DESC
      LIMIT ${Math.min(30, Math.max(1, limit))}
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
      warning: error instanceof Error ? error.message : "No fue posible cargar las cápsulas activas.",
    };
  }
}
