import { haversineKm } from "./regions";
import type {
  AlertLevel,
  CountryTarget,
  MigrationAnalysis,
  MigrationProjection,
  SeismicEvent,
} from "./types";

const DAY_MS = 86_400_000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageDays(event: SeismicEvent, now: Date) {
  return Math.max(0, (now.getTime() - new Date(event.time).getTime()) / DAY_MS);
}

function levelForScore(score: number): { level: AlertLevel; label: string } {
  if (score >= 70) return { level: "red", label: "Pronóstico operacional elevado" };
  if (score >= 50) return { level: "orange", label: "Pronóstico operacional moderado" };
  if (score >= 25) return { level: "yellow", label: "Actividad regional en observación" };
  return { level: "green", label: "Actividad regional baja" };
}

export function calculateMigrationAnalysis(
  events: SeismicEvent[],
  target: CountryTarget,
  projections: MigrationProjection[],
  generatedAt = new Date(),
): MigrationAnalysis {
  const local = events.filter(
    (event) =>
      haversineKm(
        event.latitude,
        event.longitude,
        target.latitude,
        target.longitude,
      ) <= target.radiusKm + 350,
  );
  const recent = local.filter((event) => ageDays(event, generatedAt) <= 7);
  const baseline = local.filter((event) => {
    const age = ageDays(event, generatedAt);
    return age > 7 && age <= 90;
  });

  const recentRatePerDay = recent.length / 7;
  const baselineRatePerDay = baseline.length / 83;
  const targetActivityRatio =
    baselineRatePerDay > 0
      ? recentRatePerDay / baselineRatePerDay
      : recentRatePerDay > 0
        ? 3
        : 1;
  const active = projections.filter((projection) => projection.status === "active");
  const maxCapsuleProbabilityPct = active.reduce(
    (maximum, projection) => Math.max(maximum, projection.excessProbabilityPct),
    0,
  );
  const highest = [...active].sort(
    (a, b) => b.excessProbabilityPct - a.excessProbabilityPct,
  )[0] ?? null;

  const rateScore = clamp((targetActivityRatio - 1) * 10, 0, 25);
  const probabilityScore = maxCapsuleProbabilityPct * 0.65;
  const countScore = clamp(active.filter((projection) => projection.excessProbabilityPct > 0).length * 3, 0, 12);
  const score = Math.round(clamp(rateScore + probabilityScore + countScore, 0, 100));
  const { level, label } = levelForScore(score);

  const summary = highest
    ? `${active.length} cápsula${active.length === 1 ? "" : "s"} ETAS activa${active.length === 1 ? "" : "s"} para ${target.name}; la señal máxima sobre el fondo es ${highest.excessProbabilityPct}% y la probabilidad total asociada es ${highest.probabilityPct}%.`
    : `No hay cápsulas ETAS activas para ${target.name} con señal superior a la actividad sísmica de fondo.`;

  return {
    score,
    level,
    label,
    summary,
    targetActivityRatio,
    recentRatePerDay,
    baselineRatePerDay,
    activeCapsules: active.length,
    maxCapsuleProbabilityPct,
    evidence: [
      `Tasa de los últimos 7 días: ${recentRatePerDay.toFixed(2)} eventos/día en el entorno seleccionado.`,
      `Tasa de referencia de los 83 días anteriores: ${baselineRatePerDay.toFixed(2)} eventos/día.`,
      `Relación actividad reciente/referencia: ${targetActivityRatio.toFixed(2)}×.`,
      `El nivel ETAS utiliza el exceso sobre la tasa de fondo, no la mera existencia de terremotos en la región.`,
    ],
    limitations: [
      "La compatibilidad ETAS es estadística y no demuestra causalidad física entre dos sismos.",
      "Los parámetros iniciales son generales y deben calibrarse con el catálogo histórico de cada país antes de interpretar probabilidades como operacionales.",
      "Los eventos fuera de la zona, escala o ventana de una proyección se consideran actividad independiente y no errores adicionales del modelo.",
      "Las probabilidades son condicionales al catálogo disponible y no equivalen a una predicción determinista ni a una alerta oficial.",
    ],
  };
}
