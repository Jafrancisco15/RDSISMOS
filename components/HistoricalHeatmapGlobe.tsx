"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { COUNTRIES } from "@/lib/countries";
import type {
  GlobeMapLayersResponse,
  GlobeMapPath,
  GlobeMapPoint,
  PlateBoundaryClass,
} from "@/lib/globeLayers";
import type { HistoricalHeatmapEvent } from "@/lib/historicalHeatmap";
import { visualMagnitudeWeight } from "@/lib/historicalHeatmap";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";

type HeatMode = "density" | "magnitude";

interface RenderPath extends Omit<GlobeMapPath, "points"> {
  points: Array<GlobeMapPoint & { altitude: number }>;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
}

interface HeatDataset {
  id: string;
  points: HistoricalHeatmapEvent[];
}

interface GlobeLabel {
  id: string;
  latitude: number;
  longitude: number;
  text: string;
  size: number;
  color: string;
  kind: "country" | "plate";
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

function heatColor(value: number) {
  const x = clamp(value, 0, 1);
  if (x < 0.18) return `rgba(37,99,235,${0.12 + x * 1.8})`;
  if (x < 0.38) return `rgba(14,165,233,${0.28 + x})`;
  if (x < 0.58) return `rgba(34,211,238,${0.42 + x * 0.6})`;
  if (x < 0.76) return `rgba(250,204,21,${0.55 + x * 0.45})`;
  if (x < 0.9) return `rgba(249,115,22,${0.68 + x * 0.32})`;
  return "rgba(239,68,68,1)";
}

function magnitudeColor(magnitude: number) {
  if (magnitude >= 7) return "#ef4444";
  if (magnitude >= 6) return "#f97316";
  if (magnitude >= 5) return "#facc15";
  if (magnitude >= 4) return "#22d3ee";
  return "#60a5fa";
}

const PLATE_BOUNDARY_COLORS: Record<PlateBoundaryClass, string> = {
  SUB: "#ef4444",
  OSR: "#22d3ee",
  OTF: "#f59e0b",
  OCB: "#f97316",
  CRB: "#38bdf8",
  CTF: "#a78bfa",
  CCB: "#fb7185",
  UNKNOWN: "#94a3b8",
};

function boundaryColor(boundaryClass: PlateBoundaryClass | undefined) {
  return PLATE_BOUNDARY_COLORS[boundaryClass ?? "UNKNOWN"];
}

function faultColor(type: string | undefined) {
  const value = (type ?? "").toLowerCase();
  if (value.includes("normal") || value.includes("extens")) return "#38bdf8";
  if (value.includes("reverse") || value.includes("thrust") || value.includes("compress")) return "#fb7185";
  if (value.includes("dextral") || value.includes("sinistral") || value.includes("strike")) return "#c084fc";
  if (value.includes("oblique")) return "#f59e0b";
  return "#f472b6";
}

function pointLabel(event: HistoricalHeatmapEvent) {
  const date = new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(event.timeUtc));
  return `<div class="globe-tooltip"><strong>M${event.magnitude.toFixed(1)} · ${escapeHtml(event.place)}</strong><span>${date} UTC</span><small>Profundidad ${event.depthKm.toFixed(1)} km · USGS ComCat</small></div>`;
}

function pathLabel(path: RenderPath, plateNames: Map<string, string>) {
  if (path.kind === "plate-boundary") {
    const plateA = path.plateA ? plateNames.get(path.plateA) ?? path.plateA : null;
    const plateB = path.plateB ? plateNames.get(path.plateB) ?? path.plateB : null;
    const plates = [plateA, plateB].filter(Boolean).join(" ↔ ");
    return `<div class="globe-tooltip"><strong>${escapeHtml(path.boundaryType ?? "Límite de placa")}</strong><span>${escapeHtml(plates || path.name)}</span><small>Clase PB2002: ${escapeHtml(path.boundaryClass ?? "UNKNOWN")} · pasa el cursor por otros tramos: el tipo puede cambiar a lo largo del mismo borde.</small></div>`;
  }
  if (path.kind === "active-fault") {
    const details = [
      path.faultType ? `Tipo: ${escapeHtml(path.faultType)}` : "Tipo cinemático no disponible",
      path.dip ? `Dip: ${escapeHtml(path.dip)}` : null,
      path.dipDirection ? `Dirección: ${escapeHtml(path.dipDirection)}` : null,
      path.slipRate ? `Tasa: ${escapeHtml(path.slipRate)}` : null,
    ].filter(Boolean).join(" · ");
    return `<div class="globe-tooltip"><strong>Falla activa · ${escapeHtml(path.name)}</strong><span>${details}</span><small>GEM Global Active Faults${path.catalogId ? ` · ${escapeHtml(path.catalogId)}` : ""}</small></div>`;
  }
  return `<div class="globe-tooltip"><strong>Frontera internacional</strong><span>${escapeHtml(path.name)}</span></div>`;
}

export function HistoricalHeatmapGlobe({
  events,
  mode,
  showCountryNames,
  showStrongEvents,
  showPlateNames,
  showPlateBoundaries,
  showFaults,
  autoRotate,
}: {
  events: HistoricalHeatmapEvent[];
  mode: HeatMode;
  showCountryNames: boolean;
  showStrongEvents: boolean;
  showPlateNames: boolean;
  showPlateBoundaries: boolean;
  showFaults: boolean;
  autoRotate: boolean;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 720 });
  const [layers, setLayers] = useState<GlobeMapLayersResponse | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resize = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(520, Math.min(820, element.clientWidth * 0.7)),
    });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/globe/layers", { cache: "force-cache", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<GlobeMapLayersResponse>;
      })
      .then(setLayers)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 12, lng: -20, altitude: 2.05 }, 800);
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.3;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  const heatmaps = useMemo<HeatDataset[]>(() => [{ id: "earthquakes", points: events }], [events]);

  const strongEvents = useMemo(() => {
    if (!showStrongEvents) return [];
    return [...events]
      .filter((event) => event.magnitude >= 5.5)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 350);
  }, [events, showStrongEvents]);

  const plateNames = useMemo(
    () => new Map((layers?.tectonicPlates ?? []).map((plate) => [plate.code, plate.name])),
    [layers],
  );

  const geographicPaths = useMemo<RenderPath[]>(() => {
    const countries = (layers?.countryBorders ?? []).map((path) => ({
      ...path,
      color: "rgba(226,232,240,.36)",
      stroke: 0.24,
      dashLength: 1,
      dashGap: 0,
      points: path.points.map((point) => ({ ...point, altitude: 0.006 })),
    }));
    const boundaries = showPlateBoundaries ? (layers?.plateBoundaries ?? []).map((path) => ({
      ...path,
      color: boundaryColor(path.boundaryClass),
      stroke: path.boundaryClass === "SUB" ? 0.72 : 0.58,
      dashLength: path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? 0.055 : 1,
      dashGap: path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? 0.026 : 0,
      points: path.points.map((point) => ({ ...point, altitude: 0.015 })),
    })) : [];
    const faults = showFaults ? (layers?.activeFaults ?? []).map((path) => ({
      ...path,
      color: faultColor(path.faultType),
      stroke: 0.46,
      dashLength: 0.035,
      dashGap: 0.018,
      points: path.points.map((point) => ({ ...point, altitude: 0.021 })),
    })) : [];
    return [...countries, ...boundaries, ...faults];
  }, [layers, showFaults, showPlateBoundaries]);

  const labels = useMemo<GlobeLabel[]>(() => {
    const countries: GlobeLabel[] = showCountryNames ? COUNTRIES.map((country) => ({
      id: `country:${country.code}`,
      latitude: country.latitude,
      longitude: country.longitude,
      text: country.name,
      size: clamp(0.18 + country.radiusKm / 7_500, 0.18, 0.42),
      color: "rgba(241,245,249,.84)",
      kind: "country",
    })) : [];
    const plates: GlobeLabel[] = showPlateNames ? (layers?.tectonicPlates ?? []).map((plate) => ({
      id: `plate:${plate.code}`,
      latitude: plate.latitude,
      longitude: plate.longitude,
      text: `Placa ${plate.name}`,
      size: 0.42,
      color: "rgba(253,224,71,.96)",
      kind: "plate",
    })) : [];
    return [...countries, ...plates];
  }, [layers, showCountryNames, showPlateNames]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 520 }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.16}
        showGraticules
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
        pathLabel={(path: object) => pathLabel(path as RenderPath, plateNames)}
        pathTransitionDuration={220}
        heatmapsData={heatmaps}
        heatmapPoints="points"
        heatmapPointLat="latitude"
        heatmapPointLng="longitude"
        heatmapPointWeight={(point: object) => mode === "density"
          ? 1
          : visualMagnitudeWeight((point as HistoricalHeatmapEvent).magnitude)}
        heatmapBandwidth={mode === "density" ? 1.45 : 1.2}
        heatmapColorFn={() => heatColor}
        heatmapColorSaturation={1.35}
        heatmapBaseAltitude={0.008}
        heatmapTopAltitude={mode === "density" ? 0.035 : 0.07}
        heatmapsTransitionDuration={480}
        pointsData={strongEvents}
        pointLat="latitude"
        pointLng="longitude"
        pointAltitude={(point: object) => 0.025 + clamp(((point as HistoricalHeatmapEvent).magnitude - 5.5) / 3.5, 0, 1) * 0.13}
        pointRadius={(point: object) => 0.09 + clamp(((point as HistoricalHeatmapEvent).magnitude - 5.5) / 3.5, 0, 1) * 0.34}
        pointColor={(point: object) => magnitudeColor((point as HistoricalHeatmapEvent).magnitude)}
        pointLabel={(point: object) => pointLabel(point as HistoricalHeatmapEvent)}
        pointsTransitionDuration={420}
        labelsData={labels}
        labelLat="latitude"
        labelLng="longitude"
        labelText="text"
        labelColor="color"
        labelAltitude={(label: object) => (label as GlobeLabel).kind === "plate" ? 0.025 : 0.012}
        labelSize="size"
        labelIncludeDot={false}
        labelResolution={2}
        labelsTransitionDuration={250}
        enablePointerInteraction
      />
    </div>
  );
}
