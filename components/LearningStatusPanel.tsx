"use client";

import { useCallback, useEffect, useState } from "react";

interface LearningStatus {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  migrationPending?: boolean;
  cronSecretConfigured?: boolean;
  generationCronSchedule?: string;
  evaluationCronSchedule?: string;
  schedulerWarning?: string;
  modelVersion: string;
  capsulesTotal: number;
  capsulesActive: number;
  capsulesDue: number;
  capsulesEvaluated: number;
  predictionsTotal: number;
  outcomesTotal: number;
  pipeline?: {
    latestCapsuleCreatedAt: string | null;
    latestSourceTime: string | null;
    latestOutcomeEvaluatedAt: string | null;
    latestPredictionUpdatedAt: string | null;
    error: string | null;
  };
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

function dateTime(value: string | null | undefined) {
  if (!value) return "Sin registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function LearningStatusPanel() {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/migration/learning/status?_=${Date.now()}`, { cache: "no-store" });
      const text = await response.text();
      let payload: LearningStatus;
      try {
        payload = JSON.parse(text) as LearningStatus;
      } catch {
        throw new Error(`Estado del pipeline devolvió HTTP ${response.status}: ${text.slice(0, 180) || "respuesta vacía"}`);
      }
      setStatus(payload);
    } catch (error) {
      setStatus({
        databaseConfigured: true,
        databaseConnected: false,
        migrationPending: false,
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

  const connectionClass = status?.databaseConnected
    ? "connected"
    : status?.migrationPending
      ? "pending"
      : "disconnected";
  const connectionLabel = loading
    ? "Comprobando…"
    : status?.databaseConnected
      ? "Supabase conectado"
      : status?.migrationPending
        ? "Migración pendiente"
        : "Base no disponible";

  return (
    <section className="panel learning-status-panel">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">Memoria del modelo</span>
          <h2>Aprendizaje y evaluación</h2>
        </div>
        <span className={`learning-db-badge ${connectionClass}`}>
          {connectionLabel}
        </span>
      </div>

      {status?.message && !status.databaseConnected && (
        <p className="learning-status-message">{status.message}</p>
      )}
      {status?.schedulerWarning && (
        <p className="learning-status-message">{status.schedulerWarning}</p>
      )}
      {status?.pipeline?.error && (
        <p className="learning-status-message">Pipeline: {status.pipeline.error}</p>
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
          <span>Último evento fuente en memoria</span>
          <strong>{dateTime(status?.pipeline?.latestSourceTime)}</strong>
        </div>
        <div>
          <span>Última cápsula creada</span>
          <strong>{dateTime(status?.pipeline?.latestCapsuleCreatedAt)}</strong>
        </div>
        <div>
          <span>Último resultado evaluado</span>
          <strong>{dateTime(status?.pipeline?.latestOutcomeEvaluatedAt)}</strong>
        </div>
        <div>
          <span>Generación automática</span>
          <strong>{status?.generationCronSchedule ?? "45 2 * * *"}</strong>
        </div>
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
        La generación automática busca cada día eventos fuente nuevos de los últimos 14 días y guarda la proyección antes de conocer el resultado. Después, el evaluador revisa las ventanas activas y vencidas. Las fechas de arriba permiten comprobar si la escritura y evaluación siguen vivas.
      </p>
    </section>
  );
}
