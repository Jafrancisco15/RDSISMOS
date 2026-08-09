"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { TectonicSimulationWithAnalogs } from "@/lib/tectonicAnalogs";
import type { TectonicInteraction, TectonicSimulationResponse } from "@/lib/tectonicSimulator";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";
const DEGREE_KM = 111.2;

interface RenderPath {
  id: string;
  name: string;
  kind: string;
  stressState: string;
  stressProxyKpa: number;
  responseScore: number;
  points: Array<{ lat: number; lng: number; altitude: number }>;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
}

interface RenderPoint {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
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

function formatHistoricalDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function stressColor(state: TectonicInteraction["stressState"]) {
  if (state === "promoted") return "#fb7185";
  if (state === "inhibited") return "#38bdf8";
  return "rgba(203,213,225,.62)";
}

function analogColor(score: number) {
  if (score >= 82) return "#fb923c";
  if (score >= 68) return "#f59e0b";
  return "#fbbf24";
}

function endpoint(latitude: number, longitude: number, bearingDeg: number, distanceKm: number) {
  const angularDistance = distanceKm / 6_371;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
      + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    lat: lat2 * 180 / Math.PI,
    lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180,
  };
}

function pathLabel(path: RenderPath) {
  if (path.stressState === "source") {
    return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>Ruptura fuente aproximada</span></div>`;
  }
  const state = path.stressState === "promoted"
    ? "favorecido"
    : path.stressState === "inhibited"
      ? "sombra relativa"
      : "cambio pequeño";
  return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>${escapeHtml(path.kind)} · ${state}</span><small>ΔCFS proxy ${path.stressProxyKpa > 0 ? "+" : ""}${path.stressProxyKpa.toFixed(1)} kPa · respuesta ${path.responseScore}%</small></div>`;
}

export function TectonicSimulatorGlobe({
  simulation,
  onPickLocation,
}: {
  simulation: TectonicSimulationResponse;
  onPickLocation: (latitude: number, longitude: number) => void;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 650 });
  const enriched = simulation as TectonicSimulationResponse & Partial<TectonicSimulationWithAnalogs>;
  const historicalAnalogs = enriched.historicalAnalogs ?? [];
  const historicalCatalog = enriched.historicalCatalog ?? null;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(500, Math.min(760, element.clientWidth * 0.72)),
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
      lat: simulation.input.latitude,
      lng: simulation.input.longitude,
      altitude: simulation.source.interactionRadiusKm > 1_500 ? 2.0 : 1.45,
    }, 850);
  }, [simulation.generatedAt, simulation.input.latitude, simulation.input.longitude, simulation.source.interactionRadiusKm]);

  const paths = useMemo<RenderPath[]>(() => {
    const interactionPaths: RenderPath[] = simulation.interactions.map((interaction) => {
      const strength = clamp(interaction.responseScore / 100, 0, 1);
      const isFault = interaction.kind === "active-fault";
      return {
        id: interaction.id,
        name: interaction.name,
        kind: isFault ? "Falla activa" : "Límite de placa",
        stressState: interaction.stressState,
        stressProxyKpa: interaction.stressProxyKpa,
        responseScore: interaction.responseScore,
        points: interaction.points.map((point) => ({
          ...point,
          altitude: (isFault ? 0.017 : 0.013) + strength * 0.012,
        })),
        color: stressColor(interaction.stressState),
        stroke: (isFault ? 0.55 : 0.42) + strength * (isFault ? 1.45 : 1.05),
        dashLength: interaction.stressState === "neutral" ? 0.025 : 0.055,
        dashGap: interaction.stressState === "neutral" ? 0.035 : 0.018,
      };
    });
    const halfLength = simulation.source.ruptureLengthKm / 2;
    const sourceA = endpoint(
      simulation.input.latitude,
      simulation.input.longitude,
      simulation.input.strikeDeg,
      halfLength,
    );
    const sourceB = endpoint(
      simulation.input.latitude,
      simulation.input.longitude,
      simulation.input.strikeDeg + 180,
      halfLength,
    );
    interactionPaths.push({
      id: "source-rupture",
      name: "Ruptura fuente aproximada",
      kind: "Fuente",
      stressState: "source",
      stressProxyKpa: 0,
      responseScore: 100,
      points: [
        { ...sourceA, altitude: 0.031 },
        { ...sourceB, altitude: 0.031 },
      ],
      color: "#facc15",
      stroke: 1.8,
      dashLength: 1,
      dashGap: 0,
    });
    return interactionPaths;
  }, [simulation]);

  const receivers = useMemo<RenderPoint[]>(() => simulation.interactions.slice(0, 40).map((interaction) => ({
    id: `receiver:${interaction.id}`,
    lat: interaction.closestPoint.lat,
    lng: interaction.closestPoint.lng,
    altitude: 0.045 + clamp(interaction.responseScore / 100, 0, 1) * 0.11,
    radius: 0.13 + clamp(interaction.responseScore / 100, 0, 1) * 0.34,
    color: stressColor(interaction.stressState),
    label: `<div class="globe-tooltip"><strong>${escapeHtml(interaction.name)}</strong><span>${interaction.stressState === "promoted" ? "Favorecida" : interaction.stressState === "inhibited" ? "Sombra relativa" : "Cambio pequeño"}</span><small>${interaction.distanceKm.toFixed(0)} km · ${interaction.stressProxyKpa > 0 ? "+" : ""}${interaction.stressProxyKpa.toFixed(1)} kPa · respuesta ${interaction.responseScore}%</small></div>`,
  })), [simulation.interactions]);

  const analogPoints = useMemo<RenderPoint[]>(() => historicalAnalogs.map((analog) => ({
    id: `historical-analog:${analog.id}`,
    lat: analog.latitude,
    lng: analog.longitude,
    altitude: 0.032 + clamp((analog.magnitude - 5.9) / 2.6, 0, 1) * 0.075,
    radius: 0.14 + clamp((analog.magnitude - 5.9) / 2.6, 0, 1) * 0.28,
    color: analogColor(analog.similarityScore),
    label: `<div class="globe-tooltip"><strong>Sismo histórico real · M${analog.magnitude.toFixed(1)}</strong><span>${escapeHtml(analog.place)}</span><small>${formatHistoricalDate(analog.timeUtc)} · ${analog.depthKm.toFixed(0)} km profundidad · similitud ${analog.similarityScore}% · ${analog.distanceKm.toFixed(0)} km del escenario · USGS</small></div>`,
  })), [historicalAnalogs]);

  const sourcePoint = useMemo<RenderPoint>(() => ({
    id: "simulated-source",
    lat: simulation.input.latitude,
    lng: simulation.input.longitude,
    altitude: 0.13,
    radius: 0.46,
    color: "#facc15",
    label: `<div class="globe-tooltip"><strong>Sismo simulado · Mw ${simulation.input.magnitude.toFixed(1)}</strong><span>${simulation.input.depthKm.toFixed(0)} km profundidad · ${simulation.input.mechanism}</span><small>Strike ${simulation.input.strikeDeg.toFixed(0)}° · dip ${simulation.input.dipDeg.toFixed(0)}° · rake ${simulation.input.rakeDeg.toFixed(0)}°</small></div>`,
  }), [simulation]);

  const arcs = useMemo(() => simulation.interactions.slice(0, 24).map((interaction) => ({
    id: `arc:${interaction.id}`,
    startLat: simulation.input.latitude,
    startLng: simulation.input.longitude,
    endLat: interaction.closestPoint.lat,
    endLng: interaction.closestPoint.lng,
    color: stressColor(interaction.stressState),
    altitude: 0.12 + clamp(interaction.distanceKm / 2_500, 0, 1) * 0.22,
  })), [simulation]);

  const rings = useMemo<RenderRing[]>(() => {
    const source: RenderRing = {
      id: "source-wave",
      lat: simulation.input.latitude,
      lng: simulation.input.longitude,
      color: "#facc15",
      maxRadius: clamp(simulation.source.interactionRadiusKm / DEGREE_KM, 2.5, 24),
      speed: 1.15,
      repeatPeriod: 1_550,
    };
    const reactions = simulation.interactions
      .filter((interaction) => interaction.stressState !== "neutral")
      .slice(0, 28)
      .map((interaction): RenderRing => ({
        id: `reaction-ring:${interaction.id}`,
        lat: interaction.closestPoint.lat,
        lng: interaction.closestPoint.lng,
        color: stressColor(interaction.stressState),
        maxRadius: 0.7 + clamp(interaction.responseScore / 100, 0, 1) * 2.6,
        speed: 0.45 + clamp(interaction.responseScore / 100, 0, 1) * 0.75,
        repeatPeriod: 1_900 + Math.round((1 - clamp(interaction.responseScore / 100, 0, 1)) * 1_600),
      }));
    return [source, ...reactions];
  }, [simulation]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 500, position: "relative" }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.18}
        showGraticules
        pathsData={paths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor="color"
        pathStroke="stroke"
        pathDashLength="dashLength"
        pathDashGap="dashGap"
        pathDashAnimateTime={0}
        pathLabel={(path) => pathLabel(path as RenderPath)}
        pathTransitionDuration={350}
        pointsData={[sourcePoint, ...receivers, ...analogPoints]}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => String((point as RenderPoint).label)}
        pointsTransitionDuration={450}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcAltitude="altitude"
        arcColor="color"
        arcStroke={0.38}
        arcDashLength={0.42}
        arcDashGap={0.18}
        arcDashAnimateTime={1_850}
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={(ring: unknown) => [String((ring as RenderRing).color), "rgba(255,255,255,0)"]}
        ringMaxRadius={(ring: unknown) => (ring as RenderRing).maxRadius}
        ringPropagationSpeed={(ring: unknown) => (ring as RenderRing).speed}
        ringRepeatPeriod={(ring: unknown) => (ring as RenderRing).repeatPeriod}
        onGlobeClick={({ lat, lng }) => onPickLocation(lat, lng)}
        enablePointerInteraction
      />
      <div style={{
        position: "absolute",
        left: 12,
        top: 12,
        maxWidth: 390,
        padding: "9px 11px",
        border: "1px solid rgba(148,163,184,.24)",
        borderRadius: 12,
        background: "rgba(7,16,24,.82)",
        backdropFilter: "blur(10px)",
        color: "#e8f1f5",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "none",
      }}>
        <strong>Reacción sobre el mapa</strong><br />
        <span style={{ color: "#fb7185" }}>● favorecida</span> · <span style={{ color: "#38bdf8" }}>● sombra</span> · <span style={{ color: "#f59e0b" }}>● sismo histórico real M5.9+</span><br />
        El grosor, los pulsos y los marcadores aumentan con la respuesta calculada.
      </div>
      <div style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        padding: "8px 10px",
        border: "1px solid rgba(245,158,11,.3)",
        borderRadius: 12,
        background: "rgba(7,16,24,.82)",
        color: "#fde68a",
        fontSize: 12,
        pointerEvents: "none",
      }}>
        {historicalAnalogs.length} análogos reales · {historicalCatalog?.provider ?? "USGS"}
        {historicalCatalog?.warning ? " · histórico parcial" : ""}
      </div>
    </div>
  );
}
