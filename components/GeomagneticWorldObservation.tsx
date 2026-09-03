"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GroundMagneticObservation, MagneticGridCell } from "@/lib/geomagneticWorld";
import type { SwarmMagneticPoint } from "@/lib/swarmGeomag";
import type { SuperMagContext } from "@/lib/supermag";
import { readJsonResponse } from "@/lib/safeFetchJson";
import type { WorldMapLayers, WorldMapViewMode } from "./GeomagneticWorldLeafletMap";

const WorldMap = dynamic(
  () => import("./GeomagneticWorldLeafletMap").then((module) => module.GeomagneticWorldLeafletMap),
  { ssr: false, loading: () => <div style={{ height: 520, display: "grid", placeItems: "center", borderRadius: 14, background: "#061322", color: "#bae6fd" }}>Construyendo mapa geomagnético mundial…</div> },
);

type ObservationPayload = {
  generatedAt?: string;
  defaultView?: WorldMapViewMode;
  reference?: { name?: string; modelName?: string; epoch?: number; start?: string; end?: string };
  groundPoints?: GroundMagneticObservation[];
  referenceGrid?: MagneticGridCell[];
  changeGrid?: MagneticGridCell[];
  anomalyGrid?: MagneticGridCell[];
  anomalies?: GroundMagneticObservation[];
  swarmPoints?: SwarmMagneticPoint[];
  supermag?: SuperMagContext | null;
  coverage?: {
    federatedStations?: number;
    sampledGroundStations?: number;
    groundPoints?: number;
    fallbackGroundPoints?: number;
    swarmPoints?: number;
    referenceCells?: number;
    changeCells?: number;
    anomalyCells?: number;
  };
  sourceStatus?: Record<string, boolean>;
  warnings?: string[];
  methodology?: Record<string, string>;
  error?: string;
};
type EventsPayload = { events?: EarthquakeEvent[]; error?: string };

const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.18)", borderRadius: 16, background: "linear-gradient(145deg,#061322,#020914)", padding: 12 };
const button: React.CSSProperties = { border: "1px solid #334155", borderRadius: 999, padding: "6px 9px", background: "#0f172a", color: "#cbd5e1", fontSize: 9, fontWeight: 800, cursor: "pointer" };
const DAY = 86_400_000;
function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function sourceChip(label: string, active: boolean, suffix?: string) { return <span style={{ border: `1px solid ${active ? "#34d39955" : "#64748b44"}`, borderRadius: 999, padding: "4px 7px", color: active ? "#a7f3d0" : "#94a3b8", background: active ? "rgba(6,95,70,.18)" : "rgba(15,23,42,.5)", fontSize: 8.7, fontWeight: 800 }}>{label}{suffix ? ` · ${suffix}` : ""}</span>; }

function summarizeWarnings(warnings: string[]) {
  const temporal = warnings.filter((warning) => /sin datos|cobertura temporal|snapshot reciente|observatorios/i.test(warning)).length;
  const swarm = warnings.filter((warning) => /swarm|vires/i.test(warning)).length;
  const supermag = warnings.filter((warning) => /supermag/i.test(warning)).length;
  const other = warnings.length - temporal - swarm - supermag;
  const result: string[] = [];
  if (temporal) result.push(`${temporal} avisos de cobertura terrestre reciente.`);
  if (swarm) result.push(`${swarm} avisos de Swarm/VirES.`);
  if (supermag) result.push(`${supermag} aviso de SuperMAG/AMDA.`);
  if (other > 0) result.push(`${other} avisos adicionales de fuentes.`);
  return result;
}

function viewLabel(view: WorldMapViewMode) {
  if (view === "reference") return "Campo base WMM2025";
  if (view === "anomaly") return "Anomalía robust-Z";
  return "Cambio reciente ΔF";
}

function viewDescription(view: WorldMapViewMode) {
  if (view === "reference") return "Campo principal esperado por WMM2025. Es geografía magnética normal, no anomalía ni riesgo.";
  if (view === "anomaly") return "Desviación reciente estandarizada por la variabilidad robusta de cada observatorio. |z|≥3 merece inspección, no implica origen sísmico.";
  return "Último |F| menos la mediana reciente de cada estación. Rojo=aumento reciente; azul=disminución reciente. Es la vista predeterminada.";
}

export function GeomagneticWorldObservation() {
  const [payload, setPayload] = useState<ObservationPayload | null>(null);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [minMagnitude, setMinMagnitude] = useState(4);
  const [viewMode, setViewMode] = useState<WorldMapViewMode>("change");
  const [layers, setLayers] = useState<WorldMapLayers>({ anomalies: true, swarm: true, earthquakes: true, dataPoints: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/geomagnetism/world-observation?_=${Date.now()}-${reloadKey}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJsonResponse<ObservationPayload>(response); if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`); return body; })
      .then((body) => { setPayload(body); if (body.defaultView) setViewMode(body.defaultView); })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar la observación mundial."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    const end = new Date(); const start = new Date(end.getTime() - 30 * DAY);
    const params = new URLSearchParams({ starttime: dateKey(start), endtime: dateKey(end), minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJsonResponse<EventsPayload>(response); if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`); return body.events ?? []; })
      .then((items) => setEvents(items.slice().sort((a, b) => Date.parse(b.timeUtc) - Date.parse(a.timeUtc))))
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError((current) => current ?? (err instanceof Error ? err.message : "No fue posible cargar los sismos de 30 días.")); });
    return () => controller.abort();
  }, [minMagnitude, reloadKey]);

  const warnings = payload?.warnings ?? [];
  const warningSummary = useMemo(() => summarizeWarnings(warnings), [warnings]);
  const supermag = payload?.supermag ?? null;
  const activeGrid = viewMode === "reference" ? payload?.referenceGrid ?? [] : viewMode === "anomaly" ? payload?.anomalyGrid ?? [] : payload?.changeGrid ?? [];
  const toggle = (key: keyof WorldMapLayers) => setLayers((current) => ({ ...current, [key]: !current[key] }));

  return <section style={panel}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#67e8f9", fontSize: 9, fontWeight: 900, letterSpacing: ".1em" }}>OBSERVACIÓN MUNDIAL · ÚLTIMOS 30 DÍAS DE SISMICIDAD</div>
        <h2 style={{ color: "white", margin: "5px 0 3px", fontSize: "clamp(18px,3vw,25px)" }}>Cambios geomagnéticos, anomalías y sismos</h2>
        <p style={{ color: "#94a3b8", margin: 0, fontSize: 10, lineHeight: 1.5, maxWidth: 980 }}>El mapa ya no usa “campo absoluto alto” como señal principal. Por defecto muestra <b style={{ color: "#e2e8f0" }}>cambio reciente ΔF</b> respecto a la propia línea base de cada observatorio. WMM2025 mantiene un campo base mundial continuo solo como referencia física.</p>
      </div>
      <button type="button" onClick={() => setReloadKey((value) => value + 1)} style={{ ...button, borderColor: "#0ea5e9", color: "#bae6fd" }}>{loading ? "Actualizando…" : "Actualizar"}</button>
    </div>

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
      {sourceChip("WMM2025", Boolean(payload?.sourceStatus?.WMM2025), "campo esperado global")}
      {sourceChip("USGS", Boolean(payload?.sourceStatus?.USGS))}
      {sourceChip("INTERMAGNET", Boolean(payload?.sourceStatus?.INTERMAGNET))}
      {sourceChip("Swarm A/B/C", Boolean(payload?.sourceStatus?.Swarm), `${payload?.swarmPoints?.length ?? 0} puntos`)}
      {sourceChip("SuperMAG", Boolean(payload?.sourceStatus?.SuperMAG), supermag ? (supermag.current ? "actual" : `hasta ${supermag.availableStop?.slice(0, 10) ?? "N/D"}`) : "N/D")}
      {sourceChip("Sismos", true, `30 d · ${events.length} M${minMagnitude.toFixed(1)}+`)}
    </div>

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 6px" }}>
      {([['change','ΔF reciente'],['anomaly','robust-Z'],['reference','Campo base']] as Array<[WorldMapViewMode,string]>).map(([mode, label]) => <button key={mode} type="button" onClick={() => setViewMode(mode)} style={{ ...button, background: viewMode === mode ? "#0c4a6e" : "#111827", borderColor: viewMode === mode ? "#38bdf8" : "#334155", color: viewMode === mode ? "white" : "#94a3b8" }}>{label}</button>)}
    </div>
    <div style={{ marginBottom: 8, padding: "7px 9px", borderRadius: 10, background: "rgba(15,23,42,.62)", border: "1px solid rgba(148,163,184,.14)", color: "#cbd5e1", fontSize: 9, lineHeight: 1.45 }}><b>{viewLabel(viewMode)}:</b> {viewDescription(viewMode)}</div>

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "0 0 8px" }}>
      {([['anomalies','Anillos z≥3'],['dataPoints','Estaciones'],['swarm','Swarm'],['earthquakes','Sismos']] as Array<[keyof WorldMapLayers,string]>).map(([key, label]) => <button key={key} type="button" onClick={() => toggle(key)} style={{ ...button, background: layers[key] ? "#0c4a6e" : "#111827", borderColor: layers[key] ? "#38bdf8" : "#334155", color: layers[key] ? "white" : "#64748b" }}>{label} {layers[key] ? "ON" : "OFF"}</button>)}
      <label style={{ color: "#94a3b8", fontSize: 9, marginLeft: "auto" }}>Sismos 30 d <select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={{ marginLeft: 5, background: "#071525", color: "white", border: "1px solid #334155", borderRadius: 7, padding: "5px 7px" }}><option value={3}>M3+</option><option value={4}>M4+</option><option value={5}>M5+</option><option value={6}>M6+</option></select></label>
    </div>

    {error ? <div style={{ padding: 12, borderRadius: 12, color: "#fca5a5", background: "rgba(127,29,29,.18)", border: "1px solid rgba(248,113,113,.3)" }}>{error}</div> : <WorldMap
      viewMode={viewMode}
      grid={activeGrid}
      referenceGrid={payload?.referenceGrid ?? []}
      groundPoints={payload?.groundPoints ?? []}
      anomalies={payload?.anomalies ?? []}
      swarmPoints={payload?.swarmPoints ?? []}
      events={events}
      layers={layers}
    />}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 7, marginTop: 9 }}>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#67e8f9", fontSize: 8.5, fontWeight: 900 }}>VISTA ACTIVA</div><strong style={{ color: "white", fontSize: 15 }}>{viewLabel(viewMode)}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{activeGrid.length} celdas · {viewMode === "reference" ? "cobertura mundial modelada" : "solo donde hay soporte observado"}</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#f8fafc", fontSize: 8.5, fontWeight: 900 }}>CAMPO TERRESTRE</div><strong style={{ color: "white", fontSize: 17 }}>{payload?.groundPoints?.length ?? 0} puntos</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{payload?.coverage?.fallbackGroundPoints ?? 0} recuperados por fallback USGS</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#f0abfc", fontSize: 8.5, fontWeight: 900 }}>ANOMALÍAS PRELIMINARES</div><strong style={{ color: "white", fontSize: 17 }}>{payload?.anomalies?.length ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>z≥3 respecto a la propia serie reciente</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#60a5fa", fontSize: 8.5, fontWeight: 900 }}>SWARM</div><strong style={{ color: "white", fontSize: 17 }}>{payload?.swarmPoints?.length ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>A/B/C FAST · contexto orbital independiente</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#a5b4fc", fontSize: 8.5, fontWeight: 900 }}>SUPERMAG SME</div><strong style={{ color: "white", fontSize: 17 }}>{supermag?.latestSmeNt === null || supermag?.latestSmeNt === undefined ? "N/D" : `${Math.round(supermag.latestSmeNt)} nT`}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{supermag?.current ? "contexto actual" : supermag?.availableStop ? `último espejo ${supermag.availableStop.slice(0,10)}` : "sin contexto"}</div></article>
    </div>

    {warningSummary.length > 0 && <details style={{ marginTop: 8, border: "1px solid rgba(251,191,36,.18)", borderRadius: 10, padding: 8, color: "#fde68a", fontSize: 9 }}><summary style={{ cursor: "pointer", fontWeight: 800 }}>Cobertura parcial · {warnings.length} avisos</summary><div style={{ marginTop: 6 }}>{warningSummary.map((warning) => <div key={warning}>{warning}</div>)}</div></details>}

    <p style={{ color: "#64748b", fontSize: 8.6, lineHeight: 1.5, margin: "9px 1px 0" }}><b style={{ color: "#94a3b8" }}>Lectura correcta:</b> una región roja en ΔF significa que los observatorios cercanos están por encima de su propia línea base reciente; no significa “magnetismo fuerte”, daño, ni relación demostrada con un terremoto. El campo base WMM2025 muestra dónde el campo principal es naturalmente mayor o menor y por eso usa otra paleta.</p>
  </section>;
}
