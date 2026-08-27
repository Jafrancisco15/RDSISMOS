"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeomagneticModelState, GeomagneticOutcome } from "@/lib/geomagneticProjection";
import type { GeomagneticTrialRow } from "@/lib/geomagneticLearningStore";
import { readJsonResponse } from "@/lib/safeFetchJson";

type Payload = {
  available: boolean;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  model: GeomagneticModelState;
  trials: GeomagneticTrialRow[];
  message?: string;
};

const panel: React.CSSProperties = { border: "1px solid rgba(129,140,248,.22)", borderRadius: 16, background: "linear-gradient(145deg,#071225,#100b2e)", padding: 14 };
const outcomeLabels: Record<GeomagneticOutcome, string> = { hit: "ACIERTO", miss: "FALLO", omission: "OMISIÓN", correct_rejection: "RECHAZO CORRECTO" };
const outcomeColors: Record<GeomagneticOutcome, string> = { hit: "#34d399", miss: "#fb7185", omission: "#f59e0b", correct_rejection: "#60a5fa" };

function fmt(value: string) { return new Date(value).toLocaleString("es-DO", { timeZone: "UTC" }); }

export function GeomagneticProjectionPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/geomagnetism/projections?limit=80&_=${Date.now()}`, { cache: "no-store" });
      const payload = await readJsonResponse<Payload & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar el ledger prospectivo.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5 * 60_000); return () => window.clearInterval(timer); }, [load]);

  const active = useMemo(() => data?.trials.filter((trial) => trial.status === "active" && trial.emitted) ?? [], [data]);
  const evaluated = useMemo(() => data?.trials.filter((trial) => trial.status === "evaluated") ?? [], [data]);
  const emittedEvaluated = evaluated.filter((trial) => trial.emitted);
  const precision = emittedEvaluated.length ? 100 * emittedEvaluated.filter((trial) => trial.outcome === "hit").length / emittedEvaluated.length : null;
  const observedPositive = evaluated.filter((trial) => trial.occurred).length;
  const recall = observedPositive ? 100 * evaluated.filter((trial) => trial.outcome === "hit").length / observedPositive : null;
  const model = data?.model;

  return <section style={{ display: "grid", gap: 12, padding: "0 12px 24px" }}>
    <header style={{ ...panel, background: "linear-gradient(135deg,#111b46,#312e81 58%,#4c1d95)" }}>
      <div style={{ color: "#c4b5fd", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>PROSPECTIVO · INTERMAGNET → M3.0+</div>
      <h2 style={{ color: "white", margin: "5px 0" }}>Proyecciones geomagnéticas y auto-validación</h2>
      <p style={{ color: "#dbeafe", fontSize: 11, lineHeight: 1.5, margin: 0 }}>Cada ensayo queda congelado antes de conocer el resultado. Una señal emitida vigila inicialmente 72 h y 200 km para cualquier sismo M3.0+. Los resultados futuros recalibran el umbral, nunca reescriben una proyección pasada.</p>
    </header>

    {loading && !data && <div style={panel}>Cargando ledger prospectivo…</div>}
    {error && <div style={{ ...panel, color: "#fca5a5" }}><strong>No se pudo leer el ledger.</strong><div style={{ marginTop: 4, fontSize: 11 }}>{error}</div><button type="button" onClick={() => void load()} style={{ marginTop: 8, border: "1px solid #4338ca", borderRadius: 9, background: "#1e1b4b", color: "white", padding: "6px 9px" }}>Reintentar</button></div>}
    {data && !data.available && <div style={{ ...panel, color: "#fde68a" }}><strong>Aprendizaje prospectivo no disponible.</strong><div style={{ fontSize: 11, marginTop: 4 }}>{data.message}</div></div>}

    {data?.available && model && <>
      <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 9 }}>
        <article><div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900 }}>UMBRAL ACTUAL</div><strong style={{ color: "white", fontSize: 27 }}>{model.emissionThreshold.toFixed(1)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>modelo v{model.version}{model.previousThreshold !== null && model.previousThreshold !== undefined ? ` · anterior ${model.previousThreshold.toFixed(1)}` : ""}</div></article>
        <article><div style={{ color: "#38bdf8", fontSize: 9, fontWeight: 900 }}>REGLA CONGELADA</div><strong style={{ color: "white", fontSize: 18 }}>M{model.magnitudeMin.toFixed(1)}+</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{model.radiusKm} km · {model.windowHours} h</div></article>
        <article><div style={{ color: "#34d399", fontSize: 9, fontWeight: 900 }}>ACIERTOS</div><strong style={{ color: "white", fontSize: 27 }}>{model.hits}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{precision === null ? "sin muestra" : `precisión ${precision.toFixed(1)}%`}</div></article>
        <article><div style={{ color: "#fb7185", fontSize: 9, fontWeight: 900 }}>FALLOS</div><strong style={{ color: "white", fontSize: 27 }}>{model.misses}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>alertas sin M3+ en ventana</div></article>
        <article><div style={{ color: "#f59e0b", fontSize: 9, fontWeight: 900 }}>OMISIONES</div><strong style={{ color: "white", fontSize: 27 }}>{model.omissions}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{recall === null ? "sin positivos aún" : `recall ${recall.toFixed(1)}%`}</div></article>
        <article><div style={{ color: "#60a5fa", fontSize: 9, fontWeight: 900 }}>ENSAYOS EVALUADOS</div><strong style={{ color: "white", fontSize: 27 }}>{model.evaluatedTrials}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{model.correctRejections} rechazos correctos</div></article>
      </section>

      <section style={{ ...panel, color: "#cbd5e1", fontSize: 11 }}><strong style={{ color: "white" }}>Última auto-corrección</strong><div style={{ marginTop: 4 }}>{model.calibrationReason ?? "Todavía no hay recalibración."}</div><div style={{ color: "#64748b", marginTop: 4 }}>Actualizado: {fmt(model.updatedAt)} UTC. Se requieren al menos 8 ensayos con suficientes positivos y negativos antes de mover el umbral.</div></section>

      <section style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}><strong style={{ color: "white" }}>Proyecciones activas</strong><button type="button" onClick={() => void load()} style={{ border: "1px solid #4338ca", borderRadius: 9, background: "#1e1b4b", color: "white", padding: "6px 9px", cursor: "pointer" }}>Actualizar</button></div>
        <div style={{ display: "grid", gap: 7, marginTop: 9 }}>{active.map((trial) => <article key={trial.id} style={{ padding: 9, borderRadius: 10, background: "rgba(49,46,129,.22)", border: "1px solid rgba(129,140,248,.22)", color: "#cbd5e1", fontSize: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong style={{ color: "#c4b5fd" }}>{trial.stationCode} · {trial.stationName}</strong><b style={{ color: "#fde68a" }}>ACTIVA</b></div><div>Score {trial.localityScore.toFixed(0)}/100 · umbral congelado {trial.thresholdSnapshot.toFixed(0)} · M{trial.magnitudeMin.toFixed(1)}+ · {trial.radiusKm} km</div><div>{fmt(trial.surveillanceStart)} → {fmt(trial.surveillanceEnd)} UTC</div></article>)}{!active.length && <span style={{ color: "#64748b", fontSize: 11 }}>No hay alertas geomagnéticas activas en este momento. Los ensayos sin señal siguen guardándose para medir omisiones y rechazos correctos.</span>}</div>
      </section>

      <section style={panel}><strong style={{ color: "white" }}>Resultados recientes</strong><div style={{ display: "grid", gap: 6, marginTop: 8, maxHeight: 420, overflow: "auto" }}>{evaluated.slice(0, 40).map((trial) => {
        const outcome = trial.outcome ?? "correct_rejection";
        return <article key={trial.id} style={{ padding: 8, borderRadius: 9, background: "rgba(15,23,42,.72)", borderLeft: `3px solid ${outcomeColors[outcome]}`, color: "#cbd5e1", fontSize: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{trial.stationCode} · score {trial.localityScore.toFixed(0)} / umbral {trial.thresholdSnapshot.toFixed(0)}</strong><b style={{ color: outcomeColors[outcome] }}>{outcomeLabels[outcome]}</b></div><div>{trial.eventCount} sismo(s) M{trial.magnitudeMin.toFixed(1)}+ en {trial.radiusKm} km{trial.firstEventMagnitude !== null ? ` · primero M${trial.firstEventMagnitude.toFixed(1)} ${trial.firstEventPlace ?? ""}` : ""}</div><div style={{ color: "#64748b" }}>Emitida: {trial.emitted ? "sí" : "no"} · {trial.evaluatedAt ? fmt(trial.evaluatedAt) : "—"} UTC</div></article>;
      })}{!evaluated.length && <span style={{ color: "#64748b", fontSize: 11 }}>Los primeros resultados aparecerán cuando ocurra un M3+ dentro de una ventana o cuando expire una ventana de 72 h.</span>}</div></section>
    </>}
  </section>;
}
