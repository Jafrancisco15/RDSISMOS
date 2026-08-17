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

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";

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

interface PlatePolygon {
  id: string;
  geometry: NonNullable<GlobeTectonicPlate["geometry"]>;
  plate: GlobeTectonicPlate;
  color: string;
}

interface HeatPoint {
  latitude: number;
  longitude: number;
  weight: number;
}

interface HeatBand {
  id: string;
  label: string;
  color: string;
  minMagnitude: number;
  maxMagnitude: number | null;
  altitude: number;
  points: HeatPoint[];
}

const PLATE_PALETTE = [
  "#2563eb", "#7c3aed", "#0891b2", "#059669", "#65a30d", "#ca8a04",
  "#ea580c", "#dc2626", "#db2777", "#9333ea", "#0d9488", "#4f46e5",
];

const HEAT_BAND_DEFINITIONS = [
  { id: "m3", label: "M≤3", color: "#2563eb", minMagnitude: -Infinity, maxMagnitude: 3, altitude: 0.009 },
  { id: "m3-4", label: "M3–4", color: "#22d3ee", minMagnitude: 3, maxMagnitude: 4, altitude: 0.010 },
  { id: "m4-5", label: "M4–5", color: "#22c55e", minMagnitude: 4, maxMagnitude: 5, altitude: 0.011 },
  { id: "m5-6", label: "M5–6", color: "#facc15", minMagnitude: 5, maxMagnitude: 6, altitude: 0.012 },
  { id: "m6-7", label: "M6–7", color: "#f97316", minMagnitude: 6, maxMagnitude: 7, altitude: 0.013 },
  { id: "m7", label: "M7+", color: "#ef4444", minMagnitude: 7, maxMagnitude: null, altitude: 0.014 },
] as const;

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

function plateLabel(polygon: PlatePolygon) {
  return `<div class="globe-tooltip"><strong>Placa tectónica · ${escapeHtml(polygon.plate.name)}</strong><span>Código PB2002: ${escapeHtml(polygon.plate.code)}</span><small>Área tectónica PB2002. El color es contextual y no representa riesgo.</small></div>`;
}

function bandForMagnitude(magnitude: number) {
  return HEAT_BAND_DEFINITIONS.find((band) => (
    magnitude > band.minMagnitude
    && (band.maxMagnitude === null || magnitude <= band.maxMagnitude)
  )) ?? HEAT_BAND_DEFINITIONS[0];
}

function buildHeatBands(cells: HistoricalHeatmapCell[]): HeatBand[] {
  const buckets = new Map<string, HeatPoint[]>();
  HEAT_BAND_DEFINITIONS.forEach((band) => buckets.set(band.id, []));

  for (const cell of cells) {
    const band = bandForMagnitude(cell.maximumMagnitude);
    buckets.get(band.id)?.push({
      latitude: (cell.minLatitude + cell.maxLatitude) / 2,
      longitude: (cell.minLongitude + cell.maxLongitude) / 2,
      weight: 1 + Math.log2(Math.max(1, cell.eventCount)),
    });
  }

  return HEAT_BAND_DEFINITIONS
    .map((band) => ({ ...band, points: buckets.get(band.id) ?? [] }))
    .filter((band) => band.points.length > 0);
}

function heatColorInterpolator(band: HeatBand) {
  const rgb = parseHexColor(band.color);
  return (value: number) => {
    const normalized = clamp(value, 0, 1.35);
    const alpha = clamp(0.05 + normalized * 0.72, 0.04, 0.86);
    return `rgba(${rgb.red},${rgb.green},${rgb.blue},${alpha.toFixed(3)})`;
  };
}

export function HistoricalHeatmapGlobe({
  cells,
  showCountryNames,
  showPlateAreas,
  showPlateNames,
  showPlateBoundaries,
  showFaults,
  autoRotate,
}: {
  cells: HistoricalHeatmapCell[];
  showCountryNames: boolean;
  showPlateAreas: boolean;
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
    globeRef.current?.pointOfView({ lat: 12, lng: -20, altitude: 2.05 }, 0);
  }, []);

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
      color: "rgba(226,232,240,.42)",
      stroke: 0.25,
      dashLength: 1,
      dashGap: 0,
      points: path.points.map((point) => ({ ...point, altitude: 0.018 })),
    }));
    const boundaries = showPlateBoundaries ? (layers?.plateBoundaries ?? []).map((path) => ({
      ...path,
      color: boundaryColor(path.boundaryClass),
      stroke: path.boundaryClass === "SUB" ? 0.72 : 0.58,
      dashLength: path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? 0.055 : 1,
      dashGap: path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? 0.026 : 0,
      points: path.points.map((point) => ({ ...point, altitude: 0.026 })),
    })) : [];
    const faults = showFaults ? (layers?.activeFaults ?? []).map((path) => ({
      ...path,
      color: faultColor(path.faultType),
      stroke: 0.46,
      dashLength: 0.035,
      dashGap: 0.018,
      points: path.points.map((point) => ({ ...point, altitude: 0.032 })),
    })) : [];
    return [...countries, ...boundaries, ...faults];
  }, [layers, showFaults, showPlateBoundaries]);

  const platePolygons = useMemo<PlatePolygon[]>(() => showPlateAreas
    ? (layers?.tectonicPlates ?? [])
      .filter((plate): plate is GlobeTectonicPlate & { geometry: NonNullable<GlobeTectonicPlate["geometry"]> } => Boolean(plate.geometry))
      .map((plate) => ({
        id: `plate-area:${plate.code}`,
        geometry: plate.geometry,
        plate,
        color: plateColor(plate.code),
      }))
    : [], [layers, showPlateAreas]);

  const heatBands = useMemo(() => buildHeatBands(cells), [cells]);

  const labels = useMemo<GlobeLabel[]>(() => {
    const countries: GlobeLabel[] = showCountryNames ? COUNTRIES.map((country) => ({
      id: `country:${country.code}`,
      latitude: country.latitude,
      longitude: country.longitude,
      text: country.name,
      size: clamp(0.18 + country.radiusKm / 7_500, 0.18, 0.42),
      color: "rgba(241,245,249,.9)",
      kind: "country",
    })) : [];
    const plates: GlobeLabel[] = showPlateNames ? (layers?.tectonicPlates ?? []).map((plate) => ({
      id: `plate:${plate.code}`,
      latitude: plate.latitude,
      longitude: plate.longitude,
      text: `Placa ${plate.name}`,
      size: 0.42,
      color: "rgba(253,224,71,.98)",
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
        polygonsData={platePolygons}
        polygonGeoJsonGeometry={(polygon: object) => (polygon as PlatePolygon).geometry as any}
        polygonAltitude={0.002}
        polygonCapColor={(polygon: object) => rgba((polygon as PlatePolygon).color, 0.12)}
        polygonSideColor={(polygon: object) => rgba((polygon as PlatePolygon).color, 0.025)}
        polygonStrokeColor={(polygon: object) => rgba((polygon as PlatePolygon).color, 0.24)}
        polygonLabel={(polygon: object) => plateLabel(polygon as PlatePolygon)}
        polygonsTransitionDuration={0}
        heatmapsData={heatBands}
        heatmapPoints="points"
        heatmapPointLat="latitude"
        heatmapPointLng="longitude"
        heatmapPointWeight="weight"
        heatmapBandwidth={1.55}
        heatmapColorFn={(heatmap: object) => heatColorInterpolator(heatmap as HeatBand)}
        heatmapColorSaturation={0.9}
        heatmapBaseAltitude={(heatmap: object) => (heatmap as HeatBand).altitude}
        heatmapTopAltitude={(heatmap: object) => (heatmap as HeatBand).altitude}
        heatmapsTransitionDuration={0}
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
        labelAltitude={(label: object) => (label as GlobeLabel).kind === "plate" ? 0.036 : 0.024}
        labelSize="size"
        labelIncludeDot={false}
        labelResolution={2}
        labelsTransitionDuration={0}
        enablePointerInteraction
      />
    </div>
  );
}
