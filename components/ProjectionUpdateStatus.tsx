"use client";

import { useEffect, useMemo, useState } from "react";

type LearningStatus = {
  databaseConnected?: boolean;
  migrationPending?: boolean;
  catchupCronSchedule?: string;
  generationCronSchedule?: string;
  pipeline?: {
    latestCapsuleCreatedAt?: string | null;
    latestPredictionUpdatedAt?: string | null;
    latestSourceTime?: string | null;
    error?: string | null;
  };
  message?: string;
};

const DEFAULT_CATCHUP_CRON = "15 */3 * * *";
const STATUS_REFRESH_MS = 15 * 60_000;

function nextThreeHourCatchup(value: string | undefined, now = new Date()) {
  const parts = (value || DEFAULT_CATCHUP_CRON).trim().split(/\s+/);
  const minute = Number(parts[0]);
  const intervalMatch = parts[1]?.match(/^\*\/(\d+)$/);
  const interval = intervalMatch ? Number(intervalMatch[1]) : 3;
  const safeMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 15;
  const safeInterval = Number.isInteger(interval) && interval > 0 && interval <= 24 ? interval : 3;

  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(safeMinute);
  let hour = Math.ceil((now.getUTCHours() + (now.getUTCMinutes() >= safeMinute ? 1 : 0)) / safeInterval) * safeInterval;
  if (hour >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    hour = 0;
  }
  next.setUTCHours(hour);
  if (next.getTime() <= now.getTime()) next.setUTCHours(next.getUTCHours() + safeInterval);
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

  const nextUpdate = useMemo(
    () => nextThreeHourCatchup(status?.catchupCronSchedule, new Date(clock)),
    [clock, status?.catchupCronSchedule],
  );
  const lastProjectionChange = status?.pipeline?.latestPredictionUpdatedAt ?? status?.pipeline?.latestCapsuleCreatedAt ?? null;
  const latestSourceTime = status?.pipeline?.latestSourceTime ?? null;
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
            <span style={{ display: "block", color: "#94a3b8", fontSize: 12 }}>Último evento precedente procesado</span>
            <strong>{formatLocal(latestSourceTime)}</strong>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,.34)" }}>
            <span style={{ display: "block", color: "#94a3b8", fontSize: 12 }}>Próximo catch-up automático</span>
            <strong>{formatLocal(nextUpdate)}</strong>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(2,6,23,.34)" }}>
            <span style={{ display: "block", color: "#94a3b8", fontSize: 12 }}>Horario mostrado</span>
            <strong>{timezone}</strong>
          </div>
        </div>

        <p style={{ margin: 0, color: "#94a3b8", fontSize: 12, lineHeight: 1.55 }}>
          El sistema busca nuevos eventos precedentes cada 3 horas y mantiene además una generación diaria de respaldo. Si no aparece un evento nuevo e independiente que cumpla los criterios, las proyecciones pueden permanecer iguales sin que el sistema esté detenido. Eventos Sísmicos se refresca cada 5 minutos mientras la pestaña está visible; ETAS y Mapa 3D usan sus propios ciclos de actualización.
        </p>
        {error && <small style={{ color: "#fbbf24" }}>Consulta de estado: {error}</small>}
      </div>
    </footer>
  );
}
