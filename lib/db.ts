import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var rdsismosPostgres: SqlClient | undefined;
}

export function hasDatabaseConfiguration() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): SqlClient | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;

  if (!globalThis.rdsismosPostgres) {
    globalThis.rdsismosPostgres = postgres(connectionString, {
      max: 1,
      prepare: false,
      ssl: "require",
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
    });
  }

  return globalThis.rdsismosPostgres;
}
