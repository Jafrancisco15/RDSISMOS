"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  coincidenceScore,
  EXTRACTION_KIND_COLORS,
  EXTRACTION_KIND_LABELS,
  haversineKm,
  waterPressureMpa,
  type ExtractionKind,
  type ExtractionSite,
} from "@/lib/extractions";
import type { TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

const ExtractionGlobe3D = dynamic(() => import("./ExtractionGlobe3D").then((m) => m.ExtractionGlobe3D), { ssr: false, loading: () => <div style={{ padding: 28 }}>Inicializando globo de extracciones…</div> });
const ExtractionRelief3D = dynamic(() => import("./ExtractionRelief3D").then((m) => m.ExtractionRelief3D), { ssr: false, loading: () => <div style={{ padding: 28 }}>Inicializando relieve de extracción…</div> });

type Mode = "globe" | "relief";
type ExtractionPayload = { sites: ExtractionSite[]; counts?: Record<string, number>; warnings?: string[]; sources?: string[]; generatedAt?: string };
type EventsPayload = { events?: EarthquakeEvent[]; total?: number; error?: string };
const KINDS: ExtractionKind[] = ["oil_gas", "fracking", "injection", "mineral", "reservoir", "groundwater"];

function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function startKey(days: number) { return dateKey(new Date(Date.now() - days * 86_400_000)); }

const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.16)", borderRadius: 16, background: "linear-gradient(145deg,rgba(6,20,36,.96),rgba(2,9,18,.98))", padding: 14 };
const chip: React.CSSProperties = { borderRadius: 999, padding: "7px 10px", border: "1px solid rgba(148,163,184,.2)", background: "rgba(15,23,42,.72)", color: "#dbeafe", fontSize: 11, cursor: "pointer" };

export function ExtractionDashboard() {
  const [mode, setMode] = useState<Mode>("globe");
  const [sites, setSites] = useState<ExtractionSite[]>([]);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [tectonic, setTectonic] = useState<TectonicDepth3DResponse | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [visibleKinds, setVisibleKinds] = useState<ExtractionKind[]>(KINDS);
  const [days, setDays] = useState(30);
  const [minMagnitude, setMinMagnitude] = useState(3);
  const [showEarthquakes, setShowEarthquakes] = useState(true);
  const [showPlateBoundaries, setShowPlateBoundaries] = useState(true);
  const [showFaults, setShowFaults] = useState(true);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetch("/api/extractions", { cache: "force-cache", signal: controller.signal }).then((r) => r.json() as Promise<ExtractionPayload>),
      fetch("/api/tectonic-depth-3d", { cache: "force-cache", signal: controller.signal }).then((r) => r.json() as Promise<TectonicDepth3DResponse>),
    ]).then(([extractions, tectonics]) => {
      if (extractions.status === "fulfilled") {
        setSites(extractions.value.sites ?? []);
        setWarnings(extractions.value.warnings ?? []);
        const preferred = extractions.value.sites?.find((s) => s.id === "oil-maracaibo") ?? extractions.value.sites?.[0];
        if (preferred) setSelectedSiteId((current) => current ?? preferred.id);
      } else setWarnings(["No fue posible cargar la capa de extracciones."]);
      if (tectonics.status === "fulfilled") setTectonic(tectonics.value);
      setLoadingSites(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingEvents(true); setEventError(null);
    const params = new URLSearchParams({ starttime: startKey(days), endtime: dateKey(new Date()), minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as EventsPayload;
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setEvents(payload.events ?? []);
      })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setEvents([]); setEventError(error instanceof Error ? error.message : "No fue posible cargar sismos."); } })
      .finally(() => setLoadingEvents(false));
    return () => controller.abort();
  }, [days, minMagnitude]);

  const kindSet = useMemo(() => new Set(visibleKinds), [visibleKinds]);
  const filteredSites = useMemo(() => sites.filter((site) => kindSet.has(site.kind)), [kindSet, sites]);
  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites]);

  const selectSite = useCallback((site: ExtractionSite) => setSelectedSiteId(site.id), []);
  const openRelief = useCallback((site: ExtractionSite) => { setSelectedSiteId(site.id); setMode("relief"); }, []);

  const selectedCoincidence = useMemo(() => {
    if (!selectedSite || !events.length) return null;
    let nearest: EarthquakeEvent | null = null; let distance = Infinity;
    for (const event of events) {
      const d = haversineKm(selectedSite.latitude, selectedSite.longitude, event.latitude, event.longitude);
      if (d < distance) { distance = d; nearest = event; }
    }
    return nearest ? { event: nearest, distanceKm: distance, score: coincidenceScore(distance, nearest.depthKm, selectedSite.kind) } : null;
  }, [events, selectedSite]);

  const ranking = useMemo(() => {
    if (!events.length) return [] as Array<{ site: ExtractionSite; event: EarthquakeEvent; distanceKm: number; score: number }>;
    const ranked: Array<{ site: ExtractionSite; event: EarthquakeEvent; distanceKm: number; score: number }> = [];
    for (const site of filteredSites.slice(0, 1100)) {
      let nearest: EarthquakeEvent | null = null; let distance = Infinity;
      for (const event of events) {
        if (Math.abs(event.latitude - site.latitude) > 4 || Math.abs(event.longitude - site.longitude) > 6) continue;
        const d = haversineKm(site.latitude, site.longitude, event.latitude, event.longitude);
        if (d < distance) { distance = d; nearest = event; }
      }
      if (!nearest || distance > 180) continue;
      const score = coincidenceScore(distance, nearest.depthKm, site.kind);
      if (score >= 8) ranked.push({ site, event: nearest, distanceKm: distance, score });
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [events, filteredSites]);

  function toggleKind(kind: ExtractionKind) {
    setVisibleKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
  }

  return (
    <main style={{ display: "grid", gap: 14, padding: "0 12px 26px" }}>
      <section style={{ ...panel, background: "linear-gradient(135deg,#06233b,#082f49 52%,#073b32)" }}>
        <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>EXTRACCIÓN + CARGA DE AGUA + TECTÓNICA + SISMICIDAD</div>
        <h1 style={{ margin: "6px 0", color: "#f8fafc", fontSize: "clamp(22px,4vw,36px)" }}>Extracciones · Globo y Relieve 3D</h1>
        <p style={{ margin: 0, color: "#b9d5e5", lineHeight: 1.5, fontSize: 12 }}>Explora coincidencias espaciales entre petróleo/gas, fracking, inyección de agua residual, minería, grandes cargas de agua y sismicidad. La proximidad no demuestra causalidad.</p>
      </section>

      <section style={{ ...panel, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMode("globe")} style={{ ...chip, background: mode === "globe" ? "#0369a1" : chip.background, color: "white", fontWeight: 800 }}>Globo 3D</button>
        <button type="button" disabled={!selectedSite} onClick={() => setMode("relief")} style={{ ...chip, background: mode === "relief" ? "#0369a1" : chip.background, color: "white", fontWeight: 800 }}>Relieve 3D</button>
        <span style={{ color: "#94a3b8", fontSize: 10 }}>Selecciona un punto en el globo y ábrelo en relieve.</span>
      </section>

      <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        {KINDS.map((kind) => <button type="button" key={kind} onClick={() => toggleKind(kind)} style={{ ...chip, display: "flex", alignItems: "center", gap: 7, opacity: visibleKinds.includes(kind) ? 1 : .42, borderColor: `${EXTRACTION_KIND_COLORS[kind]}66`, textAlign: "left" }}><span style={{ width: 9, height: 9, borderRadius: 99, background: EXTRACTION_KIND_COLORS[kind], flex: "0 0 auto" }} />{EXTRACTION_KIND_LABELS[kind]} <b style={{ marginLeft: "auto" }}>{sites.filter((s) => s.kind === kind).length}</b></button>)}
      </section>

      <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Período<select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: "100%", marginTop: 5, padding: 8, borderRadius: 9, background: "#071525", color: "white", border: "1px solid #1e3a52" }}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option><option value={120}>120 días</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}>Magnitud mínima<select value={minMagnitude} onChange={(e) => setMinMagnitude(Number(e.target.value))} style={{ width: "100%", marginTop: 5, padding: 8, borderRadius: 9, background: "#071525", color: "white", border: "1px solid #1e3a52" }}><option value={2.5}>M2.5+</option><option value={3}>M3.0+</option><option value={4.2}>M4.2+</option><option value={5}>M5.0+</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}><input type="checkbox" checked={showEarthquakes} onChange={(e) => setShowEarthquakes(e.target.checked)} /> Sismos 3D</label>
        <label style={{ color: "#cbd5e1", fontSize: 11 }}><input type="checkbox" checked={showPlateBoundaries} onChange={(e) => setShowPlateBoundaries(e.target.checked)} /> Límites tectónicos</label>
        {mode === "relief" && <label style={{ color: "#cbd5e1", fontSize: 11 }}><input type="checkbox" checked={showFaults} onChange={(e) => setShowFaults(e.target.checked)} /> Fallas activas GEM</label>}
      </section>

      {(warnings.length > 0 || eventError) && <section style={{ ...panel, borderColor: "rgba(245,158,11,.3)", color: "#fde68a", fontSize: 11 }}>{warnings.map((w) => <div key={w}>{w}</div>)}{eventError && <div>{eventError}</div>}</section>}

      {loadingSites ? <section style={panel}>Cargando fuentes de extracción…</section> : mode === "globe" ? (
        <ExtractionGlobe3D tectonic={tectonic} sites={sites} earthquakes={events} visibleKinds={kindSet} selectedSiteId={selectedSiteId} onSelectSite={selectSite} onOpenRelief={openRelief} showEarthquakes={showEarthquakes} showPlateBoundaries={showPlateBoundaries} />
      ) : selectedSite ? (
        <ExtractionRelief3D site={selectedSite} tectonic={tectonic} earthquakes={events} showFaults={showFaults} showPlateBoundaries={showPlateBoundaries} showEarthquakes={showEarthquakes} />
      ) : <section style={panel}>Selecciona primero una extracción.</section>}

      {selectedSite && <section style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        <article><div style={{ color: EXTRACTION_KIND_COLORS[selectedSite.kind], fontSize: 10, fontWeight: 900 }}>{EXTRACTION_KIND_LABELS[selectedSite.kind]}</div><strong style={{ color: "white" }}>{selectedSite.name}</strong><p style={{ color: "#a8c2d2", fontSize: 11, lineHeight: 1.45 }}>{selectedSite.detail}</p><small style={{ color: "#64748b" }}>{selectedSite.source}{selectedSite.representative ? " · ubicación representativa, no inventario de pozos" : ""}</small></article>
        <article><div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900 }}>COINCIDENCIA ESPACIAL</div>{loadingEvents ? <strong style={{ color: "white" }}>Calculando…</strong> : selectedCoincidence ? <><strong style={{ color: "white" }}>{selectedCoincidence.score}/100</strong><div style={{ color: "#a8c2d2", fontSize: 11 }}>{selectedCoincidence.distanceKm.toFixed(1)} km al sismo más cercano · M{selectedCoincidence.event.magnitude.toFixed(1)} · {selectedCoincidence.event.depthKm.toFixed(0)} km profundidad</div></> : <strong style={{ color: "white" }}>Sin sismos en el período</strong>}<p style={{ color: "#64748b", fontSize: 10 }}>Este score prioriza distancia y sismos someros; es exploratorio y no atribuye origen inducido.</p></article>
        {selectedSite.waterHeadM && <article><div style={{ color: "#22d3ee", fontSize: 10, fontWeight: 900 }}>CARGA DE AGUA</div><strong style={{ color: "white" }}>≈ {waterPressureMpa(selectedSite.waterHeadM).toFixed(2)} MPa</strong><div style={{ color: "#a8c2d2", fontSize: 11 }}>para una columna de agua de {selectedSite.waterHeadM} m, usando ρgh. Es presión hidrostática local de referencia, no esfuerzo resuelto sobre una falla.</div></article>}
      </section>}

      <section style={panel}>
        <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, marginBottom: 8 }}>MAYORES COINCIDENCIAS DEL PERÍODO</div>
        {ranking.length ? ranking.map((item) => <button type="button" key={item.site.id} onClick={() => { setSelectedSiteId(item.site.id); setMode("relief"); }} style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, border: 0, borderTop: "1px solid rgba(148,163,184,.1)", padding: "9px 3px", background: "transparent", color: "#e2e8f0", textAlign: "left", cursor: "pointer" }}><span><b style={{ color: EXTRACTION_KIND_COLORS[item.site.kind] }}>{item.site.name}</b><small style={{ display: "block", color: "#7890a0" }}>{EXTRACTION_KIND_LABELS[item.site.kind]} · {item.distanceKm.toFixed(1)} km de M{item.event.magnitude.toFixed(1)} a {item.event.depthKm.toFixed(0)} km</small></span><strong>{item.score}</strong></button>) : <div style={{ color: "#7890a0", fontSize: 11 }}>No hay coincidencias destacables con los filtros actuales.</div>}
      </section>

      <section style={{ ...panel, color: "#8aa6b7", fontSize: 10, lineHeight: 1.5 }}>
        <strong style={{ color: "#cfe8f5" }}>Fuentes y límites.</strong> Minerales: USGS MRDS, cuya cobertura fuera de EE. UU. es incompleta y cuyo estado operativo puede estar desactualizado. Inyección: contexto EPA UIC Class II. Fracking: contexto EIA/FracFocus. Petróleo/gas, embalses y algunas capas hidrogeológicas usan por ahora centroides regionales representativos, no un inventario completo de pozos. Esta vista busca relaciones espaciales para investigación; proximidad y simultaneidad no prueban causalidad sísmica.
      </section>
    </main>
  );
}
