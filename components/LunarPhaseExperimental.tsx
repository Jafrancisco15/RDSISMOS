"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { circlePolygon, greatCircleDistanceKm, lunarPosition } from "@/lib/lunar";
import type { GlobeMapLayersResponse, GlobeMapPoint } from "@/lib/globeLayers";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const HOUR_MS = 3_600_000;

type ShadowMode = "direct" | "antipode" | "both";
type CameraFollow = "off" | "direct" | "antipode";
type CoincidenceKind = "none" | "direct" | "antipode" | "both";

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

interface EventAnalysis {
  event: LunarEarthquake;
  moonKm: number;
  antipodeKm: number;
  deltaMinutes: number;
  directHit: boolean;
  antipodeHit: boolean;
  coincidence: CoincidenceKind;
  closestKm: number;
  closest: "sublunar" | "antípoda";
}

function formatUtc(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function coincidenceLabel(kind: CoincidenceKind) {
  if (kind === "direct") return "DIRECTA";
  if (kind === "antipode") return "ANTÍPODA";
  if (kind === "both") return "AMBAS";
  return "—";
}

function coincidenceColor(kind: CoincidenceKind) {
  if (kind === "direct") return "#facc15";
  if (kind === "antipode") return "#c084fc";
  if (kind === "both") return "#fb7185";
  return "#ef4444";
}

function eventLabel(event: LunarEarthquake, analysis?: EventAnalysis) {
  const extra = analysis && analysis.coincidence !== "none"
    ? `<small>Coincidencia ${coincidenceLabel(analysis.coincidence).toLowerCase()} · directa ${Math.round(analysis.moonKm).toLocaleString()} km · antípoda ${Math.round(analysis.antipodeKm).toLocaleString()} km</small>`
    : "";
  return `<div class="globe-tooltip"><strong>M${event.magnitude.toFixed(1)} · ${event.place}</strong><span>${formatUtc(event.time)} UTC</span><small>${event.depthKm.toFixed(0)} km de profundidad</small>${extra}</div>`;
}

const panelStyle = { border: "1px solid rgba(148,163,184,.18)", borderRadius: 16, background: "rgba(5,12,23,.88)", boxShadow: "0 16px 50px rgba(0,0,0,.18)" } as const;
const labelStyle = { display: "grid", gap: 6, fontSize: 12, color: "#cbd5e1", textTransform: "uppercase" as const, letterSpacing: ".06em" };
const selectStyle = { width: "100%", padding: "9px 10px", borderRadius: 10, border: "1px solid rgba(148,163,184,.2)", background: "#0b1320", color: "#e2e8f0" };

export function LunarPhaseExperimental() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 720 });
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
    const update = () => setSize({ width: Math.max(320, element.clientWidth), height: Math.max(540, Math.min(820, element.clientWidth * 0.78)) });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 8, lng: -20, altitude: 2.05 }, 900);
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
      ? { lat: moon.latitude, lng: moon.longitude, altitude: 1.72 }
      : { lat: moon.antipodeLatitude, lng: moon.antipodeLongitude, altitude: 1.72 };
    globeRef.current?.pointOfView(target, playing ? 380 : 650);
  }, [cameraFollow, moon.latitude, moon.longitude, moon.antipodeLatitude, moon.antipodeLongitude, playing]);

  const visibleEvents = useMemo(() => (data?.events ?? []).filter((event) => {
    const time = new Date(event.time).getTime();
    return time >= windowStart && time <= windowEnd;
  }), [data, windowStart, windowEnd]);

  const analysis = useMemo<EventAnalysis[]>(() => visibleEvents.map((event) => {
    const eventMoon = lunarPosition(new Date(event.time));
    const moonKm = greatCircleDistanceKm(event.latitude, event.longitude, eventMoon.latitude, eventMoon.longitude);
    const antipodeKm = greatCircleDistanceKm(event.latitude, event.longitude, eventMoon.antipodeLatitude, eventMoon.antipodeLongitude);
    const directHit = moonKm <= analysisRadiusKm;
    const antipodeHit = antipodeKm <= analysisRadiusKm;
    const coincidence: CoincidenceKind = directHit && antipodeHit ? "both" : directHit ? "direct" : antipodeHit ? "antipode" : "none";
    const deltaMinutes = Math.round((new Date(event.time).getTime() - selectedTime) / 60_000);
    const closest = shadowMode === "direct" ? "sublunar" : shadowMode === "antipode" ? "antípoda" : moonKm <= antipodeKm ? "sublunar" : "antípoda";
    const closestKm = shadowMode === "direct" ? moonKm : shadowMode === "antipode" ? antipodeKm : Math.min(moonKm, antipodeKm);
    return { event, moonKm, antipodeKm, directHit, antipodeHit, coincidence, deltaMinutes, closest, closestKm };
  }).sort((a, b) => Math.abs(a.deltaMinutes) - Math.abs(b.deltaMinutes) || a.closestKm - b.closestKm), [visibleEvents, selectedTime, analysisRadiusKm, shadowMode]);

  const analysisById = useMemo(() => new Map(analysis.map((item) => [item.event.id, item])), [analysis]);
  const directCount = analysis.filter((item) => item.directHit).length;
  const antipodeCount = analysis.filter((item) => item.antipodeHit).length;
  const bothCount = analysis.filter((item) => item.directHit && item.antipodeHit).length;

  const points = useMemo(() => {
    const items: Array<
      | { kind: "event"; event: LunarEarthquake; lat: number; lng: number; altitude: number; radius: number; color: string }
      | { kind: "moon"; lat: number; lng: number; altitude: number; radius: number; color: string }
      | { kind: "antipode"; lat: number; lng: number; altitude: number; radius: number; color: string }
    > = visibleEvents.map((event) => {
      const item = analysisById.get(event.id);
      return {
        kind: "event" as const,
        event,
        lat: event.latitude,
        lng: event.longitude,
        altitude: item?.coincidence === "none" ? 0.014 : 0.019,
        radius: item?.coincidence === "none" ? 0.28 : 0.43,
        color: coincidenceColor(item?.coincidence ?? "none"),
      };
    });
    if (shadowMode === "direct" || shadowMode === "both") items.push({ kind: "moon", lat: moon.latitude, lng: moon.longitude, altitude: 0.045, radius: 0.48, color: "#f8fafc" });
    if (shadowMode === "antipode" || shadowMode === "both") items.push({ kind: "antipode", lat: moon.antipodeLatitude, lng: moon.antipodeLongitude, altitude: 0.04, radius: 0.46, color: "#c084fc" });
    return items;
  }, [visibleEvents, analysisById, moon, shadowMode]);

  const rings = useMemo(() => analysis.filter((item) => item.coincidence !== "none").map((item) => ({
    lat: item.event.latitude,
    lng: item.event.longitude,
    color: coincidenceColor(item.coincidence),
    maxRadius: item.coincidence === "both" ? 2.8 : 2.3,
    propagationSpeed: item.coincidence === "both" ? 1.1 : 0.75,
    repeatPeriod: item.coincidence === "both" ? 900 : 1300,
  })), [analysis]);

  const shadowPolygons = useMemo(() => {
    const polygons: Array<{ id: string; color: string; geometry: { type: "Polygon"; coordinates: number[][][] } }> = [];
    if (shadowMode === "direct" || shadowMode === "both") polygons.push({ id: "sublunar-zone", color: "rgba(248,250,252,.16)", geometry: { type: "Polygon", coordinates: [circlePolygon(moon.latitude, moon.longitude, analysisRadiusKm)] } });
    if (shadowMode === "antipode" || shadowMode === "both") polygons.push({ id: "antipode-zone", color: "rgba(192,132,252,.20)", geometry: { type: "Polygon", coordinates: [circlePolygon(moon.antipodeLatitude, moon.antipodeLongitude, analysisRadiusKm)] } });
    return polygons;
  }, [moon, analysisRadiusKm, shadowMode]);

  const platePaths = useMemo<RenderPath[]>(() => (mapLayers?.plateBoundaries ?? []).map((path) => ({
    id: path.id,
    name: path.name,
    points: path.points.map((point) => ({ ...point, altitude: 0.009 })),
    color: "#ef4444",
    stroke: 0.42,
    dashLength: 0,
    dashGap: 0,
  })), [mapLayers]);

  const lunarTrackPaths = useMemo<RenderPath[]>(() => {
    const moonPoints: Array<GlobeMapPoint & { altitude: number }> = [];
    const antipodePoints: Array<GlobeMapPoint & { altitude: number }> = [];
    for (let time = windowStart; time <= windowEnd; time += HOUR_MS) {
      const position = lunarPosition(new Date(time));
      moonPoints.push({ lat: position.latitude, lng: position.longitude, altitude: 0.026 });
      antipodePoints.push({ lat: position.antipodeLatitude, lng: position.antipodeLongitude, altitude: 0.024 });
    }
    const endPosition = lunarPosition(new Date(windowEnd));
    moonPoints.push({ lat: endPosition.latitude, lng: endPosition.longitude, altitude: 0.026 });
    antipodePoints.push({ lat: endPosition.antipodeLatitude, lng: endPosition.antipodeLongitude, altitude: 0.024 });
    const paths: RenderPath[] = [];
    if (shadowMode === "direct" || shadowMode === "both") paths.push({ id: "lunar-track", name: `Recorrido sublunar ${windowHours} h`, points: moonPoints, color: "#f8fafc", stroke: 0.9, dashLength: 0.12, dashGap: 0.035 });
    if (shadowMode === "antipode" || shadowMode === "both") paths.push({ id: "antipode-track", name: `Recorrido antípoda ${windowHours} h`, points: antipodePoints, color: "#c084fc", stroke: 0.95, dashLength: 0.12, dashGap: 0.035 });
    return paths;
  }, [windowStart, windowEnd, windowHours, shadowMode]);

  const displayPaths = useMemo(() => [...platePaths, ...lunarTrackPaths], [platePaths, lunarTrackPaths]);
  const selectedProximity = selectedEvent ? analysisById.get(selectedEvent.id) ?? null : null;

  return (
    <main style={{ maxWidth: 1540, margin: "0 auto", padding: "18px clamp(10px,2vw,24px) 34px", color: "#e5edf5" }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "end", marginBottom: 14 }}>
        <div><div className="brand-line"><span className="pulse-dot" /> RDSISMOS · EXPERIMENTAL</div><h1 style={{ marginBottom: 4 }}>Lunar Phase Experimental</h1><p style={{ maxWidth: 850, margin: 0, color: "#94a3b8" }}>Análisis exploratorio de coincidencia temporal y espacial entre el recorrido lunar, su antípoda y la sismicidad observada.</p></div>
        <div style={{ ...panelStyle, padding: "10px 14px", minWidth: 220, textAlign: "center" }}><strong>{formatUtc(new Date(selectedTime))} UTC</strong><small style={{ display: "block", color: "#64748b", marginTop: 4 }}>Centro de la ventana</small></div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
        {[
          ["Sismos en ventana", analysis.length, "#ef4444"],
          ["Coincidencia directa", directCount, "#facc15"],
          ["Coincidencia antípoda", antipodeCount, "#c084fc"],
          ["Coincidencia ambas", bothCount, "#fb7185"],
        ].map(([label, value, color]) => <article key={String(label)} style={{ ...panelStyle, padding: 14, textAlign: "center" }}><div style={{ color: String(color), fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div><strong style={{ display: "block", fontSize: 27, marginTop: 4 }}>{value}</strong><small style={{ color: "#64748b" }}>radio ≤ {analysisRadiusKm.toLocaleString()} km</small></article>)}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(230px,280px) minmax(0,1fr)", gap: 12, alignItems: "start" }}>
        <aside style={{ ...panelStyle, padding: 14, display: "grid", gap: 14 }}>
          <div><strong style={{ fontSize: 13 }}>VENTANA LUNA–SISMOS</strong><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>{[12,24].map((hours) => <button key={hours} type="button" onClick={() => setWindowHours(hours)} style={{ padding: 10, borderRadius: 9, border: windowHours === hours ? "1px solid #3b82f6" : "1px solid rgba(148,163,184,.18)", background: windowHours === hours ? "#0b4ea2" : "#101824", color: "white" }}>{hours} horas<br/><small>± {hours / 2} h</small></button>)}</div></div>
          <label style={labelStyle}>Rango disponible<select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle}><option value={7}>7 días</option><option value={14}>14 días</option><option value={30}>30 días</option></select></label>
          <label style={labelStyle}>Sombra analizada<select value={shadowMode} onChange={(e) => setShadowMode(e.target.value as ShadowMode)} style={selectStyle}><option value="direct">Directa · punto sublunar</option><option value="antipode">Opuesta · antípoda</option><option value="both">Ambas sombras</option></select></label>
          <label style={labelStyle}>Seguir con cámara<select value={cameraFollow} onChange={(e) => setCameraFollow(e.target.value as CameraFollow)} style={selectStyle}><option value="off">Libre</option><option value="direct">Seguir sombra directa</option><option value="antipode">Seguir antípoda</option></select></label>
          <label style={labelStyle}>Magnitud mínima<select value={minMagnitude} onChange={(e) => setMinMagnitude(Number(e.target.value))} style={selectStyle}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option></select></label>
          <label style={labelStyle}>Radio de coincidencia<select value={analysisRadiusKm} onChange={(e) => setAnalysisRadiusKm(Number(e.target.value))} style={selectStyle}><option value={1000}>1,000 km</option><option value={1800}>1,800 km</option><option value={3000}>3,000 km</option></select></label>
          <div style={{ borderTop: "1px solid rgba(148,163,184,.14)", paddingTop: 12, display: "grid", gap: 7, fontSize: 12, color: "#cbd5e1" }}><strong>LEYENDA</strong><span>🔴 Sismo en la ventana</span><span style={{ color: "#facc15" }}>◉ Coincidencia directa</span><span style={{ color: "#c084fc" }}>◉ Coincidencia antípoda</span><span style={{ color: "#fb7185" }}>◉ Coincidencia con ambas</span><span>▬ Recorrido directo</span><span style={{ color: "#c084fc" }}>▬ Recorrido antípoda</span></div>
        </aside>

        <div style={{ minWidth: 0 }}>
          <div style={{ ...panelStyle, overflow: "hidden", padding: 8 }}>
            <div ref={containerRef} style={{ width: "100%", minHeight: 540, borderRadius: 13, overflow: "hidden", background: "radial-gradient(circle at 50% 35%,#10243b,#030711 68%)" }}>
              <Globe ref={globeRef} width={size.width} height={size.height} globeImageUrl={EARTH_TEXTURE} backgroundColor="rgba(0,0,0,0)" atmosphereColor="#8ccff5" atmosphereAltitude={0.14} showGraticules polygonsData={shadowPolygons} polygonGeoJsonGeometry="geometry" polygonCapColor={(item: unknown) => String((item as { color: string }).color)} polygonSideColor={() => "rgba(255,255,255,.02)"} polygonStrokeColor={() => "rgba(255,255,255,.28)"} polygonAltitude={0.005} pointsData={points} pointLat="lat" pointLng="lng" pointAltitude="altitude" pointRadius="radius" pointColor="color" pointResolution={24} pointLabel={(point: unknown) => { const item = point as (typeof points)[number]; if (item.kind === "moon") return `<div class="globe-tooltip"><strong>Punto sublunar</strong></div>`; if (item.kind === "antipode") return `<div class="globe-tooltip"><strong>Antípoda lunar</strong></div>`; return eventLabel(item.event, analysisById.get(item.event.id)); }} onPointClick={(point: unknown) => { const item = point as (typeof points)[number]; if (item.kind === "event") setSelectedEvent(item.event); }} ringsData={rings} ringLat="lat" ringLng="lng" ringColor={(item: unknown) => String((item as { color: string }).color)} ringMaxRadius="maxRadius" ringPropagationSpeed="propagationSpeed" ringRepeatPeriod="repeatPeriod" pathsData={displayPaths} pathPoints="points" pathPointLat="lat" pathPointLng="lng" pathPointAlt="altitude" pathColor={(path: unknown) => (path as RenderPath).color} pathStroke={(path: unknown) => (path as RenderPath).stroke} pathDashLength={(path: unknown) => (path as RenderPath).dashLength} pathDashGap={(path: unknown) => (path as RenderPath).dashGap} pathTransitionDuration={0} enablePointerInteraction />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "10px 8px 4px" }}><button type="button" onClick={() => setPlaying((v) => !v)} style={{ border: "1px solid #2563eb", background: "#0b4ea2", color: "white", borderRadius: 999, width: 42, height: 42 }}>{playing ? "Ⅱ" : "▶"}</button><input type="range" min={startTime} max={endTime} step={30 * 60_000} value={Math.min(endTime, Math.max(startTime, selectedTime))} onChange={(e) => { setPlaying(false); setSelectedTime(Number(e.target.value)); }} /><span style={{ fontSize: 12, color: "#94a3b8" }}>{windowHours} h</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: "0 8px 8px", fontSize: 12, color: "#64748b" }}><span>{formatUtc(new Date(windowStart))} → {formatUtc(new Date(windowEnd))} UTC</span><span>{cameraFollow === "off" ? "Cámara libre" : cameraFollow === "direct" ? "Siguiendo directa" : "Siguiendo antípoda"}</span></div>
          </div>

          <section style={{ ...panelStyle, marginTop: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(148,163,184,.14)" }}><strong>SISMOS EN LA VENTANA ({windowHours} HORAS)</strong><small style={{ display: "block", color: "#64748b", marginTop: 3 }}>Distancias calculadas con la posición lunar exacta en la hora de cada sismo.</small></div>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 760 }}><thead><tr style={{ color: "#94a3b8", textAlign: "left" }}><th style={{ padding: 10 }}>UTC</th><th>Mag</th><th>Ubicación</th><th>Δt</th><th>Directa</th><th>Antípoda</th><th>Coincidencia</th></tr></thead><tbody>{analysis.slice(0,30).map((item) => <tr key={item.event.id} onClick={() => setSelectedEvent(item.event)} style={{ borderTop: "1px solid rgba(148,163,184,.09)", cursor: "pointer" }}><td style={{ padding: 10, whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#ef4444", marginRight: 7 }} />{formatUtc(item.event.time)}</td><td>M{item.event.magnitude.toFixed(1)}</td><td>{item.event.place}</td><td>{item.deltaMinutes >= 0 ? "+" : ""}{item.deltaMinutes}m</td><td>{Math.round(item.moonKm).toLocaleString()} km</td><td>{Math.round(item.antipodeKm).toLocaleString()} km</td><td><span style={{ color: coincidenceColor(item.coincidence), fontWeight: 700 }}>{coincidenceLabel(item.coincidence)}</span></td></tr>)}{!analysis.length && <tr><td colSpan={7} style={{ padding: 18, color: "#64748b" }}>No hay sismos con los filtros actuales dentro de esta ventana.</td></tr>}</tbody></table></div>
          </section>
        </div>
      </section>

      {selectedEvent && selectedProximity && <section style={{ ...panelStyle, marginTop: 12, padding: 14 }}><strong>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</strong><p style={{ margin: "6px 0 0", color: "#94a3b8" }}>{formatUtc(selectedEvent.time)} UTC · {selectedEvent.depthKm.toFixed(1)} km de profundidad · directa {Math.round(selectedProximity.moonKm).toLocaleString()} km · antípoda {Math.round(selectedProximity.antipodeKm).toLocaleString()} km · <span style={{ color: coincidenceColor(selectedProximity.coincidence) }}>{coincidenceLabel(selectedProximity.coincidence)}</span>.</p></section>}
      <div className="quality-warning" style={{ marginTop: 12 }}><strong>Experimental:</strong> las sombras representan radios geométricos de análisis. Una coincidencia espacial/temporal no demuestra que la Luna haya causado o disparado un terremoto.</div>
      {loading && <div className="info-banner" style={{ marginTop: 12 }}>Cargando historial sísmico USGS…</div>}
      {error && <div className="warning-banner" style={{ marginTop: 12 }}>{error}</div>}
      <style>{`@media (max-width: 900px){main > section:nth-of-type(2){grid-template-columns:1fr!important} main > section:first-of-type{grid-template-columns:repeat(2,minmax(0,1fr))!important}} @media (max-width:560px){main > section:first-of-type{grid-template-columns:1fr 1fr!important}}`}</style>
    </main>
  );
}
