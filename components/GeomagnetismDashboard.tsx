"use client";

import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { MagneticAnomalyPoint, MagneticLocalityMetrics } from "@/lib/geomagnetism";
import { readJsonResponse } from "@/lib/safeFetchJson";
import { GeomagnetismMap2D } from "./GeomagnetismMap2D";

type Station = {
  code: string;
  name: string;
  minuteDatasetId: string;
  hasOneSecond: boolean;
  latitude: number | null;
  longitude: number | null;
  elevationM: number | null;
  country?: string;
  dataSource?: string;
};
type StationPayload = { stations?: Station[]; error?: string; licenseNote?: string; mappedCount?: number; source?: string };
type EventsPayload = { events?: EarthquakeEvent[]; error?: string };
type AnalysisPayload = {
  target?: { code: string; datasetId: string; samples: number };
  references?: Array<{ code: string; datasetId: string; samples: number }>;
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

function scoreLabel(score: number) {
  if (score >= 75) return "anomalía local fuerte";
  if (score >= 55) return "anomalía local moderada";
  if (score >= 35) return "señal local débil";
  return "sin señal local destacada";
}

function StationOption({ station }: { station: Station }) {
  const position = station.latitude !== null && station.longitude !== null ? ` · ${station.latitude.toFixed(1)}, ${station.longitude.toFixed(1)}` : "";
  return <option value={station.code}>{station.code} · {station.name}{position}{station.hasOneSecond ? " · 1 s" : ""}</option>;
}

function MagneticChart({ points, event }: { points: MagneticAnomalyPoint[]; event: EarthquakeEvent | null }) {
  if (points.length < 2) return <div style={{ color: "#64748b", fontSize: 11 }}>Sin suficientes puntos para graficar.</div>;
  const width = 1000; const height = 280; const left = 45; const right = 16; const top = 18; const bottom = 34;
  const minT = Date.parse(points[0].timeUtc); const maxT = Date.parse(points[points.length - 1].timeUtc);
  const maxZ = Math.max(5, Math.min(14, Math.ceil(Math.max(...points.map((point) => point.robustZ)))));
  const minZ = -2;
  const x = (time: string) => left + (Date.parse(time) - minT) / Math.max(1, maxT - minT) * (width - left - right);
  const y = (value: number) => top + (maxZ - Math.max(minZ, Math.min(maxZ, value))) / (maxZ - minZ) * (height - top - bottom);
  const polyline = points.map((point) => `${x(point.timeUtc).toFixed(1)},${y(point.robustZ).toFixed(1)}`).join(" ");
  const thresholdY = y(3);
  const eventX = event && Date.parse(event.timeUtc) >= minT && Date.parse(event.timeUtc) <= maxT ? x(event.timeUtc) : null;
  return <div style={{ overflowX: "auto" }}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 720, display: "block", background: "#020812", borderRadius: 12 }} role="img" aria-label="Residuo magnético local robust z">
      <line x1={left} y1={thresholdY} x2={width - right} y2={thresholdY} stroke="#f59e0b" strokeDasharray="6 5" opacity=".8" />
      <text x={left + 5} y={thresholdY - 6} fill="#fbbf24" fontSize="11">umbral exploratorio z=3</text>
      <line x1={left} y1={y(0)} x2={width - right} y2={y(0)} stroke="#334155" />
      <polyline points={polyline} fill="none" stroke="#38bdf8" strokeWidth="1.7" strokeLinejoin="round" />
      {eventX !== null && <><line x1={eventX} y1={top} x2={eventX} y2={height - bottom} stroke="#fb7185" strokeWidth="2" /><text x={Math.min(width - 190, eventX + 5)} y={top + 14} fill="#fda4af" fontSize="11">terremoto seleccionado</text></>}
      <text x="8" y={top + 8} fill="#94a3b8" fontSize="11">z {maxZ}</text><text x="12" y={height - bottom + 2} fill="#94a3b8" fontSize="11">{minZ}</text>
      <text x={left} y={height - 10} fill="#94a3b8" fontSize="10">{new Date(minT).toLocaleString("es-DO")}</text>
      <text x={width - 175} y={height - 10} fill="#94a3b8" fontSize="10">{new Date(maxT).toLocaleString("es-DO")}</text>
    </svg>
  </div>;
}

export function GeomagnetismDashboard() {
  const today = dateKey(new Date());
  const [stations, setStations] = useState<Station[]>([]);
  const [stationSource, setStationSource] = useState("USGS Geomagnetism Program");
  const [target, setTarget] = useState("SJG");
  const [references, setReferences] = useState<string[]>(["FRD", "BOU", "HON"]);
  const [startDate, setStartDate] = useState(() => daysAgo(3));
  const [endDate, setEndDate] = useState(today);
  const [minMagnitude, setMinMagnitude] = useState(3);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stationError, setStationError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setStationError(null);
    fetch(`/api/geomagnetism/stations?_=${reloadKey}`, { cache: "no-store" }).then(async (response) => {
      const payload = await readJsonResponse<StationPayload>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      if (active && payload.source) setStationSource(payload.source);
      return payload.stations ?? [];
    }).then((loaded) => {
      if (!active) return;
      setStations(loaded);
      const codes = new Set(loaded.map((station) => station.code));
      const nextTarget = codes.has(target) ? target : codes.has("SJG") ? "SJG" : loaded[0]?.code ?? "";
      setTarget(nextTarget);
      const currentRefs = references.filter((code) => code !== nextTarget && codes.has(code));
      if (currentRefs.length >= 2) setReferences(currentRefs.slice(0, 4));
      else {
        const preferred = ["FRD", "BOU", "HON", "GUA", "CMO", "NEW"].filter((code) => code !== nextTarget && codes.has(code)).slice(0, 3);
        setReferences(preferred);
      }
    }).catch((err) => { if (active) setStationError(err instanceof Error ? err.message : "No fue posible cargar la red geomagnética USGS."); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    setEventsError(null);
    const params = new URLSearchParams({ starttime: startDate, endtime: endDate, minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await readJsonResponse<EventsPayload>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload.events ?? [];
    }).then((loaded) => {
      const sorted = loaded.slice().sort((a, b) => b.magnitude - a.magnitude);
      setEvents(sorted);
      setEventId((current) => current && sorted.some((event) => event.id === current) ? current : "");
    }).catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setEvents([]); setEventId("");
      setEventsError(err instanceof Error ? err.message : "No fue posible cargar el catálogo sísmico.");
    });
    return () => controller.abort();
  }, [endDate, minMagnitude, startDate, reloadKey]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === eventId) ?? null, [eventId, events]);
  const metrics = analysis?.metrics ?? null;
  const mappedStationCount = stations.filter((station) => station.latitude !== null && station.longitude !== null).length;
  const selectedStation = useMemo(() => stations.find((station) => station.code === target) ?? null, [stations, target]);
  const preEvent = useMemo(() => {
    if (!selectedEvent || !metrics) return null;
    const eventMs = Date.parse(selectedEvent.timeUtc);
    const anomalies = metrics.anomalies.filter((point) => Date.parse(point.timeUtc) <= eventMs);
    const pre24 = anomalies.filter((point) => eventMs - Date.parse(point.timeUtc) <= DAY).length;
    const pre72 = anomalies.filter((point) => eventMs - Date.parse(point.timeUtc) <= 3 * DAY).length;
    const strongest = anomalies.slice().sort((a, b) => b.robustZ - a.robustZ)[0] ?? null;
    return { pre24, pre72, strongest };
  }, [metrics, selectedEvent]);

  function setReference(index: number, value: string) {
    setReferences((current) => {
      const next = [...current];
      next[index] = value;
      return next.filter((entry, position) => entry && next.indexOf(entry) === position);
    });
  }

  function selectStationFromMap(code: string) {
    setTarget(code);
    setReferences((current) => current.filter((entry) => entry !== code));
    setAnalysis(null);
    setError(null);
  }

  async function runAnalysis() {
    setLoading(true); setError(null); setAnalysis(null);
    try {
      const refs = references.filter((code) => code && code !== target).slice(0, 4);
      if (!target) throw new Error("Selecciona una estación objetivo.");
      if (!refs.length) throw new Error("Selecciona al menos una referencia.");
      const params = new URLSearchParams({ target, references: refs.join(","), start: startDate, end: endDate });
      const response = await fetch(`/api/geomagnetism/analyze?${params}`, { cache: "no-store" });
      const payload = await readJsonResponse<AnalysisPayload>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setAnalysis(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible ejecutar el análisis.");
    } finally { setLoading(false); }
  }

  return <main style={{ display: "grid", gap: 14, padding: "0 12px 28px" }}>
    <section style={{ ...panel, background: "linear-gradient(135deg,#071b35,#172554 50%,#3b0764)" }}>
      <div style={{ color: "#a5b4fc", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>USGS GEOMAGNETISM · CAMPO MAGNÉTICO LOCAL/REGIONAL</div>
      <h1 style={{ color: "white", margin: "6px 0", fontSize: "clamp(23px,4vw,36px)" }}>Geomagnetismo · Anomalías vs Sismos</h1>
      <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.55, margin: 0 }}>Mapa mundial de relieve con la red geomagnética USGS y los sismos del período. SJG corresponde al observatorio de San Juan en Cayey, Puerto Rico. Toca una estación para convertirla en objetivo y un sismo para usarlo como referencia temporal.</p>
      <div style={{ marginTop: 9, color: "#7dd3fc", fontSize: 10, fontWeight: 800 }}>Series magnéticas: geomag.usgs.gov/ws/data · 60 s · adjusted XYZF con fallback variation HDZF</div>
    </section>

    <section style={{ ...panel, padding: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 9, flexWrap: "wrap", alignItems: "center", padding: "4px 5px 10px" }}>
        <div><strong style={{ color: "white" }}>Mapa de estaciones y sismicidad</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>{mappedStationCount}/{stations.length || mappedStationCount} estaciones USGS georreferenciadas · {events.length} sismos M{minMagnitude.toFixed(1)}+ · {startDate} → {endDate}</div><div style={{ color: "#38bdf8", fontSize: 9, marginTop: 2 }}>{stationSource}</div></div>
        <button type="button" style={button} onClick={() => setReloadKey((value) => value + 1)}>Recargar fuentes</button>
      </div>
      <GeomagnetismMap2D
        stations={stations}
        targetCode={target}
        referenceCodes={references}
        events={events}
        selectedEventId={eventId}
        onStationSelect={selectStationFromMap}
        onEventSelect={(event) => setEventId(event.id)}
      />
      {selectedStation && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#cbd5e1", fontSize: 10, padding: "9px 5px 2px" }}><b style={{ color: "#fde047" }}>{selectedStation.code} · {selectedStation.name}</b>{selectedStation.latitude !== null && selectedStation.longitude !== null ? <span>{selectedStation.latitude.toFixed(3)}, {selectedStation.longitude.toFixed(3)}</span> : <span>coordenadas no disponibles</span>}<span>{selectedStation.country ?? "USGS"}</span><span>{selectedStation.dataSource ?? "USGS Geomagnetism"}</span>{selectedEvent && <span style={{ color: "#fda4af" }}>Sismo seleccionado: M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</span>}</div>}
    </section>

    <section style={{ ...panel, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9 }}>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Estación objetivo<select value={target} onChange={(e) => selectStationFromMap(e.target.value)} style={control}><option value="">— selecciona —</option>{stations.map((station) => <StationOption key={station.code} station={station} />)}</select></label>
        {[0,1,2,3].map((index) => <label key={index} style={{ color: "#cbd5e1", fontSize: 11 }}>Referencia {index + 1}<select value={references[index] ?? ""} onChange={(e) => setReference(index, e.target.value)} style={control}><option value="">— ninguna —</option>{stations.filter((station) => station.code !== target).map((station) => <StationOption key={station.code} station={station} />)}</select></label>)}
      </div>
      <div style={{ color: "#64748b", fontSize: 10 }}>Ideal: 2–3 referencias suficientemente separadas. Para SJG el preset usa FRD, BOU y HON, todas servidas directamente por USGS.</div>
    </section>

    <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9 }}>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Desde<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} style={control} /></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Hasta<input type="date" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value)} style={control} /></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Sismos del período<select value={minMagnitude} onChange={(e) => setMinMagnitude(Number(e.target.value))} style={control}><option value={3}>M3.0+</option><option value={3.5}>M3.5+</option><option value={4.2}>M4.2+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Terremoto de referencia<select value={eventId} onChange={(e) => setEventId(e.target.value)} style={control}><option value="">— sin marcador —</option>{events.slice(0, 1000).map((event) => <option key={event.id} value={event.id}>M{event.magnitude.toFixed(1)} · {new Date(event.timeUtc).toISOString().slice(0,16)} · {event.place}</option>)}</select></label>
      <div style={{ display: "flex", alignItems: "end" }}><button type="button" onClick={runAnalysis} disabled={loading || !target} style={{ ...button, width: "100%", opacity: loading ? .65 : 1 }}>{loading ? "Analizando USGS…" : "Analizar anomalía local"}</button></div>
    </section>

    {(stationError || eventsError || error) && <section style={{ ...panel, color: "#fca5a5", borderColor: "rgba(248,113,113,.35)" }}>
      {stationError && <div><b>USGS Geomagnetismo:</b> {stationError}</div>}
      {eventsError && <div><b>Sismos:</b> {eventsError}</div>}
      {error && <div><b>Análisis:</b> {error}</div>}
      <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 5 }}>El mapa base y el catálogo de estaciones permanecen disponibles aunque falle temporalmente una serie magnética.</div>
    </section>}

    {metrics && <>
      <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9 }}>
        <article><div style={{ color: "#a5b4fc", fontSize: 10, fontWeight: 900 }}>LOCAL MAGNETIC ANOMALY SCORE</div><strong style={{ color: "white", fontSize: 30 }}>{metrics.localityScore}/100</strong><div style={{ color: "#cbd5e1", fontSize: 11 }}>{scoreLabel(metrics.localityScore)}</div></article>
        <article><div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900 }}>ROBUST Z</div><strong style={{ color: "white", fontSize: 24 }}>{metrics.p95RobustZ.toFixed(2)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>p95 · máximo {metrics.maxRobustZ.toFixed(2)}</div></article>
        <article><div style={{ color: "#34d399", fontSize: 10, fontWeight: 900 }}>SEÑAL COMÚN</div><strong style={{ color: "white", fontSize: 24 }}>{Math.round(metrics.commonModeCorrelation * 100)}%</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>correlación con referencias; alta = menos local</div></article>
        <article><div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900 }}>KP MÁXIMO</div><strong style={{ color: "white", fontSize: 24 }}>{metrics.maxKp === null ? "N/D" : metrics.maxKp.toFixed(1)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>penalización score ×{metrics.kpPenalty.toFixed(2)}</div></article>
        <article><div style={{ color: "#fb7185", fontSize: 10, fontWeight: 900 }}>dB/dt MÁX.</div><strong style={{ color: "white", fontSize: 24 }}>{metrics.maxDbDtNtPerMin.toFixed(2)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>nT/min del residuo</div></article>
        <article><div style={{ color: "#c084fc", fontSize: 10, fontWeight: 900 }}>Z/H PROXY</div><strong style={{ color: "white", fontSize: 24 }}>{metrics.maxZhProxy.toFixed(2)}</strong><div style={{ color: "#94a3b8", fontSize: 10 }}>proxy temporal, no espectro ULF</div></article>
      </section>

      {selectedEvent && <section style={{ ...panel, borderColor: "rgba(251,113,133,.3)" }}><div style={{ color: "#fb7185", fontSize: 10, fontWeight: 900 }}>VENTANA PRE-SISMO</div><strong style={{ color: "white" }}>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</strong><div style={{ color: "#cbd5e1", fontSize: 11, marginTop: 4 }}>{new Date(selectedEvent.timeUtc).toLocaleString("es-DO")} · {selectedEvent.depthKm.toFixed(1)} km profundidad</div>{preEvent && <div style={{ display: "flex", gap: 15, flexWrap: "wrap", color: "#e2e8f0", fontSize: 12, marginTop: 9 }}><span><b>{preEvent.pre24}</b> anomalías z≥3 en 24 h previas</span><span><b>{preEvent.pre72}</b> en 72 h previas</span>{preEvent.strongest && <span>más fuerte: <b>z={preEvent.strongest.robustZ.toFixed(1)}</b>, {Math.abs(hoursBetween(preEvent.strongest.timeUtc, selectedEvent.timeUtc)).toFixed(1)} h antes</span>}</div>}<p style={{ color: "#64748b", fontSize: 10, marginBottom: 0 }}>Esta comparación temporal no demuestra que la anomalía esté relacionada con el terremoto. La selección sirve como marcador retrospectivo/prospectivo auditable.</p></section>}

      <section style={panel}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><strong style={{ color: "white" }}>Residuo magnético local · robust z</strong><span style={{ color: "#64748b", fontSize: 10 }}>{analysis?.target?.code} vs {analysis?.references?.map((reference) => reference.code).join(", ")} · {metrics.alignedSamples.toLocaleString("es-DO")} min alineados</span></div><div style={{ marginTop: 9 }}><MagneticChart points={metrics.plot} event={selectedEvent} /></div></section>

      <section style={panel}><strong style={{ color: "white" }}>Anomalías locales más fuertes</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{metrics.anomalies.map((point) => <div key={point.timeUtc} style={{ display: "grid", gridTemplateColumns: "minmax(155px,1fr) repeat(3,auto)", gap: 10, padding: 8, borderRadius: 9, background: "rgba(15,23,42,.65)", color: "#cbd5e1", fontSize: 10 }}><span>{new Date(point.timeUtc).toLocaleString("es-DO")}</span><b style={{ color: "#fbbf24" }}>z {point.robustZ.toFixed(2)}</b><span>{point.residualNt.toFixed(1)} nT</span><span>{point.dBdtNtPerMin.toFixed(1)} nT/min</span></div>)}{!metrics.anomalies.length && <span style={{ color: "#64748b", fontSize: 11 }}>No hubo puntos con robust z ≥ 3 en esta ventana.</span>}</div></section>

      {analysis?.warnings?.length ? <section style={{ ...panel, color: "#fde68a", fontSize: 11 }}>{analysis.warnings.map((warning) => <div key={warning}>{warning}</div>)}</section> : null}
    </>}

    <section style={{ ...panel, color: "#94a3b8", fontSize: 10, lineHeight: 1.55 }}>
      <strong style={{ color: "#cbd5e1" }}>Método y límites.</strong> El módulo usa el USGS Geomagnetism Data Web Service a 60 s. Prioriza XYZF adjusted; si no está disponible usa HDZF variation y convierte H/D a X/Y. Cada estación se centra por su mediana; la mediana de las referencias estima la señal común y se resta de la estación objetivo. El score combina robust z, persistencia, baja coherencia con controles, dB/dt y un proxy Z/H, con penalización por Kp de GFZ. No es un análisis espectral ULF completo y no valida predicción sísmica.
    </section>
  </main>;
}
