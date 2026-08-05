import { haversineKm } from "../regions";
import type { SeismicEvent } from "../types";

type SourceFamily = "usgs" | "emsc" | "raspberry" | "other";

const SOURCE_PRIORITY: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /USGS ComCat/i, score: 500 },
  { pattern: /Raspberry Shake/i, score: 450 },
  { pattern: /EMSC/i, score: 400 },
  { pattern: /USGS real-time/i, score: 350 },
];

function sourceFamily(event: Pick<SeismicEvent, "source">): SourceFamily {
  if (/USGS/i.test(event.source)) return "usgs";
  if (/EMSC/i.test(event.source)) return "emsc";
  if (/Raspberry/i.test(event.source)) return "raspberry";
  return "other";
}

function sourcePriority(event: SeismicEvent) {
  return SOURCE_PRIORITY.find((item) => item.pattern.test(event.source))?.score ?? 0;
}

function reportQuality(event: SeismicEvent) {
  return sourcePriority(event)
    + (event.detailUrl ? 25 : 0)
    + (event.updatedAt ? 10 : 0)
    + (event.magnitudeType && event.magnitudeType !== "M" ? 5 : 0)
    + (event.place && event.place !== "Región no especificada" ? 5 : 0);
}

function timeDifferenceSeconds(a: SeismicEvent, b: SeismicEvent) {
  return Math.abs(Date.parse(a.time) - Date.parse(b.time)) / 1_000;
}

function magnitudeDifference(a: SeismicEvent, b: SeismicEvent) {
  return Math.abs(a.magnitude - b.magnitude);
}

function spatialDifferenceKm(a: SeismicEvent, b: SeismicEvent) {
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
}

/**
 * Decides whether two provider reports describe the same physical earthquake.
 *
 * Same-provider records use tight tolerances because two nearby aftershocks may
 * legitimately be separate events. Cross-provider records allow the small time,
 * magnitude and epicentral revisions that are common between catalogues, but
 * still require either a very close origin time or a very close epicentre.
 */
export function reportsDescribeSameEvent(a: SeismicEvent, b: SeismicEvent) {
  const familyA = sourceFamily(a);
  const familyB = sourceFamily(b);
  const sameFamily = familyA === familyB;

  if (sameFamily && a.id && b.id && a.id === b.id) return true;

  const seconds = timeDifferenceSeconds(a, b);
  const magnitude = magnitudeDifference(a, b);
  const distance = spatialDifferenceKm(a, b);

  if (sameFamily) {
    return seconds <= 25 && magnitude <= 0.2 && distance <= 20;
  }

  if (seconds > 180 || magnitude > 0.5 || distance > 110) return false;

  const originTimesVeryClose = seconds <= 55 && distance <= 110;
  const epicentresVeryClose = distance <= 30 && seconds <= 180;
  const balancedRevision = seconds <= 100 && distance <= 70 && magnitude <= 0.35;
  return originTimesVeryClose || epicentresVeryClose || balancedRevision;
}

function latestIso(values: Array<string | undefined>) {
  const valid = values
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return valid[0];
}

function canonicalReport(cluster: SeismicEvent[]) {
  const ordered = [...cluster].sort((a, b) => {
    const quality = reportQuality(b) - reportQuality(a);
    if (quality !== 0) return quality;
    const updated = Date.parse(b.updatedAt ?? b.time) - Date.parse(a.updatedAt ?? a.time);
    if (updated !== 0) return updated;
    return a.id.localeCompare(b.id);
  });
  const winner = ordered[0];
  const aliases = ordered.map((item) => ({ source: item.source, id: item.id }));

  return {
    ...winner,
    updatedAt: latestIso(ordered.map((item) => item.updatedAt)) ?? winner.updatedAt,
    detailUrl: winner.detailUrl ?? ordered.find((item) => item.detailUrl)?.detailUrl,
    regionId: winner.regionId ?? ordered.find((item) => item.regionId)?.regionId,
    isTargetRegion: ordered.some((item) => item.isTargetRegion),
    duplicateReports: Math.max(0, ordered.length - 1),
    sourceAliases: aliases,
  } satisfies SeismicEvent;
}

/**
 * Consolidates provider reports into one canonical event per physical earthquake.
 * The returned record belongs to exactly one preferred source; other reports are
 * retained only as aliases for traceability and are never rendered as events.
 */
export function deduplicateProviderEvents(events: SeismicEvent[]) {
  const ordered = [...events]
    .filter((event) => Number.isFinite(Date.parse(event.time)))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const clusters: SeismicEvent[][] = [];

  for (const event of ordered) {
    const cluster = clusters.find((items) => items.some((item) => reportsDescribeSameEvent(item, event)));
    if (cluster) cluster.push(event);
    else clusters.push([event]);
  }

  return clusters
    .map(canonicalReport)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
