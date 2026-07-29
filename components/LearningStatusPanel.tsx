"use client";

import { useCallback, useEffect, useState } from "react";

interface LearningStatus {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  modelVersion: string;
  capsulesTotal: number;
  capsulesActive: number;
  capsulesDue: number;
  capsulesEvaluated: number;
  predictionsTotal: number;
  outcomesTotal: number;
  latestMetrics: {
    sampleCount: number;
    positiveCount: number;
    averageProbability: number;
    observedRate: number;
    brierScore: number;
    logLoss: number;
    accuracyAt50: number;
    calculatedAt: string;
  } | null;
  message?: string;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function LearningStatusPanel() {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/migration/learning/status?_=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json() as LearningStatus;
      setStatus(payload);
    } catch (error) {
      setStatus({
        databaseConfigured: true,
        databaseConnected: false,
        modelVersion: "migration-country-v2",
        capsulesTotal: 0,
        capsulesActive: 0,
        capsulesDue: 0,
        capsulesEvaluated: 0,
        predictionsTotal: 0,
        outcomesTotal: 0,
        latestMetrics: null,
        message: error instanceof Error ? error.message : "No fue posible consultar el aprendizaje.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    const listener = () => void load();
    window.addEventListener("rdsismos-learning-updated", listener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("rdsismos-learning-updated", listener);
    };
  }, [load]);

  return (
    <section className="panel learning-status-panel">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">Memoria del modelo</span>
          <h2>Aprendizaje y evaluación</h2>
        </div>
        <span className={`learning-db-badge ${status?.databaseConnected ? "connected" : "disconnected"}`}>
          {loading ? "Comprobando…" : status?.databaseConnected ? "Supabase conectado" : "Base no disponible"}
        </span>
      </div>

      {status?.message && !status.databaseConnected && (
        <p className="learning-status-message">{status.message}</p>
      )}

      <div className="learning-status-grid">
        <div><span>Cápsulas guardadas</span><strong>{status?.capsulesTotal ?? 0}</strong></div>
        <div><span>En vigilancia</span><strong>{status?.capsulesActive ?? 0}</strong></div>
        <div><span>Pendientes de evaluar</span><strong>{status?.capsulesDue ?? 0}</strong></div>
        <div><span>Evaluadas</span><strong>{status?.capsulesEvaluated ?? 0}</strong></div>
        <div><span>Predicciones nacionales</span><strong>{status?.predictionsTotal ?? 0}</strong></div>
        <div><span>Resultados observados</span><strong>{status?.outcomesTotal ?? 0}</strong></div>
      </div>

      <div className="learning-metrics-row">
        <div>
          <span>Versión activa</span>
          <strong>{status?.modelVersion ?? "migration-country-v2"}</strong>
        </div>
        <div>
          <span>Brier Score</span>
          <strong>{status?.latestMetrics ? status.latestMetrics.brierScore.toFixed(3) : "Sin muestra"}</strong>
        </div>
        <div>
          <span>Probabilidad media</span>
          <strong>{status?.latestMetrics ? percent(status.latestMetrics.averageProbability) : "—"}</strong>
        </div>
        <div>
          <span>Frecuencia observada</span>
          <strong>{status?.latestMetrics ? percent(status.latestMetrics.observedRate) : "—"}</strong>
        </div>
      </div>

      <p className="learning-status-footnote">
        El aprendizaje comienza guardando la predicción antes del resultado. Cuando termina la vigilancia, el evaluador registra lo ocurrido y calcula calibración y error probabilístico.
      </p>
    </section>
  );
}
