"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { COUNTRIES } from "@/lib/countries";
import type {
  GlobeMapLayersResponse,
  GlobeMapPath,
  GlobeMapPoint,
  GlobeTectonicPlate,
  PlateBoundaryClass,
} from "@/lib/globeLayers";
import type { HistoricalHeatmapCell } from "@/lib/historicalHeatmap";

interface RenderPath extends Omit<GlobeMapPath, "points"> {
  points: Array<GlobeMapPoint & { altitude: number }>;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
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

type Position = [number, number];

const PLATE_PALETTE = [
  "#2563eb", "#7c3aed", "#0891b2", "#059669", "#65a30d", "#ca8a04",
  "#ea580c", "#dc2626", "#db2777", "#9333ea", "#0d9488", "#4f46e5",
];

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

function parseHexColor(value: string) {
  const hex = value.replace("#", "");
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number) {
  const rgb = parseHexColor(hex);
  return `rgba(${rgb.red},${rgb.green},${rgb.blue},${alpha})`;
}

function plateColor(code: string) {
  let hash = 0;
  for (let index = 0; index < code.length; index += 1) hash = (hash * 31 + code.charCodeAt(index)) >>> 0;
  return PLATE_PALETTE[hash % PLATE_PALETTE.length];
}

function heatColor(magnitude: number) {
  if (magnitude >= 7) return "#ef4444";
  if (magnitude >= 6) return "#f97316";
  if (magnitude >= 5) return "#facc15";
  if (magnitude >= 4) return "#22c55e";
  if (magnitude > 3) return "#22d3ee";
  return "#2563eb";
}

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

function pathLabel(path: RenderPath, plateNames: Map<string, string>) {
  if (path.kind === "plate-boundary") {
    const plateA = path.plateA ? plateNames.get(path.plateA) ?? path.plateA : null;
    const plateB = path.plateB ? plateNames.get(path.plateB) ?? path.plateB : null;
    const plates = [plateA, plateB].filter(Boolean).join(" ↔ ");
    return `<div class="globe-tooltip"><strong>${escapeHtml(path.boundaryType ?? "Límite de placa")}</strong><span>${escapeHtml(plates || path.name)}</span><small>Clase PB2002: ${escapeHtml(path.boundaryClass ?? "UNKNOWN")}</small></div>`;
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

function parsePosition(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

function parseRing(value: unknown): Position[] {
  if (!Array.isArray(value)) return [];
  return value.map(parsePosition).filter((position): position is Position => Boolean(position));
}

function polygonsFromPlate(plate: GlobeTectonicPlate): Position[][][] {
  const geometry = plate.geometry;
  const coordinates = geometry?.coordinates;
  if (!geometry || !Array.isArray(coordinates)) return [];
  if (geometry.type === "Polygon") {
    const rings = (coordinates as unknown[]).map(parseRing).filter((ring) => ring.length >= 3);
    return rings.length ? [rings] : [];
  }
  return (coordinates as unknown[]).map((polygon) => {
    if (!Array.isArray(polygon)) return [];
    return (polygon as unknown[]).map(parseRing).filter((ring) => ring.length >= 3);
  }).filter((polygon) => polygon.length > 0);
}

function longitudeToX(longitude: number, width: number) {
  return ((longitude + 180) / 360) * width;
}

function latitudeToY(latitude: number, height: number) {
  return ((90 - latitude) / 180) * height;
}

function drawWrappedRing(
  context: CanvasRenderingContext2D,
  ring: Position[],
  width: number,
  height: number,
) {
  if (ring.length < 3) return;
  const points = ring.map(([longitude, latitude]) => ({
    x: longitudeToX(longitude, width),
    y: latitudeToY(latitude, height),
  }));
  for (let index = 1; index < points.length; index += 1) {
    while (points[index].x - points[index - 1].x > width / 2) points[index].x -= width;
    while (points[index].x - points[index - 1].x < -width / 2) points[index].x += width;
  }
  for (const shift of [-width, 0, width]) {
    context.beginPath();
    context.moveTo(points[0].x + shift, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x + shift, points[index].y);
    context.closePath();
    context.fill();
  }
}

function drawPlateAreas(
  context: CanvasRenderingContext2D,
  plates: GlobeTectonicPlate[],
  width: number,
  height: number,
) {
  for (const plate of plates) {
    const color = plateColor(plate.code);
    context.fillStyle = rgba(color, 0.13);
    for (const polygon of polygonsFromPlate(plate)) {
      for (const ring of polygon) drawWrappedRing(context, ring, width, height);
    }
  }
}

function drawHeatSpot(
  context: CanvasRenderingContext2D,
  cell: HistoricalHeatmapCell,
  width: number,
  height: number,
) {
  const x = longitudeToX(cell.longitude, width);
  const y = latitudeToY(cell.latitude, height);
  const density = Math.log2(Math.max(1, cell.eventCount) + 1);
  const radius = clamp(7 + density * 4 + Math.max(0, cell.maximumMagnitude - 5) * 2.5, 8, 42);
  const alpha = cell.maximumMagnitude >= 7 ? 0.9 : clamp(0.24 + Math.log10(cell.eventCount + 1) * 0.2, 0.24, 0.78);
  const rgb = parseHexColor(heatColor(cell.maximumMagnitude));

  function drawAt(centerX: number) {
    const gradient = context.createRadialGradient(centerX, y, 0, centerX, y, radius);
    gradient.addColorStop(0, `rgba(${rgb.red},${rgb.green},${rgb.blue},${alpha})`);
    gradient.addColorStop(0.42, `rgba(${rgb.red},${rgb.green},${rgb.blue},${(alpha * 0.66).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${rgb.red},${rgb.green},${rgb.blue},0)`);
    context.fillStyle = gradient;
    context.fillRect(centerX - radius, y - radius, radius * 2, radius * 2);
  }

  drawAt(x);
  if (x < radius) drawAt(x + width);
  if (x > width - radius) drawAt(x - width);
}

function buildRasterTexture(cells: HistoricalHeatmapCell[], plates: GlobeTectonicPlate[], showPlateAreas: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return "";

  const background = context.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, "#06131f");
  background.addColorStop(0.5, "#03101a");
  background.addColorStop(1, "#020a12");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (showPlateAreas) drawPlateAreas(context, plates, canvas.width, canvas.height);

  const ordered = [...cells].sort((a, b) => a.maximumMagnitude - b.maximumMagnitude || a.eventCount - b.eventCount);
  for (const cell of ordered) drawHeatSpot(context, cell, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.88);
}

export function HistoricalHeatmapGlobe({
  cells,
  showCountryNames,
  showPlateAreas,
  showPlateNames,
  showPlateBoundaries,
  showFaults,
  autoRotate,
  onTextureReady,
}: {
  cells: HistoricalHeatmapCell[];
  showCountryNames: boolean;
  showPlateAreas: boolean;
  showPlateNames: boolean;
  showPlateBoundaries: boolean;
  showFaults: boolean;
  autoRotate: boolean;
  onTextureReady?: () => void;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const readyCallbackRef = useRef(onTextureReady);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 720 });
  const [layers, setLayers] = useState<GlobeMapLayersResponse | null>(null);
  const [textureUrl, setTextureUrl] = useState<string>("");

  useEffect(() => { readyCallbackRef.current = onTextureReady; }, [onTextureReady]);

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

  const requestedLayerSet = useMemo(() => {
    const requested = ["countries"];
    if (showPlateAreas || showPlateNames) requested.push("plates");
    if (showPlateBoundaries) requested.push("boundaries");
    if (showFaults) requested.push("faults");
    return requested.join(",");
  }, [showFaults, showPlateAreas, showPlateBoundaries, showPlateNames]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/globe/layers?include=${requestedLayerSet}`, { cache: "force-cache", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<GlobeMapLayersResponse>;
      })
      .then(setLayers)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [requestedLayerSet]);

  useEffect(() => {
    const texture = buildRasterTexture(cells, layers?.tectonicPlates ?? [], showPlateAreas);
    setTextureUrl(texture);
    if (texture) window.requestAnimationFrame(() => readyCallbackRef.current?.());
  }, [cells, layers?.tectonicPlates, showPlateAreas]);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.3;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  const plateNames = useMemo(
    () => new Map((layers?.tectonicPlates ?? []).map((plate) => [plate.code, plate.name])),
    [layers],
  );

  const geographicPaths = useMemo<RenderPath[]>(() => {
    const countries = (layers?.countryBorders ?? []).map((path) => ({
      ...path,
      color: "rgba(226,232,240,.44)",
      stroke: 0.24,
      dashLength: 1,
      dashGap: 0,
      points: path.points.map((point) => ({ ...point, altitude: 0.012 })),
    }));
    const boundaries = showPlateBoundaries ? (layers?.plateBoundaries ?? []).map((path) => ({
      ...path,
      color: boundaryColor(path.boundaryClass),
      stroke: path.boundaryClass === "SUB" ? 0.72 : 0.58,
      dashLength: path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? 0.055 : 1,
      dashGap: path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? 0.026 : 0,
      points: path.points.map((point) => ({ ...point, altitude: 0.022 })),
    })) : [];
    const faults = showFaults ? (layers?.activeFaults ?? []).map((path) => ({
      ...path,
      color: faultColor(path.faultType),
      stroke: 0.46,
      dashLength: 0.035,
      dashGap: 0.018,
      points: path.points.map((point) => ({ ...point, altitude: 0.028 })),
    })) : [];
    return [...countries, ...boundaries, ...faults];
  }, [layers, showFaults, showPlateBoundaries]);

  const labels = useMemo<GlobeLabel[]>(() => {
    const countries: GlobeLabel[] = showCountryNames ? COUNTRIES.map((country) => ({
      id: `country:${country.code}`,
      latitude: country.latitude,
      longitude: country.longitude,
      text: country.name,
      size: clamp(0.17 + country.radiusKm / 8_000, 0.17, 0.38),
      color: "rgba(241,245,249,.9)",
      kind: "country",
    })) : [];
    const plates: GlobeLabel[] = showPlateNames ? (layers?.tectonicPlates ?? []).map((plate) => ({
      id: `plate:${plate.code}`,
      latitude: plate.latitude,
      longitude: plate.longitude,
      text: `Placa ${plate.name}`,
      size: 0.4,
      color: "rgba(253,224,71,.98)",
      kind: "plate",
    })) : [];
    return [...countries, ...plates];
  }, [layers, showCountryNames, showPlateNames]);

  if (!textureUrl) return <div ref={containerRef} style={{ width: "100%", minHeight: 520 }} />;

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 520 }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={textureUrl}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.13}
        showGraticules
        onGlobeReady={() => globeRef.current?.pointOfView({ lat: 12, lng: -20, altitude: 2.05 }, 0)}
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
        pathTransitionDuration={0}
        labelsData={labels}
        labelLat="latitude"
        labelLng="longitude"
        labelText="text"
        labelColor="color"
        labelAltitude={(label: object) => (label as GlobeLabel).kind === "plate" ? 0.03 : 0.018}
        labelSize="size"
        labelIncludeDot={false}
        labelResolution={2}
        labelsTransitionDuration={0}
        enablePointerInteraction
      />
    </div>
  );
}
