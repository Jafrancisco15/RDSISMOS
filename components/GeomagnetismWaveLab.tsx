"use client";

import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapLayersResponse } from "@/lib/globeLayers";
import { readJsonResponse } from "@/lib/safeFetchJson";
import { SeismicRayDiagramCard, type RayDiagramDetail, type RayDiagramModel } from "./SeismicRayDiagramCard";

const DAY = 86_400_000;
const PAGE_SIZE = 4;
const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.16)", borderRadius: 16, background: "linear-gradient(145deg,#061322,#020914)", padding: 14 };
const control: React.CSSProperties = { width: "100%", background: "#071525", color: "white", border: "1px solid #1e3a52", borderRadius: 9, padding: 8, marginTop: 4 };
const button: React.CSSProperties = { background: "#075985", color: "white", border: "1px solid #0ea5e9", borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontWeight: 800 };

type EventsPayload = { events?: EarthquakeEvent[]; error?: string };
type ScopeMode = "one" | "several" | "all";

function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function daysAgo(days: number) { return dateKey(new Date(Date.now() - days * DAY)); }

export function GeomagnetismWaveLab() {
  const today = dateKey(new Date());
  const [startDate, setStartDate] = useState(() => daysAgo(3));
  const [endDate, setEndDate] = useState(today);
  const [minMagnitude, setMinMagnitude] = useState(3);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [scope, setScope] = useState<ScopeMode>("one");
  const [model, setModel] = useState<RayDiagramModel>("ak135");
  const [detail, setDetail] = useState<RayDiagramDetail>("full");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<GlobeMapLayersResponse | null>(null);
  const [layersError, setLayersError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ starttime: startDate, endtime: endDate, minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await readJsonResponse<EventsPayload>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload.events ?? [];
    }).then((loaded) => {
      const sorted = loaded.slice().sort((a, b) => b.magnitude - a.magnitude || Date.parse(b.timeUtc) - Date.parse(a.timeUtc));
      setEvents(sorted);
      setSelectedEventId((current) => current && sorted.some((event) => event.id === current) ? current : sorted[0]?.id ?? "");
      setManualIds((current) => current.filter((id) => sorted.some((event) => event.id === id)));
      setPage(1);
    }).catch((loadError) => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setEvents([]);
      setSelectedEventId("");
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los sismos del período.");
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [endDate, minMagnitude, startDate]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/globe/layers?include=plates,boundaries,faults,countries", { cache: "force-cache", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as GlobeMapLayersResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setLayers(payload);
      setLayersError(payload.warnings?.length ? payload.warnings.join(" · ") : null);
    }).catch((loadError) => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setLayersError(loadError instanceof Error ? loadError.message : "No fue posible cargar el contexto tectónico.");
    });
    return () => controller.abort();
  }, []);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);
  const activeEvents = useMemo(() => {
    if (scope === "one") return selectedEvent ? [selectedEvent] : [];
    if (scope === "several") {
      const ids = new Set(manualIds);
      return events.filter((event) => ids.has(event.id));
    }
    return events;
  }, [events, manualIds, scope, selectedEvent]);

  const pageCount = Math.max(1, Math.ceil(activeEvents.length / PAGE_SIZE));
  const visibleEvents = useMemo(() => activeEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [activeEvents, page]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [pageCount]);

  function addSelected() {
    if (!selectedEvent) return;
    setManualIds((current) => current.includes(selectedEvent.id) ? current : [...current, selectedEvent.id]);
    setScope("several");
    setPage(1);
  }

  return <div style={{ display: "grid", gap: 12, padding: "0 12px 22px" }}>
    <section style={panel}>
      <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>SEISMIC IMPACT & RAY LAB · MOTOR LOCAL RDSISMOS</div>
      <h2 style={{ color: "white", margin: "5px 0 4px", fontSize: 21 }}>Ondas P/S, países alcanzados e impacto estimado</h2>
      <p style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.55, margin: 0, maxWidth: 980 }}>Cada sismo genera su propia ficha: contexto real de países, fallas, placas, epicentro y antípoda; globo 3D transparente con frentes P/S y probabilidad de intensidad por país; perfil 2D de MMI; y corte interno con rayos calculados localmente mediante AK135, PREM o IASP91.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 11 }}>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Desde<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} style={control} /></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Hasta<input type="date" value={endDate} min={startDate} max={today} onChange={(event) => setEndDate(event.target.value)} style={control} /></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Magnitud mínima<select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={control}><option value={3}>M3.0+</option><option value={3.5}>M3.5+</option><option value={4.2}>M4.2+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option><option value={6.5}>M6.5+</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Sismo<select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} style={control}><option value="">— ninguno —</option>{events.slice(0, 1500).map((event) => <option key={event.id} value={event.id}>M{event.magnitude.toFixed(1)} · {new Date(event.timeUtc).toISOString().slice(0, 16)} · {event.place}</option>)}</select></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Mostrar<select value={scope} onChange={(event) => { setScope(event.target.value as ScopeMode); setPage(1); }} style={control}><option value="one">Uno · seleccionado</option><option value="several">Varios · lista manual</option><option value="all">Todos · paginados</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Modelo<select value={model} onChange={(event) => setModel(event.target.value as RayDiagramModel)} style={control}><option value="ak135">AK135</option><option value="prem">PREM</option><option value="iasp91">IASP91</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Trayectorias<select value={detail} onChange={(event) => setDetail(event.target.value as RayDiagramDetail)} style={control}><option value="full">Completo · P/S + reflejos + núcleo</option><option value="basic">Básico · P/S directas</option></select></label>
        <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ ...button, width: "100%" }} onClick={addSelected} disabled={!selectedEvent}>Añadir a Varios</button></div>
      </div>

      {manualIds.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>{manualIds.map((id) => {
        const item = events.find((event) => event.id === id);
        if (!item) return null;
        return <button key={id} type="button" onClick={() => setManualIds((current) => current.filter((value) => value !== id))} title="Quitar de Varios" style={{ border: "1px solid #334155", borderRadius: 999, background: "#0f172a", color: "#cbd5e1", padding: "5px 8px", fontSize: 9, cursor: "pointer" }}>M{item.magnitude.toFixed(1)} · {item.place} ×</button>;
      })}</div>}

      <div style={{ marginTop: 8, color: error ? "#fca5a5" : "#64748b", fontSize: 9 }}>
        {loading ? "Cargando catálogo sísmico…" : error ? error : `${events.length} sismos disponibles · ${activeEvents.length} en la vista actual`}
        {layersError ? <span style={{ color: "#fde68a" }}> · contexto tectónico: {layersError}</span> : null}
      </div>
    </section>

    {activeEvents.length === 0 && !loading && <section style={{ ...panel, color: "#94a3b8", fontSize: 11 }}>Selecciona un sismo o añade eventos a la lista “Varios”.</section>}

    {visibleEvents.map((event) => <SeismicRayDiagramCard key={`${event.id}:${model}:${detail}`} event={event} model={model} detail={detail} layers={layers} />)}

    {pageCount > 1 && <section style={{ ...panel, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={{ ...button, background: "#0f172a", borderColor: "#334155", opacity: page <= 1 ? .45 : 1 }} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Anteriores</button>
      <span style={{ color: "#cbd5e1", fontSize: 10 }}>Página {page} / {pageCount} · {activeEvents.length} terremotos · {PAGE_SIZE} gráficas por página</span>
      <button type="button" style={{ ...button, background: "#0f172a", borderColor: "#334155", opacity: page >= pageCount ? .45 : 1 }} disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Siguientes →</button>
    </section>}

    <section style={{ ...panel, color: "#94a3b8", fontSize: 9.5, lineHeight: 1.55 }}>
      <b style={{ color: "#cbd5e1" }}>Método.</b> El contexto superficial reutiliza Natural Earth, PB2002 y GEM Global Active Faults. Los rayos y frentes P/S se calculan localmente con perfiles 1-D AK135/PREM/IASP91. El impacto por país usa la ecuación de predicción de intensidad Allen–Wald–Worden 2012 con distancia hipocentral y dispersión; no incluye Vs30, directividad ni geometría finita de ruptura y no sustituye ShakeMap.
    </section>
  </div>;
}
