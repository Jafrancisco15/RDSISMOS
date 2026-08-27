import type { MagneticLocalityMetrics } from "./geomagnetism";

export type FreundCriterionState = "supportive" | "mixed" | "weak" | "unknown";

export interface FreundCriterion {
  id: "locality" | "robustness" | "persistence" | "gradient" | "verticality" | "geomagneticQuiet";
  label: string;
  value: string;
  state: FreundCriterionState;
  note: string;
}

export interface FreundExperimentalAssessment {
  score: number;
  classification: "high" | "partial" | "weak" | "none" | "solar-contaminated";
  label: string;
  criteria: FreundCriterion[];
  phase: "magnetic-only";
  predictive: false;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function quietness(maxKp: number | null) {
  if (maxKp === null) return 0.5;
  if (maxKp < 4) return 1;
  if (maxKp < 5) return 0.65;
  if (maxKp < 6) return 0.3;
  return 0.05;
}

function criterionState(value: number, supportive: number, mixed: number): FreundCriterionState {
  if (value >= supportive) return "supportive";
  if (value >= mixed) return "mixed";
  return "weak";
}

/**
 * Experimental compatibility score for the magnetic portion of Friedemann Freund's
 * stress-activated positive-hole hypothesis. This is intentionally NOT an earthquake
 * probability and does not claim causality. It asks only whether the observed magnetic
 * residual looks local, robust, persistent and comparatively quiet in planetary Kp.
 */
export function assessFreundCompatibility(metrics: MagneticLocalityMetrics): FreundExperimentalAssessment {
  const locality = clamp01(1 - metrics.commonModeCorrelation);
  const robustness = clamp01((metrics.p95RobustZ - 1) / 5);
  const persistence = clamp01(1 - Math.exp(-metrics.anomalyFraction * 30));
  const gradient = clamp01(1 - Math.exp(-metrics.maxDbDtNtPerMin / 8));
  const verticality = clamp01(1 - Math.exp(-Math.min(8, metrics.maxZhProxy) / 2.5));
  const geomagneticQuiet = quietness(metrics.maxKp);

  const raw = 100 * (
    0.30 * robustness +
    0.22 * locality +
    0.16 * persistence +
    0.10 * gradient +
    0.08 * verticality +
    0.14 * geomagneticQuiet
  );
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  const solarContaminated = metrics.maxKp !== null && metrics.maxKp >= 5;
  let classification: FreundExperimentalAssessment["classification"];
  let label: string;
  if (solarContaminated) {
    classification = "solar-contaminated";
    label = "actividad geomagnética externa significativa";
  } else if (score >= 70) {
    classification = "high";
    label = "compatibilidad magnética alta";
  } else if (score >= 50) {
    classification = "partial";
    label = "compatibilidad magnética parcial";
  } else if (score >= 30) {
    classification = "weak";
    label = "compatibilidad magnética débil";
  } else {
    classification = "none";
    label = "sin patrón Freund destacado";
  }

  const kpState: FreundCriterionState = metrics.maxKp === null
    ? "unknown"
    : metrics.maxKp < 4
      ? "supportive"
      : metrics.maxKp < 5
        ? "mixed"
        : "weak";

  return {
    score,
    classification,
    label,
    phase: "magnetic-only",
    predictive: false,
    criteria: [
      {
        id: "locality",
        label: "Localidad",
        value: `${Math.round(locality * 100)}%`,
        state: criterionState(locality, 0.65, 0.4),
        note: "Baja coherencia con estaciones control favorece una fuente local frente a señal regional/global.",
      },
      {
        id: "robustness",
        label: "Robust Z",
        value: metrics.p95RobustZ.toFixed(2),
        state: criterionState(robustness, 0.55, 0.3),
        note: "Cuantifica qué tan excepcional es el residuo frente al fondo robusto de la propia ventana.",
      },
      {
        id: "persistence",
        label: "Persistencia",
        value: `${(metrics.anomalyFraction * 100).toFixed(2)}%`,
        state: criterionState(persistence, 0.5, 0.2),
        note: "Una señal sostenida pesa más que un pico aislado; el umbral base es robust z ≥ 3.",
      },
      {
        id: "gradient",
        label: "dB/dt",
        value: `${metrics.maxDbDtNtPerMin.toFixed(2)} nT/min`,
        state: criterionState(gradient, 0.55, 0.3),
        note: "Proxy de cambio rápido del residuo magnético local; no identifica por sí solo su causa.",
      },
      {
        id: "verticality",
        label: "Z/H proxy",
        value: metrics.maxZhProxy.toFixed(2),
        state: criterionState(verticality, 0.55, 0.3),
        note: "Proxy temporal de verticalidad. No sustituye un análisis espectral ULF ni medición eléctrica del terreno.",
      },
      {
        id: "geomagneticQuiet",
        label: "Quietud Kp",
        value: metrics.maxKp === null ? "N/D" : `Kp ${metrics.maxKp.toFixed(1)}`,
        state: kpState,
        note: "Kp bajo reduce la posibilidad de confundir actividad solar/planetaria con una anomalía local.",
      },
    ],
  };
}
