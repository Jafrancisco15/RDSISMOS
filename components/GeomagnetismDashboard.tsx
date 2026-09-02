"use client";

import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { MagneticAnomalyPoint, MagneticLocalityMetrics } from "@/lib/geomagnetism";
import { coverageForReferences, selectAutomaticReferences, type GeomagneticStation, type GeomagCoverage } from "@/lib/geomagNetwork";
import { readJsonResponse } from "@/lib/safeFetchJson";
import { FreundExperimentalPanel } from "./FreundExperimentalPanel";
import { GeomagnetismMap2D } from "./GeomagnetismMap2D";

type StationPayload = {
  stations?: GeomagneticStation[];
  error?: string;
  licenseNote?: string;
  mappedCount?: number;
  source?: string;
  sourceCounts?: Record<string, number>;
  warnings?: string[];
};
type EventsPayload = { events?: EarthquakeEvent[]; error?: string };
type SpaceWeatherPayload = { btNt?: number | null; bzGsmNt?: number | null; protonSpeedKmS?: number | null; magneticTimeUtc?: string | null; speedTimeUtc?: string | null; source?: string; error?: string };
type AnalysisPayload = {
  target?: { code: string; datasetId: string; samples: number; source?: string };
  references?: Array<{ code: string; datasetId: string; samples: number; source?: string }>;
  referenceMode?: "automatic" | "manual";
  coverage?: GeomagCoverage;
  metrics?: MagneticLocalityMetrics;
  warnings?: string[];
  methodology?: Record<string, string>;
  licenseNote?: string;
  error?: string;
};

const DAY = 86_400_000;
const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.16)", borderRadius: 16, background: "linear-gradient(145deg,#061322,#020914)", padding: 14 };
const control: React.CSSProperties = { width: "100%", background: "#071525", color: "white", border: "1px solid #1e3a52", borderRadius: 9, padding: 8, marginTop: 4 };
const button: React.CSSProperties = { background: "#075985", color: "white", border: "1px solid #0ea5e9", borderRadius: 10, padding: "8px 11px", cursor: "pointer", fontWeight: 800 };

function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function daysAgo(days: number) { return dateKey(new Date(Date.now() - days * DAY)); }
function hoursBetween(a: string, b: string) { return (Date.parse(a) - Date.parse(b)) / 3_600_000; }
function percent(value: number) { return `${Math.round(value * 100)}%`; }

function scoreLabel(score: number) {
  if (score >= 75) return "señal local fuerte";
  if (score >= 55) return "señal local moderada";
  if (score >= 35) return "señal local débil";
  return "sin señal local destacada";
}

function globalContext(metrics: MagneticLocalityMetrics | null) {
  if (!metrics) return { label: "sin análisis", detail: "Ejecuta el análisis para separar señal común y local.", color: "#94a3b8" };
  if ((metrics.maxKp ?? 0) >= 5 || metrics.commonModeCorrelation >= .72) return { label: "global dominante", detail: `Kp ${metrics.maxKp?.toFixed(1) ?? "N/D"} · señal común ${percent(metrics.commonModeCorrelation)}`, color: "#f59e0b" };
  if ((metrics.maxKp ?? 0) >= 4 || metrics.commonModeCorrelation >= .45) return { label: "contexto mixto", detail: `Kp ${metrics.maxKp?.toFixed(1) ?? "N/D"} · señal común ${percent(metrics.commonModeCorrelation)}`, color: "#fbbf24" };
  return { label: "entorno global tranquilo", detail: `Kp ${metrics.maxKp?.toFixed(1) ?? "N/D"} · señal común ${percent(metrics.commonModeCorrelation)}`, color: "#34d399" };
}

function StationOption({ station }: { station: GeomagneticStation }) {
  const position = station.latitude !== null && station.longitude !== null ? ` · ${station.latitude.toFixed(1)}, ${station.longitude.toFixed(1)}` : "";
  const source = station.sources.length > 1 ? "U+I" : station.sources.includes("INTERMAGNET") ? "I" : "U";
  return <option value={station.code}>[{source}] {station.code} · {station.name}{position}</option>;
}

function MagneticChart({ points, event }: { points: MagneticAnomalyPoint[]; event: EarthquakeEvent | null }) {
  if (points.length < 2) return <div style={{ color: "#64748b", fontSize: 11 }}>Sin suficientes puntos para graficar.</div>;
  const width = 1000; const height = 280; const left = 45; const right = 16; const top = 18; const bottom = 34;
  const minT = Date.parse(points[0].timeUtc); const maxT = Date.parse(points[points.length - 1].timeUtc);
  const maxZ = Math.max(5, Math.min(14, Math.ceil(Math.max(...points.map((point) => point.robustZ))))); const minZ = -2;
  const x = (time: string) => left + (Date.parse(time) - minT) / Math.max(1, maxT - minT) * (width - left - right);
  const y = (value: number) => top + (maxZ - Math.max(minZ, Math.min(maxZ, value))) / (maxZ - minZ) * (height - top - bottom);
  const polyline = points.map((point) => `${x(point.timeUtc).toFixed(1)},${y(point.robustZ).toFixed(1)}`).join(" ");
  const thresholdY = y(3); const eventX = event && Date.parse(event.timeUtc) >= minT && Date.parse(event.timeUtc) <= maxT ? x(event.timeUtc) : null;
  return <div style={{ overflowX: "auto" }}><svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 720, display: "block", background: "#020812", borderRadius: 12 }} role="img" aria-label="Residuo magnético local robust z">
    <line x1={left} y1={thresholdY} x2={width - right} y2={thresholdY} stroke="#f59e0b" strokeDasharray="6 5" opacity=".8" /><text x={left + 5} y={thresholdY - 6} fill="#fbbf24" fontSize="11">z=3</text>
    <line x1={left} y1={y(0)} x2={width - right} y2={y(0)} stroke="#334155" /><polyline points={polyline} fill="none" stroke="#38bdf8" strokeWidth="1.7" strokeLinejoin="round" />
    {eventX !== null && <><line x1={eventX} y1={top} x2={eventX} y2={height - bottom} stroke="#fb7185" strokeWidth="2" /><text x={Math.min(width - 190, eventX + 5)} y={top + 14} fill="#fda4af" fontSize="11">sismo seleccionado</text></>}
    <text x="8" y={top + 8} fill="#94a3b8" fontSize="11">z {maxZ}</text><text x={left} y={height - 10} fill="#94a3b8" fontSize="10">{new Date(minT).toLocaleString("es-DO")}</text><text x={width - 175} y={height - 10} fill="#94a3b8" fontSize="10">{new Date(maxT).toLocaleString("es-DO")}</text>
  </svg></div>;
}

function SummaryCard({ title, value, detail, color }: { title: string; value: string; detail: string; color: string }) {
  return <article style={{ border: `1px solid ${color}33`, borderRadius: 13, background: "rgba(2,8,18,.72)", padding: 12 }}><div style={{ color, fontSize: 9, fontWeight: 900, letterSpacing: ".08em" }}>{title}</div><strong style={{ color: "white", display: "block", fontSize: 22, marginTop: 4 }}>{value}</strong><div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.45, marginTop: 3 }}>{detail}</div></article>;
}

export function GeomagnetismDashboard() {
  const today = dateKey(new Date());
  const [stations, setStations] = useState<GeomagneticStation[]>([]);
  const [stationSource, setStationSource] = useState("Red geomagnética federada");
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [target, setTarget] = useState("SJG");
  const [references, setReferences] = useState<string[]>([]);
  const [autoReferences, setAutoReferences] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startDate, setStartDate] = useState(() => daysAgo(3)); const [endDate, setEndDate] = useState(today);
  const [minMagnitude, setMinMagnitude] = useState(3); const [events, setEvents] = useState<EarthquakeEvent[]>([]); const [eventId, setEventId] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null); const [spaceWeather, setSpaceWeather] = useState<SpaceWeatherPayload | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [stationError, setStationError] = useState<string | null>(null); const [eventsError, setEventsError] = useState<string | null>(null); const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true; setStationError(null);
    fetch(`/api/geomagnetism/stations?_=${reloadKey}`, { cache: "no-store" }).then(async (response) => { const payload = await readJsonResponse<StationPayload>(response); if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`); if (active) { if (payload.source) setStationSource(payload.source); setSourceCounts(payload.sourceCounts ?? {}); } return payload.stations ?? []; }).then((loaded) => {
      if (!active) return; setStations(loaded); const codes = new Set(loaded.map((station) => station.code)); setTarget((current) => codes.has(current) ? current : codes.has("SJG") ? "SJG" : loaded[0]?.code ?? "");
    }).catch((err) => { if (active) setStationError(err instanceof Error ? err.message : "No fue posible cargar la red geomagnética global."); });
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    if (!autoReferences || !stations.length || !target) return;
    const targetStation = stations.find((station) => station.code === target); if (!targetStation) return;
    setReferences(selectAutomaticReferences(targetStation, stations, 4).map((station) => station.code));
  }, [autoReferences, stations, target]);

  useEffect(() => {
    const controller = new AbortController(); setEventsError(null);
    const params = new URLSearchParams({ starttime: startDate, endtime: endDate, minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => { const payload = await readJsonResponse<EventsPayload>(response); if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`); return payload.events ?? []; }).then((loaded) => { const sorted = loaded.slice().sort((a, b) => b.magnitude - a.magnitude); setEvents(sorted); setEventId((current) => current && sorted.some((event) => event.id === current) ? current : ""); }).catch((err) => { if (err instanceof DOMException && err.name === "AbortError") return; setEvents([]); setEventId(""); setEventsError(err instanceof Error ? err.message : "No fue posible cargar el catálogo sísmico."); });
    return () => controller.abort();
  }, [endDate, minMagnitude, startDate, reloadKey]);

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/geomagnetism/space-weather", { cache: "no-store" }).then(async (response) => { const payload = await readJsonResponse<SpaceWeatherPayload>(response); if (active && response.ok) setSpaceWeather(payload); }).catch(() => undefined);
    void load(); const timer = window.setInterval(load, 60_000); return () => { active = false; window.clearInterval(timer); };
  }, [reloadKey]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === eventId) ?? null, [eventId, events]);
  const metrics = analysis?.metrics ?? null; const selectedStation = useMemo(() => stations.find((station) => station.code === target) ?? null, [stations, target]);
  const selectedReferences = useMemo(() => references.map((code) => stations.find((station) => station.code === code)).filter((station): station is GeomagneticStation => Boolean(station)), [references, stations]);
  const coverage = analysis?.coverage ?? coverageForReferences(selectedStation, selectedReferences); const context = globalContext(metrics);
  const mappedStationCount = stations.filter((station) => station.latitude !== null && station.longitude !== null).length;
  const preEvent = useMemo(() => { if (!selectedEvent || !metrics) return null; const eventMs = Date.parse(selectedEvent.timeUtc); const anomalies = metrics.anomalies.filter((point) => Date.parse(point.timeUtc) <= eventMs); return { pre24: anomalies.filter((point) => eventMs - Date.parse(point.timeUtc) <= DAY).length, pre72: anomalies.filter((point) => eventMs - Date.parse(point.timeUtc) <= 3 * DAY).length, strongest: anomalies.slice().sort((a, b) => b.robustZ - a.robustZ)[0] ?? null }; }, [metrics, selectedEvent]);

  function setReference(index: number, value: string) { setReferences((current) => { const next = [...current]; next[index] = value; return next.filter((entry, position) => entry && next.indexOf(entry) === position); }); }
  function selectStationFromMap(code: string) { setTarget(code); setAnalysis(null); setError(null); if (!autoReferences) setReferences((current) => current.filter((entry) => entry !== code)); }

  async function runAnalysis() {
    setLoading(true); setError(null); setAnalysis(null);
    try {
      if (!target) throw new Error("Selecciona una estación objetivo.");
      const params = new URLSearchParams({ target, start: startDate, end: endDate, auto: autoReferences ? "1" : "0" });
      if (!autoReferences) { const refs = references.filter((code) => code && code !== target).slice(0, 6); if (!refs.length) throw new Error("Selecciona al menos una referencia manual."); params.set("references", refs.join(",")); }
      const response = await fetch(`/api/geomagnetism/analyze?${params}`, { cache: "no-store" }); const payload = await readJsonResponse<AnalysisPayload>(response); if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`); setAnalysis(payload); if (payload.references?.length) setReferences(payload.references.map((item) => item.code));
    } catch (err) { setError(err instanceof Error ? err.message : "No fue posible ejecutar el análisis."); } finally { setLoading(false); }
  }

  return <main style={{ display: "grid", gap: 14, padding: "0 12px 28px" }}>
    <section style={{ ...panel, background: "linear-gradient(135deg,#071b35,#172554 50%,#3b0764)" }}>
      <div style={{ color: "#a5b4fc", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>USGS + INTERMAGNET · GFZ · NOAA SWPC</div>
      <h1 style={{ color: "white", margin: "6px 0", fontSize: "clamp(23px,4vw,36px)" }}>Geomagnetismo · Observación global</h1>
      <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.55, margin: 0 }}>La vista principal responde tres preguntas: ¿hay una señal local?, ¿la perturbación parece global/solar?, ¿la red de estaciones tiene cobertura suficiente para confiar en la comparación?</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, color: "#bae6fd", fontSize: 9, fontWeight: 800 }}><span>USGS {sourceCounts.USGS ?? 0}</span><span>INTERMAGNET {sourceCounts.INTERMAGNET ?? 0}</span><span>GFZ Kp</span><span>NOAA viento solar en vivo</span></div>
    </section>

    <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
      <SummaryCard title="RED GLOBAL" value={`${mappedStationCount}`} detail={`${stationSource} · códigos IAGA deduplicados`} color="#38bdf8" />
      <SummaryCard title="Bz GSM · AHORA" value={spaceWeather?.bzGsmNt === null || spaceWeather?.bzGsmNt === undefined ? "N/D" : `${spaceWeather.bzGsmNt.toFixed(1)} nT`} detail={`Bt ${spaceWeather?.btNt?.toFixed(1) ?? "—"} nT · NOAA SWPC`} color={(spaceWeather?.bzGsmNt ?? 0) <= -5 ? "#f59e0b" : "#34d399"} />
      <SummaryCard title="VIENTO SOLAR" value={spaceWeather?.protonSpeedKmS ? `${Math.round(spaceWeather.protonSpeedKmS)} km/s` : "N/D"} detail="Contexto en vivo; el análisis histórico usa Kp de GFZ" color="#a5b4fc" />
      <SummaryCard title="COBERTURA ACTUAL" value={`${coverage.score}/100`} detail={`${coverage.label} · ${coverage.referenceCount} controles · ${coverage.azimuthCoverageDeg}° azimut`} color={coverage.score >= 58 ? "#34d399" : coverage.score >= 35 ? "#fbbf24" : "#fb7185"} />
    </section>

    <section style={{ ...panel, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9 }}>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Observatorio<select value={target} onChange={(e) => selectStationFromMap(e.target.value)} style={control}><option value="">— selecciona —</option>{stations.map((station) => <StationOption key={station.code} station={station} />)}</select></label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Desde<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} style={control} /></label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Hasta<input type="date" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value)} style={control} /></label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Sismicidad<select value={minMagnitude} onChange={(e) => setMinMagnitude(Number(e.target.value))} style={control}><option value={3}>M3.0+</option><option value={4.2}>M4.2+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Sismo marcador<select value={eventId} onChange={(e) => setEventId(e.target.value)} style={control}><option value="">— ninguno —</option>{events.slice(0, 1000).map((event) => <option key={event.id} value={event.id}>M{event.magnitude.toFixed(1)} · {new Date(event.timeUtc).toISOString().slice(0,16)} · {event.place}</option>)}</select></label>
        <div style={{ display: "flex", alignItems: "end" }}><button type="button" onClick={runAnalysis} disabled={loading || !target} style={{ ...button, width: "100%", opacity: loading ? .65 : 1 }}>{loading ? "Analizando red global…" : "Analizar señal local"}</button></div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><button type="button" style={{ ...button, background: autoReferences ? "#065f46" : "#334155", borderColor: autoReferences ? "#34d399" : "#64748b" }} onClick={() => setAutoReferences((value) => !value)}>Controles automáticos {autoReferences ? "ON" : "OFF"}</button><button type="button" style={{ ...button, background: "#111827", borderColor: "#475569" }} onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "Ocultar avanzado" : "Avanzado"}</button><span style={{ color: "#94a3b8", fontSize: 10 }}>{references.length ? `Controles: ${references.join(", ")}` : "RDSISMOS elegirá controles al analizar"}</span></div>
      {showAdvanced && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, paddingTop: 4 }}>{[0,1,2,3].map((index) => <label key={index} style={{ color: "#cbd5e1", fontSize: 10 }}>Control {index + 1}<select disabled={autoReferences} value={references[index] ?? ""} onChange={(e) => setReference(index, e.target.value)} style={{ ...control, opacity: autoReferences ? .55 : 1 }}><option value="">— ninguno —</option>{stations.filter((station) => station.code !== target).map((station) => <StationOption key={station.code} station={station} />)}</select></label>)}</div>}
    </section>

    {metrics && <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 9, borderColor: "rgba(52,211,153,.22)" }}>
      <SummaryCard title="SEÑAL LOCAL" value={`${metrics.localityScore}/100`} detail={`${scoreLabel(metrics.localityScore)} · p95 robust-Z ${metrics.p95RobustZ.toFixed(2)}`} color={metrics.localityScore >= 55 ? "#fb7185" : metrics.localityScore >= 35 ? "#fbbf24" : "#34d399"} />
      <SummaryCard title="CONTEXTO GLOBAL" value={context.label} detail={context.detail} color={context.color} />
      <SummaryCard title="CONFIANZA DE RED" value={`${coverage.score}/100`} detail={`${coverage.referenceCount} controles · mediana ${coverage.medianDistanceKm?.toLocaleString("es-DO") ?? "—"} km · ${analysis?.referenceMode === "manual" ? "manual" : "automática"}`} color={coverage.score >= 58 ? "#34d399" : "#fbbf24"} />
    </section>}

    {(stationError || eventsError || error) && <section style={{ ...panel, color: "#fca5a5", borderColor: "rgba(248,113,113,.35)" }}>{stationError && <div><b>Red:</b> {stationError}</div>}{eventsError && <div><b>Sismos:</b> {eventsError}</div>}{error && <div><b>Análisis:</b> {error}</div>}</section>}

    <section style={{ ...panel, padding: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 9, flexWrap: "wrap", alignItems: "center", padding: "4px 5px 10px" }}><div><strong style={{ color: "white" }}>Red geomagnética + sismicidad</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{mappedStationCount} observatorios · {events.length} sismos M{minMagnitude.toFixed(1)}+ · {startDate} → {endDate}</div></div><button type="button" style={button} onClick={() => setReloadKey((value) => value + 1)}>Actualizar fuentes</button></div>
      <GeomagnetismMap2D stations={stations} targetCode={target} referenceCodes={references} events={events} selectedEventId={eventId} onStationSelect={selectStationFromMap} onEventSelect={(event) => setEventId(event.id)} />
      {selectedStation && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#cbd5e1", fontSize: 10, padding: "9px 5px 2px" }}><b style={{ color: "#fde047" }}>{selectedStation.code} · {selectedStation.name}</b><span>{selectedStation.dataSource}</span>{selectedStation.country && <span>{selectedStation.country}</span>}{selectedEvent && <span style={{ color: "#fda4af" }}>Sismo: M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</span>}</div>}
    </section>

    {metrics && <>
      {selectedEvent && <section style={{ ...panel, borderColor: "rgba(251,113,133,.3)" }}><div style={{ color: "#fb7185", fontSize: 10, fontWeight: 900 }}>VENTANA PRE-SISMO</div><strong style={{ color: "white" }}>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</strong>{preEvent && <div style={{ display: "flex", gap: 15, flexWrap: "wrap", color: "#e2e8f0", fontSize: 11, marginTop: 8 }}><span><b>{preEvent.pre24}</b> anomalías z≥3 en 24 h</span><span><b>{preEvent.pre72}</b> en 72 h</span>{preEvent.strongest && <span>máxima z={preEvent.strongest.robustZ.toFixed(1)} · {Math.abs(hoursBetween(preEvent.strongest.timeUtc, selectedEvent.timeUtc)).toFixed(1)} h antes</span>}</div>}<p style={{ color: "#64748b", fontSize: 9, marginBottom: 0 }}>Marcador retrospectivo/prospectivo; no prueba causalidad.</p></section>}

      <section style={panel}><strong style={{ color: "white" }}>Residuo local en el tiempo</strong><div style={{ color: "#64748b", fontSize: 9, marginTop: 2 }}>{analysis?.target?.code} vs {analysis?.references?.map((reference) => reference.code).join(", ")} · {metrics.alignedSamples.toLocaleString("es-DO")} minutos alineados</div><div style={{ marginTop: 9 }}><MagneticChart points={metrics.plot} event={selectedEvent} /></div></section>

      <details style={panel}><summary style={{ color: "white", fontWeight: 800, cursor: "pointer" }}>Diagnóstico técnico · robust-Z, dB/dt, Z/H y anomalías</summary><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginTop: 12 }}><SummaryCard title="ROBUST Z P95" value={metrics.p95RobustZ.toFixed(2)} detail={`máximo ${metrics.maxRobustZ.toFixed(2)}`} color="#38bdf8"/><SummaryCard title="SEÑAL COMÚN" value={percent(metrics.commonModeCorrelation)} detail="alta = menos local" color="#34d399"/><SummaryCard title="dB/dt MÁX" value={metrics.maxDbDtNtPerMin.toFixed(2)} detail="nT/min del residuo" color="#fb7185"/><SummaryCard title="Z/H PROXY" value={metrics.maxZhProxy.toFixed(2)} detail="proxy temporal; no espectro ULF" color="#c084fc"/></div><div style={{ display: "grid", gap: 6, marginTop: 10 }}>{metrics.anomalies.map((point) => <div key={point.timeUtc} style={{ display: "grid", gridTemplateColumns: "minmax(155px,1fr) repeat(3,auto)", gap: 10, padding: 8, borderRadius: 9, background: "rgba(15,23,42,.65)", color: "#cbd5e1", fontSize: 10 }}><span>{new Date(point.timeUtc).toLocaleString("es-DO")}</span><b style={{ color: "#fbbf24" }}>z {point.robustZ.toFixed(2)}</b><span>{point.residualNt.toFixed(1)} nT</span><span>{point.dBdtNtPerMin.toFixed(1)} nT/min</span></div>)}{!metrics.anomalies.length && <span style={{ color: "#64748b", fontSize: 11 }}>No hubo puntos con robust z ≥ 3.</span>}</div></details>

      <details style={panel}><summary style={{ color: "white", fontWeight: 800, cursor: "pointer" }}>Freund · hipótesis experimental</summary><div style={{ marginTop: 10 }}><FreundExperimentalPanel metrics={metrics} event={selectedEvent} /></div></details>
      {analysis?.warnings?.length ? <details style={{ ...panel, color: "#fde68a", fontSize: 10 }}><summary style={{ cursor: "pointer", fontWeight: 800 }}>Advertencias de datos ({analysis.warnings.length})</summary><div style={{ marginTop: 8 }}>{analysis.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></details> : null}
    </>}

    <section style={{ ...panel, color: "#94a3b8", fontSize: 10, lineHeight: 1.55 }}><strong style={{ color: "#cbd5e1" }}>Método.</strong> RDSISMOS federa observatorios USGS e INTERMAGNET por código IAGA, usa series XYZ a 60 s y elige controles automáticamente por distancia y diversidad azimutal. La mediana de controles estima la señal común; el residuo de la estación objetivo alimenta robust-Z, persistencia y localidad. GFZ Kp controla actividad planetaria y NOAA SWPC aporta contexto solar en vivo. El Coverage Score mide geometría de observación, no calidad absoluta de un observatorio. La prueba Freund sigue siendo experimental y no constituye predicción sísmica.</section>
  </main>;
}
