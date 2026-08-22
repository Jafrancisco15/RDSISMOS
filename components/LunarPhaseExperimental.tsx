"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { circlePolygon, greatCircleDistanceKm, lunarPosition } from "@/lib/lunar";
import type { GlobeMapLayersResponse, GlobeMapPath, GlobeMapPoint } from "@/lib/globeLayers";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";

interface LunarEarthquake {
  id: string;
  time: string;
  magnitude: number;
  place: string;
  longitude: number;
  latitude: number;
  depthKm: number;
  url: string | null;
}

interface LunarResponse {
  generatedAt: string;
  days: number;
  minMagnitude: number;
  events: LunarEarthquake[];
  error?: string;
}

interface RenderPath extends Omit<GlobeMapPath, "points"> {
  points: Array<GlobeMapPoint & { altitude: number }>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatUtc(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function earthquakeColor(magnitude: number) {
  if (magnitude >= 7) return "#ff3b30";
  if (magnitude >= 6) return "#ff7a45";
  if (magnitude >= 5) return "#fbbf24";
  return "#7dd3fc";
}

function eventLabel(event: LunarEarthquake) {
  return `<div class="globe-tooltip"><strong>M${event.magnitude.toFixed(1)} · ${event.place}</strong><span>${formatUtc(event.time)} UTC</span><small>${event.depthKm.toFixed(0)} km de profundidad</small></div>`;
}

export function LunarPhaseExperimental() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 680 });
  const [days, setDays] = useState(14);
  const [minMagnitude, setMinMagnitude] = useState(4.5);
  const [trailHours, setTrailHours] = useState(12);
  const [analysisRadiusKm, setAnalysisRadiusKm] = useState(1800);
  const [data, setData] = useState<LunarResponse | null>(null);
  const [mapLayers, setMapLayers] = useState<GlobeMapLayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<LunarEarthquake | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({ width: Math.max(320, element.clientWidth), height: Math.max(520, Math.min(760, element.clientWidth * 0.72)) });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 8, lng: -20, altitude: 2.15 }, 900);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/lunar-earthquakes?days=${days}&minmag=${minMagnitude}`, { signal: controller.signal, cache: "default" })
      .then(async (response) => {
        const payload = await response.json() as LunarResponse;
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setData(payload);
        setSelectedTime(Date.now());
        setError(null);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "No fue posible cargar el experimento lunar.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [days, minMagnitude]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/globe/layers", { signal: controller.signal, cache: "force-cache" })
      .then((response) => response.json())
      .then((payload: GlobeMapLayersResponse) => setMapLayers(payload))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const startTime = useMemo(() => Date.now() - days * 86_400_000, [days, data?.generatedAt]);
  const endTime = useMemo(() => data ? new Date(data.generatedAt).getTime() : Date.now(), [data]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setSelectedTime((value) => {
        const next = value + 30 * 60_000;
        if (next >= endTime) {
          setPlaying(false);
          return endTime;
        }
        return next;
      });
    }, 450);
    return () => window.clearInterval(timer);
  }, [playing, endTime]);

  const moon = useMemo(() => lunarPosition(new Date(selectedTime)), [selectedTime]);
  const visibleEvents = useMemo(() => {
    const lower = selectedTime - trailHours * 3_600_000;
    return (data?.events ?? []).filter((event) => {
      const time = new Date(event.time).getTime();
      return time <= selectedTime && time >= lower;
    });
  }, [data, selectedTime, trailHours]);

  const points = useMemo(() => [
    ...visibleEvents.map((event) => ({
      kind: "event" as const,
      event,
      lat: event.latitude,
      lng: event.longitude,
      altitude: 0.018 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.08,
      radius: 0.14 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.32,
      color: earthquakeColor(event.magnitude),
    })),
    { kind: "moon" as const, lat: moon.latitude, lng: moon.longitude, altitude: 0.045, radius: 0.52, color: "#f8fafc" },
    { kind: "antipode" as const, lat: moon.antipodeLatitude, lng: moon.antipodeLongitude, altitude: 0.035, radius: 0.44, color: "#c084fc" },
  ], [visibleEvents, moon]);

  const shadowPolygons = useMemo(() => [
    {
      id: "sublunar-zone",
      color: "rgba(255,255,255,.18)",
      geometry: { type: "Polygon", coordinates: [circlePolygon(moon.latitude, moon.longitude, analysisRadiusKm)] },
    },
    {
      id: "antipode-zone",
      color: "rgba(192,132,252,.18)",
      geometry: { type: "Polygon", coordinates: [circlePolygon(moon.antipodeLatitude, moon.antipodeLongitude, analysisRadiusKm)] },
    },
  ], [moon, analysisRadiusKm]);

  const platePaths = useMemo<RenderPath[]>(() => (mapLayers?.plateBoundaries ?? []).map((path) => ({
    ...path,
    points: path.points.map((point) => ({ ...point, altitude: 0.012 })),
  })), [mapLayers]);

  const proximity = useMemo(() => visibleEvents.map((event) => {
    const eventMoon = lunarPosition(new Date(event.time));
    const moonKm = greatCircleDistanceKm(event.latitude, event.longitude, eventMoon.latitude, eventMoon.longitude);
    const antipodeKm = greatCircleDistanceKm(event.latitude, event.longitude, eventMoon.antipodeLatitude, eventMoon.antipodeLongitude);
    return { event, moonKm, antipodeKm, closestKm: Math.min(moonKm, antipodeKm), closest: moonKm <= antipodeKm ? "sublunar" : "antípoda" };
  }).sort((a, b) => a.closestKm - b.closestKm), [visibleEvents]);

  const selectedProximity = selectedEvent ? (() => {
    const eventMoon = lunarPosition(new Date(selectedEvent.time));
    return {
      moonKm: greatCircleDistanceKm(selectedEvent.latitude, selectedEvent.longitude, eventMoon.latitude, eventMoon.longitude),
      antipodeKm: greatCircleDistanceKm(selectedEvent.latitude, selectedEvent.longitude, eventMoon.antipodeLatitude, eventMoon.antipodeLongitude),
    };
  })() : null;

  return (
    <main style={{ maxWidth: 1480, margin: "0 auto", padding: 28 }}>
      <header style={{ marginBottom: 16 }}>
        <div className="brand-line"><span className="pulse-dot" /> RDSISMOS · EXPERIMENTAL</div>
        <h1>Lunar Phase Experimental</h1>
        <p style={{ maxWidth: 980 }}>Visualiza en 3D el punto sublunar, su antípoda, los límites de placas y la ocurrencia real de sismos durante la misma ventana temporal. El módulo busca patrones y coincidencias; no presupone que la Luna cause o dispare terremotos.</p>
      </header>

      <div className="quality-warning"><strong>Lectura científica:</strong> las zonas blancas y violetas son radios visuales de análisis, no campos físicos ni zonas de peligro. La posición lunar usa una efeméride geocéntrica aproximada adecuada para exploración visual; cualquier prueba estadística formal debe usar efemérides astronómicas de mayor precisión y un catálogo con controles de tasa y múltiples comparaciones.</div>

      <section className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label>Días de catálogo<select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ width: "100%" }}><option value={7}>7 días</option><option value={14}>14 días</option><option value={30}>30 días</option></select></label>
          <label>Magnitud mínima<select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={{ width: "100%" }}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option></select></label>
          <label>Rastro sísmico<select value={trailHours} onChange={(event) => setTrailHours(Number(event.target.value))} style={{ width: "100%" }}><option value={3}>3 h</option><option value={6}>6 h</option><option value={12}>12 h</option><option value={24}>24 h</option></select></label>
          <label>Radio visual<select value={analysisRadiusKm} onChange={(event) => setAnalysisRadiusKm(Number(event.target.value))} style={{ width: "100%" }}><option value={1000}>1,000 km</option><option value={1800}>1,800 km</option><option value={3000}>3,000 km</option></select></label>
        </div>
      </section>

      <section className="panel" style={{ padding: 12, overflow: "hidden" }}>
        <div ref={containerRef} style={{ width: "100%", minHeight: 520, borderRadius: 16, overflow: "hidden", background: "#06101b" }}>
          <Globe
            ref={globeRef}
            width={size.width}
            height={size.height}
            globeImageUrl={EARTH_TEXTURE}
            backgroundColor="rgba(0,0,0,0)"
            atmosphereColor="#9bdcff"
            atmosphereAltitude={0.16}
            showGraticules
            polygonsData={shadowPolygons}
            polygonGeoJsonGeometry="geometry"
            polygonCapColor={(item: unknown) => String((item as { color: string }).color)}
            polygonSideColor={() => "rgba(255,255,255,.03)"}
            polygonStrokeColor={() => "rgba(255,255,255,.22)"}
            polygonAltitude={0.006}
            pointsData={points}
            pointLat="lat"
            pointLng="lng"
            pointAltitude="altitude"
            pointRadius="radius"
            pointColor="color"
            pointLabel={(point: unknown) => {
              const item = point as (typeof points)[number];
              if (item.kind === "moon") return `<div class="globe-tooltip"><strong>Punto sublunar</strong><span>${moon.latitude.toFixed(2)}°, ${moon.longitude.toFixed(2)}°</span></div>`;
              if (item.kind === "antipode") return `<div class="globe-tooltip"><strong>Antípoda lunar</strong><span>${moon.antipodeLatitude.toFixed(2)}°, ${moon.antipodeLongitude.toFixed(2)}°</span></div>`;
              return eventLabel(item.event);
            }}
            onPointClick={(point: unknown) => {
              const item = point as (typeof points)[number];
              if (item.kind === "event") setSelectedEvent(item.event);
            }}
            pathsData={platePaths}
            pathPoints="points"
            pathPointLat="lat"
            pathPointLng="lng"
            pathPointAlt="altitude"
            pathColor={() => "#22d3ee"}
            pathStroke={0.55}
            pathDashLength={0.04}
            pathDashGap={0.025}
            pathTransitionDuration={0}
            enablePointerInteraction
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center", marginTop: 12 }}>
          <button type="button" onClick={() => setPlaying((value) => !value)} style={{ border: "1px solid rgba(56,189,248,.45)", borderRadius: 999, padding: "9px 15px", background: "rgba(56,189,248,.12)", color: "white" }}>{playing ? "Pausar" : "▶ Reproducir"}</button>
          <input type="range" min={startTime} max={endTime} step={30 * 60_000} value={Math.min(endTime, Math.max(startTime, selectedTime))} onChange={(event) => { setPlaying(false); setSelectedTime(Number(event.target.value)); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", marginTop: 8, color: "#94a3b8", fontSize: 13 }}><span>{formatUtc(new Date(selectedTime))} UTC</span><span>{visibleEvents.length} sismos visibles en las últimas {trailHours} h</span></div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10, marginTop: 14 }}>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Fase lunar</span><h2>{moon.phaseName}</h2><p>{(moon.illuminatedFraction * 100).toFixed(0)}% iluminada · fase {(moon.phaseFraction * 100).toFixed(1)}%</p></article>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Punto sublunar</span><h2>{moon.latitude.toFixed(2)}°, {moon.longitude.toFixed(2)}°</h2><p>Centro blanco de la visualización.</p></article>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Antípoda</span><h2>{moon.antipodeLatitude.toFixed(2)}°, {moon.antipodeLongitude.toFixed(2)}°</h2><p>Punto exactamente opuesto en la esfera.</p></article>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Sismos cercanos</span><h2>{proximity.filter((item) => item.closestKm <= analysisRadiusKm).length}</h2><p>Dentro del radio visual respecto al punto sublunar o su antípoda durante el rastro actual.</p></article>
      </section>

      <section className="panel" style={{ marginTop: 14, padding: 18 }}>
        <span className="eyebrow">Coincidencias espaciales de la ventana visible</span>
        <h2>Sismos más próximos al eje Luna–antípoda</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {proximity.slice(0, 8).map((item) => <button key={item.event.id} type="button" onClick={() => setSelectedEvent(item.event)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, textAlign: "left", border: "1px solid rgba(148,163,184,.18)", borderRadius: 12, padding: 11, background: "rgba(2,6,23,.35)", color: "#e8f1f5" }}><span><strong>M{item.event.magnitude.toFixed(1)} · {item.event.place}</strong><small style={{ display: "block", color: "#94a3b8", marginTop: 3 }}>{formatUtc(item.event.time)} UTC</small></span><span style={{ color: item.closestKm <= analysisRadiusKm ? "#fde68a" : "#94a3b8", whiteSpace: "nowrap" }}>{Math.round(item.closestKm).toLocaleString()} km · {item.closest}</span></button>)}
          {!proximity.length && <p>No hay sismos en la ventana temporal seleccionada.</p>}
        </div>
      </section>

      {selectedEvent && selectedProximity && <section className="panel" style={{ marginTop: 14, padding: 18 }}><span className="eyebrow">Evento seleccionado</span><h2>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</h2><p>{formatUtc(selectedEvent.time)} UTC · profundidad {selectedEvent.depthKm.toFixed(1)} km.</p><p>En el instante exacto del sismo: <strong>{Math.round(selectedProximity.moonKm).toLocaleString()} km</strong> del punto sublunar y <strong>{Math.round(selectedProximity.antipodeKm).toLocaleString()} km</strong> de la antípoda. Estas distancias describen geometría temporal; por sí solas no demuestran disparo sísmico.</p></section>}

      {loading && <div className="info-banner" style={{ marginTop: 14 }}>Cargando catálogo USGS…</div>}
      {error && <div className="warning-banner" style={{ marginTop: 14 }}>{error}</div>}
    </main>
  );
}
