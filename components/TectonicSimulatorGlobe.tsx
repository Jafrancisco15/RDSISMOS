"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { TectonicSimulationWithAnalogs } from "@/lib/tectonicAnalogs";
import type { GlobalTectonicInteraction } from "@/lib/tectonicGlobal";
import type { EarthScopeObservedTrace, EarthScopeObservedWaveforms } from "@/lib/earthscopeWaveforms";
import type { TectonicInteraction, TectonicSimulationResponse } from "@/lib/tectonicSimulator";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";
const DEGREE_KM = 111.2;
const OBSERVED_START_SEC = -60;
const OBSERVED_END_SEC = 2 * 60 * 60;

type DisplayMode = "simulated" | "observed";

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

function formatRelativeTime(seconds: number) {
  const sign = seconds < 0 ? "−" : "+";
  const absolute = Math.abs(Math.round(seconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const secs = absolute % 60;
  return `T${sign}${hours ? `${hours}h ` : ""}${minutes ? `${minutes}m ` : ""}${secs}s`;
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

function observedColor(value: number) {
  if (value > 0.08) return "#fb7185";
  if (value < -0.08) return "#38bdf8";
  return "#e2e8f0";
}

function nearestObservedSample(trace: EarthScopeObservedTrace, timeSec: number) {
  if (!trace.samples.length) return null;
  let low = 0;
  let high = trace.samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trace.samples[middle].tSec < timeSec) low = middle + 1;
    else high = middle;
  }
  const after = trace.samples[low];
  const before = trace.samples[Math.max(0, low - 1)];
  return Math.abs(after.tSec - timeSec) < Math.abs(before.tSec - timeSec) ? after : before;
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
      ? "conectividad tectónica no resuelta"
      : `${path.connectivityHops} salto${path.connectivityHops === 1 ? "" : "s"} en red de placas`;
    return `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>Estructura receptora · respuesta dinámica ${escapeHtml(path.state)}</span><small>índice ${path.dynamicIndex}/100 · respuesta ${path.responseScore}% · ${path.distanceKm.toFixed(0)} km · superficie ~${path.arrivalMinutes.toFixed(0)} min</small><small>${hopText}. La onda no viaja siguiendo esta línea.</small></div>`;
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
  const [showWaves, setShowWaves] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [showAnalogs, setShowAnalogs] = useState(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("simulated");
  const [observed, setObserved] = useState<EarthScopeObservedWaveforms | null>(null);
  const [observedLoading, setObservedLoading] = useState(false);
  const [observedError, setObservedError] = useState<string | null>(null);
  const [observedTimeSec, setObservedTimeSec] = useState(OBSERVED_START_SEC);
  const [observedPlaying, setObservedPlaying] = useState(false);
  const [observedSpeed, setObservedSpeed] = useState(30);
  const enriched = simulation as TectonicSimulationResponse & Partial<TectonicSimulationWithAnalogs>;
  const historicalAnalogs = enriched.historicalAnalogs ?? [];
  const historicalCatalog = enriched.historicalCatalog ?? null;
  const globalTectonics = enriched.globalTectonics ?? null;
  const globalInteractions = globalTectonics?.interactions ?? [];
  const earthScope = enriched.earthScope ?? null;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(560, Math.min(820, element.clientWidth * 0.74)),
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
      altitude: displayMode === "observed" || showGlobal || showWaves
        ? 2.25
        : simulation.source.interactionRadiusKm > 1_500 ? 2.0 : 1.45,
    }, 850);
  }, [displayMode, showGlobal, showWaves, simulation.generatedAt, simulation.input.latitude, simulation.input.longitude, simulation.source.interactionRadiusKm]);

  useEffect(() => {
    setDisplayMode("simulated");
    setObserved(null);
    setObservedError(null);
    setObservedTimeSec(OBSERVED_START_SEC);
    setObservedPlaying(false);
    setShowWaves(true);
    setShowStatic(true);
    setShowGlobal(true);
    setShowAnalogs(true);
  }, [sourceEvent?.id]);

  useEffect(() => {
    if (!observedPlaying || displayMode !== "observed") return;
    const interval = window.setInterval(() => {
      setObservedTimeSec((current) => {
        const next = current + observedSpeed / 10;
        if (next >= OBSERVED_END_SEC) {
          setObservedPlaying(false);
          return OBSERVED_END_SEC;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [displayMode, observedPlaying, observedSpeed]);

  async function activateObserved() {
    if (!sourceEvent || !(earthScope?.stations.length)) return;
    setDisplayMode("observed");
    setShowWaves(false);
    setShowStatic(false);
    setShowGlobal(false);
    setShowAnalogs(false);
    setShowStations(true);
    setObservedTimeSec(OBSERVED_START_SEC);
    setObservedPlaying(false);
    if (observed?.source.id === sourceEvent.id) return;
    setObservedLoading(true);
    setObservedError(null);
    try {
      const response = await fetch("/api/simulator/earthscope/waveforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEvent: {
            id: sourceEvent.id,
            timeUtc: sourceEvent.timeUtc,
            latitude: sourceEvent.latitude,
            longitude: sourceEvent.longitude,
            magnitude: sourceEvent.magnitude,
            depthKm: sourceEvent.depthKm,
            place: sourceEvent.place,
          },
          stations: earthScope.stations,
        }),
        cache: "no-store",
      });
      const raw = await response.text();
      const payload = raw ? JSON.parse(raw) as EarthScopeObservedWaveforms & { error?: string } : null;
      if (!response.ok || !payload) throw new Error(payload?.error ?? `EarthScope HTTP ${response.status}`);
      setObserved(payload);
      if (!payload.available) setObservedError("EarthScope no devolvió formas de onda utilizables para las estaciones seleccionadas.");
    } catch (error) {
      setObservedError(error instanceof Error ? error.message : "No fue posible cargar las formas de onda observadas.");
    } finally {
      setObservedLoading(false);
    }
  }

  function activateSimulated() {
    setDisplayMode("simulated");
    setObservedPlaying(false);
    setShowWaves(true);
    setShowStatic(true);
    setShowGlobal(true);
    setShowAnalogs(true);
  }

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
        label: `<div class="globe-tooltip"><strong>${escapeHtml(interaction.name)}</strong><span>Estructura receptora · ${interaction.distanceBand === "teleseismic" ? "teleseísmica" : interaction.distanceBand}</span><small>respuesta ${interaction.responseScore}% · índice dinámico ${interaction.dynamicIndex}/100 · ${interaction.distanceKm.toFixed(0)} km</small><small>${interaction.connectivityHops === null ? "Conectividad tectónica no resuelta" : `${interaction.connectivityHops} salto${interaction.connectivityHops === 1 ? "" : "s"} de placa como contexto, no ruta de onda`}</small></div>`,
      }))
    : [], [globalInteractions, showGlobal]);

  const metadataStationPoints = useMemo<RenderPoint[]>(() => showStations && displayMode === "simulated"
    ? (earthScope?.stations ?? []).map((station) => ({
        id: `earthscope-station:${station.network}:${station.station}`,
        lat: station.latitude,
        lng: station.longitude,
        altitude: 0.018,
        radius: 0.085,
        color: "#e0f2fe",
        label: `<div class="globe-tooltip"><strong>EarthScope · ${escapeHtml(station.network)}.${escapeHtml(station.station)}</strong><span>${escapeHtml(station.siteName)}</span><small>${station.distanceKm.toFixed(0)} km del epicentro · estación/metadata FDSN</small><small>El punto muestra ubicación de estación, no amplitud instantánea de la forma de onda.</small></div>`,
      }))
    : [], [displayMode, earthScope?.stations, showStations]);

  const observedStationPoints = useMemo<RenderPoint[]>(() => {
    if (!showStations || displayMode !== "observed" || !observed?.available) return [];
    return observed.traces.map((trace) => {
      const sample = nearestObservedSample(trace, observedTimeSec);
      const normalized = sample?.normalized ?? 0;
      const physical = sample?.value ?? 0;
      return {
        id: `observed:${trace.network}:${trace.station}:${trace.location}:${trace.channel}`,
        lat: trace.latitude,
        lng: trace.longitude,
        altitude: 0.035 + Math.abs(normalized) * 0.13,
        radius: 0.1 + Math.abs(normalized) * 0.48,
        color: observedColor(normalized),
        label: `<div class="globe-tooltip"><strong>OBSERVADO · ${escapeHtml(trace.network)}.${escapeHtml(trace.station)}.${escapeHtml(trace.channel)}</strong><span>${escapeHtml(trace.siteName)}</span><small>${formatRelativeTime(sample?.tSec ?? observedTimeSec)} · ${physical.toExponential(3)} ${escapeHtml(trace.units)} · normalizado ${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}</small><small>${trace.calibration === "response-corrected" ? "Respuesta instrumental removida · velocidad" : "Escalado por sensibilidad"}. Color cálido = signo positivo; azul = negativo.</small></div>`,
      };
    });
  }, [displayMode, observed, observedTimeSec, showStations]);

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
      ? `<div class="globe-tooltip"><strong>Evento real seleccionado · M${sourceEvent.magnitude.toFixed(1)}</strong><span>${escapeHtml(sourceEvent.place)}</span><small>${formatHistoricalDate(sourceEvent.timeUtc)} · ${sourceEvent.depthKm.toFixed(0)} km · ${escapeHtml(sourceEvent.sourceCatalog)}</small><small>${displayMode === "observed" ? "Las estaciones muestran formas de onda observadas EarthScope." : "Desde aquí se calculan Coulomb local, propagación de ondas y respuesta de estructuras."}</small></div>`
      : `<div class="globe-tooltip"><strong>Escenario manual · Mw ${simulation.input.magnitude.toFixed(1)}</strong><span>${simulation.input.depthKm.toFixed(0)} km · ${simulation.input.mechanism}</span><small>Strike ${simulation.input.strikeDeg.toFixed(0)}° · dip ${simulation.input.dipDeg.toFixed(0)}° · rake ${simulation.input.rakeDeg.toFixed(0)}°</small></div>`,
  }), [displayMode, simulation, sourceEvent]);

  const rings = useMemo<RenderRing[]>(() => {
    const ringsResult: RenderRing[] = [];
    if (showWaves) {
      ringsResult.push(
        { id: "wave-p", lat: simulation.input.latitude, lng: simulation.input.longitude, color: "#f8fafc", maxRadius: 175, speed: 8.4, repeatPeriod: 6_700 },
        { id: "wave-s", lat: simulation.input.latitude, lng: simulation.input.longitude, color: "#22d3ee", maxRadius: 175, speed: 5.1, repeatPeriod: 8_200 },
        { id: "wave-surface", lat: simulation.input.latitude, lng: simulation.input.longitude, color: "#c084fc", maxRadius: 175, speed: 3.3, repeatPeriod: 9_700 },
      );
    }
    if (showStatic) {
      ringsResult.push({
        id: "static-source-range",
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
  }, [globalInteractions, showGlobal, showStatic, showWaves, simulation]);

  const activeTraceSummary = useMemo(() => observed?.traces
    .map((trace) => ({ trace, sample: nearestObservedSample(trace, observedTimeSec) }))
    .sort((a, b) => Math.abs(b.sample?.normalized ?? 0) - Math.abs(a.sample?.normalized ?? 0))
    .slice(0, 4) ?? [], [observed, observedTimeSec]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 560, position: "relative" }}>
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
        pointsData={[sourcePoint, ...staticReceivers, ...globalReceivers, ...metadataStationPoints, ...observedStationPoints, ...analogPoints]}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => String((point as RenderPoint).label)}
        pointsTransitionDuration={120}
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
        maxWidth: 480,
        padding: "10px 12px",
        border: displayMode === "observed" ? "1px solid rgba(251,113,133,.38)" : "1px solid rgba(148,163,184,.24)",
        borderRadius: 12,
        background: "rgba(7,16,24,.9)",
        backdropFilter: "blur(10px)",
        color: "#e8f1f5",
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        <strong>Modo del globo</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <button type="button" onClick={activateSimulated} style={{ opacity: displayMode === "simulated" ? 1 : .55 }}>SIMULADO</button>
          <button
            type="button"
            onClick={() => void activateObserved()}
            disabled={!sourceEvent || !(earthScope?.stations.length) || observedLoading}
            style={{ opacity: displayMode === "observed" ? 1 : .55 }}
          >
            {observedLoading ? "Cargando EarthScope…" : "OBSERVADO EarthScope"}
          </button>
        </div>

        {displayMode === "observed" ? (
          <>
            <div style={{ marginTop: 8, color: "#f8fafc" }}>
              <strong>{formatRelativeTime(observedTimeSec)}</strong> · {observed?.traces.length ?? 0} trazas reales
            </div>
            <input
              aria-label="Tiempo observado desde el origen del terremoto"
              type="range"
              min={OBSERVED_START_SEC}
              max={OBSERVED_END_SEC}
              step={1}
              value={observedTimeSec}
              onChange={(event) => { setObservedPlaying(false); setObservedTimeSec(Number(event.target.value)); }}
              style={{ width: "100%", marginTop: 6 }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
              <button type="button" onClick={() => setObservedPlaying((value) => !value)} disabled={!observed?.available}>
                {observedPlaying ? "Pausa" : "Reproducir"}
              </button>
              {[10, 30, 120].map((speed) => (
                <button key={speed} type="button" onClick={() => setObservedSpeed(speed)} style={{ opacity: observedSpeed === speed ? 1 : .55 }}>{speed}×</button>
              ))}
              <button type="button" onClick={() => { setObservedPlaying(false); setObservedTimeSec(OBSERVED_START_SEC); }}>Reiniciar</button>
            </div>
            {observedError ? <div style={{ marginTop: 7, color: "#fecaca" }}>{observedError}</div> : null}
            <div style={{ marginTop: 7, color: "#aebfca" }}>
              <span style={{ color: "#fb7185" }}>● movimiento +</span> · <span style={{ color: "#38bdf8" }}>● movimiento −</span> · <span style={{ color: "#e2e8f0" }}>● cerca de 0</span>
            </div>
            <div style={{ marginTop: 5, color: "#fde68a" }}>Amplitud normalizada por estación solo para visualización; no es probabilidad ni intensidad macrosísmica.</div>
          </>
        ) : (
          <div style={{ marginTop: 7, color: "#aebfca" }}>
            Simulación física: frentes P/S/superficie, Coulomb local y estructuras receptoras. Los puntos EarthScope son solo metadata hasta activar OBSERVADO.
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
          <button type="button" onClick={() => setShowWaves((value) => !value)} style={{ opacity: showWaves ? 1 : .5 }}>Frentes teóricos</button>
          <button type="button" onClick={() => setShowStations((value) => !value)} style={{ opacity: showStations ? 1 : .5 }}>Estaciones</button>
          <button type="button" onClick={() => setShowStatic((value) => !value)} style={{ opacity: showStatic ? 1 : .5 }}>Coulomb</button>
          <button type="button" onClick={() => setShowGlobal((value) => !value)} style={{ opacity: showGlobal ? 1 : .5 }}>Tectónica</button>
          <button type="button" onClick={() => setShowAnalogs((value) => !value)} style={{ opacity: showAnalogs ? 1 : .5 }}>Históricos</button>
        </div>
      </div>

      {displayMode === "observed" && observed?.available ? (
        <div style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          width: "min(520px, calc(100% - 24px))",
          padding: "9px 11px",
          border: "1px solid rgba(148,163,184,.25)",
          borderRadius: 12,
          background: "rgba(7,16,24,.88)",
          color: "#dbeafe",
          fontSize: 11,
          lineHeight: 1.4,
          pointerEvents: "none",
        }}>
          <strong>Movimiento observado ahora · {formatRelativeTime(observedTimeSec)}</strong>
          {activeTraceSummary.map(({ trace, sample }) => (
            <div key={`${trace.network}:${trace.station}:${trace.channel}`} style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px", gap: 7, alignItems: "center", marginTop: 5 }}>
              <span>{trace.network}.{trace.station}</span>
              <span style={{ height: 5, borderRadius: 99, background: "rgba(148,163,184,.18)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.max(2, Math.abs(sample?.normalized ?? 0) * 100)}%`, background: observedColor(sample?.normalized ?? 0) }} />
              </span>
              <span style={{ textAlign: "right" }}>{(sample?.normalized ?? 0) > 0 ? "+" : ""}{(sample?.normalized ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        maxWidth: 400,
        padding: "9px 11px",
        border: "1px solid rgba(125,211,252,.32)",
        borderRadius: 12,
        background: "rgba(7,16,24,.88)",
        color: "#dbeafe",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "none",
      }}>
        <strong>{displayMode === "observed" ? "OBSERVADO · EarthScope NSF SAGE" : "SIMULADO · ondas + tectónica"}</strong><br />
        {displayMode === "observed"
          ? observedLoading
            ? "Descargando formas de onda reales…"
            : observed?.available
              ? `${observed.traces.length}/${observed.requestedStations} estaciones con traza · ventana 2 h`
              : "Sin trazas observadas utilizables; cambia a SIMULADO."
          : earthScope?.available
            ? `${earthScope.stations.length} estaciones EarthScope · tiempos P/S ${earthScope.travelTimeModel}`
            : "EarthScope no disponible para este escenario; se mantiene la simulación."}
        <br />
        <span style={{ color: "#aebfca" }}>
          {globalTectonics?.sourceBoundary ? `Contexto tectónico: ${globalTectonics.sourceBoundary.name}` : "Sin límite fuente resuelto"}
        </span><br />
        {displayMode === "simulated" ? <span style={{ color: "#fde68a" }}>{historicalAnalogs.length} análogos reales · {historicalCatalog?.provider ?? "USGS"}</span> : null}
      </div>
    </div>
  );
}
