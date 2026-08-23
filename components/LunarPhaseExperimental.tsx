"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { circlePolygon, greatCircleDistanceKm, lunarPosition } from "@/lib/lunar";
import type { GlobeMapLayersResponse, GlobeMapPoint } from "@/lib/globeLayers";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const HOUR_MS = 3_600_000;

type ShadowMode = "direct" | "antipode" | "both";
type CameraFollow = "off" | "direct" | "antipode";

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

interface RenderPath {
  id: string;
  name: string;
  points: Array<GlobeMapPoint & { altitude: number }>;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
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
  const [windowHours, setWindowHours] = useState(24);
  const [analysisRadiusKm, setAnalysisRadiusKm] = useState(1800);
  const [shadowMode, setShadowMode] = useState<ShadowMode>("both");
  const [cameraFollow, setCameraFollow] = useState<CameraFollow>("off");
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
  const halfWindowMs = windowHours * HOUR_MS / 2;
  const windowStart = selectedTime - halfWindowMs;
  const windowEnd = selectedTime + halfWindowMs;

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

  useEffect(() => {
    if (cameraFollow === "off") return;
    const target = cameraFollow === "direct"
      ? { lat: moon.latitude, lng: moon.longitude, altitude: 1.75 }
      : { lat: moon.antipodeLatitude, lng: moon.antipodeLongitude, altitude: 1.75 };
    globeRef.current?.pointOfView(target, playing ? 380 : 650);
  }, [cameraFollow, moon.latitude, moon.longitude, moon.antipodeLatitude, moon.antipodeLongitude, playing]);

  const visibleEvents = useMemo(() => (data?.events ?? []).filter((event) => {
    const time = new Date(event.time).getTime();
    return time >= windowStart && time <= windowEnd;
  }), [data, windowStart, windowEnd]);

  const points = useMemo(() => {
    const items: Array<
      | { kind: "event"; event: LunarEarthquake; lat: number; lng: number; altitude: number; radius: number; color: string }
      | { kind: "moon"; lat: number; lng: number; altitude: number; radius: number; color: string }
      | { kind: "antipode"; lat: number; lng: number; altitude: number; radius: number; color: string }
    > = visibleEvents.map((event) => ({
      kind: "event" as const,
      event,
      lat: event.latitude,
      lng: event.longitude,
      altitude: 0.018 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.08,
      radius: 0.14 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.32,
      color: earthquakeColor(event.magnitude),
    }));
    if (shadowMode === "direct" || shadowMode === "both") {
      items.push({ kind: "moon", lat: moon.latitude, lng: moon.longitude, altitude: 0.045, radius: 0.52, color: "#f8fafc" });
    }
    if (shadowMode === "antipode" || shadowMode === "both") {
      items.push({ kind: "antipode", lat: moon.antipodeLatitude, lng: moon.antipodeLongitude, altitude: 0.035, radius: 0.44, color: "#c084fc" });
    }
    return items;
  }, [visibleEvents, moon, shadowMode]);

  const shadowPolygons = useMemo(() => {
    const polygons: Array<{ id: string; color: string; geometry: { type: "Polygon"; coordinates: number[][][] } }> = [];
    if (shadowMode === "direct" || shadowMode === "both") {
      polygons.push({
        id: "sublunar-zone",
        color: "rgba(255,255,255,.18)",
        geometry: { type: "Polygon", coordinates: [circlePolygon(moon.latitude, moon.longitude, analysisRadiusKm)] },
      });
    }
    if (shadowMode === "antipode" || shadowMode === "both") {
      polygons.push({
        id: "antipode-zone",
        color: "rgba(192,132,252,.22)",
        geometry: { type: "Polygon", coordinates: [circlePolygon(moon.antipodeLatitude, moon.antipodeLongitude, analysisRadiusKm)] },
      });
    }
    return polygons;
  }, [moon, analysisRadiusKm, shadowMode]);

  const platePaths = useMemo<RenderPath[]>(() => (mapLayers?.plateBoundaries ?? []).map((path) => ({
    id: path.id,
    name: path.name,
    points: path.points.map((point) => ({ ...point, altitude: 0.012 })),
    color: "#22d3ee",
    stroke: 0.55,
    dashLength: 0.04,
    dashGap: 0.025,
  })), [mapLayers]);

  const lunarTrackPaths = useMemo<RenderPath[]>(() => {
    const moonPoints: Array<GlobeMapPoint & { altitude: number }> = [];
    const antipodePoints: Array<GlobeMapPoint & { altitude: number }> = [];
    const stepMs = HOUR_MS;
    for (let time = windowStart; time <= windowEnd; time += stepMs) {
      const position = lunarPosition(new Date(time));
      moonPoints.push({ lat: position.latitude, lng: position.longitude, altitude: 0.026 });
      antipodePoints.push({ lat: position.antipodeLatitude, lng: position.antipodeLongitude, altitude: 0.024 });
    }
    const endPosition = lunarPosition(new Date(windowEnd));
    moonPoints.push({ lat: endPosition.latitude, lng: endPosition.longitude, altitude: 0.026 });
    antipodePoints.push({ lat: endPosition.antipodeLatitude, lng: endPosition.antipodeLongitude, altitude: 0.024 });

    const paths: RenderPath[] = [];
    if (shadowMode === "direct" || shadowMode === "both") {
      paths.push({ id: "lunar-track", name: `Recorrido sublunar ${windowHours} h`, points: moonPoints, color: "#ffffff", stroke: 1.1, dashLength: 0.12, dashGap: 0.035 });
    }
    if (shadowMode === "antipode" || shadowMode === "both") {
      paths.push({ id: "antipode-track", name: `Recorrido antípoda ${windowHours} h`, points: antipodePoints, color: "#c084fc", stroke: 1.0, dashLength: 0.12, dashGap: 0.035 });
    }
    return paths;
  }, [windowStart, windowEnd, windowHours, shadowMode]);

  const displayPaths = useMemo(() => [...platePaths, ...lunarTrackPaths], [platePaths, lunarTrackPaths]);

  const proximity = useMemo(() => visibleEvents.map((event) => {
    const eventMoon = lunarPosition(new Date(event.time));
    const moonKm = greatCircleDistanceKm(event.latitude, event.longitude, eventMoon.latitude, eventMoon.longitude);
    const antipodeKm = greatCircleDistanceKm(event.latitude, event.longitude, eventMoon.antipodeLatitude, eventMoon.antipodeLongitude);
    const deltaMinutes = Math.round((new Date(event.time).getTime() - selectedTime) / 60_000);
    const closest = shadowMode === "direct"
      ? "sublunar"
      : shadowMode === "antipode"
        ? "antípoda"
        : moonKm <= antipodeKm ? "sublunar" : "antípoda";
    const closestKm = shadowMode === "direct" ? moonKm : shadowMode === "antipode" ? antipodeKm : Math.min(moonKm, antipodeKm);
    return { event, moonKm, antipodeKm, deltaMinutes, closestKm, closest };
  }).sort((a, b) => Math.abs(a.deltaMinutes) - Math.abs(b.deltaMinutes) || a.closestKm - b.closestKm), [visibleEvents, selectedTime, shadowMode]);

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
        <p style={{ maxWidth: 980 }}>Compara en 3D el recorrido del punto sublunar y/o su antípoda con los sismos que ocurrieron durante exactamente la misma ventana de 12 o 24 horas. Puedes estudiar por separado la cara directa, la opuesta o ambas.</p>
      </header>

      <div className="quality-warning"><strong>Lectura científica:</strong> las zonas blanca y violeta son áreas geométricas de análisis, no campos físicos ni zonas de peligro. La antípoda permite probar por separado la hipótesis de coincidencias en el lado opuesto de la Tierra. Una coincidencia temporal o espacial no demuestra causalidad.</div>

      <section className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
          <label>Rango disponible<select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ width: "100%" }}><option value={7}>7 días de historial</option><option value={14}>14 días de historial</option><option value={30}>30 días de historial</option></select><small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>Solo define cuánto tiempo puedes recorrer.</small></label>
          <label>Magnitud mínima<select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={{ width: "100%" }}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option></select></label>
          <label>Ventana Luna–sismos<select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value))} style={{ width: "100%" }}><option value={12}>12 h · ±6 h</option><option value={24}>24 h · ±12 h</option></select><small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>Ventana real de coincidencia.</small></label>
          <label>Sombra analizada<select value={shadowMode} onChange={(event) => setShadowMode(event.target.value as ShadowMode)} style={{ width: "100%" }}><option value="direct">Directa · punto sublunar</option><option value="antipode">Opuesta · antípoda</option><option value="both">Ambas</option></select><small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>Filtra la sombra, recorrido y métrica espacial.</small></label>
          <label>Seguir con la cámara<select value={cameraFollow} onChange={(event) => setCameraFollow(event.target.value as CameraFollow)} style={{ width: "100%" }}><option value="off">Libre · no rotar automáticamente</option><option value="direct">Seguir sombra directa</option><option value="antipode">Seguir sombra opuesta</option></select><small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>Rota suavemente el globo con el paso lunar.</small></label>
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
            pathsData={displayPaths}
            pathPoints="points"
            pathPointLat="lat"
            pathPointLng="lng"
            pathPointAlt="altitude"
            pathColor={(path: unknown) => (path as RenderPath).color}
            pathStroke={(path: unknown) => (path as RenderPath).stroke}
            pathDashLength={(path: unknown) => (path as RenderPath).dashLength}
            pathDashGap={(path: unknown) => (path as RenderPath).dashGap}
            pathTransitionDuration={0}
            enablePointerInteraction
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center", marginTop: 12 }}>
          <button type="button" onClick={() => setPlaying((value) => !value)} style={{ border: "1px solid rgba(56,189,248,.45)", borderRadius: 999, padding: "9px 15px", background: "rgba(56,189,248,.12)", color: "white" }}>{playing ? "Pausar" : "▶ Reproducir"}</button>
          <input type="range" min={startTime} max={endTime} step={30 * 60_000} value={Math.min(endTime, Math.max(startTime, selectedTime))} onChange={(event) => { setPlaying(false); setSelectedTime(Number(event.target.value)); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", marginTop: 8, color: "#94a3b8", fontSize: 13 }}>
          <span>Centro: {formatUtc(new Date(selectedTime))} UTC</span>
          <span>{visibleEvents.length} sismos en {windowHours} h · ±{windowHours / 2} h</span>
          <span>Cámara: {cameraFollow === "off" ? "libre" : cameraFollow === "direct" ? "siguiendo directa" : "siguiendo antípoda"}</span>
        </div>
        <div style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>Ventana mostrada: {formatUtc(new Date(windowStart))} → {formatUtc(new Date(windowEnd))} UTC.</div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10, marginTop: 14 }}>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Fase lunar</span><h2>{moon.phaseName}</h2><p>{(moon.illuminatedFraction * 100).toFixed(0)}% iluminada · fase {(moon.phaseFraction * 100).toFixed(1)}%</p></article>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Punto sublunar al centro</span><h2>{moon.latitude.toFixed(2)}°, {moon.longitude.toFixed(2)}°</h2><p>{shadowMode === "antipode" ? "Oculto en esta vista." : `La línea blanca muestra su recorrido durante ${windowHours} h.`}</p></article>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Antípoda al centro</span><h2>{moon.antipodeLatitude.toFixed(2)}°, {moon.antipodeLongitude.toFixed(2)}°</h2><p>{shadowMode === "direct" ? "Oculta en esta vista." : `La línea violeta muestra su recorrido durante ${windowHours} h.`}</p></article>
        <article className="panel" style={{ padding: 16 }}><span className="eyebrow">Sismos espacialmente cercanos</span><h2>{proximity.filter((item) => item.closestKm <= analysisRadiusKm).length}</h2><p>Eventos de las mismas {windowHours} h dentro del radio respecto a {shadowMode === "direct" ? "la sombra directa" : shadowMode === "antipode" ? "la antípoda" : "cualquiera de las dos sombras"} en la hora exacta del sismo.</p></article>
      </section>

      <section className="panel" style={{ marginTop: 14, padding: 18 }}>
        <span className="eyebrow">Coincidencia temporal de {windowHours} horas</span>
        <h2>Sismos ocurridos durante el mismo paso lunar</h2>
        <p style={{ color: "#94a3b8" }}>Se ordenan por cercanía temporal al centro seleccionado. La distancia espacial se calcula en la hora exacta del sismo y respeta la sombra elegida.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {proximity.slice(0, 12).map((item) => <button key={item.event.id} type="button" onClick={() => setSelectedEvent(item.event)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, textAlign: "left", border: "1px solid rgba(148,163,184,.18)", borderRadius: 12, padding: 11, background: "rgba(2,6,23,.35)", color: "#e8f1f5" }}><span><strong>M{item.event.magnitude.toFixed(1)} · {item.event.place}</strong><small style={{ display: "block", color: "#94a3b8", marginTop: 3 }}>{formatUtc(item.event.time)} UTC · Δt {item.deltaMinutes >= 0 ? "+" : ""}{item.deltaMinutes} min</small></span><span style={{ color: item.closestKm <= analysisRadiusKm ? "#fde68a" : "#94a3b8", whiteSpace: "nowrap" }}>{Math.round(item.closestKm).toLocaleString()} km · {item.closest}</span></button>)}
          {!proximity.length && <p>No hay sismos con los filtros actuales dentro de esta ventana de {windowHours} horas.</p>}
        </div>
      </section>

      {selectedEvent && selectedProximity && <section className="panel" style={{ marginTop: 14, padding: 18 }}><span className="eyebrow">Evento seleccionado</span><h2>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</h2><p>{formatUtc(selectedEvent.time)} UTC · profundidad {selectedEvent.depthKm.toFixed(1)} km.</p><p>En el instante exacto del sismo: <strong>{Math.round(selectedProximity.moonKm).toLocaleString()} km</strong> del punto sublunar y <strong>{Math.round(selectedProximity.antipodeKm).toLocaleString()} km</strong> de la antípoda. Estas distancias describen coincidencia geométrica y temporal; por sí solas no demuestran disparo sísmico.</p></section>}

      {loading && <div className="info-banner" style={{ marginTop: 14 }}>Cargando historial sísmico USGS…</div>}
      {error && <div className="warning-banner" style={{ marginTop: 14 }}>{error}</div>}
    </main>
  );
}
