"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeomagFeatureName } from "@/lib/geomagneticProbabilistic";
import type { ProbabilisticGeomagForecastRow, ProbabilisticGeomagModelState } from "@/lib/geomagneticProbabilisticStore";
import { readJsonResponse } from "@/lib/safeFetchJson";

type Experiment = {
  stationCode: string;
  stationName: string;
  magnitudeMin: number;
  radiusKm: number;
  horizonDays: number;
  referenceCodes: readonly string[];
};
type Metrics = {
  evaluatedForecasts: number;
  positiveWindows: number;
  brierEtas: number | null;
  brierCombined: number | null;
  brierSkillScore: number | null;
  informationGainBitsPerWindow: number | null;
  molchan: Array<{ threshold: number; alarmFraction: number; missFraction: number }>;
  schusterPValue: number | null;
  schusterPositivePhases: number;
  overlappingWindows: boolean;
};
type CalibrationInterval = { low: number; high: number; method: string } | null;
type Payload = {
  available: boolean;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  experiment: Experiment;
  model: ProbabilisticGeomagModelState;
  forecasts: ProbabilisticGeomagForecastRow[];
  metrics: Metrics;
  calibrationInterval?: CalibrationInterval;
  methodology?: Record<string, string>;
  message?: string;
  error?: string;
};

const panel: React.CSSProperties = { border: "1px solid rgba(129,140,248,.2)", borderRadius: 16, background: "linear-gradient(145deg,#071225,#100b2e)", padding: 14 };
const featureLabels: Record<GeomagFeatureName, string> = {
  locality: "Localidad",
  p95RobustZ: "Robust z",
  dBdt: "dB/dt",
  ulfEnergy: "ULF",
  sqResidual: "Residuo Sq",
  trend27d: "Tendencia 27 d",
  spatialIndependence: "Independencia regional",
};

function fmt(value: string) { return new Date(value).toLocaleString("es-DO", { timeZone: "UTC" }); }
function pct(value: number | null | undefined, digits = 2) { return value === null || value === undefined ? "—" : `${(100 * value).toFixed(digits)}%`; }
function number(value: number | null | undefined, digits = 3) { return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function skillTone(value: number | null) { return value === null ? "#94a3b8" : value > 0 ? "#34d399" : value < 0 ? "#fb7185" : "#fbbf24"; }

export function GeomagneticProjectionPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/geomagnetism/projections?limit=180&_=${Date.now()}`, { cache: "no-store" });
      const payload = await readJsonResponse<Payload>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar el experimento prospectivo.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10 * 60_000); return () => window.clearInterval(timer); }, [load]);

  const active = useMemo(() => data?.forecasts.filter((forecast) => forecast.status === "active") ?? [], [data]);
  const evaluated = useMemo(() => data?.forecasts.filter((forecast) => forecast.status === "evaluated") ?? [], [data]);
  const latest = data?.forecasts[0] ?? null;
  const experiment = data?.experiment;
  const metrics = data?.metrics;
  const model = data?.model;
  const deltaPp = latest ? (latest.combinedProbability - latest.baselineProbability) * 100 : null;
  const molchanUseful = metrics?.molchan.filter((point) => point.alarmFraction > 0 && point.alarmFraction < 1).slice(0, 4) ?? [];

  return <section style={{ display: "grid", gap: 12, padding: "0 12px 26px" }}>
    <header style={{ ...panel, background: "linear-gradient(135deg,#071b3b,#1e3a8a 55%,#4c1d95)" }}>
      <div style={{ color: "#93c5fd", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>PROSPECTIVO · USGS SJG · ETAS VS ETAS+GEOMAG</div>
      <h2 style={{ color: "white", margin: "5px 0" }}>Experimento geomagnético probabilístico</h2>
      <p style={{ color: "#dbeafe", fontSize: 11, lineHeight: 1.55, margin: 0 }}>
        Pregunta fija: ¿la información geomagnética local/regional mejora a la sismicidad por sí sola? Cada día se congelan dos probabilidades para la misma ventana: el baseline ETAS y ETAS+Geomag. El resultado posterior actualiza solamente los pesos de futuras predicciones.
      </p>
    </header>

    {loading && !data && <div style={panel}>Cargando ledger probabilístico…</div>}
    {error && <div style={{ ...panel, color: "#fca5a5" }}><strong>No se pudo leer el experimento.</strong><div style={{ marginTop: 4, fontSize: 11 }}>{error}</div><button type="button" onClick={() => void load()} style={{ marginTop: 8, border: "1px solid #4338ca", borderRadius: 9, background: "#1e1b4b", color: "white", padding: "6px 9px" }}>Reintentar</button></div>}
    {data && !data.available && <div style={{ ...panel, color: "#fde68a" }}><strong>Ledger probabilístico v2 todavía no disponible.</strong><div style={{ fontSize: 11, marginTop: 4 }}>{data.message}</div><div style={{ color: "#94a3b8", fontSize: 10, marginTop: 5 }}>El mapa y el análisis manual de Geomagnetismo siguen funcionando aunque esta persistencia esté temporalmente fuera de línea.</div></div>}

    {experiment && <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 9 }}>
      <article><div style={{ color: "#60a5fa", fontSize: 9, fontWeight: 900 }}>EVENTO OBJETIVO</div><strong style={{ color: "white", fontSize: 24 }}>M{experiment.magnitudeMin.toFixed(1)}+</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>≤ {experiment.radiusKm} km de {experiment.stationCode}</div></article>
      <article><div style={{ color: "#c4b5fd", fontSize: 9, fontWeight: 900 }}>HORIZONTE FIJO</div><strong style={{ color: "white", fontSize: 24 }}>{experiment.horizonDays} días</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>prospectivo · no se cambia al evaluar</div></article>
      <article><div style={{ color: "#38bdf8", fontSize: 9, fontWeight: 900 }}>ESTACIÓN</div><strong style={{ color: "white", fontSize: 18 }}>{experiment.stationCode}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{experiment.stationName}</div></article>
      <article><div style={{ color: "#34d399", fontSize: 9, fontWeight: 900 }}>CONTROLES</div><strong style={{ color: "white", fontSize: 15 }}>{experiment.referenceCodes.join(" · ")}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>modo común regional/global</div></article>
    </section>}

    {data?.available && latest && <section style={{ ...panel, border: "1px solid rgba(56,189,248,.32)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong style={{ color: "white" }}>{latest.status === "active" ? "Ventana prospectiva más reciente" : "Última ventana registrada"}</strong><span style={{ color: latest.status === "active" ? "#fde68a" : "#94a3b8", fontSize: 10 }}>{latest.status === "active" ? "ACTIVA" : "RESUELTA"} · modelo v{latest.modelVersion}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 10 }}>
        <article><div style={{ color: "#60a5fa", fontSize: 9, fontWeight: 900 }}>ETAS BASELINE</div><strong style={{ color: "white", fontSize: 32 }}>{pct(latest.baselineProbability, 1)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>sin geomagnetismo</div></article>
        <article><div style={{ color: "#c084fc", fontSize: 9, fontWeight: 900 }}>ETAS + GEOMAG</div><strong style={{ color: "white", fontSize: 32 }}>{pct(latest.combinedProbability, 1)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>logística incremental sobre ETAS</div></article>
        <article><div style={{ color: "#fbbf24", fontSize: 9, fontWeight: 900 }}>APORTE GEOMAGNÉTICO</div><strong style={{ color: deltaPp !== null && deltaPp > 0 ? "#34d399" : deltaPp !== null && deltaPp < 0 ? "#fb7185" : "white", fontSize: 28 }}>{deltaPp === null ? "—" : `${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(2)} pp`}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>diferencia, no causalidad</div></article>
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 10, marginTop: 10 }}>{fmt(latest.windowStart)} → {fmt(latest.windowEnd)} UTC · probabilidad y pesos congelados al emitir.</div>
      <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 4 }}>{data.calibrationInterval ? `Intervalo aproximado de calibración: ${pct(data.calibrationInterval.low, 1)}–${pct(data.calibrationInterval.high, 1)}.` : "Intervalo de calibración: esperar al menos 30 ventanas resueltas; no se inventa un IC prematuro."}</div>
    </section>}

    {data?.available && latest?.features && <section style={panel}>
      <strong style={{ color: "white" }}>Señal geomagnética congelada</strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 8, marginTop: 9, color: "#cbd5e1", fontSize: 10 }}>
        <article><b style={{ color: "#38bdf8" }}>Locality score</b><div>{latest.features.localityScore.toFixed(1)}/100</div></article>
        <article><b style={{ color: "#38bdf8" }}>p95 robust z</b><div>{latest.features.p95RobustZ.toFixed(2)}</div></article>
        <article><b style={{ color: "#38bdf8" }}>dB/dt</b><div>{latest.features.maxDbDtNtPerMin.toFixed(2)} nT/min</div></article>
        <article><b style={{ color: "#38bdf8" }}>ULF ratio</b><div>{latest.features.ulfEnergyRatio.toFixed(2)}×</div></article>
        <article><b style={{ color: "#38bdf8" }}>ULF dominante</b><div>{latest.features.dominantUlfHz === null ? "—" : `${latest.features.dominantUlfHz.toFixed(4)} Hz`}</div></article>
        <article><b style={{ color: "#38bdf8" }}>Residuo Sq RMS</b><div>{latest.features.sqResidualRmsNt.toFixed(1)} nT</div></article>
        <article><b style={{ color: "#38bdf8" }}>Tendencia 27 d</b><div>{latest.features.trend27dNt.toFixed(1)} nT</div></article>
        <article><b style={{ color: "#fbbf24" }}>Kp máx.</b><div>{latest.features.maxKp ?? "—"}</div></article>
        <article><b style={{ color: "#fbbf24" }}>Dst mín.</b><div>{latest.features.minDstNt === null ? "—" : `${latest.features.minDstNt.toFixed(0)} nT`}</div></article>
        <article><b style={{ color: "#a78bfa" }}>Calidad tormenta</b><div>{pct(latest.features.stormQuality, 0)}</div></article>
        <article><b style={{ color: "#a78bfa" }}>Referencias</b><div>{latest.features.referenceCount}</div></article>
      </div>
      <div style={{ color: "#64748b", fontSize: 10, marginTop: 9 }}>ULF con 1 minuto está limitado a 0.001–0.008 Hz. No se atribuye información a 0.008–0.1 Hz sin datos de mayor frecuencia.</div>
    </section>}

    {data?.available && metrics && <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 9 }}>
      <article><div style={{ color: "#94a3b8", fontSize: 9, fontWeight: 900 }}>VENTANAS RESUELTAS</div><strong style={{ color: "white", fontSize: 27 }}>{metrics.evaluatedForecasts}</strong><div style={{ color: "#64748b", fontSize: 10 }}>{metrics.positiveWindows} con evento objetivo</div></article>
      <article><div style={{ color: "#60a5fa", fontSize: 9, fontWeight: 900 }}>BRIER ETAS</div><strong style={{ color: "white", fontSize: 24 }}>{number(metrics.brierEtas, 4)}</strong><div style={{ color: "#64748b", fontSize: 10 }}>menor es mejor</div></article>
      <article><div style={{ color: "#c084fc", fontSize: 9, fontWeight: 900 }}>BRIER ETAS+G</div><strong style={{ color: "white", fontSize: 24 }}>{number(metrics.brierCombined, 4)}</strong><div style={{ color: "#64748b", fontSize: 10 }}>mismas ventanas</div></article>
      <article><div style={{ color: "#fbbf24", fontSize: 9, fontWeight: 900 }}>BRIER SKILL VS ETAS</div><strong style={{ color: skillTone(metrics.brierSkillScore), fontSize: 24 }}>{metrics.brierSkillScore === null ? "—" : `${metrics.brierSkillScore >= 0 ? "+" : ""}${(100 * metrics.brierSkillScore).toFixed(1)}%`}</strong><div style={{ color: "#64748b", fontSize: 10 }}>≤0 = geomag no mejora baseline</div></article>
      <article><div style={{ color: "#34d399", fontSize: 9, fontWeight: 900 }}>INFO GAIN</div><strong style={{ color: skillTone(metrics.informationGainBitsPerWindow), fontSize: 24 }}>{metrics.informationGainBitsPerWindow === null ? "—" : `${metrics.informationGainBitsPerWindow >= 0 ? "+" : ""}${metrics.informationGainBitsPerWindow.toFixed(3)}`}</strong><div style={{ color: "#64748b", fontSize: 10 }}>bits/ventana vs ETAS</div></article>
      <article><div style={{ color: "#fb7185", fontSize: 9, fontWeight: 900 }}>SCHUSTER</div><strong style={{ color: "white", fontSize: 24 }}>{metrics.schusterPValue === null ? "—" : `p=${metrics.schusterPValue.toFixed(3)}`}</strong><div style={{ color: "#64748b", fontSize: 10 }}>{metrics.schusterPositivePhases} fases positivas; exploratorio</div></article>
    </section>}

    {data?.available && metrics && <section style={panel}>
      <strong style={{ color: "white" }}>Molchan por ventanas</strong>
      <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 4 }}>Fracción de tiempo/ventanas en alarma frente a fracción de eventos omitidos. Esta es una adaptación por ventanas diarias, no una curva Molchan espacio-tiempo continua.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>{molchanUseful.length ? molchanUseful.map((point) => <span key={point.threshold} style={{ border: "1px solid #334155", borderRadius: 9, padding: "6px 8px", color: "#cbd5e1", fontSize: 10 }}>p≥{pct(point.threshold, 0)} · alarma {pct(point.alarmFraction, 0)} · omitidos {pct(point.missFraction, 0)}</span>) : <span style={{ color: "#64748b", fontSize: 10 }}>Todavía no hay muestra suficiente para una curva informativa.</span>}</div>
    </section>}

    {data?.available && model && <section style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong style={{ color: "white" }}>Modelo geomagnético incremental · v{model.version}</strong><span style={{ color: "#94a3b8", fontSize: 10 }}>{model.evaluatedForecasts} actualizaciones resueltas</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 7, marginTop: 9 }}>{(Object.keys(featureLabels) as GeomagFeatureName[]).map((name) => <article key={name} style={{ padding: 8, borderRadius: 9, background: "rgba(15,23,42,.65)" }}><div style={{ color: "#94a3b8", fontSize: 9 }}>{featureLabels[name]}</div><strong style={{ color: Math.abs(model.weights[name]) < 1e-8 ? "#64748b" : model.weights[name] > 0 ? "#34d399" : "#fb7185" }}>{model.weights[name].toFixed(4)}</strong></article>)}</div>
      <div style={{ color: "#64748b", fontSize: 10, marginTop: 8 }}>{model.lastUpdateReason}</div>
    </section>}

    {data?.available && <section style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}><strong style={{ color: "white" }}>Historial congelado</strong><button type="button" onClick={() => void load()} style={{ border: "1px solid #4338ca", borderRadius: 9, background: "#1e1b4b", color: "white", padding: "6px 9px", cursor: "pointer" }}>Actualizar</button></div>
      <div style={{ display: "grid", gap: 6, marginTop: 8, maxHeight: 440, overflow: "auto" }}>{data.forecasts.slice(0, 60).map((forecast) => {
        const d = 100 * (forecast.combinedProbability - forecast.baselineProbability);
        return <article key={forecast.id} style={{ padding: 8, borderRadius: 9, background: "rgba(15,23,42,.72)", borderLeft: `3px solid ${forecast.status === "active" ? "#fbbf24" : forecast.occurred ? "#34d399" : "#64748b"}`, color: "#cbd5e1", fontSize: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{forecast.issuedAt.slice(0, 10)} · ETAS {pct(forecast.baselineProbability, 1)} → +G {pct(forecast.combinedProbability, 1)}</strong><b style={{ color: forecast.status === "active" ? "#fde68a" : forecast.occurred ? "#34d399" : "#94a3b8" }}>{forecast.status === "active" ? "ACTIVA" : forecast.occurred ? "EVENTO" : "SIN EVENTO"}</b></div>
          <div>Aporte {d >= 0 ? "+" : ""}{d.toFixed(2)} pp · modelo v{forecast.modelVersion} · {fmt(forecast.windowStart)} → {fmt(forecast.windowEnd)} UTC</div>
          {forecast.status === "evaluated" && <div style={{ color: "#94a3b8" }}>Brier ETAS {number(forecast.brierBaseline, 4)} · +G {number(forecast.brierCombined, 4)} · IG {forecast.informationGainBits === null ? "—" : `${forecast.informationGainBits >= 0 ? "+" : ""}${forecast.informationGainBits.toFixed(3)} bits`}{forecast.firstEventMagnitude !== null ? ` · primero M${forecast.firstEventMagnitude.toFixed(1)} ${forecast.firstEventPlace ?? ""}` : ""}</div>}
        </article>;
      })}{!data.forecasts.length && <span style={{ color: "#64748b", fontSize: 11 }}>La primera proyección aparecerá cuando el generador prospectivo v2 complete su primera ejecución.</span>}</div>
    </section>}

    {data?.available && <section style={{ ...panel, color: "#cbd5e1", fontSize: 10, lineHeight: 1.55 }}>
      <strong style={{ color: "white" }}>Reglas contra autoengaño</strong>
      <div style={{ marginTop: 5 }}>Si Brier Skill Score ≤ 0 o information gain ≤ 0 de forma sostenida, el geomagnetismo no está mejorando ETAS. Las ventanas de 7 días se solapan, por lo que más adelante la significancia formal deberá usar block bootstrap/permutaciones temporales. Schuster explora uniformidad de fase; un p bajo por sí solo no demuestra predicción.</div>
    </section>}

    {data?.available && !active.length && !evaluated.length && <div style={{ ...panel, color: "#94a3b8", fontSize: 11 }}>El experimento está inicializado pero aún no hay ventanas. Los pesos permanecen en cero hasta que existan resultados prospectivos resueltos.</div>}
  </section>;
}
