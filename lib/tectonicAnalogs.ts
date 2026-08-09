import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { haversineKm } from "@/lib/regions";
import type {
  TectonicSimulationInput,
  TectonicSimulationResponse,
} from "@/lib/tectonicSimulator";

export const HISTORICAL_ANALOG_MINIMUM_MAGNITUDE = 5.9;
export const HISTORICAL_ANALOG_START = "1900-01-01T00:00:00.000Z";

export interface HistoricalAnalogEvent {
  id: string;
  timeUtc: string;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  place: string;
  sourceCatalog: string;
  sourceUrl: string;
  distanceKm: number;
  magnitudeDifference: number;
  depthDifferenceKm: number;
  similarityScore: number;
  similarityReasons: string[];
}

export interface HistoricalAnalogCatalog {
  minimumMagnitude: number;
  startTime: string;
  endTime: string;
  radiusKm: number;
  totalCandidates: number;
  provider: string;
  warning?: string | null;
}

export type TectonicSimulationWithAnalogs = TectonicSimulationResponse & {
  historicalAnalogs: HistoricalAnalogEvent[];
  historicalCatalog: HistoricalAnalogCatalog;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function exponentialSimilarity(difference: number, scale: number) {
  return Math.exp(-Math.max(0, difference) / Math.max(scale, 0.001));
}

function reasonsFor(
  magnitudeDifference: number,
  depthDifferenceKm: number,
  distanceKm: number,
) {
  const reasons: string[] = [];
  if (magnitudeDifference <= 0.25) reasons.push("magnitud casi equivalente");
  else if (magnitudeDifference <= 0.6) reasons.push("magnitud comparable");
  if (depthDifferenceKm <= 15) reasons.push("profundidad muy similar");
  else if (depthDifferenceKm <= 40) reasons.push("profundidad compatible");
  if (distanceKm <= 250) reasons.push("misma zona tectónica local");
  else if (distanceKm <= 800) reasons.push("entorno tectónico regional cercano");
  else reasons.push("análogo regional de mayor distancia");
  return reasons;
}

export function historicalAnalogRadiusKm(interactionRadiusKm: number) {
  return Math.round(clamp(Math.max(1_000, interactionRadiusKm * 1.15), 1_000, 3_000));
}

export function rankHistoricalAnalogs(
  input: Required<TectonicSimulationInput>,
  events: EarthquakeEvent[],
  radiusKm: number,
  limit = 30,
): HistoricalAnalogEvent[] {
  const depthScale = Math.max(35, input.depthKm * 1.5);
  const distanceScale = Math.max(450, radiusKm * 0.42);

  return events
    .filter((event) => Number.isFinite(event.magnitude) && event.magnitude >= HISTORICAL_ANALOG_MINIMUM_MAGNITUDE)
    .map((event) => {
      const distanceKm = haversineKm(
        input.latitude,
        input.longitude,
        finite(event.latitude),
        finite(event.longitude),
      );
      const magnitudeDifference = Math.abs(event.magnitude - input.magnitude);
      const depthDifferenceKm = Math.abs(event.depthKm - input.depthKm);
      const magnitudeSimilarity = exponentialSimilarity(magnitudeDifference, 0.55);
      const depthSimilarity = exponentialSimilarity(depthDifferenceKm, depthScale);
      const distanceSimilarity = exponentialSimilarity(distanceKm, distanceScale);

      // The score intentionally uses only observable catalogue quantities.
      // Standard ComCat rows do not consistently contain focal mechanisms, so
      // mechanism similarity is not invented when moment tensors are absent.
      const similarityScore = Math.round(100 * clamp(
        0.47 * magnitudeSimilarity
          + 0.20 * depthSimilarity
          + 0.33 * distanceSimilarity,
        0,
        1,
      ));

      return {
        id: event.id,
        timeUtc: event.timeUtc,
        magnitude: event.magnitude,
        depthKm: event.depthKm,
        latitude: event.latitude,
        longitude: event.longitude,
        place: event.place,
        sourceCatalog: event.sourceCatalog,
        sourceUrl: event.sourceUrl,
        distanceKm: Number(distanceKm.toFixed(1)),
        magnitudeDifference: Number(magnitudeDifference.toFixed(2)),
        depthDifferenceKm: Number(depthDifferenceKm.toFixed(1)),
        similarityScore,
        similarityReasons: reasonsFor(magnitudeDifference, depthDifferenceKm, distanceKm),
      } satisfies HistoricalAnalogEvent;
    })
    .filter((event) => event.distanceKm <= radiusKm)
    .sort((left, right) =>
      right.similarityScore - left.similarityScore
      || left.magnitudeDifference - right.magnitudeDifference
      || left.distanceKm - right.distanceKm
      || Date.parse(right.timeUtc) - Date.parse(left.timeUtc),
    )
    .slice(0, Math.max(1, Math.min(60, limit)));
}
