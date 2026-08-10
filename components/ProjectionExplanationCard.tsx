"use client";

import type { ProjectionHistoryItem } from "@/lib/learning/projectionHistory";
import {
  formatProbability,
  formatSignedPercentagePoints,
  ParameterLabel,
  PROJECTION_PARAMETER_HELP,
  projectionInfoStyles as styles,
} from "./ProjectionInfo";

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function observedSummary(item: ProjectionHistoryItem) {
  if (item.status === "fulfilled" && item.outcome?.firstEvent) {
    const event = item.outcome.firstEvent;
    return (
      <div className={styles.outcome}>
        <strong>Por qué se considera cumplida.</strong>{" "}
        El {formatDate(event.time, true)} UTC ocurrió un sismo M{event.magnitude.toFixed(1)} en {event.place}. Entró dentro de la zona, la ventana {formatDate(item.surveillanceStart)}–{formatDate(item.surveillanceEnd)} y el rango M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)} definidos antes de observar ese resultado.
      </div>
    );
  }
  if (item.status === "fulfilled_outside_range" && item.outcome?.firstOutsideRangeEvent) {
    const event = item.outcome.firstOutsideRangeEvent;
    return (
      <div className={styles.outcome}>
        <strong>Actividad relacionada, pero fuera de la escala proyectada.</strong>{" "}
        El {formatDate(event.timeUtc, true)} UTC ocurrió un sismo M{event.magnitude.toFixed(1)} en {event.place}; estuvo en el área y periodo vigilados, pero no dentro del rango M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}.
      </div>
    );
  }
  if (item.status === "active") {
    return (
      <div className={styles.inlineExplanation}>
        Esta proyección sigue abierta hasta {formatDate(item.surveillanceEnd)}. Que esté activa no significa que el evento vaya a ocurrir; solo que todavía no terminó la ventana definida al emitirla.
      </div>
    );
  }
  if (item.status === "not_fulfilled") {
    return (
      <div className={styles.inlineExplanation}>
        La ventana terminó sin un evento que cumpliera simultáneamente ubicación, tiempo y magnitud. Este resultado también alimenta la calibración futura del modelo.
      </div>
    );
  }
  return null;
}

export function ProjectionExplanationCard({
  item,
  onClose,
}: {
  item: ProjectionHistoryItem;
  onClose?: () => void;
}) {
  const evaluated = Math.max(item.analogsEvaluated, item.analogHits, item.controlHits);
  return (
    <section className={styles.explanation} aria-label={`Explicación de la proyección ${item.countryName}`}>
      <div className={styles.explanationHeader}>
        <div>
          <span className="eyebrow">Cómo leer esta proyección</span>
          <h3>{item.countryName} fue proyectado a partir de M{item.sourceEvent.magnitude.toFixed(1)} · {item.sourceEvent.place}</h3>
        </div>
        {onClose ? <button type="button" className={styles.closeButton} onClick={onClose}>Cerrar</button> : null}
      </div>

      <p className={styles.narrative}>
        El evento precedente ocurrió el {formatDate(item.sourceEvent.time, true)} UTC. El sistema buscó terremotos históricos comparables y observó qué ocurrió después en {item.countryName}, usando una ventana de control anterior para estimar cuánto de la actividad podía considerarse habitual. La proyección se emitió con esos parámetros antes de evaluar el resultado observado.
      </p>

      <div className={styles.metrics}>
        <div>
          <ParameterLabel label="Probabilidad" help={PROJECTION_PARAMETER_HELP.probability} />
          <strong>{formatProbability(item.probabilityPct)}</strong>
          <small>{item.analogHits} análogo(s) con coincidencia</small>
        </div>
        <div>
          <ParameterLabel label="Línea base" help={PROJECTION_PARAMETER_HELP.baseline} />
          <strong>{formatProbability(item.baselinePct)}</strong>
          <small>{item.controlHits} coincidencia(s) de control</small>
        </div>
        <div>
          <ParameterLabel label="Exceso vs. base" help={PROJECTION_PARAMETER_HELP.lift} />
          <strong>{formatSignedPercentagePoints(item.liftPct)}</strong>
          <small>posterior − control</small>
        </div>
        <div>
          <ParameterLabel label="Calidad de evidencia" help={PROJECTION_PARAMETER_HELP.confidence} />
          <strong>{item.confidencePct.toFixed(0)}%</strong>
          <small>{evaluated || "—"} análogos evaluados</small>
        </div>
      </div>

      <p className={styles.narrative}>
        La lectura correcta es: <strong>{formatProbability(item.probabilityPct)}</strong> es la recurrencia empírica estimada para este destino bajo condiciones históricas comparables; <strong>{item.confidencePct.toFixed(0)}%</strong> describe la calidad de la evidencia del escenario y no una segunda probabilidad de ocurrencia.
      </p>

      <div className={styles.metrics}>
        <div>
          <ParameterLabel label="Ventana" help={PROJECTION_PARAMETER_HELP.window} />
          <strong>{formatDate(item.surveillanceStart)}–{formatDate(item.surveillanceEnd)}</strong>
        </div>
        <div>
          <ParameterLabel label="Magnitud" help={PROJECTION_PARAMETER_HELP.magnitude} />
          <strong>M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}</strong>
        </div>
        <div>
          <ParameterLabel label="Análogos históricos" help={PROJECTION_PARAMETER_HELP.analogs} />
          <strong>{item.analogHits}/{evaluated || "—"}</strong>
          <small>coincidencias posteriores</small>
        </div>
        <div>
          <span>Mediana histórica</span>
          <strong>{item.medianLeadDays === null ? "—" : `${item.medianLeadDays.toFixed(1)} días`}</strong>
          <small>tiempo hasta la primera coincidencia</small>
        </div>
      </div>

      {observedSummary(item)}
    </section>
  );
}
