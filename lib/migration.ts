import { DOMINICAN_TARGET, WATCHED_REGIONS, haversineKm } from "./regions";
import type { AlertLevel, MigrationAnalysis, SeismicEvent } from "./types";

const DAY_MS = 86_400_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ageDays(event: SeismicEvent, now: Date) {
  return Math.max(0, (now.getTime() - new Date(event.time).getTime()) / DAY_MS);
}

function rateRatio(current: number, currentDays: number, previous: number, previousDays: number) {
  const currentRate = current / currentDays;
  const previousRate = previous / previousDays;
  if (previousRate === 0) return currentRate > 0 ? 3 : 1;
  return currentRate / previousRate;
}

function linearDistanceTrend(events: SeismicEvent[], now: Date) {
  const points = events
    .filter((event) => event.magnitude >= 5 && ageDays(event, now) <= 30)
    .map((event) => ({
      x: 30 - ageDays(event, now),
      y: haversineKm(
        event.latitude,
        event.longitude,
        DOMINICAN_TARGET.latitude,
        DOMINICAN_TARGET.longitude,
      ),
    }));

  if (points.length < 4) return 0;

  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0,
  );
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return denominator === 0 ? 0 : numerator / denominator;
}

function longestApproachChain(events: SeismicEvent[]) {
  const ordered = events
    .filter((event) => event.magnitude >= 5)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .map((event) => ({
      event,
      distance: haversineKm(
        event.latitude,
        event.longitude,
        DOMINICAN_TARGET.latitude,
        DOMINICAN_TARGET.longitude,
      ),
    }));

  if (!ordered.length) return 0;
  const best = new Array<number>(ordered.length).fill(1);

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const timeGapDays =
        (new Date(ordered[i].event.time).getTime() -
          new Date(ordered[j].event.time).getTime()) /
        DAY_MS;
      const meaningfullyCloser = ordered[i].distance <= ordered[j].distance - 500;
      if (timeGapDays <= 21 && meaningfullyCloser) {
        best[i] = Math.max(best[i], best[j] + 1);
      }
    }
  }

  return Math.max(...best);
}

function levelForScore(score: number): { level: AlertLevel; label: string } {
  if (score >= 75) return { level: "red", label: "Posible actividad sísmica" };
  if (score >= 55) return { level: "orange", label: "Actividad experimental elevada" };
  if (score >= 35) return { level: "yellow", label: "Vigilancia estadística" };
  return { level: "green", label: "Sin señal migratoria destacada" };
}

export function calculateMigrationAnalysis(
  events: SeismicEvent[],
  generatedAt = new Date(),
): MigrationAnalysis {
  const sourceEvents = events.filter((event) => Boolean(event.regionId));
  const caribbeanEvents = events.filter((event) => event.isDominicanRegion);

  const sourceCurrent = sourceEvents.filter((event) => ageDays(event, generatedAt) <= 30);
  const sourcePrevious = sourceEvents.filter((event) => {
    const age = ageDays(event, generatedAt);
    return age > 30 && age <= 90;
  });
  const caribbeanCurrent = caribbeanEvents.filter((event) => ageDays(event, generatedAt) <= 14);
  const caribbeanPrevious = caribbeanEvents.filter((event) => {
    const age = ageDays(event, generatedAt);
    return age > 14 && age <= 90;
  });

  const sourceActivityRatio = rateRatio(
    sourceCurrent.length,
    30,
    sourcePrevious.length,
    60,
  );
  const caribbeanActivityRatio = rateRatio(
    caribbeanCurrent.length,
    14,
    caribbeanPrevious.length,
    76,
  );

  const distanceTrendKmPerDay = linearDistanceTrend(events, generatedAt);
  const approachChainLength = longestApproachChain(events);

  const leadEvent = sourceEvents
    .filter((event) => ageDays(event, generatedAt) <= 45)
    .sort((a, b) => {
      const contributionA = a.magnitude ** 2 * Math.exp(-ageDays(a, generatedAt) / 21);
      const contributionB = b.magnitude ** 2 * Math.exp(-ageDays(b, generatedAt) / 21);
      return contributionB - contributionA;
    })[0] ?? null;

  const leadRegionName = leadEvent
    ? WATCHED_REGIONS.find((region) => region.id === leadEvent.regionId)?.name ?? null
    : null;

  const maxRecentSourceMagnitude = sourceCurrent.reduce(
    (maximum, event) => Math.max(maximum, event.magnitude),
    0,
  );
  const maxRecentCaribbeanMagnitude = caribbeanCurrent.reduce(
    (maximum, event) => Math.max(maximum, event.magnitude),
    0,
  );

  const sourceScore = clamp((sourceActivityRatio - 0.8) * 14, 0, 25);
  const caribbeanScore = clamp((caribbeanActivityRatio - 0.8) * 15, 0, 25);
  const magnitudeScore = clamp((maxRecentSourceMagnitude - 5.5) * 10, 0, 15);
  const localMagnitudeScore = clamp((maxRecentCaribbeanMagnitude - 3.5) * 5, 0, 10);
  const trendScore = clamp((-distanceTrendKmPerDay - 20) / 8, 0, 15);
  const chainScore = clamp((approachChainLength - 2) * 5, 0, 10);

  const score = Math.round(
    clamp(
      sourceScore +
        caribbeanScore +
        magnitudeScore +
        localMagnitudeScore +
        trendScore +
        chainScore,
      0,
      100,
    ),
  );

  const { level, label } = levelForScore(score);
  const sourceDescription = leadEvent
    ? `La señal de origen con mayor peso es un M${leadEvent.magnitude.toFixed(1)} del ${new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(leadEvent.time))} en ${leadRegionName ?? leadEvent.place}.`
    : "No se identificó un evento reciente de peso en las zonas históricas vigiladas.";

  const evidence = [
    `Tasa de actividad en zonas fuente: ${sourceActivityRatio.toFixed(2)} veces su referencia de los 60 días anteriores.`,
    `Tasa de actividad en el entorno dominicano: ${caribbeanActivityRatio.toFixed(2)} veces su referencia reciente.`,
    `Tendencia lineal exploratoria de distancia: ${distanceTrendKmPerDay.toFixed(0)} km/día; un valor negativo representa acercamiento estadístico.`,
    `Cadena espacial decreciente más larga: ${approachChainLength} eventos.`,
  ];

  const limitations = [
    "El índice mezcla eventos de placas tectónicas distintas y no demuestra causalidad física entre ellos.",
    "Una tendencia espacial aparente puede surgir por azar en un catálogo mundial con muchos eventos.",
    "El sistema no predice fecha, lugar ni magnitud de un terremoto y no debe usarse para decisiones de seguridad.",
  ];

  return {
    score,
    level,
    label,
    summary: `${sourceDescription} El resultado es una señal estadística experimental, no una predicción.`,
    leadEvent,
    leadRegionName,
    sourceActivityRatio,
    caribbeanActivityRatio,
    distanceTrendKmPerDay,
    approachChainLength,
    evidence,
    limitations,
  };
}
