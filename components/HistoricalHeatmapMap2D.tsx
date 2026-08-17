"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import type {
  GlobeMapLayersResponse,
  GlobeMapPath,
  GlobeTectonicPlate,
  PlateBoundaryClass,
} from "@/lib/globeLayers";
import type { HistoricalHeatmapCell } from "@/lib/historicalHeatmap";
import styles from "./HistoricalHeatmap.module.css";

type Position = [number, number];

const WIDTH = 1440;
const HEIGHT = 720;
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

function faultColor(type: string | undefined) {
  const value = (type ?? "").toLowerCase();
  if (value.includes("normal") || value.includes("extens")) return "#38bdf8";
  if (value.includes("reverse") || value.includes("thrust") || value.includes("compress")) return "#fb7185";
  if (value.includes("dextral") || value.includes("sinistral") || value.includes("strike")) return "#c084fc";
  if (value.includes("oblique")) return "#f59e0b";
  return "#f472b6";
}

function longitudeToX(longitude: number) {
  return ((longitude + 180) / 360) * WIDTH;
}

function latitudeToY(latitude: number) {
  return ((90 - latitude) / 180) * HEIGHT;
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

function unwrapXs(points: Array<{ x: number; y: number }>) {
  const result = points.map((point) => ({ ...point }));
  for (let index = 1; index < result.length; index += 1) {
    while (result[index].x - result[index - 1].x > WIDTH / 2) result[index].x -= WIDTH;
    while (result[index].x - result[index - 1].x < -WIDTH / 2) result[index].x += WIDTH;
  }
  return result;
}

function drawWrappedRing(context: CanvasRenderingContext2D, ring: Position[]) {
  if (ring.length < 3) return;
  const points = unwrapXs(ring.map(([longitude, latitude]) => ({ x: longitudeToX(longitude), y: latitudeToY(latitude) })));
  for (const shift of [-WIDTH, 0, WIDTH]) {
    context.beginPath();
    context.moveTo(points[0].x + shift, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x + shift, points[index].y);
    context.closePath();
    context.fill();
  }
}

function drawPlateAreas(context: CanvasRenderingContext2D, plates: GlobeTectonicPlate[]) {
  for (const plate of plates) {
    context.fillStyle = rgba(plateColor(plate.code), 0.13);
    for (const polygon of polygonsFromPlate(plate)) {
      for (const ring of polygon) drawWrappedRing(context, ring);
    }
  }
}

function drawHeatSpot(context: CanvasRenderingContext2D, cell: HistoricalHeatmapCell) {
  const x = longitudeToX(cell.longitude);
  const y = latitudeToY(cell.latitude);
  const density = Math.log2(Math.max(1, cell.eventCount) + 1);
  const radius = clamp(10 + density * 5.6 + Math.max(0, cell.maximumMagnitude - 5) * 3.2, 12, 60);
  const alpha = cell.maximumMagnitude >= 7 ? 0.92 : clamp(0.24 + Math.log10(cell.eventCount + 1) * 0.2, 0.24, 0.78);
  const rgb = parseHexColor(heatColor(cell.maximumMagnitude));

  function drawAt(centerX: number) {
    const gradient = context.createRadialGradient(centerX, y, 0, centerX, y, radius);
    gradient.addColorStop(0, `rgba(${rgb.red},${rgb.green},${rgb.blue},${alpha})`);
    gradient.addColorStop(0.44, `rgba(${rgb.red},${rgb.green},${rgb.blue},${(alpha * 0.64).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${rgb.red},${rgb.green},${rgb.blue},0)`);
    context.fillStyle = gradient;
    context.fillRect(centerX - radius, y - radius, radius * 2, radius * 2);
  }

  drawAt(x);
  if (x < radius) drawAt(x + WIDTH);
  if (x > WIDTH - radius) drawAt(x - WIDTH);
}

function drawPath(context: CanvasRenderingContext2D, path: GlobeMapPath) {
  if (path.points.length < 2) return;
  const points = unwrapXs(path.points.map((point) => ({ x: longitudeToX(point.lng), y: latitudeToY(point.lat) })));

  if (path.kind === "country-border") {
    context.strokeStyle = "rgba(248,250,252,.92)";
    context.lineWidth = 1.15;
    context.setLineDash([]);
  } else if (path.kind === "plate-boundary") {
    context.strokeStyle = PLATE_BOUNDARY_COLORS[path.boundaryClass ?? "UNKNOWN"];
    context.lineWidth = path.boundaryClass === "SUB" ? 2.25 : 1.7;
    context.setLineDash(path.boundaryClass === "OTF" || path.boundaryClass === "CTF" ? [8, 5] : []);
  } else {
    context.strokeStyle = faultColor(path.faultType);
    context.lineWidth = 1.25;
    context.setLineDash([5, 4]);
  }

  for (const shift of [-WIDTH, 0, WIDTH]) {
    context.beginPath();
    context.moveTo(points[0].x + shift, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x + shift, points[index].y);
    context.stroke();
  }
  context.setLineDash([]);
}

function drawGraticule(context: CanvasRenderingContext2D) {
  context.save();
  context.strokeStyle = "rgba(148,163,184,.10)";
  context.lineWidth = 0.7;
  for (let longitude = -150; longitude <= 150; longitude += 30) {
    const x = longitudeToX(longitude);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, HEIGHT);
    context.stroke();
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const y = latitudeToY(latitude);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  }
  context.restore();
}

function drawText(context: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill: string) {
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(2,6,12,.82)";
  context.strokeText(text, x, y);
  context.fillStyle = fill;
  context.fillText(text, x, y);
}

export function HistoricalHeatmapMap2D({
  cells,
  showCountryNames,
  showPlateAreas,
  showPlateNames,
  showPlateBoundaries,
  showFaults,
}: {
  cells: HistoricalHeatmapCell[];
  showCountryNames: boolean;
  showPlateAreas: boolean;
  showPlateNames: boolean;
  showPlateBoundaries: boolean;
  showFaults: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layers, setLayers] = useState<GlobeMapLayersResponse | null>(null);

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const background = context.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, "#06131f");
    background.addColorStop(0.5, "#03101a");
    background.addColorStop(1, "#020a12");
    context.fillStyle = background;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawGraticule(context);

    if (showPlateAreas) drawPlateAreas(context, layers?.tectonicPlates ?? []);

    const ordered = [...cells].sort((a, b) => a.maximumMagnitude - b.maximumMagnitude || a.eventCount - b.eventCount);
    for (const cell of ordered) drawHeatSpot(context, cell);

    // Structural overlays deliberately render after heat so they remain visually on top.
    for (const path of layers?.countryBorders ?? []) drawPath(context, path);
    if (showPlateBoundaries) for (const path of layers?.plateBoundaries ?? []) drawPath(context, path);
    if (showFaults) for (const path of layers?.activeFaults ?? []) drawPath(context, path);

    if (showCountryNames) {
      for (const country of COUNTRIES) {
        const fontSize = clamp(8.2 + country.radiusKm / 650, 8.2, 12.4);
        drawText(context, country.name, longitudeToX(country.longitude), latitudeToY(country.latitude), `600 ${fontSize}px system-ui, sans-serif`, "rgba(248,250,252,.94)");
      }
    }

    if (showPlateNames) {
      for (const plate of layers?.tectonicPlates ?? []) {
        drawText(context, `Placa ${plate.name}`, longitudeToX(plate.longitude), latitudeToY(plate.latitude), "700 13px system-ui, sans-serif", "rgba(253,224,71,.98)");
      }
    }
  }, [cells, layers, showCountryNames, showFaults, showPlateAreas, showPlateBoundaries, showPlateNames]);

  return (
    <div className={styles.map2dCanvasWrap}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className={styles.map2dCanvas}
        aria-label="Mapa 2D mundial de calor sísmico histórico con placas, fronteras y fallas"
      />
    </div>
  );
}
