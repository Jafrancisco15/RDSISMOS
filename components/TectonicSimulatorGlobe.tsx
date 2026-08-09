"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { TectonicSimulationWithAnalogs } from "@/lib/tectonicAnalogs";
import type { GlobalTectonicInteraction } from "@/lib/tectonicGlobal";
import type { TectonicInteraction, TectonicSimulationResponse } from "@/lib/tectonicSimulator";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";
const DEGREE_KM = 111.2;

interface RenderPath {
  id: string;
  name: string;
  layer: "static" | "dynamic" | "source";
  kind: string;
  state: string;
  stressProxyKpa: number;
  responseScore: number;
  dynamicIndex: number;
  distanceKm: number;
  arrivalMinutes: number;
  connectivityHops: number | null;
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

interface RenderArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  altitude: number;
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
  return "rgba(203,213,225,.56)";
}

function dynamicColor(interaction: GlobalTectonicInteraction) {
  if (interaction.distanceBand === "teleseismic") return "#c084fc";
  if (interaction.distanceBand === "regional") return "#2dd4bf";
  return "#a3e635";
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
  if (path.layer === "source") {
    return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>Ruptura fuente aproximada</span></div>`;
  }
  if (path.layer === "dynamic") {
    const hopText = path.connectivityHops === null
      ? "sin ruta de placa resuelta"
      : `${path.connectivityHops} salto${path.connectivityHops === 1 ? "" : "s"} en red de placas`;
    return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>Respuesta dinámica global · ${escapeHtml(path.state)}</span><small>índice ${path.dynamicIndex}/100 · respuesta ${path.responseScore}% · ${path.distanceKm.toFixed(0)} km · ~${path.arrivalMinutes.toFixed(0)} min · ${hopText}</small></div>`;
  }
  const state = path.state === "promoted"
    ? "favorecido"
    : path.state === "inhibited"
      ? "sombra relativa"
      : "cambio pequeño";
  return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>${escapeHtml(path.kind)} · Coulomb local ${state}</span><small>ΔCFS proxy ${path.stressProxyKpa > 0 ? "+" : ""}${path.stressProxyKpa.toFixed(1)} kPa · respuesta ${path.responseScore}%</small></div>`;
}

export function TectonicSimulatorGlobe({
  simulation,
  onPickLocation,
  sourceEvent,
}: {
  simulation: TectonicSimulationResponse;
  onPickLocation: (latitude: number, longitude: number) => void;
  sourceEvent?: EarthquakeEvent | null;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 650 });
  const [showStatic, setShowStatic] = useState(true);
  const [showGlobal, setShowGlobal] = useState(true);
  const [showAnalogs, setShowAnalogs] = useState(true);
  const enriched = simulation as TectonicSimulationResponse & Partial<TectonicSimulationWithAnalogs>;
  const historicalAnalogs = enriched.historicalAnalogs ?? [];
  const historicalCatalog = enriched.historicalCatalog ?? null;
  const globalTectonics = enriched.globalTectonics ?? null;
  const globalInteractions = globalTectonics?.interactions ?? [];

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(520, Math.min(780, element.clientWidth * 0.72)),
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
      altitude: showGlobal ? 2.25 : simulation.source.interactionRadiusKm > 1_500 ? 2.0 : 1.45,
    }, 850);
  }, [showGlobal, simulation.generatedAt, simulation.input.latitude, simulation.input.longitude, simulation.source.interactionRadiusKm]);

  const paths = useMemo<RenderPath[]>(() => {
    const staticPaths: RenderPath[] = showStatic
      ? simulation.interactions.map((interaction) => {
          const strength = clamp(interaction.responseScore / 100, 0, 1);
          const isFault = interaction.kind === "active-fault";
          return {
            id: `static:${interaction.id}`,
            name: interaction.name,
            layer: "static",
            kind: isFault ? "Falla activa" : "Límite de placa",
            state: interaction.stressState,
            stressProxyKpa: interaction.stressProxyKpa,
            responseScore: interaction.responseScore,
            dynamicIndex: 0,
            distanceKm: interaction.distanceKm,
            arrivalMinutes: 0,
            connectivityHops: null,
            points: interaction.points.map((point) => ({
              ...point,
              altitude: (isFault ? 0.017 : 0.013) + strength * 0.012,
            })),
            color: stressColor(interaction.stressState),
            stroke: (isFault ? 0.5 : 0.4) + strength * (isFault ? 1.15 : 0.85),
            dashLength: interaction.stressState === "neutral" ? 0.025 : 0.055,
            dashGap: interaction.stressState === "neutral" ? 0.035 : 0.018,
          };
        })
      : [];

    const dynamicPaths: RenderPath[] = showGlobal
      ? globalInteractions.map((interaction) => {
          const strength = clamp(interaction.responseScore / 100, 0, 1);
          return {
            id: interaction.id,
            name: interaction.name,
            layer: "dynamic",
            kind: interaction.kind === "active-fault" ? "Falla activa" : "Límite de placa",
            state: interaction.distanceBand === "teleseismic" ? "teleseísmica" : interaction.distanceBand,
            stressProxyKpa: 0,
            responseScore: interaction.responseScore,
            dynamicIndex: interaction.dynamicIndex,
            distanceKm: interaction.distanceKm,
            arrivalMinutes: interaction.arrivalMinutes,
            connectivityHops: interaction.connectivityHops,
            points: interaction.points.map((point) => ({
              ...point,
              altitude: 0.032 + strength * 0.018,
            })),
            color: dynamicColor(interaction),
            stroke: 0.45 + strength * 1.55,
            dashLength: interaction.distanceBand === "teleseismic" ? 0.07 : 0.05,
            dashGap: 0.02,
          };
        })
      : [];

    const halfLength = simulation.source.ruptureLengthKm / 2;
    const sourceA = endpoint(simulation.input.latitude, simulation.input.longitude, simulation.input.strikeDeg, halfLength);
    const sourceB = endpoint(simulation.input.latitude, simulation.input.longitude, simulation.input.strikeDeg + 180, halfLength);
    const sourcePath: RenderPath = {
      id: "source-rupture",
      name: sourceEvent ? `Ruptura estimada · ${sourceEvent.place}` : "Ruptura fuente aproximada",
      layer: "source",
      kind: "Fuente",
      state: "source",
      stressProxyKpa: 0,
      responseScore: 100,
      dynamicIndex: 0,
      distanceKm: 0,
      arrivalMinutes: 0,
      connectivityHops: null,
      points: [{ ...sourceA, altitude: 0.045 }, { ...sourceB, altitude: 0.045 }],
      color: "#facc15",
      stroke: 2.0,
      dashLength: 1,
      dashGap: 0,
    };
    return [...staticPaths, ...dynamicPaths, sourcePath];
  }, [globalInteractions, showGlobal, showStatic, simulation, sourceEvent]);

  const staticReceivers = useMemo<RenderPoint[]>(() => showStatic
    ? simulation.interactions.slice(0, 32).map((interaction) => ({
        id: `receiver:${interaction.id}`,
        lat: interaction.closestPoint.lat,
        lng: interaction.closestPoint.lng,
        altitude: 0.045 + clamp(interaction.responseScore / 100, 0, 1) * 0.11,
        radius: 0.12 + clamp(interaction.responseScore / 100, 0, 1) * 0.28,
        color: stressColor(interaction.stressState),
        label: `<div class="globe-tooltip"><strong>${escapeHtml(interaction.name)}</strong><span>Coulomb local · ${interaction.stressState === "promoted" ? "favorecida" : interaction.stressState === "inhibited" ? "sombra" : "cambio pequeño"}</span><small>${interaction.distanceKm.toFixed(0)} km · ${interaction.stressProxyKpa > 0 ? "+" : ""}${interaction.stressProxyKpa.toFixed(1)} kPa</small></div>`,
      }))
    : [], [showStatic, simulation.interactions]);

  const globalReceivers = useMemo<RenderPoint[]>(() => showGlobal
    ? globalInteractions.slice(0, 48).map((interaction) => ({
        id: `global-receiver:${interaction.id}`,
        lat: interaction.closestPoint.lat,
        lng: interaction.closestPoint.lng,
        altitude: 0.075 + clamp(interaction.responseScore / 100, 0, 1) * 0.12,
        radius: 0.11 + clamp(interaction.responseScore / 100, 0, 1) * 0.33,
        color: dynamicColor(interaction),
        label: `<div class="globe-tooltip"><strong>${escapeHtml(interaction.name)}</strong><span>Interacción global · ${interaction.distanceBand === "teleseismic" ? "teleseísmica" : interaction.distanceBand}</span><small>respuesta ${interaction.responseScore}% · índice dinámico ${interaction.dynamicIndex}/100 · ${interaction.distanceKm.toFixed(0)} km · llegada ~${interaction.arrivalMinutes.toFixed(0)} min</small><small>${interaction.connectivityHops === null ? "Conectividad de placa no resuelta" : `${interaction.connectivityHops} salto${interaction.connectivityHops === 1 ? "" : "s"} desde la placa fuente`}</small></div>`,
      }))
    : [], [globalInteractions, showGlobal]);

  const analogPoints = useMemo<RenderPoint[]>(() => showAnalogs
    ? historicalAnalogs.map((analog) => ({
        id: `historical-analog:${analog.id}`,
        lat: analog.latitude,
        lng: analog.longitude,
        altitude: 0.032 + clamp((analog.magnitude - 5.9) / 2.6, 0, 1) * 0.075,
        radius: 0.14 + clamp((analog.magnitude - 5.9) / 2.6, 0, 1) * 0.28,
        color: analogColor(analog.similarityScore),
        label: `<div class="globe-tooltip"><strong>Sismo histórico real · M${analog.magnitude.toFixed(1)}</strong><span>${escapeHtml(analog.place)}</span><small>${formatHistoricalDate(analog.timeUtc)} · ${analog.depthKm.toFixed(0)} km · similitud ${analog.similarityScore}% · ${analog.distanceKm.toFixed(0)} km</small></div>`,
      }))
    : [], [historicalAnalogs, showAnalogs]);

  const sourcePoint = useMemo<RenderPoint>(() => ({
    id: "simulated-source",
    lat: simulation.input.latitude,
    lng: simulation.input.longitude,
    altitude: 0.15,
    radius: 0.5,
    color: "#facc15",
    label: sourceEvent
      ? `<div class="globe-tooltip"><strong>Evento real seleccionado · M${sourceEvent.magnitude.toFixed(1)}</strong><span>${escapeHtml(sourceEvent.place)}</span><small>${formatHistoricalDate(sourceEvent.timeUtc)} · ${sourceEvent.depthKm.toFixed(0)} km · ${escapeHtml(sourceEvent.sourceCatalog)}</small><small>Desde aquí se calculan Coulomb local + respuesta dinámica global.</small></div>`
      : `<div class="globe-tooltip"><strong>Escenario manual · Mw ${simulation.input.magnitude.toFixed(1)}</strong><span>${simulation.input.depthKm.toFixed(0)} km · ${simulation.input.mechanism}</span><small>Strike ${simulation.input.strikeDeg.toFixed(0)}° · dip ${simulation.input.dipDeg.toFixed(0)}° · rake ${simulation.input.rakeDeg.toFixed(0)}°</small></div>`,
  }), [simulation, sourceEvent]);

  const arcs = useMemo<RenderArc[]>(() => {
    const staticArcs: RenderArc[] = showStatic
      ? simulation.interactions.slice(0, 16).map((interaction) => ({
          id: `static-arc:${interaction.id}`,
          startLat: simulation.input.latitude,
          startLng: simulation.input.longitude,
          endLat: interaction.closestPoint.lat,
          endLng: interaction.closestPoint.lng,
          color: stressColor(interaction.stressState),
          altitude: 0.12 + clamp(interaction.distanceKm / 2_500, 0, 1) * 0.18,
        }))
      : [];
    const remote = globalInteractions
      .filter((interaction) => interaction.distanceBand !== "near")
      .sort((a, b) => b.responseScore - a.responseScore)
      .slice(0, 22);
    const globalArcs: RenderArc[] = showGlobal
      ? remote.map((interaction) => ({
          id: `global-arc:${interaction.id}`,
          startLat: simulation.input.latitude,
          startLng: simulation.input.longitude,
          endLat: interaction.closestPoint.lat,
          endLng: interaction.closestPoint.lng,
          color: dynamicColor(interaction),
          altitude: 0.22 + clamp(interaction.distanceKm / 20_000, 0, 1) * 0.65,
        }))
      : [];
    return [...staticArcs, ...globalArcs];
  }, [globalInteractions, showGlobal, showStatic, simulation]);

  const rings = useMemo<RenderRing[]>(() => {
    const ringsResult: RenderRing[] = [];
    if (showGlobal) {
      ringsResult.push({
        id: "global-surface-wave",
        lat: simulation.input.latitude,
        lng: simulation.input.longitude,
        color: "#c084fc",
        maxRadius: 175,
        speed: 4.2,
        repeatPeriod: 5_200,
      });
    }
    if (showStatic) {
      ringsResult.push({
        id: "static-source-wave",
        lat: simulation.input.latitude,
        lng: simulation.input.longitude,
        color: "#facc15",
        maxRadius: clamp(simulation.source.interactionRadiusKm / DEGREE_KM, 2.5, 24),
        speed: 1.15,
        repeatPeriod: 1_550,
      });
    }
    if (showGlobal) {
      globalInteractions
        .filter((interaction) => interaction.responseScore >= 35)
        .slice(0, 20)
        .forEach((interaction) => ringsResult.push({
          id: `dynamic-reaction:${interaction.id}`,
          lat: interaction.closestPoint.lat,
          lng: interaction.closestPoint.lng,
          color: dynamicColor(interaction),
          maxRadius: 0.7 + clamp(interaction.responseScore / 100, 0, 1) * 2.8,
          speed: 0.45 + clamp(interaction.responseScore / 100, 0, 1) * 0.7,
          repeatPeriod: 2_100 + Math.round((1 - clamp(interaction.responseScore / 100, 0, 1)) * 1_700),
        }));
    }
    return ringsResult;
  }, [globalInteractions, showGlobal, showStatic, simulation]);

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
        pointsData={[sourcePoint, ...staticReceivers, ...globalReceivers, ...analogPoints]}
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
        arcDashLength={0.38}
        arcDashGap={0.2}
        arcDashAnimateTime={2_100}
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
        maxWidth: 430,
        padding: "10px 12px",
        border: "1px solid rgba(148,163,184,.24)",
        borderRadius: 12,
        background: "rgba(7,16,24,.86)",
        backdropFilter: "blur(10px)",
        color: "#e8f1f5",
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        <strong>Capas de interacción</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <button type="button" onClick={() => setShowStatic((value) => !value)} style={{ opacity: showStatic ? 1 : .5 }}>Coulomb local</button>
          <button type="button" onClick={() => setShowGlobal((value) => !value)} style={{ opacity: showGlobal ? 1 : .5 }}>Dinámica global</button>
          <button type="button" onClick={() => setShowAnalogs((value) => !value)} style={{ opacity: showAnalogs ? 1 : .5 }}>Históricos</button>
        </div>
        <div style={{ marginTop: 7, color: "#aebfca" }}>
          <span style={{ color: "#fb7185" }}>● estático favorecido</span> · <span style={{ color: "#38bdf8" }}>● sombra</span><br />
          <span style={{ color: "#a3e635" }}>● dinámica cercana</span> · <span style={{ color: "#2dd4bf" }}>● regional</span> · <span style={{ color: "#c084fc" }}>● teleseísmica</span><br />
          <span style={{ color: "#f59e0b" }}>● análogo histórico real M5.9+</span>
        </div>
      </div>

      <div style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        maxWidth: 380,
        padding: "9px 11px",
        border: "1px solid rgba(192,132,252,.32)",
        borderRadius: 12,
        background: "rgba(7,16,24,.86)",
        color: "#ddd6fe",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "none",
      }}>
        <strong>Interacción global</strong><br />
        {globalTectonics
          ? `${globalTectonics.counts.teleseismic} respuestas teleseísmicas · ${globalTectonics.counts.plateLinked} conectadas ≤3 saltos de placa`
          : "Calculando red global…"}
        <br />
        <span style={{ color: "#aebfca" }}>
          {globalTectonics?.sourceBoundary
            ? `Límite fuente más cercano: ${globalTectonics.sourceBoundary.name}`
            : "Sin límite fuente resuelto"}
        </span><br />
        <span style={{ color: "#fde68a" }}>{historicalAnalogs.length} análogos reales · {historicalCatalog?.provider ?? "USGS"}</span>
      </div>
    </div>
  );
}
