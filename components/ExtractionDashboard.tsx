"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { extractionQuantityText, EXTRACTION_KIND_COLORS, EXTRACTION_KIND_LABELS, haversineKm, waterPressureMpa, type ExtractionKind, type ExtractionSite } from "@/lib/extractions";
import type { TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";
import { FrackingEarthScopeAnalysis } from "./FrackingEarthScopeAnalysis";

const ExtractionGlobe3D = dynamic(() => import("./ExtractionGlobe3D").then((m) => m.ExtractionGlobe3D), { ssr: false });
const ExtractionRelief3D = dynamic(() => import("./ExtractionRelief3D").then((m) => m.ExtractionRelief3D), { ssr: false });
type ExtractionPayload = { sites: ExtractionSite[]; warnings?: string[]; coverage?: { note?: string } };
type EventsPayload = { events?: EarthquakeEvent[]; error?: string };
const KINDS: ExtractionKind[] = ["oil_gas", "fracking", "injection", "mineral", "reservoir", "groundwater"];
const DAY = 86_400_000;
const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.16)", borderRadius: 16, background: "#061322", padding: 14 };
const control: React.CSSProperties = { background: "#071525", color: "white", border: "1px solid #1e3a52", borderRadius: 9, padding: 8 };
const button: React.CSSProperties = { ...control, cursor: "pointer", fontWeight: 800 };
const key = (date: Date) => date.toISOString().slice(0, 10);
const daysAgo = (days: number, end = new Date()) => key(new Date(end.getTime() - days * DAY));

export function ExtractionDashboard() {
  const today = key(new Date());
  const [mode, setMode] = useState<"globe" | "relief">("globe");
  const [sites, setSites] = useState<ExtractionSite[]>([]);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [tectonic, setTectonic] = useState<TectonicDepth3DResponse | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedEarthquakeId, setSelectedEarthquakeId] = useState<string | null>(null);
  const [visibleKinds, setVisibleKinds] = useState<ExtractionKind[]>(KINDS);
  const [startDate, setStartDate] = useState(() => daysAgo(30));
  const [endDate, setEndDate] = useState(today);
  const [minMagnitude, setMinMagnitude] = useState(3);
  const [radiusKm, setRadiusKm] = useState(100);
  const [showEarthquakes, setShowEarthquakes] = useState(true);
  const [showPlateBoundaries, setShowPlateBoundaries] = useState(true);
  const [showFaults, setShowFaults] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);
  const [coverageNote, setCoverageNote] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetch("/api/extractions", { cache: "force-cache", signal: controller.signal }).then((r) => r.json() as Promise<ExtractionPayload>),
      fetch("/api/tectonic-depth-3d", { cache: "force-cache", signal: controller.signal }).then((r) => r.json() as Promise<TectonicDepth3DResponse>),
    ]).then(([extractionResult, tectonicResult]) => {
      if (extractionResult.status === "fulfilled") {
        const loaded = extractionResult.value.sites ?? [];
        setSites(loaded); setWarnings(extractionResult.value.warnings ?? []); setCoverageNote(extractionResult.value.coverage?.note ?? null);
        setSelectedSiteId((current) => current ?? loaded.find((site) => site.id === "oil-maracaibo")?.id ?? loaded[0]?.id ?? null);
      } else setWarnings(["No fue posible cargar las extracciones."]);
      if (tectonicResult.status === "fulfilled") setTectonic(tectonicResult.value);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController(); setEventError(null);
    const start = new Date(`${startDate}T00:00:00Z`); const end = new Date(`${endDate}T23:59:59Z`);
    const span = (end.getTime() - start.getTime()) / DAY;
    if (span < 0 || span > 120.99) { setEvents([]); setEventError(span < 0 ? "La fecha inicial no puede superar la final." : "El span máximo es 120 días."); return () => controller.abort(); }
    const params = new URLSearchParams({ starttime: startDate, endtime: endDate, minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as EventsPayload; if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`); return payload.events ?? [];
    }).then((loaded) => { setEvents(loaded); setSelectedEarthquakeId((current) => current && loaded.some((event) => event.id === current) ? current : null); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setEvents([]); setEventError(error instanceof Error ? error.message : "No fue posible cargar sismos."); } });
    return () => controller.abort();
  }, [endDate, minMagnitude, startDate]);

  const kindSet = useMemo(() => new Set(visibleKinds), [visibleKinds]);
  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites]);
  const selectedEarthquake = useMemo(() => events.find((event) => event.id === selectedEarthquakeId) ?? null, [events, selectedEarthquakeId]);
  const nearbyEvents = useMemo(() => !selectedSite ? [] : events.map((event) => ({ event, distanceKm: haversineKm(selectedSite.latitude, selectedSite.longitude, event.latitude, event.longitude) })).filter((item) => item.distanceKm <= radiusKm).sort((a, b) => a.distanceKm - b.distanceKm), [events, radiusKm, selectedSite]);
  const selectSite = useCallback((site: ExtractionSite) => { setSelectedSiteId(site.id); setSelectedEarthquakeId(null); }, []);
  const selectEarthquake = useCallback((event: EarthquakeEvent) => setSelectedEarthquakeId(event.id), []);
  const openRelief = useCallback((site: ExtractionSite) => { setSelectedSiteId(site.id); setMode("relief"); }, []);
  const quickSpan = (days: number) => { const end = new Date(); setEndDate(key(end)); setStartDate(daysAgo(days, end)); };
  const toggleKind = (kind: ExtractionKind) => setVisibleKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);

  return <main style={{ display: "grid", gap: 14, padding: "0 12px 26px" }}>
    <section style={{ ...panel, background: "linear-gradient(135deg,#06233b,#075985 50%,#063b5b)" }}><div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900 }}>EXTRACCIONES + SISMICIDAD</div><h1 style={{ color: "white", margin: "5px 0" }}>Extracciones · Globo y Relieve 3D</h1><p style={{ color: "#c3dfef", fontSize: 12, margin: 0 }}>Planeta azul, países visibles, todas las extracciones cargadas y sismos seleccionables. La proximidad no prueba causalidad.</p></section>

    <section style={{ ...panel, display: "flex", gap: 7, flexWrap: "wrap" }}><button style={button} onClick={() => setMode("globe")}>Globo 3D</button><button style={button} disabled={!selectedSite} onClick={() => setMode("relief")}>Relieve 3D</button><span style={{ color: "#94a3b8", fontSize: 11, alignSelf: "center" }}>{sites.length.toLocaleString("es-DO")} extracciones · {events.length.toLocaleString("es-DO")} sismos</span></section>

    <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 7 }}>{KINDS.map((kind) => <button key={kind} style={{ ...button, opacity: visibleKinds.includes(kind) ? 1 : .4, borderColor: `${EXTRACTION_KIND_COLORS[kind]}66` }} onClick={() => toggleKind(kind)}>{EXTRACTION_KIND_LABELS[kind]} · {sites.filter((site) => site.kind === kind).length}</button>)}</section>

    <section style={{ ...panel, display: "grid", gap: 9 }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{[7,30,60,90,120].map((days) => <button key={days} style={button} onClick={() => quickSpan(days)}>{days} días</button>)}</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}><label style={{ color: "#cbd5e1", fontSize: 11 }}>Desde<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...control, width: "100%", marginTop: 4 }} /></label><label style={{ color: "#cbd5e1", fontSize: 11 }}>Hasta<input type="date" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value)} style={{ ...control, width: "100%", marginTop: 4 }} /></label><label style={{ color: "#cbd5e1", fontSize: 11 }}>Magnitud<select value={minMagnitude} onChange={(e) => setMinMagnitude(Number(e.target.value))} style={{ ...control, width: "100%", marginTop: 4 }}><option value={2.5}>M2.5+</option><option value={3}>M3.0+</option><option value={4.2}>M4.2+</option><option value={5}>M5.0+</option></select></label><label style={{ color: "#cbd5e1", fontSize: 11 }}>Radio<select value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} style={{ ...control, width: "100%", marginTop: 4 }}>{[25,50,100,200,300].map((radius) => <option key={radius} value={radius}>{radius} km</option>)}</select></label></div><div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#cbd5e1", fontSize: 11 }}><label><input type="checkbox" checked={showEarthquakes} onChange={(e) => setShowEarthquakes(e.target.checked)} /> Sismos</label><label><input type="checkbox" checked={showPlateBoundaries} onChange={(e) => setShowPlateBoundaries(e.target.checked)} /> Placas</label>{mode === "relief" && <label><input type="checkbox" checked={showFaults} onChange={(e) => setShowFaults(e.target.checked)} /> Fallas GEM</label>}</div></section>

    {(warnings.length > 0 || eventError) && <section style={{ ...panel, color: "#fde68a" }}>{warnings.map((warning) => <div key={warning}>{warning}</div>)}{eventError && <div>{eventError}</div>}</section>}

    {mode === "globe" ? <ExtractionGlobe3D tectonic={tectonic} sites={sites} earthquakes={events} visibleKinds={kindSet} selectedSiteId={selectedSiteId} selectedEarthquakeId={selectedEarthquakeId} nearbyEventCount={nearbyEvents.length} radiusKm={radiusKm} onSelectSite={selectSite} onSelectEarthquake={selectEarthquake} onOpenRelief={openRelief} showEarthquakes={showEarthquakes} showPlateBoundaries={showPlateBoundaries} /> : selectedSite ? <ExtractionRelief3D site={selectedSite} tectonic={tectonic} earthquakes={events} showFaults={showFaults} showPlateBoundaries={showPlateBoundaries} showEarthquakes={showEarthquakes} /> : <section style={panel}>Selecciona una extracción.</section>}

    {selectedSite && <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><article><div style={{ color: EXTRACTION_KIND_COLORS[selectedSite.kind], fontSize: 10, fontWeight: 900 }}>{EXTRACTION_KIND_LABELS[selectedSite.kind]}</div><strong style={{ color: "white" }}>{selectedSite.name}</strong><div style={{ color: "#bdd4e2", fontSize: 11 }}>{selectedSite.location ? `${selectedSite.location} · ` : ""}{selectedSite.country}</div><div style={{ color: "#7dd3fc", fontSize: 11 }}>{selectedSite.latitude.toFixed(5)}, {selectedSite.longitude.toFixed(5)}</div><p style={{ color: "#94a3b8", fontSize: 11 }}>{selectedSite.detail}</p></article><article><div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900 }}>CANTIDAD</div><strong style={{ color: "white" }}>{extractionQuantityText(selectedSite)}</strong>{selectedSite.waterHeadM && <div style={{ color: "#67e8f9", fontSize: 11 }}>Carga ≈ {waterPressureMpa(selectedSite.waterHeadM).toFixed(2)} MPa</div>}<p style={{ color: "#64748b", fontSize: 10 }}>{selectedSite.source}</p></article><article><div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900 }}>SISMOS ALREDEDOR</div><strong style={{ color: "white", fontSize: 24 }}>{nearbyEvents.length}</strong><div style={{ color: "#bdd4e2", fontSize: 11 }}>dentro de {radiusKm} km · {startDate} → {endDate}</div></article></section>}

    {selectedSite?.kind === "fracking" && <FrackingEarthScopeAnalysis site={selectedSite} events={events} />}

    {selectedEarthquake && <section style={{ ...panel, borderColor: "rgba(251,113,133,.4)" }}><div style={{ color: "#fb7185", fontSize: 10, fontWeight: 900 }}>SISMO SELECCIONADO</div><strong style={{ color: "white" }}>M{selectedEarthquake.magnitude.toFixed(1)} · {selectedEarthquake.place}</strong><div style={{ color: "#cbd5e1", fontSize: 11 }}>{new Date(selectedEarthquake.timeUtc).toLocaleString("es-DO")} · {selectedEarthquake.depthKm.toFixed(1)} km profundidad · {selectedEarthquake.latitude.toFixed(4)}, {selectedEarthquake.longitude.toFixed(4)}{selectedSite ? ` · ${haversineKm(selectedSite.latitude, selectedSite.longitude, selectedEarthquake.latitude, selectedEarthquake.longitude).toFixed(1)} km de ${selectedSite.name}` : ""}</div></section>}

    {selectedSite && <section style={panel}><strong style={{ color: "white" }}>Sismos dentro de {radiusKm} km</strong><div style={{ maxHeight: 330, overflow: "auto", display: "grid", gap: 6, marginTop: 8 }}>{nearbyEvents.map(({ event, distanceKm }) => <button key={event.id} style={{ ...button, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, textAlign: "left", borderColor: event.id === selectedEarthquakeId ? "#fb7185" : "#1e3a52" }} onClick={() => { selectEarthquake(event); setMode("globe"); }}><b style={{ color: "#fb7185" }}>M{event.magnitude.toFixed(1)}</b><span>{event.place}<small style={{ display: "block", color: "#94a3b8" }}>{new Date(event.timeUtc).toLocaleString("es-DO")} · {event.depthKm.toFixed(1)} km</small></span><span>{distanceKm.toFixed(1)} km</span></button>)}{!nearbyEvents.length && <span style={{ color: "#64748b", fontSize: 11 }}>Sin eventos en el radio y span elegidos.</span>}</div></section>}

    {coverageNote && <section style={{ ...panel, color: "#64748b", fontSize: 10 }}>{coverageNote}</section>}
  </main>;
}
