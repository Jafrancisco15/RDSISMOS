"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GroundMagneticObservation, MagneticGridCell } from "@/lib/geomagneticWorld";
import type { SwarmMagneticPoint } from "@/lib/swarmGeomag";
import type { SuperMagContext } from "@/lib/supermag";
import { readJsonResponse } from "@/lib/safeFetchJson";
import type { WorldMapLayers } from "./GeomagneticWorldLeafletMap";

const WorldMap = dynamic(
  () => import("./GeomagneticWorldLeafletMap").then((module) => module.GeomagneticWorldLeafletMap),
  { ssr: false, loading: () => <div style={{ height: 520, display: "grid", placeItems: "center", borderRadius: 14, background: "#061322", color: "#bae6fd" }}>Construyendo mapa geomagnético mundial…</div> },
);

type ObservationPayload = {
  generatedAt?: string;
  groundPoints?: GroundMagneticObservation[];
  grid?: MagneticGridCell[];
  anomalies?: GroundMagneticObservation[];
  swarmPoints?: SwarmMagneticPoint[];
  supermag?: SuperMagContext | null;
  coverage?: { federatedStations?: number; sampledGroundStations?: number; groundPoints?: number; swarmPoints?: number };
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
  const temporal = warnings.filter((warning) => /sin datos en la ventana|disponibilidad/i.test(warning)).length;
  const swarm = warnings.filter((warning) => /swarm|vires/i.test(warning)).length;
  const supermag = warnings.filter((warning) => /supermag/i.test(warning)).length;
  const other = warnings.length - temporal - swarm - supermag;
  const result: string[] = [];
  if (temporal) result.push(`${temporal} observatorios sin cobertura temporal útil en la ventana reciente.`);
  if (swarm) result.push(`${swarm} avisos de Swarm/VirES.`);
  if (supermag) result.push(`${supermag} aviso de SuperMAG/AMDA.`);
  if (other > 0) result.push(`${other} fuentes terrestres no entregaron un snapshot utilizable.`);
  return result;
}

export function GeomagneticWorldObservation() {
  const [payload, setPayload] = useState<ObservationPayload | null>(null);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [minMagnitude, setMinMagnitude] = useState(4);
  const [layers, setLayers] = useState<WorldMapLayers>({ field: true, anomalies: true, swarm: true, earthquakes: true, dataPoints: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/geomagnetism/world-observation?_=${reloadKey}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJsonResponse<ObservationPayload>(response); if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`); return body; })
      .then(setPayload)
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
  const toggle = (key: keyof WorldMapLayers) => setLayers((current) => ({ ...current, [key]: !current[key] }));

  return <section style={panel}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#67e8f9", fontSize: 9, fontWeight: 900, letterSpacing: ".1em" }}>OBSERVACIÓN MUNDIAL · ÚLTIMOS 30 DÍAS DE SISMICIDAD</div>
        <h2 style={{ color: "white", margin: "5px 0 3px", fontSize: "clamp(18px,3vw,25px)" }}>Campo magnético, anomalías y sismos</h2>
        <p style={{ color: "#94a3b8", margin: 0, fontSize: 10, lineHeight: 1.5, maxWidth: 980 }}>El color amarillo→rojo representa |F| magnético terrestre relativo dentro de los puntos observados; rojo significa campo más alto, no mayor riesgo sísmico. Los anillos magenta marcan desviaciones locales preliminares z≥3. Swarm se muestra como trayectoria satelital independiente.</p>
      </div>
      <button type="button" onClick={() => setReloadKey((value) => value + 1)} style={{ ...button, borderColor: "#0ea5e9", color: "#bae6fd" }}>{loading ? "Actualizando…" : "Actualizar"}</button>
    </div>

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
      {sourceChip("USGS", Boolean(payload?.sourceStatus?.USGS))}
      {sourceChip("INTERMAGNET", Boolean(payload?.sourceStatus?.INTERMAGNET))}
      {sourceChip("Swarm A/B/C", Boolean(payload?.sourceStatus?.Swarm), `${payload?.swarmPoints?.length ?? 0} puntos`)}
      {sourceChip("SuperMAG", Boolean(payload?.sourceStatus?.SuperMAG), supermag ? (supermag.current ? "actual" : `hasta ${supermag.availableStop?.slice(0, 10) ?? "N/D"}`) : "N/D")}
      {sourceChip("Sismos", true, `30 d · ${events.length} M${minMagnitude.toFixed(1)}+`)}
    </div>

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0 8px" }}>
      {([['field','Campo |F|'],['anomalies','Anomalías'],['dataPoints','Estaciones'],['swarm','Swarm'],['earthquakes','Sismos']] as Array<[keyof WorldMapLayers,string]>).map(([key, label]) => <button key={key} type="button" onClick={() => toggle(key)} style={{ ...button, background: layers[key] ? "#0c4a6e" : "#111827", borderColor: layers[key] ? "#38bdf8" : "#334155", color: layers[key] ? "white" : "#64748b" }}>{label} {layers[key] ? "ON" : "OFF"}</button>)}
      <label style={{ color: "#94a3b8", fontSize: 9, marginLeft: "auto" }}>Sismos 30 d <select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={{ marginLeft: 5, background: "#071525", color: "white", border: "1px solid #334155", borderRadius: 7, padding: "5px 7px" }}><option value={3}>M3+</option><option value={4}>M4+</option><option value={5}>M5+</option><option value={6}>M6+</option></select></label>
    </div>

    {error ? <div style={{ padding: 12, borderRadius: 12, color: "#fca5a5", background: "rgba(127,29,29,.18)", border: "1px solid rgba(248,113,113,.3)" }}>{error}</div> : <WorldMap
      grid={payload?.grid ?? []}
      groundPoints={payload?.groundPoints ?? []}
      anomalies={payload?.anomalies ?? []}
      swarmPoints={payload?.swarmPoints ?? []}
      events={events}
      layers={layers}
    />}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 7, marginTop: 9 }}>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#fbbf24", fontSize: 8.5, fontWeight: 900 }}>CAMPO TERRESTRE</div><strong style={{ color: "white", fontSize: 17 }}>{payload?.groundPoints?.length ?? 0} puntos</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>de {payload?.coverage?.sampledGroundStations ?? 0} observatorios muestreados</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#f0abfc", fontSize: 8.5, fontWeight: 900 }}>ANOMALÍAS PRELIMINARES</div><strong style={{ color: "white", fontSize: 17 }}>{payload?.anomalies?.length ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>z≥3 respecto a la propia serie reciente</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#60a5fa", fontSize: 8.5, fontWeight: 900 }}>SWARM</div><strong style={{ color: "white", fontSize: 17 }}>{payload?.swarmPoints?.length ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>A/B/C FAST · trazas recientes</div></article>
      <article style={{ padding: 9, borderRadius: 10, background: "rgba(15,23,42,.7)" }}><div style={{ color: "#a5b4fc", fontSize: 8.5, fontWeight: 900 }}>SUPERMAG SME</div><strong style={{ color: "white", fontSize: 17 }}>{supermag?.latestSmeNt === null || supermag?.latestSmeNt === undefined ? "N/D" : `${Math.round(supermag.latestSmeNt)} nT`}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{supermag?.current ? "contexto actual" : supermag?.availableStop ? `último espejo ${supermag.availableStop.slice(0,10)}` : "sin contexto"}</div></article>
    </div>

    {warningSummary.length > 0 && <details style={{ marginTop: 8, border: "1px solid rgba(251,191,36,.18)", borderRadius: 10, padding: 8, color: "#fde68a", fontSize: 9 }}><summary style={{ cursor: "pointer", fontWeight: 800 }}>Cobertura parcial · {warnings.length} avisos</summary><div style={{ marginTop: 6 }}>{warningSummary.map((warning) => <div key={warning}>{warning}</div>)}</div><details style={{ marginTop: 6 }}><summary style={{ color: "#94a3b8", cursor: "pointer" }}>Detalle técnico</summary><div style={{ color: "#64748b", marginTop: 4, maxHeight: 130, overflow: "auto" }}>{warnings.map((warning, index) => <div key={`${index}:${warning.slice(0,20)}`}>{warning}</div>)}</div></details></details>}

    <p style={{ color: "#64748b", fontSize: 8.6, lineHeight: 1.5, margin: "9px 1px 0" }}><b style={{ color: "#94a3b8" }}>Lectura correcta:</b> el heatmap es una interpolación observacional del campo absoluto terrestre y solo se dibuja cerca de puntos con soporte. No es un mapa de “energía sísmica” ni una predicción. Swarm no se mezcla con el color terrestre porque mide a altitud orbital. SuperMAG aporta perturbación magnetosférica global, no puntos de campo absoluto.</p>
  </section>;
}
