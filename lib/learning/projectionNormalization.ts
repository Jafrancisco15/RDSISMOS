import { haversineKm } from "@/lib/regions";
import type {
  HistoricalAnalogEvidence,
  HistoricalMigrationCapsule,
  HistoricalMigrationDestination,
} from "@/lib/types";

const SAME_EVENT_WINDOW_MS = 20 * 60_000;
const SAME_EVENT_DISTANCE_KM = 80;
const SAME_EVENT_MAGNITUDE_DELTA = 0.35;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function evidenceKeyMatchesCountry(value: string, countryCode: string) {
  const normalized = value.trim().toUpperCase();
  const code = countryCode.trim().toUpperCase();
  return normalized === code || normalized.endsWith(`:${code}`);
}

function analogWeight(analog: HistoricalAnalogEvidence) {
  const value = Number(analog.similarityPct) / 100;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function countryEvidence(capsule: HistoricalMigrationCapsule, countryCode: string) {
  if (!capsule.analogs.length) return null;
  let totalWeight = 0;
  let postWeight = 0;
  let controlWeight = 0;
  let analogHits = 0;
  let controlHits = 0;

  for (const analog of capsule.analogs) {
    const weight = analogWeight(analog);
    totalWeight += weight;
    const postHit = (analog.hitCountryCodes ?? []).some((value) => evidenceKeyMatchesCountry(value, countryCode));
    const controlHit = (analog.controlHitCountryCodes ?? []).some((value) => evidenceKeyMatchesCountry(value, countryCode));
    if (postHit) {
      postWeight += weight;
      analogHits += 1;
    }
    if (controlHit) {
      controlWeight += weight;
      controlHits += 1;
    }
  }

  if (totalWeight <= 0) return null;
  const probabilityPct = round2((postWeight / totalWeight) * 100);
  const baselinePct = round2((controlWeight / totalWeight) * 100);
  return {
    probabilityPct,
    baselinePct,
    liftPct: round2(probabilityPct - baselinePct),
    analogHits,
    controlHits,
  };
}

function destinationScore(destination: HistoricalMigrationDestination) {
  return [
    Number(destination.analogHits ?? 0),
    Number(destination.weightedHits ?? 0),
    Number(destination.liftPct ?? 0),
    Number(destination.recurrencePct ?? 0),
  ];
}

function compareDestinations(a: HistoricalMigrationDestination, b: HistoricalMigrationDestination) {
  const scoreA = destinationScore(a);
  const scoreB = destinationScore(b);
  for (let index = 0; index < scoreA.length; index += 1) {
    if (scoreA[index] !== scoreB[index]) return scoreB[index] - scoreA[index];
  }
  return String(a.zoneId).localeCompare(String(b.zoneId));
}

/**
 * Converts the engine's regional candidate list into one auditable projection
 * per capsule + country. Historical zone overlap remains useful internally,
 * but it must not become multiple user-facing predictions for the same country.
 */
export function normalizeMigrationCapsule(
  capsule: HistoricalMigrationCapsule,
): HistoricalMigrationCapsule {
  const grouped = new Map<string, HistoricalMigrationDestination[]>();
  for (const destination of capsule.destinations) {
    if (!destination.countryCode) continue;
    const countryCode = destination.countryCode.toUpperCase();
    grouped.set(countryCode, [...(grouped.get(countryCode) ?? []), destination]);
  }

  const destinations: HistoricalMigrationDestination[] = [];
  for (const [countryCode, candidates] of grouped) {
    const best = [...candidates].sort(compareDestinations)[0];
    const evidence = countryEvidence(capsule, countryCode);
    const analogHits = evidence?.analogHits ?? best.analogHits ?? 0;
    if (analogHits <= 0) continue;

    const probabilityPct = evidence?.probabilityPct ?? round2(best.recurrencePct);
    const baselinePct = evidence?.baselinePct ?? round2(best.baselinePct ?? 0);
    const liftPct = evidence?.liftPct ?? round2(best.liftPct ?? probabilityPct - baselinePct);

    destinations.push({
      ...best,
      countryCode,
      recurrencePct: probabilityPct,
      baselinePct,
      liftPct,
      analogHits,
      controlHits: evidence?.controlHits ?? best.controlHits ?? 0,
      relativeWeightPct: round2(best.relativeWeightPct),
      weightedHits: round2(best.weightedHits),
      targetOverlap: countryCode === capsule.targetCountry.code,
    });
  }

  destinations.sort((a, b) => {
    if (a.targetOverlap !== b.targetOverlap) return a.targetOverlap ? -1 : 1;
    if ((b.liftPct ?? 0) !== (a.liftPct ?? 0)) return (b.liftPct ?? 0) - (a.liftPct ?? 0);
    return b.recurrencePct - a.recurrencePct;
  });

  return { ...capsule, destinations };
}

function samePhysicalSource(a: HistoricalMigrationCapsule, b: HistoricalMigrationCapsule) {
  if (a.sourceEvent.id === b.sourceEvent.id) return true;
  const timeA = Date.parse(a.sourceEvent.time);
  const timeB = Date.parse(b.sourceEvent.time);
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return false;
  return Math.abs(timeA - timeB) <= SAME_EVENT_WINDOW_MS
    && Math.abs(a.sourceEvent.magnitude - b.sourceEvent.magnitude) <= SAME_EVENT_MAGNITUDE_DELTA
    && haversineKm(
      a.sourceEvent.latitude,
      a.sourceEvent.longitude,
      b.sourceEvent.latitude,
      b.sourceEvent.longitude,
    ) <= SAME_EVENT_DISTANCE_KM;
}

/** Removes duplicated catalogue representations of the same physical source. */
export function dedupeMigrationCapsules(capsules: HistoricalMigrationCapsule[]) {
  const sorted = capsules
    .map(normalizeMigrationCapsule)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  const unique: HistoricalMigrationCapsule[] = [];
  for (const capsule of sorted) {
    if (unique.some((item) => (
      item.targetCountry.code === capsule.targetCountry.code
      && samePhysicalSource(item, capsule)
    ))) continue;
    unique.push(capsule);
  }
  return unique;
}
