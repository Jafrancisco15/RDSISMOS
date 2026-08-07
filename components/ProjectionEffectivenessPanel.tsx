"use client";

import { useEffect, useState } from "react";
import type {
  ProjectionEffectivenessMetric,
  ProjectionEffectivenessResponse,
} from "@/lib/learning/projectionEffectiveness";

const REFRESH_MS = 10 * 60_000;

function score(value: number | null, digits = 3) {
  return value === null ? "—" : value.toFixed(digits);
}

function signedPct(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function signedPp(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function MetricCard({ metric }: { metric: ProjectionEffectivenessMetric }) {
  const skillClass = metric.brierSkillScorePct === null
    ? ""
    : metric.brierSkillScorePct > 0
      ? "positive"
      : "negative";
  return (
    <article className="metric-card">
      <span>{metric.label}</span>
      <strong className="viz-stat-value">{metric.resolvedCount.toLocaleString()}</strong>
      <small>resueltas de {metric.issuedCount.toLocaleString()} emitidas · {metric.positiveCount.toLocaleString()} cumplidas</small>
      <div className="projection-effectiveness-details">
        <small>Brier: <strong>{score(metric.brierScore)}</strong> · base: <strong>{score(metric.baselineBrierScore)}</strong></small>
        <small>Skill vs base: <strong className={skillClass}>{signedPct(metric.brierSkillScorePct)}</strong></small>
        <small>Prob. media: <strong>{metric.averageProbabilityPct.toFixed(1)}%</strong> · observado: <strong>{metric.observedRatePct.toFixed(1)}%</strong></small>
        <small>Brecha calibración: <strong>{signedPp(metric.calibrationGapPct)}</strong> · precisión @50: <strong>{metric.accuracyAt50Pct === null ? "—" : `${metric.accuracyAt50Pct.toFixed(1)}%`}</strong></small>
      </div>
    </article>
  );
}

export function ProjectionEffectivenessPanel() {
  const [data, setData] = useState<ProjectionEffectivenessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const controllers = new Set<AbortController>();

    async function load() {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await fetch(`/api/migration/projections/effectiveness?_=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as ProjectionEffectivenessResponse;
        if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
        if (!disposed) {
          setData(payload);
          setError(null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible medir la efectividad.");
      } finally {
        controllers.delete(controller);
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      for (const controller of controllers) controller.abort();
    };
  }, []);

  return (
    <section className="projection-history-page projection-effectiveness-page">
      <header className="projection-history-head">
        <div>
          <span className="eyebrow">Validación operacional</span>
          <h1>Efectividad real de las proyecciones</h1>
          <p>Brier Score, calibración y skill contra la probabilidad de fondo usando únicamente pronósticos operacionales ya resueltos.</p>
        </div>
        <div className="projection-history-total">
          <span>Último cálculo</span>
          <strong>{data ? formatDate(data.calculatedAt) : "Cargando…"}</strong>
        </div>
      </header>

      {error && <div className="warning-banner projection-history-error">{error}</div>}
      {data && (
        <>
          <div className="globe-summary-grid">
            <MetricCard metric={data.combined} />
            <MetricCard metric={data.historical} />
            <MetricCard metric={data.regionalEtas} />
            <article className="metric-card">
              <span>Integridad del scoring</span>
              <strong className="viz-stat-value">{data.legacyEtasResolvedExcluded.toLocaleString()}</strong>
              <small>ETAS legado excluido del scoring estricto</small>
              <div className="projection-effectiveness-details">
                <small>Brier menor es mejor.</small>
                <small>Skill positivo = supera la línea base; negativo = rinde peor.</small>
                <small>Se actualiza automáticamente cada 10 minutos.</small>
              </div>
            </article>
          </div>
          <div className="quality-warning">
            <strong>Criterio:</strong> {data.criteria}
            {data.message ? ` ${data.message}` : ""}
          </div>
        </>
      )}
    </section>
  );
}
