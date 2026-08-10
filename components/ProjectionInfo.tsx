"use client";

import { useState, type ReactNode } from "react";
import styles from "./ProjectionInfo.module.css";

export const PROJECTION_PARAMETER_HELP = {
  probability: {
    title: "Probabilidad empírica",
    text: "Es la frecuencia histórica ponderada con la que apareció un evento compatible en este destino después de precedentes similares. No es certeza ni una predicción determinista.",
  },
  baseline: {
    title: "Línea base",
    text: "Mide cuánto de esa actividad ya aparecía normalmente en ventanas históricas de control equivalentes antes del precedente. Sirve para separar señal de actividad sísmica habitual.",
  },
  lift: {
    title: "Exceso sobre la base",
    text: "Es la diferencia en puntos porcentuales entre la recurrencia posterior y la línea base. Un valor positivo indica más actividad posterior que en las ventanas de control.",
  },
  confidence: {
    title: "Calidad de evidencia",
    text: "Resume cantidad y similitud de los análogos usados por el escenario. No significa probabilidad de que ocurra el terremoto y no debe sumarse a la probabilidad empírica.",
  },
  analogs: {
    title: "Análogos históricos",
    text: "Son terremotos históricos independientes parecidos al evento precedente por magnitud, profundidad y cercanía. El modelo observa qué sucedió después de ellos.",
  },
  window: {
    title: "Ventana de vigilancia",
    text: "Intervalo temporal fijado al emitir la proyección. Un evento solo puede cumplirla si ocurre dentro de esta ventana, además de la zona y magnitud proyectadas.",
  },
  magnitude: {
    title: "Rango de magnitud",
    text: "Franja de magnitud derivada de lo observado después de los análogos históricos. Es orientativa y forma parte de los criterios de verificación.",
  },
} as const;

export function formatProbability(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatSignedPercentagePoints(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`;
}

export function ProjectionInfo({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.info}>
      <button
        type="button"
        className={styles.infoButton}
        aria-label={`Información: ${title}`}
        aria-expanded={open}
        title={`Información: ${title}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        i
      </button>
      {open ? (
        <span className={styles.popover} role="note" onClick={(event) => event.stopPropagation()}>
          <strong>{title}</strong>
          <span>{children}</span>
        </span>
      ) : null}
    </span>
  );
}

export function ParameterLabel({
  label,
  help,
}: {
  label: ReactNode;
  help: { title: string; text: string };
}) {
  return (
    <span className={styles.metricLabel}>
      {label}
      <ProjectionInfo title={help.title}>{help.text}</ProjectionInfo>
    </span>
  );
}

export { styles as projectionInfoStyles };
