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
  const [requestError, setRequestError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(`/api/migration/learning/status?_=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: LearningStatus;
      try {
        payload = JSON.parse(text) as LearningStatus;
      } catch {
        throw new Error(`Estado del pipeline devolvió HTTP ${response.status}: ${text.slice(0, 180) || "respuesta vacía"}`);
      }

      // A structured degraded response is still useful. Keep its real counters
      // instead of replacing them with fabricated zeros.
      setStatus(payload);
      if (!response.ok) {
        setRequestError(payload.message ?? `El estado de la memoria respondió HTTP ${response.status}.`);
      } else {
        setRequestError(null);
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "La consulta de estado tardó demasiado. La última lectura válida se conserva."
        : error instanceof Error
          ? error.message
          : "No fue posible consultar el aprendizaje.";
      setRequestError(message);
      // Deliberately preserve the last valid snapshot. A network failure does
      // not mean that Supabase contains zero capsules.
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(false), 60_000);
    const listener = () => void load(false);
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
      : !status && requestError
        ? "pending"
        : "disconnected";

  const connectionLabel = loading && !status
    ? "Comprobando…"
    : status?.databaseConnected
      ? "Supabase conectado"
      : status?.migrationPending
        ? "Migración pendiente"
        : !status && requestError
          ? "Estado no disponible"
          : "Base no disponible";

  return (
    <section className="panel learning-status-panel">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">Memoria histórica del modelo</span>
          <h2>Persistencia y evaluación</h2>
        </div>
        <span className={`learning-db-badge ${connectionClass}`}>
          {connectionLabel}
        </span>
      </div>

      {requestError && (
        <p className="learning-status-message">
          Consulta temporal: {requestError}{" "}
          <button type="button" onClick={() => void load(true)} disabled={loading}>
            {loading ? "Reintentando…" : "Reintentar"}
          </button>
        </p>
      )}
      {status?.message && !status.databaseConnected && status.message !== requestError && (
        <p className="learning-status-message">{status.message}</p>
      )}
      {status?.schedulerWarning && (
        <p className="learning-status-message">{status.schedulerWarning}</p>
      )}
      {status?.pipeline?.error && (
        <p className="learning-status-message">Pipeline: {status.pipeline.error}</p>
      )}

      <div className="learning-status-grid">
        <div><span>Cápsulas guardadas</span><strong>{status?.capsulesTotal ?? "—"}</strong></div>
        <div><span>En vigilancia</span><strong>{status?.capsulesActive ?? "—"}</strong></div>
        <div><span>Pendientes de evaluar</span><strong>{status?.capsulesDue ?? "—"}</strong></div>
        <div><span>Evaluadas</span><strong>{status?.capsulesEvaluated ?? "—"}</strong></div>
        <div><span>Predicciones nacionales</span><strong>{status?.predictionsTotal ?? "—"}</strong></div>
        <div><span>Resultados observados</span><strong>{status?.outcomesTotal ?? "—"}</strong></div>
      </div>

      <div className="learning-metrics-row">
        <div>
          <span>Último evento fuente en memoria</span>
          <strong>{status ? dateTime(status.pipeline?.latestSourceTime) : "—"}</strong>
        </div>
        <div>
          <span>Última cápsula creada</span>
          <strong>{status ? dateTime(status.pipeline?.latestCapsuleCreatedAt) : "—"}</strong>
        </div>
        <div>
          <span>Último resultado evaluado</span>
          <strong>{status ? dateTime(status.pipeline?.latestOutcomeEvaluatedAt) : "—"}</strong>
        </div>
        <div>
          <span>Generación automática</span>
          <strong>{status?.generationCronSchedule ?? (status ? "30 14 * * *" : "—")}</strong>
        </div>
      </div>

      <div className="learning-metrics-row">
        <div>
          <span>Versión activa</span>
          <strong>{status?.modelVersion ?? "—"}</strong>
        </div>
        <div>
          <span>Brier Score</span>
          <strong>{status?.latestMetrics ? status.latestMetrics.brierScore.toFixed(3) : status ? "Sin muestra" : "—"}</strong>
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
        Este panel describe únicamente la memoria histórica persistente. Si la consulta falla temporalmente, se conserva la última lectura válida y se muestran guiones cuando todavía no existe una lectura; nunca se sustituyen datos desconocidos por ceros. La vista ETAS principal funciona de forma independiente de esta memoria.
      </p>
    </section>
  );
}
