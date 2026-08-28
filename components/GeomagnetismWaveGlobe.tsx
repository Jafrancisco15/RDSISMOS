"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  depthKey,
  distanceAtElapsed,
  geodesicCircle,
  type SeismicWavefrontTable,
  type SurfaceWavePhase,
  type TravelTimeModel,
} from "@/lib/seismicWavefronts";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });
const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";

const panel: React.CSSProperties = {
  border: "1px solid rgba(56,189,248,.18)",
  borderRadius: 16,
  background: "linear-gradient(145deg,#04111d,#020812 62%,#071322)",
  padding: 14,
};
const control: React.CSSProperties = {
  width: "100%",
  background: "#071525",
  color: "white",
  border: "1px solid #1e3a52",
  borderRadius: 9,
  padding: 8,
};
const button: React.CSSProperties = {
  background: "#075985",
  color: "white",
  border: "1px solid #0ea5e9",
  borderRadius: 9,
  padding: "7px 10px",
  cursor: "pointer",
  fontWeight: 800,
};

type ScopeMode = "one" | "several" | "all";

type WavePath = {
  id: string;
  event: EarthquakeEvent;
  phase: SurfaceWavePhase;
  distanceDeg: number;
  elapsedSec: number;
  model: TravelTimeModel;
  color: string;
  stroke: number;
  points: Array<{ lat: number; lng: number; altitude: number }>;
};

type EventPoint = {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
  event: EarthquakeEvent;
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function phaseColor(phase: SurfaceWavePhase) {
  return phase === "P" ? "#38bdf8" : "#fbbf24";
}

function eventColor(magnitude: number) {
  if (magnitude >= 7) return "#fb7185";
  if (magnitude >= 5.5) return "#fb923c";
  return "#e2e8f0";
}

function secondsLabel(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function waveLabel(item: WavePath) {
  return `<div class="globe-tooltip"><strong>Fase ${item.phase} · M${item.event.magnitude.toFixed(1)}</strong><span>${escapeHtml(item.event.place)}</span><small>${item.distanceDeg.toFixed(1)}° desde el epicentro · t+${secondsLabel(item.elapsedSec)} · TauP ${item.model}</small></div>`;
}

function eventLabel(item: EventPoint) {
  const event = item.event;
  return `<div class="globe-tooltip"><strong>Epicentro · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>hipocentro ${event.depthKm.toFixed(1)} km · ${new Date(event.timeUtc).toISOString().replace("T", " ").slice(0, 19)} UTC</small></div>`;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => consume()));
}

export function GeomagnetismWaveGlobe({ events, selectedEventId }: { events: EarthquakeEvent[]; selectedEventId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 620 });
  const [scope, setScope] = useState<ScopeMode>("one");
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [model, setModel] = useState<TravelTimeModel>("ak135");
  const [showP, setShowP] = useState(true);
  const [showS, setShowS] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [tables, setTables] = useState<Record<string, SeismicWavefrontTable>>({});
  const [loadingCount, setLoadingCount] = useState(0);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({ width: Math.max(320, element.clientWidth), height: Math.max(460, Math.min(720, element.clientWidth * 0.7)) });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
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

  const tableRequests = useMemo(() => {
    const exact = scope !== "all";
    const unique = new Map<string, number>();
    for (const event of activeEvents) {
      const depth = depthKey(event.depthKm, exact);
      unique.set(`${model}:${depth.toFixed(1)}`, depth);
    }
    return [...unique.entries()].map(([key, depth]) => ({ key, depth }));
  }, [activeEvents, model, scope]);

  const requestSignature = useMemo(() => tableRequests.map((item) => item.key).sort().join("|"), [tableRequests]);

  useEffect(() => {
    const missing = tableRequests.filter(({ key }) => !tables[key]);
    if (!missing.length) {
      setLoadingCount(0);
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    const loaded: Record<string, SeismicWavefrontTable> = {};
    const errors: string[] = [];
    setLoadingCount(missing.length);
    setLoadErrors([]);

    void mapWithConcurrency(missing, 4, async ({ key, depth }) => {
      try {
        const params = new URLSearchParams({ depth: depth.toFixed(1), model });
        const response = await fetch(`/api/geomagnetism/wavefronts?${params}`, { cache: "force-cache", signal: controller.signal });
        const payload = await response.json() as SeismicWavefrontTable & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        loaded[key] = payload;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        errors.push(`Prof. ${depth.toFixed(1)} km: ${error instanceof Error ? error.message : "sin curva TauP"}`);
      } finally {
        if (!disposed) setLoadingCount((current) => Math.max(0, current - 1));
      }
    }).then(() => {
      if (disposed) return;
      if (Object.keys(loaded).length) setTables((current) => ({ ...current, ...loaded }));
      if (errors.length) setLoadErrors(errors.slice(0, 8));
    });

    return () => { disposed = true; controller.abort(); };
    // tables is intentionally omitted: a completed table is merged once per request set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, requestSignature]);

  const durationSec = useMemo(() => {
    let maximum = 0;
    for (const { key } of tableRequests) {
      const table = tables[key];
      if (!table) continue;
      for (const phase of ["P", "S"] as const) {
        for (const point of table.curves[phase]) maximum = Math.max(maximum, point.timeSec);
      }
    }
    return Math.max(60, Math.ceil(maximum + 15));
  }, [tableRequests, tables]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.2, (now - previous) / 1000);
      previous = now;
      setElapsedSec((current) => {
        const next = current + delta * speed;
        if (next >= durationSec) return 0;
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationSec, playing, speed]);

  const paths = useMemo<WavePath[]>(() => {
    const exact = scope !== "all";
    const phases = ([showP ? "P" : null, showS ? "S" : null].filter(Boolean) as SurfaceWavePhase[]);
    const segments = activeEvents.length > 180 ? 30 : activeEvents.length > 70 ? 42 : 72;
    const result: WavePath[] = [];

    for (const event of activeEvents) {
      const depth = depthKey(event.depthKm, exact);
      const table = tables[`${model}:${depth.toFixed(1)}`];
      if (!table) continue;
      for (const phase of phases) {
        const distanceDeg = distanceAtElapsed(table.curves[phase], elapsedSec, table.sampleStepDeg * 2.15);
        if (distanceDeg === null || distanceDeg <= 0.05) continue;
        result.push({
          id: `${event.id}:${phase}`,
          event,
          phase,
          distanceDeg,
          elapsedSec,
          model,
          color: phaseColor(phase),
          stroke: activeEvents.length > 100 ? 0.22 : 0.42,
          points: geodesicCircle(event.latitude, event.longitude, distanceDeg, segments).map((point) => ({ ...point, altitude: phase === "P" ? 0.012 : 0.016 })),
        });
      }
    }
    return result;
  }, [activeEvents, elapsedSec, model, scope, showP, showS, tables]);

  const epicenters = useMemo<EventPoint[]>(() => activeEvents.map((event) => ({
    id: event.id,
    lat: event.latitude,
    lng: event.longitude,
    altitude: 0.02,
    radius: Math.max(0.08, Math.min(0.42, 0.08 + (event.magnitude - 3) * 0.055)),
    color: eventColor(event.magnitude),
    event,
  })), [activeEvents]);

  function addCurrent() {
    if (!selectedEvent) return;
    setManualIds((current) => current.includes(selectedEvent.id) ? current : [...current, selectedEvent.id]);
    setScope("several");
  }

  const readyCount = tableRequests.filter(({ key }) => tables[key]).length;

  return <section style={panel}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
      <div>
        <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>TAUP · AK135 / PREM / IASP91 · SUPERFICIE 3D</div>
        <h2 style={{ color: "white", margin: "5px 0 4px", fontSize: 21 }}>Ondas sísmicas 3D · frentes de llegada P/S</h2>
        <p style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.55, margin: 0, maxWidth: 920 }}>Cada anillo representa dónde la fase directa P o S debería estar llegando a la superficie a un tiempo relativo t desde el origen del sismo. La velocidad no es constante: la curva se calcula con TauP según profundidad y modelo terrestre.</p>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 9, textAlign: "right" }}>EarthScope NSF SAGE<br />IRISWS traveltime v1</div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8, marginTop: 12 }}>
      <label style={{ color: "#cbd5e1", fontSize: 10 }}>Sismos<select value={scope} onChange={(event) => { setScope(event.target.value as ScopeMode); setElapsedSec(0); }} style={{ ...control, marginTop: 4 }}><option value="one">Uno · seleccionado</option><option value="several">Varios · lista manual</option><option value="all">Todos del período</option></select></label>
      <label style={{ color: "#cbd5e1", fontSize: 10 }}>Modelo terrestre<select value={model} onChange={(event) => { setModel(event.target.value as TravelTimeModel); setElapsedSec(0); }} style={{ ...control, marginTop: 4 }}><option value="ak135">AK135</option><option value="prem">PREM</option><option value="iasp91">IASP91</option></select></label>
      <label style={{ color: "#cbd5e1", fontSize: 10 }}>Velocidad<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} style={{ ...control, marginTop: 4 }}><option value={1}>1× tiempo real</option><option value={5}>5×</option><option value={10}>10×</option><option value={30}>30×</option><option value={60}>60×</option></select></label>
      <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}><button type="button" style={button} onClick={() => setPlaying((value) => !value)}>{playing ? "Pausar" : "Reproducir"}</button><button type="button" style={{ ...button, background: "#0f172a", borderColor: "#334155" }} onClick={() => { setElapsedSec(0); setPlaying(false); }}>Reiniciar</button></div>
    </div>

    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 10, color: "#cbd5e1", fontSize: 10 }}>
      <label><input type="checkbox" checked={showP} onChange={(event) => setShowP(event.target.checked)} /> <b style={{ color: "#38bdf8" }}>P</b> compresional</label>
      <label><input type="checkbox" checked={showS} onChange={(event) => setShowS(event.target.checked)} /> <b style={{ color: "#fbbf24" }}>S</b> corte</label>
      <span>t+<b style={{ color: "white" }}>{secondsLabel(elapsedSec)}</b> / {secondsLabel(durationSec)}</span>
      <span>{activeEvents.length} sismo{activeEvents.length === 1 ? "" : "s"}</span>
      <span>{readyCount}/{tableRequests.length} curvas de profundidad listas</span>
      {loadingCount > 0 && <span style={{ color: "#7dd3fc" }}>calculando {loadingCount}…</span>}
    </div>

    {scope === "several" && <div style={{ marginTop: 9, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" style={{ ...button, background: "#3b0764", borderColor: "#a855f7" }} onClick={addCurrent} disabled={!selectedEvent}>Añadir sismo seleccionado</button>
      {manualIds.map((id) => {
        const event = events.find((item) => item.id === id);
        if (!event) return null;
        return <button key={id} type="button" onClick={() => setManualIds((current) => current.filter((item) => item !== id))} style={{ border: "1px solid #334155", borderRadius: 999, background: "#0f172a", color: "#e2e8f0", padding: "5px 8px", fontSize: 9, cursor: "pointer" }}>M{event.magnitude.toFixed(1)} {event.place.slice(0, 28)} ×</button>;
      })}
      {!manualIds.length && <span style={{ color: "#64748b", fontSize: 9 }}>Elige un sismo en el selector superior y pulsa “Añadir”.</span>}
    </div>}

    {scope === "all" && <div style={{ color: "#fde68a", fontSize: 9, marginTop: 8 }}>Modo Todos: usa la profundidad redondeada al bloque de 5 km más cercano para compartir tablas TauP entre eventos y mantener el globo fluido. Uno/Varios usa profundidad a 0.1 km.</div>}
    {loadErrors.length > 0 && <div style={{ color: "#fca5a5", fontSize: 9, marginTop: 8 }}>{loadErrors.join(" · ")}</div>}

    <div ref={containerRef} style={{ marginTop: 10, borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 45%,#092036,#01040a 65%)", minHeight: 460 }}>
      <Globe
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#8bd5ff"
        atmosphereAltitude={0.15}
        showGraticules
        pathsData={paths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor="color"
        pathStroke="stroke"
        pathDashLength={1}
        pathDashGap={0}
        pathDashAnimateTime={0}
        pathTransitionDuration={0}
        pathLabel={(item: unknown) => waveLabel(item as WavePath)}
        pointsData={epicenters}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(item: unknown) => eventLabel(item as EventPoint)}
        pointsTransitionDuration={0}
        enablePointerInteraction
      />
    </div>

    <div style={{ color: "#94a3b8", fontSize: 9, lineHeight: 1.55, marginTop: 9 }}><b style={{ color: "#cbd5e1" }}>Interpretación:</b> esto es un campo de tiempos de viaje teórico, no una grabación de la onda. AK135/PREM/IASP91 son modelos 1-D esféricos y no representan heterogeneidad 3-D local. No se interpola a través de huecos grandes de P/S, por lo que las zonas de sombra pueden aparecer como ausencia del frente. Para amplitud real, polaridad y forma de onda deben usarse registros EarthScope.</div>
  </section>;
}
