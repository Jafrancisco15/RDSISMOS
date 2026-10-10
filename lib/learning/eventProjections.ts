import { predictionHref } from "./predictionLink";
import { getDb } from "@/lib/db";
import type { EarthquakeEvent, EventProjection } from "@/lib/earthquakes/types";
import { eventDistanceFromPrediction, eventFallsWithinPredictionWindow } from "./evaluate";

export interface ArchivedEventPrediction {
  id: string;
  countryName: string;
  generatedAt: string;
  createdAt: string;
  sourceEventExternalId: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  probabilityPct: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  magnitudeMin: number;
  magnitudeMax: number;
  fulfilled: boolean;
  matchedEventIds: string[];
}

/** Only link evaluated fulfillments that explicitly identify this observed event. */
export function matchEventProjections(event: EarthquakeEvent, predictions: ArchivedEventPrediction[]): EventProjection {
  const time = Date.parse(event.timeUtc);
  const matches = predictions.filter((prediction) => {
    if (!predictionHref(prediction.id) || !prediction.fulfilled || ![event.id, event.externalId].some((id) => prediction.matchedEventIds.includes(id))) return false;
    const issued = Date.parse(prediction.generatedAt);
    const stored = Date.parse(prediction.createdAt);
    if (!Number.isFinite(time) || !Number.isFinite(issued) || !Number.isFinite(stored)) return false;
    if (issued >= time || stored >= time || prediction.probabilityPct <= 0 || prediction.magnitudeMax < 4.2) return false;
    if ([event.id, event.externalId].includes(prediction.sourceEventExternalId)) return false;
    if (event.magnitude < Math.max(4.2, prediction.magnitudeMin) || event.magnitude > prediction.magnitudeMax) return false;
    return eventFallsWithinPredictionWindow(event, prediction)
      && eventDistanceFromPrediction(event, prediction) <= prediction.radiusKm;
  }).map((prediction) => ({
    id: prediction.id,
    href: predictionHref(prediction.id)!,
    countryName: prediction.countryName,
    generatedAt: prediction.generatedAt,
    probabilityPct: prediction.probabilityPct,
    magnitudeMin: Math.max(4.2, prediction.magnitudeMin),
    magnitudeMax: prediction.magnitudeMax,
  })).sort((a, b) => b.probabilityPct - a.probabilityPct || a.id.localeCompare(b.id));
  return {
    status: matches.length ? "projected" : "not_projected",
    matches,
  };
}

export async function annotateEventProjections(events: EarthquakeEvent[]): Promise<{
  events: EarthquakeEvent[];
  warning?: string;
}> {
  if (!events.length) return { events };
  const unavailable = () => events.map((event) => ({
    ...event, projection: { status: "unavailable" as const, matches: [] },
  }));
  const sql = getDb();
  if (!sql) return { events: unavailable(), warning: "Archivo de proyecciones no disponible; no se puede verificar la proyección previa." };
  const times = events.map((event) => event.timeUtc).sort();
  const eventIds = [...new Set(events.flatMap((event) => [event.id, event.externalId]))];
  try {
    // One bounded, parameterized archive read for the entire catalogue page.
    // Both timestamps prevent backdated/recomputed capsules from becoming hits.
    const rows = await sql`
      SELECT p.id, p.country_name, p.latitude, p.longitude, p.radius_km,
        p.probability_pct, p.surveillance_start, p.surveillance_end,
        p.magnitude_min, p.magnitude_max, p.created_at,
        c.generated_at, c.source_event_external_id,
        o.first_event_external_id, o.strongest_event_external_id,
        o.evaluation_payload->'matchedEventIds' AS matched_event_ids
      FROM migration_country_predictions p
      JOIN migration_capsules c ON c.id = p.capsule_id
      JOIN migration_outcomes o ON o.prediction_id = p.id AND o.occurred IS TRUE
      WHERE (
          o.first_event_external_id = ANY(${eventIds}::text[])
          OR o.strongest_event_external_id = ANY(${eventIds}::text[])
          OR (o.evaluation_payload->'matchedEventIds') ?| ${eventIds}::text[]
        )
        AND p.surveillance_end >= ${times[0]}
        AND p.surveillance_start <= ${times[times.length - 1]}
        AND c.generated_at < ${times[times.length - 1]}
        AND p.created_at < ${times[times.length - 1]}
        AND p.probability_pct > 0 AND p.magnitude_max >= 4.2
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${sql.json(times)}) AS t(value)
          WHERE t.value::timestamptz BETWEEN p.surveillance_start AND p.surveillance_end
            AND c.generated_at < t.value::timestamptz
            AND p.created_at < t.value::timestamptz
        )
    `;
    const predictions: ArchivedEventPrediction[] = rows.map((row) => ({
      id: String(row.id), countryName: String(row.country_name),
      generatedAt: new Date(String(row.generated_at)).toISOString(),
      createdAt: new Date(String(row.created_at)).toISOString(),
      sourceEventExternalId: String(row.source_event_external_id),
      latitude: Number(row.latitude), longitude: Number(row.longitude), radiusKm: Number(row.radius_km),
      probabilityPct: Number(row.probability_pct),
      surveillanceStart: new Date(String(row.surveillance_start)).toISOString(),
      surveillanceEnd: new Date(String(row.surveillance_end)).toISOString(),
      magnitudeMin: Number(row.magnitude_min), magnitudeMax: Number(row.magnitude_max),
      fulfilled: true,
      matchedEventIds: [row.first_event_external_id, row.strongest_event_external_id,
        ...(Array.isArray(row.matched_event_ids) ? row.matched_event_ids : [])]
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    }));
    return { events: events.map((event) => ({ ...event, projection: matchEventProjections(event, predictions) })) };
  } catch {
    return { events: unavailable(), warning: "No fue posible consultar el archivo de proyecciones; el catálogo sísmico sigue disponible." };
  }
}
