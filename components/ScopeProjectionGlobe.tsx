"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { ScopeProjectionDestination, ScopeProjectionResponse } from "@/lib/scopeProjection";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";
const DEGREE_KM = 111.2;

interface RenderPoint {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
  label: string;
}

interface RenderArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
  label: string;
}

interface RenderRing {
  id: string;
  lat: number;
  lng: number;
  color: string;
  maxRadius: number;
  speed: number;
  repeatPeriod: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function probabilityColor(probability: number, alpha = 1) {
  if (probability >= 50) return `rgba(251,113,133,${alpha})`;
  if (probability >= 25) return `rgba(251,146,60,${alpha})`;
  if (probability >= 10) return `rgba(250,204,21,${alpha})`;
  if (probability >= 3) return `rgba(45,212,191,${alpha})`;
  return `rgba(125,211,252,${alpha})`;
}

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function destinationLabel(destination: ScopeProjectionDestination) {
  return `<div class="globe-tooltip"><strong>${escapeHtml(destination.name)} · ${pct(destination.probabilityPct)}</strong><span>Scope Projection</span><small>Base ${pct(destination.baselinePct)} · diferencia ${destination.liftPct >= 0 ? "+" : ""}${destination.liftPct.toFixed(2)} pp</small><small>EarthScope ${destination.earthScopeEvidencePct}% · ${destination.analogHits} análogo(s) con actividad posterior · ${destination.waveformConfirmedHits} con waveform confirmada</small><small>M${destination.magnitudeMin.toFixed(1)}–M${destination.magnitudeMax.toFixed(1)} · ventana hasta ${new Date(destination.surveillanceEnd).toLocaleDateString("es-DO", { timeZone: "UTC" })}</small><small>Recurrencia histórica ponderada; no certeza de ocurrencia.</small></div>`;
}

export function ScopeProjectionGlobe({ data }: { data: ScopeProjectionResponse }) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 960, height: 650 });
  const [showDestinations, setShowDestinations] = useState(true);
  const [showAnalogs, setShowAnalogs] = useState(true);
  const [showLinks, setShowLinks] = useState(true);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(520, Math.min(780, element.clientWidth * 0.7)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
    }
    globeRef.current?.pointOfView({
      lat: data.source.latitude,
      lng: data.source.longitude,
      altitude: 2.15,
    }, 850);
  }, [data.generatedAt, data.source.latitude, data.source.longitude]);

  const destinationPoints = useMemo<RenderPoint[]>(() => showDestinations
    ? data.destinations.slice(0, 24).map((destination) => ({
        id: destination.id,
        lat: destination.latitude,
        lng: destination.longitude,
        altitude: 0.055 + clamp(destination.probabilityPct / 100, 0, 1) * 0.15,
        radius: 0.16 + clamp(destination.probabilityPct / 65, 0, 1) * 0.42,
        color: probabilityColor(destination.probabilityPct, 1),
        label: destinationLabel(destination),
      }))
    : [], [data.destinations, showDestinations]);

  const analogPoints = useMemo<RenderPoint[]>(() => showAnalogs
    ? data.analogs.map((analog) => ({
        id: `analog:${analog.event.id}`,
        lat: analog.event.latitude,
        lng: analog.event.longitude,
        altitude: 0.035 + clamp(analog.similarityPct / 100, 0, 1) * 0.08,
        radius: 0.10 + clamp(analog.similarityPct / 100, 0, 1) * 0.22,
        color: analog.waveformConfirmed ? "#f59e0b" : analog.earthScopeEvidencePct >= 35 ? "#fbbf24" : "rgba(203,213,225,.72)",
        label: `<div class="globe-tooltip"><strong>Análogo histórico · M${analog.event.magnitude.toFixed(1)}</strong><span>${escapeHtml(analog.event.place)}</span><small>Similitud ${analog.similarityPct}% · evidencia EarthScope ${analog.earthScopeEvidencePct}%</small><small>${analog.stationCount} estaciones · ${analog.waveformConfirmed ? `waveform ${escapeHtml(analog.waveformStation ?? "confirmada")}` : analog.waveformChecked ? "waveform no confirmada" : "waveform no sondeada"}</small></div>`,
      }))
    : [], [data.analogs, showAnalogs]);

  const sourcePoint = useMemo<RenderPoint>(() => ({
    id: "scope-source",
    lat: data.source.latitude,
    lng: data.source.longitude,
    altitude: 0.16,
    radius: 0.52,
    color: "#facc15",
    label: `<div class="globe-tooltip"><strong>Evento precedente · M${data.source.magnitude.toFixed(1)}</strong><span>${escapeHtml(data.source.place)}</span><small>${new Date(data.source.time).toLocaleString("es-DO", { timeZone: "UTC" })} UTC · ${data.source.depthKm.toFixed(0)} km</small><small>Desde este evento se construyen los análogos históricos Scope.</small></div>`,
  }), [data.source]);

  const arcs = useMemo<RenderArc[]>(() => showLinks
    ? data.destinations.slice(0, 18).map((destination) => ({
        id: `arc:${destination.id}`,
        startLat: data.source.latitude,
        startLng: data.source.longitude,
        endLat: destination.latitude,
        endLng: destination.longitude,
        color: probabilityColor(destination.probabilityPct, 0.82),
        stroke: 0.35 + clamp(destination.probabilityPct / 55, 0, 1) * 1.4,
        dashLength: 0.055,
        dashGap: 0.022,
        label: destinationLabel(destination),
      }))
    : [], [data.destinations, data.source.latitude, data.source.longitude, showLinks]);

  const rings = useMemo<RenderRing[]>(() => showDestinations
    ? data.destinations.slice(0, 18).map((destination) => ({
        id: `ring:${destination.id}`,
        lat: destination.latitude,
        lng: destination.longitude,
        color: probabilityColor(destination.probabilityPct, 0.72),
        maxRadius: clamp(destination.radiusKm / DEGREE_KM, 1.0, 10),
        speed: 0.65 + clamp(destination.probabilityPct / 100, 0, 1) * 0.8,
        repeatPeriod: 2_000 + Math.round((1 - clamp(destination.probabilityPct / 100, 0, 1)) * 1_800),
      }))
    : [], [data.destinations, showDestinations]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 520, position: "relative" }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.18}
        showGraticules
        pointsData={[sourcePoint, ...destinationPoints, ...analogPoints]}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => String((point as RenderPoint).label)}
        pointsTransitionDuration={400}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke="stroke"
        arcDashLength="dashLength"
        arcDashGap="dashGap"
        arcDashAnimateTime={2_400}
        arcLabel={(arc) => String((arc as RenderArc).label)}
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={(ring: unknown) => [String((ring as RenderRing).color), "rgba(255,255,255,0)"]}
        ringMaxRadius={(ring: unknown) => (ring as RenderRing).maxRadius}
        ringPropagationSpeed={(ring: unknown) => (ring as RenderRing).speed}
        ringRepeatPeriod={(ring: unknown) => (ring as RenderRing).repeatPeriod}
        enablePointerInteraction
      />

      <div style={{
        position: "absolute",
        left: 12,
        top: 12,
        maxWidth: 455,
        padding: "10px 12px",
        border: "1px solid rgba(125,211,252,.28)",
        borderRadius: 12,
        background: "rgba(7,16,24,.87)",
        backdropFilter: "blur(10px)",
        color: "#e8f1f5",
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        <strong>Scope Projection · ocurrencia histórica</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <button type="button" onClick={() => setShowDestinations((value) => !value)} style={{ opacity: showDestinations ? 1 : .5 }}>Proyecciones</button>
          <button type="button" onClick={() => setShowLinks((value) => !value)} style={{ opacity: showLinks ? 1 : .5 }}>Conexiones</button>
          <button type="button" onClick={() => setShowAnalogs((value) => !value)} style={{ opacity: showAnalogs ? 1 : .5 }}>Análogos</button>
        </div>
        <div style={{ marginTop: 7, color: "#aebfca" }}>
          <span style={{ color: "#fb7185" }}>● prob. alta</span> · <span style={{ color: "#facc15" }}>● intermedia</span> · <span style={{ color: "#7dd3fc" }}>● baja</span><br />
          <span style={{ color: "#f59e0b" }}>● análogo con waveform EarthScope</span> · <span style={{ color: "#facc15" }}>● precedente</span>
        </div>
        <div style={{ marginTop: 6, color: "#fde68a" }}>Las líneas indican asociación histórica del modelo; no muestran una ruta física de energía ni causalidad.</div>
      </div>

      <div style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        maxWidth: 380,
        padding: "9px 11px",
        border: "1px solid rgba(125,211,252,.28)",
        borderRadius: 12,
        background: "rgba(7,16,24,.87)",
        color: "#dbeafe",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "none",
      }}>
        <strong>{data.destinations.length} destinos Scope</strong><br />
        {data.analogsEvaluated} análogos · {data.earthScopeSupportedAnalogs} con soporte EarthScope<br />
        <span style={{ color: "#aebfca" }}>Calidad de evidencia: {data.evidenceQualityPct}% · modelo {data.model}</span>
      </div>
    </div>
  );
}
