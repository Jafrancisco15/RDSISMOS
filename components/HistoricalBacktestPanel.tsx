"use client";

import { useEffect, useState } from "react";
import type { BacktestRunResult } from "@/lib/learning/backtest";

interface BacktestApiResponse {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  result: BacktestRunResult | null;
  warning?: string;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function percentRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function skillInterpretation(value: number | null) {
  if (value === null) return "Sin base suficiente para comparar";
  if (value > 0.1) return "Mejor que la línea base en esta cohorte";
  if (value >= -0.1) return "Rendimiento similar a la línea base";
  return "Peor que la línea base en esta cohorte";
}

export function HistoricalBacktestPanel() {
  const [payload, setPayload] = useState<BacktestApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/migration/learning/backtest?_=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as BacktestApiResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? data.warning ?? `HTTP ${response.status}`);
        setPayload(data);
        setError(null);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la validación retrospectiva.");
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const result = payload?.result ?? null;

  return (
    <section className="panel projection-history-backtest" aria-label="Validación retrospectiva">
      <div className="projection-history-list-head">
        <div>
          <span className="eyebrow">Prueba fuera de muestra</span>
          <h2>Validación retrospectiva</h2>
        </div>
        <span>{result ? `Calculada ${formatDate(result.calculatedAt)}` : "Sin ejecución guardada"}</span>
      </div>

      {loading && <p>Consultando la última cohorte retrospectiva…</p>}
      {error && <div className="warning-banner projection-history-error">{error}</div>}

      {!loading && !error && !result && (
        <div className="quality-warning">
          <strong>Todavía no hay una prueba retrospectiva guardada.</strong>{" "}
          {payload?.warning ?? "Ejecuta una cohorte cerrada para medir el modelo frente a su línea base sin esperar a que terminen las proyecciones actuales."}
        </div>
      )}

      {result && (
        <>
          <div className="globe-summary-grid">
            <article className="metric-card">
              <span>Cohorte histórica</span>
              <strong className="viz-stat-value">{result.configuration.cohortDays} días</strong>
              <small>{formatDate(result.configuration.cohortStart)}–{formatDate(result.configuration.cohortEnd)}</small>
            </article>
            <article className="metric-card">
              <span>Proyecciones evaluadas</span>
              <strong className="viz-stat-value">{result.projectionsScored}</strong>
              <small>{result.sourcesProcessed} eventos precedentes procesados</small>
            </article>
            <article className="metric-card">
              <span>Migración compatible</span>
              <strong className="viz-stat-value">{result.fulfilledCount}</strong>
              <small>Tasa observada {percentRatio(result.metrics.observedRate)}</small>
            </article>
            <article className="metric-card">
              <span>Probabilidad media</span>
              <strong className="viz-stat-value">{percentRatio(result.metrics.averageProbability)}</strong>
              <small>Comparar con la tasa observada, no como certeza</small>
            </article>
            <article className="metric-card">
              <span>Brier del modelo</span>
              <strong className="viz-stat-value">{result.metrics.brierScore.toFixed(3)}</strong>
              <small>Menor es mejor</small>
            </article>
            <article className="metric-card">
              <span>Brier de la base</span>
              <strong className="viz-stat-value">{result.metrics.baselineBrierScore.toFixed(3)}</strong>
              <small>Actividad histórica normal</small>
            </article>
            <article className="metric-card">
              <span>Habilidad frente a base</span>
              <strong className="viz-stat-value">
                {result.metrics.brierSkillScore === null
                  ? "—"
                  : `${(result.metrics.brierSkillScore * 100).toFixed(1)}%`}
              </strong>
              <small>{skillInterpretation(result.metrics.brierSkillScore)}</small>
            </article>
            <article className="metric-card">
              <span>Exactitud al 50%</span>
              <strong className="viz-stat-value">{percentRatio(result.metrics.accuracyAt50)}</strong>
              <small>{result.possibleAssociationCount} posibles · {result.backgroundLikelyCount} de fondo · {result.noEventCount} sin evento</small>
            </article>
          </div>

          <div className="quality-warning">
            <strong>Interpretación:</strong> esta prueba reconstruye pronósticos usando solamente datos anteriores a cada evento precedente y evalúa ventanas que terminaron hace semanas. Un skill positivo indica que, en esta cohorte, el modelo superó su propia línea base; una sola cohorte de 14 días no basta para afirmar eficacia general.
            {result.sourceErrors.length ? ` ${result.sourceErrors.length} eventos precedentes no pudieron procesarse.` : ""}
          </div>
        </>
      )}
    </section>
  );
}
