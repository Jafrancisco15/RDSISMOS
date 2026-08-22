"use client";

import { useEffect, useMemo, useState } from "react";

type LearningStatus = {
  databaseConnected?: boolean;
  migrationPending?: boolean;
  generationCronSchedule?: string;
  pipeline?: {
    latestCapsuleCreatedAt?: string | null;
    latestPredictionUpdatedAt?: string | null;
    latestSourceTime?: string | null;
    error?: string | null;
  };
  message?: string;
};

const DEFAULT_GENERATION_CRON = "30 14 * * *";
const STATUS_REFRESH_MS = 15 * 60_000;

function parseDailyCron(value: string | undefined) {
  const parts = (value || DEFAULT_GENERATION_CRON).trim().split(/\s+/);
  if (parts.length !== 5) return { minute: 30, hour: 14 };
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return { minute: 30, hour: 14 };
  }
  return { minute, hour };
}

function nextDailyUtc(hour: number, minute: number, now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatLocal(value: Date | string | null | undefined) {
  if (!value) return "Sin registro";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProjectionUpdateStatus() {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/migration/learning/status", { cache: "default" });
        const payload = await response.json() as LearningStatus;
        if (!cancelled) {
          setStatus(payload);
          setError(response.ok ? null : payload.message ?? `HTTP ${response.status}`);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo consultar el estado.");
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(), STATUS_REFRESH_MS);
    const ticker = window.setInterval(() => setClock(Date.now()), 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(ticker);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const schedule = useMemo(() => parseDailyCron(status?.generationCronSchedule), [status?.generationCronSchedule]);
  const nextUpdate = useMemo(() => nextDailyUtc(schedule.hour, schedule.minute, new Date(clock)), [clock, schedule.hour, schedule.minute]);
  const lastProjectionChange = status?.pipeline?.latestPredictionUpdatedAt ?? status?.pipeline?.latestCapsuleCreatedAt ?? null;
  const timezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "hora local";

  const stateLabel = status?.databaseConnected
    ? "Sistema conectado"
    : status?.migrationPending
      ? "Base pendiente de migración"
      : status
        ? "Base no disponible"
        : error
          ? "Estado no disponible"
          : "Comprobando sistema…";

  return (
    <footer style={{ maxWidth: 1180, margin: "28px auto 36px", padding: "0 18px" }}>
      <div style={{
        display: "grid",
        gap: 12,
        padding: 18,
        borderRadius: 18,
        border: "1px solid rgba(56,189,248,.18)",
        background: "rgba(15,23,42,.82)",
        color: "#dbe7f3",
      }}>
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#38bdf8", fontSize: 12, fontWeight: 800, letterSpacing: ".1em" }}>ACTUALIZACIÓN DE PROYECCIONES</div>
            <strong style={{ display: "block", marginTop: 5, fontSize: 17 }}>{stateLabel}</strong>
          </div>
          <span style={{ fontSize: 12, color: status?.databaseConnected ? "#86efac" : "#fbbf24" }}>
            {status?.databaseConnected ? "● Operativo" : "● Verificando"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,.34)" }}>
            <span style={{ display: "block", color: "#94a3b8", fontSize: 12 }}>Último cambio persistido</span>
            <strong>{formatLocal(lastProjectionChange)}</strong>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,.34)" }}>
            <span style={{ display: "block", color: "#94a3b8", fontSize: 12 }}>Próxima generación automática</span>
            <strong>{formatLocal(nextUpdate)}</strong>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,.34)" }}>
            <span style={{ display: "block", color: "#94a3b8", fontSize: 12 }}>Horario mostrado</span>
            <strong>{timezone}</strong>
          </div>
        </div>

        <p style={{ margin: 0, color: "#94a3b8", fontSize: 12, lineHeight: 1.55 }}>
          La generación histórica automática está programada una vez al día. Que los números permanezcan iguales entre visitas no significa necesariamente que el sistema esté detenido: puede no haber aparecido un nuevo evento que cambie las cápsulas o proyecciones. Este indicador se consulta con baja frecuencia para no consumir cómputo innecesario. ETAS funciona de forma independiente de este horario.
        </p>
        {error && <small style={{ color: "#fbbf24" }}>Consulta de estado: {error}</small>}
      </div>
    </footer>
  );
}
