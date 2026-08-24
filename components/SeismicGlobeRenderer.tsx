"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeProjection } from "@/lib/globeTypes";
import type {
  GlobeMapLayersResponse,
  GlobeMapPath,
  GlobeMapPoint,
} from "@/lib/globeLayers";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const EARTH_RADIUS_KM = 6371;

export type SeismicGlobePoint =
  | {
      kind: "observed";
      id: string;
      lat: number;
      lng: number;
      altitude: number;
      radius: number;
      color: string;
      event: EarthquakeEvent;
    }
  | {
      kind: "projected";
      id: string;
      lat: number;
      lng: number;
      altitude: number;
      radius: number;
      color: string;
      comparison: boolean;
      projection: GlobeProjection;
    };

interface GlobeArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  altitude: number;
}

interface EpicenterPolygon {
  id: string;
  event: EarthquakeEvent;
  color: string;
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

interface FocusTarget {
  key: string;
  latitude: number;
  longitude: number;
}

interface RenderPath extends Omit<GlobeMapPath, "points"> {
  points: Array<GlobeMapPoint & { altitude: number }>;
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function observedColor(magnitude: number) {
  if (magnitude >= 7) return "#ff3b30";
  if (magnitude >= 5.5) return "#ff7a45";
  return "#fbbf24";
}

function projectionColor(projection: GlobeProjection, comparison = false) {
  if (comparison) return "#16a34a";
  if (projection.projectionKind === "regional-etas") return "#0891b2";
  if (projection.probabilityPct >= 65) return "#c026d3";
  if (projection.probabilityPct >= 35) return "#7c3aed";
  return "#2563eb";
}

function pointLabel(point: SeismicGlobePoint) {
  if (point.kind === "observed") {
    const event = point.event;
    return `<div class="globe-tooltip"><strong>Sismo observado · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatDate(event.timeUtc)} UTC · ${event.depthKm.toFixed(0)} km · ${escapeHtml(event.sourceCatalog)}</small></div>`;
  }
  const projection = point.projection;
  const model = projection.projectionKind === "regional-etas" ? "ETAS regional" : "analogía histórica";
  return `<div class="globe-tooltip"><strong>${point.comparison ? "Comparación" : "Proyección"} · ${escapeHtml(projection.countryName)}</strong><span>${projection.probabilityPct}% · M${projection.magnitudeMin.toFixed(1)}–M${projection.magnitudeMax.toFixed(1)}</span><small>${formatDate(projection.surveillanceStart)}–${formatDate(projection.surveillanceEnd)} · ${model}</small></div>`;
}

function epicenterLabel(item: EpicenterPolygon) {
  const event = item.event;
  return `<div class="globe-tooltip"><strong>Epicentro observado · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatDate(event.timeUtc)} UTC · profundidad hipocentral ${event.depthKm.toFixed(0)} km</small></div>`;
}

function pathLabel(path: RenderPath) {
  const category = path.kind === "active-fault"
    ? "Falla activa"
    : path.kind === "plate-boundary"
      ? "Límite de placa tectónica"
      : "Frontera de país";
  return `<div class="globe-tooltip"><strong>${category}</strong><span>${escapeHtml(path.name)}</span></div>`;
}

function decoratePaths(
  paths: GlobeMapPath[],
  style: { color: string; stroke: number; dashLength: number; dashGap: number; altitude: number },
): RenderPath[] {
  return paths.map((path) => ({
    ...path,
    color: style.color,
    stroke: style.stroke,
    dashLength: style.dashLength,
    dashGap: style.dashGap,
    points: path.points.map((point) => ({ ...point, altitude: style.altitude })),
  }));
}

function surfaceCircle(latitude: number, longitude: number, radiusKm: number, segments = 14) {
  const angular = radiusKm / EARTH_RADIUS_KM;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const coordinates: number[][] = [];
  for (let index = 0; index <= segments; index += 1) {
    const bearing = index / segments * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    coordinates.push([((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI]);
  }
  return coordinates;
}

export function SeismicGlobeRenderer({
  observedEvents,
  projections,
  comparisonProjections,
  showObserved,
  showEpicenters,
  showProjected,
  showComparison,
  showFaults,
  showPlateBoundaries,
  showCountryBorders,
  autoRotate,
  focusTarget,
  selectedPoint,
  onSelect,
}: {
  observedEvents: EarthquakeEvent[];
  projections: GlobeProjection[];
  comparisonProjections: GlobeProjection[];
  showObserved: boolean;
  showEpicenters: boolean;
  showProjected: boolean;
  showComparison: boolean;
  showFaults: boolean;
  showPlateBoundaries: boolean;
  showCountryBorders: boolean;
  autoRotate: boolean;
  focusTarget: FocusTarget | null;
  selectedPoint: SeismicGlobePoint | null;
  onSelect: (point: SeismicGlobePoint) => void;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 680 });
  const [mapLayers, setMapLayers] = useState<GlobeMapLayersResponse | null>(null);
  const [mapLayersLoading, setMapLayersLoading] = useState(true);
  const [mapLayersError, setMapLayersError] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({ width: Math.max(320, element.clientWidth), height: Math.max(480, Math.min(760, element.clientWidth * 0.72)) });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function loadMapLayers() {
      try {
        const response = await fetch("/api/globe/layers", { cache: "force-cache", signal: controller.signal });
        const payload = await response.json() as GlobeMapLayersResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) { setMapLayers(payload); setMapLayersError(null); }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!disposed) setMapLayersError(error instanceof Error ? error.message : "Capas geológicas no disponibles.");
      } finally { if (!disposed) setMapLayersLoading(false); }
    }
    void loadMapLayers();
    return () => { disposed = true; controller.abort(); };
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.38;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  useEffect(() => { globeRef.current?.pointOfView({ lat: 15, lng: -25, altitude: 2.15 }, 900); }, []);

  useEffect(() => {
    if (!focusTarget) return;
    globeRef.current?.pointOfView({ lat: focusTarget.latitude, lng: focusTarget.longitude, altitude: 1.35 }, 850);
  }, [focusTarget]);

  const points = useMemo<SeismicGlobePoint[]>(() => {
    const observed: SeismicGlobePoint[] = showObserved ? observedEvents.map((event) => ({ kind: "observed", id: `observed:${event.id}`, lat: event.latitude, lng: event.longitude, altitude: 0.018 + clamp((event.magnitude - 4.2) / 4.3, 0, 1) * 0.11, radius: 0.12 + clamp((event.magnitude - 4.2) / 4.3, 0, 1) * 0.38, color: observedColor(event.magnitude), event })) : [];
    const projected: SeismicGlobePoint[] = showProjected ? projections.map((projection) => ({ kind: "projected", id: `projected:${projection.id}`, lat: projection.latitude, lng: projection.longitude, altitude: 0.15 + clamp(projection.probabilityPct / 100, 0, 1) * 0.25, radius: 0.24 + clamp(projection.magnitudeMax / 9, 0, 1) * 0.3, color: projectionColor(projection), comparison: false, projection })) : [];
    const comparison: SeismicGlobePoint[] = showComparison ? comparisonProjections.map((projection) => ({ kind: "projected", id: `comparison:${projection.id}`, lat: projection.latitude, lng: projection.longitude, altitude: 0.11 + clamp(projection.probabilityPct / 100, 0, 1) * 0.19, radius: 0.2 + clamp(projection.magnitudeMax / 9, 0, 1) * 0.24, color: projectionColor(projection, true), comparison: true, projection })) : [];
    return [...observed, ...projected, ...comparison];
  }, [observedEvents, projections, comparisonProjections, showObserved, showProjected, showComparison]);

  const epicenters = useMemo<EpicenterPolygon[]>(() => showEpicenters ? observedEvents.map((event) => {
    const radiusKm = 22 + clamp((event.magnitude - 4.2) / 3.8, 0, 1) * 28;
    return { id: `epicenter:${event.id}`, event, color: observedColor(event.magnitude), geometry: { type: "Polygon", coordinates: [surfaceCircle(event.latitude, event.longitude, radiusKm)] } };
  }) : [], [observedEvents, showEpicenters]);

  const arcs = useMemo<GlobeArc[]>(() => {
    if (!selectedPoint || selectedPoint.kind !== "projected") return [];
    const projection = selectedPoint.projection;
    return [{ id: `selected-arc:${selectedPoint.id}`, startLat: projection.sourceEvent.latitude, startLng: projection.sourceEvent.longitude, endLat: projection.latitude, endLng: projection.longitude, color: projectionColor(projection, selectedPoint.comparison), altitude: selectedPoint.comparison ? 0.13 + clamp(projection.probabilityPct / 100, 0, 1) * 0.13 : 0.18 + clamp(projection.probabilityPct / 100, 0, 1) * 0.18 }];
  }, [selectedPoint]);

  const rings = useMemo(() => {
    const primary = showProjected ? projections.map((projection) => ({ ...projection, color: projectionColor(projection) })) : [];
    const comparison = showComparison ? comparisonProjections.map((projection) => ({ ...projection, id: `comparison:${projection.id}`, color: projectionColor(projection, true) })) : [];
    return [...primary, ...comparison];
  }, [comparisonProjections, projections, showComparison, showProjected]);

  const geographicPaths = useMemo<RenderPath[]>(() => {
    const countryBorders = showCountryBorders ? decoratePaths(mapLayers?.countryBorders ?? [], { color: "rgba(15,23,42,.48)", stroke: 0.32, dashLength: 1, dashGap: 0, altitude: 0.006 }) : [];
    const plateBoundaries = showPlateBoundaries ? decoratePaths(mapLayers?.plateBoundaries ?? [], { color: "#0284c7", stroke: 0.54, dashLength: 0.035, dashGap: 0.025, altitude: 0.011 }) : [];
    const faults = showFaults ? decoratePaths(mapLayers?.activeFaults ?? [], { color: "#e11d48", stroke: 0.45, dashLength: 0.022, dashGap: 0.018, altitude: 0.014 }) : [];
    return [...countryBorders, ...plateBoundaries, ...faults];
  }, [mapLayers, showCountryBorders, showFaults, showPlateBoundaries]);

  return (
    <div className="seismic-globe-canvas" ref={containerRef}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#8bd5ff"
        atmosphereAltitude={0.16}
        showGraticules
        polygonsData={epicenters}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={(item: unknown) => String((item as EpicenterPolygon).color)}
        polygonSideColor={() => "rgba(0,0,0,0)"}
        polygonStrokeColor={() => "rgba(127,29,29,.9)"}
        polygonAltitude={0.007}
        polygonLabel={(item: unknown) => epicenterLabel(item as EpicenterPolygon)}
        onPolygonClick={(item: unknown) => {
          const epicenter = item as EpicenterPolygon;
          const event = epicenter.event;
          onSelect({ kind: "observed", id: `observed:${event.id}`, lat: event.latitude, lng: event.longitude, altitude: 0, radius: 0, color: epicenter.color, event });
        }}
        pathsData={geographicPaths}
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
        pathTransitionDuration={0}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => pointLabel(point as SeismicGlobePoint)}
        pointsTransitionDuration={550}
        onPointClick={(point) => onSelect(point as SeismicGlobePoint)}
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
        arcDashAnimateTime={2_200}
        ringsData={rings}
        ringLat="latitude"
        ringLng="longitude"
        ringAltitude={0.012}
        ringColor={(ring: unknown) => [String((ring as { color: string }).color), "rgba(255,255,255,0)"]}
        ringMaxRadius={(ring: unknown) => 2.5 + clamp(Number((ring as GlobeProjection).radiusKm) / 600, 0, 7)}
        ringPropagationSpeed={1.6}
        ringRepeatPeriod={1_450}
        enablePointerInteraction
      />
      {mapLayersLoading && <div className="globe-layer-status">Cargando fallas, placas y fronteras…</div>}
      {!mapLayersLoading && mapLayersError && <div className="globe-layer-status error">Capas cartográficas: {mapLayersError}</div>}
      {!mapLayersLoading && !mapLayersError && (mapLayers?.warnings.length ?? 0) > 0 && <div className="globe-layer-status warning">{mapLayers?.warnings.join(" · ")}</div>}
    </div>
  );
}
