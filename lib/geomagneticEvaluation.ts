import { getDb } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeFilters } from "@/lib/earthquakes/types";
import {
  ensureGeomagneticLearningSchema,
  evaluateGeomagneticTrial,
  recalibrateGeomagneticModel,
} from "@/lib/geomagneticLearningStore";

function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

export async function runGeomagneticEvaluation(options: { limit?: number; signal?: AbortSignal } = {}) {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL no está configurada.");
  await ensureGeomagneticLearningSchema();
  const limit = Math.max(1, Math.min(60, options.limit ?? 18));
  const rows = await sql`
    SELECT id, station_code, latitude, longitude, surveillance_start, surveillance_end,
           radius_km, magnitude_min, emitted
    FROM geomagnetic_trials
    WHERE status = 'active'
    ORDER BY surveillance_end ASC
    LIMIT ${limit}
  `;
  const now = new Date();
  const evaluated: Array<Record<string, unknown>> = [];
  const stillActive: string[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    const id = String(row.id);
    const start = new Date(String(row.surveillance_start));
    const end = new Date(String(row.surveillance_end));
    const queryEnd = end.getTime() < now.getTime() ? end : now;
    try {
      const filters: EarthquakeFilters = {
        startTime: start.toISOString(), endTime: queryEnd.toISOString(),
        minMagnitude: num(row.magnitude_min) || 3, latitude: num(row.latitude), longitude: num(row.longitude),
        maxRadiusKm: num(row.radius_km) || 200, eventType: "earthquake", orderBy: "time-asc", limit: 20_000, offset: 1,
      };
      const events = await queryEarthquakeCatalogAll(filters, 20_000, options.signal);
      const matured = end.getTime() <= now.getTime();
      // Positive cases can close immediately. Negative cases remain open until the frozen window expires.
      if (events.length > 0 || matured) {
        const outcome = await evaluateGeomagneticTrial(id, events);
        evaluated.push({ id, station: String(row.station_code), outcome, emitted: Boolean(row.emitted), events: events.length });
      } else {
        stillActive.push(id);
      }
    } catch (error) {
      warnings.push(`${id}: ${error instanceof Error ? error.message : "falló la evaluación"}`);
    }
  }

  const model = evaluated.length ? await recalibrateGeomagneticModel() : null;
  return { evaluatedAt: now.toISOString(), evaluated, stillActive: stillActive.length, model, warnings };
}
