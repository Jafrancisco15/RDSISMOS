"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { TectonicInteraction, TectonicSimulationResponse } from "@/lib/tectonicSimulator";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";
const DEGREE_KM = 111.2;

interface RenderPath {
  id: string;
  name: string;
  kind: string;
  stressState: string;
  stressProxyKpa: number;
  points: Array<{ lat: number; lng: number; altitude: number }>;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
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

function stressColor(state: TectonicInteraction["stressState"]) {
  if (state === "promoted") return "#fb7185";
  if (state === "inhibited") return "#38bdf8";
  return "rgba(203,213,225,.62)";
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
  const state = path.stressState === "promoted"
    ? "favorecido"
    : path.stressState === "inhibited"
      ? "inhibido"
      : "neutral";
  return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>${escapeHtml(path.kind)} · ${state}</span><small>ΔCFS proxy ${path.stressProxyKpa > 0 ? "+" : ""}${path.stressProxyKpa.toFixed(1)} kPa</small></div>`;
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
    const interactionPaths = simulation.interactions.map((interaction) => ({
      id: interaction.id,
      name: interaction.name,
      kind: interaction.kind === "active-fault" ? "Falla activa" : "Límite de placa",
      stressState: interaction.stressState,
      stressProxyKpa: interaction.stressProxyKpa,
      points: interaction.points.map((point) => ({
        ...point,
        altitude: interaction.kind === "active-fault" ? 0.016 : 0.012,
      })),
      color: stressColor(interaction.stressState),
      stroke: interaction.kind === "active-fault" ? 0.65 : 0.52,
      dashLength: interaction.kind === "active-fault" ? 0.03 : 0.055,
      dashGap: 0.025,
    }));
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
      points: [
        { ...sourceA, altitude: 0.027 },
        { ...sourceB, altitude: 0.027 },
      ],
      color: "#facc15",
      stroke: 1.4,
      dashLength: 1,
      dashGap: 0,
    });
    return interactionPaths;
  }, [simulation]);

  const receivers = useMemo(() => simulation.interactions.slice(0, 24).map((interaction) => ({
    id: `receiver:${interaction.id}`,
    lat: interaction.closestPoint.lat,
    lng: interaction.closestPoint.lng,
    altitude: 0.035 + clamp(interaction.responseScore / 100, 0, 1) * 0.08,
    radius: 0.12 + clamp(interaction.responseScore / 100, 0, 1) * 0.22,
    color: stressColor(interaction.stressState),
    label: `<div class="globe-tooltip"><strong>${escapeHtml(interaction.name)}</strong><span>${interaction.stressState === "promoted" ? "Favorecida" : interaction.stressState === "inhibited" ? "Inhibida" : "Neutral"}</span><small>${interaction.distanceKm.toFixed(0)} km · ${interaction.stressProxyKpa > 0 ? "+" : ""}${interaction.stressProxyKpa.toFixed(1)} kPa</small></div>`,
  })), [simulation.interactions]);

  const sourcePoint = useMemo(() => ({
    id: "simulated-source",
    lat: simulation.input.latitude,
    lng: simulation.input.longitude,
    altitude: 0.12,
    radius: 0.42,
    color: "#facc15",
    label: `<div class="globe-tooltip"><strong>Sismo simulado · Mw ${simulation.input.magnitude.toFixed(1)}</strong><span>${simulation.input.depthKm.toFixed(0)} km profundidad · ${simulation.input.mechanism}</span><small>Strike ${simulation.input.strikeDeg.toFixed(0)}° · dip ${simulation.input.dipDeg.toFixed(0)}° · rake ${simulation.input.rakeDeg.toFixed(0)}°</small></div>`,
  }), [simulation]);

  const arcs = useMemo(() => simulation.interactions.slice(0, 16).map((interaction) => ({
    id: `arc:${interaction.id}`,
    startLat: simulation.input.latitude,
    startLng: simulation.input.longitude,
    endLat: interaction.closestPoint.lat,
    endLng: interaction.closestPoint.lng,
    color: stressColor(interaction.stressState),
    altitude: 0.12 + clamp(interaction.distanceKm / 2_500, 0, 1) * 0.22,
  })), [simulation]);

  const rings = useMemo(() => [{
    lat: simulation.input.latitude,
    lng: simulation.input.longitude,
    color: "#facc15",
  }], [simulation.input.latitude, simulation.input.longitude]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 500 }}>
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
        pointsData={[sourcePoint, ...receivers]}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => String((point as { label: string }).label)}
        pointsTransitionDuration={450}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcAltitude="altitude"
        arcColor="color"
        arcStroke={0.32}
        arcDashLength={0.42}
        arcDashGap={0.18}
        arcDashAnimateTime={2_100}
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={(ring: unknown) => [String((ring as { color: string }).color), "rgba(255,255,255,0)"]}
        ringMaxRadius={clamp(simulation.source.interactionRadiusKm / DEGREE_KM, 2.5, 24)}
        ringPropagationSpeed={1.2}
        ringRepeatPeriod={1_500}
        onGlobeClick={({ lat, lng }) => onPickLocation(lat, lng)}
        enablePointerInteraction
      />
    </div>
  );
}
