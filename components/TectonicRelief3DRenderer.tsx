"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ActiveFaultCollection, ActiveFaultFeature } from "@/lib/activeFaults";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  computePlatesReliefRegion,
  faultBboxForRegion,
  plateFeatures,
  plateNameOf,
  unwrapLongitude,
  type PlateReliefRegion,
} from "@/lib/plateRelief";
import type { GeoFeature } from "@/lib/plateDynamics";
import {
  buildSlabSamples,
  classifyEventRelativeToSlab,
  SLAB_EVENT_COLORS,
  type SlabEventClass,
} from "@/lib/slabEventClassification";
import type { SlabContour3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

const TILE_SIZE = 256;
const BASE_TERRAIN_Y = 0.0009;
const BASE_DEPTH_Y = 0.1;
const PLATE_COLORS = ["#00d4ff", "#ffd166", "#ef476f", "#9b5de5"];
const SLAB_SHALLOW = "#ff5d73";
const SLAB_INTERMEDIATE = "#ff9f43";
const SLAB_DEEP = "#667eea";

type Pair = [number, number];
type ReliefGrid = {
  width: number;
  height: number;
  elevations: Float32Array;
  sizeX: number;
  sizeZ: number;
  terrainZoom: number;
};
type Props = {
  tectonic: TectonicDepth3DResponse;
  earthquakes: EarthquakeEvent[];
  plateIds: string[];
  reliefExaggeration: number;
  depthExaggeration: number;
  showPlates: boolean;
  showFaults: boolean;
  showSlabs: boolean;
  showEarthquakes: boolean;
};

type QuakeCounts = Record<SlabEventClass, number>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function coordinateLines(value: unknown, output: Pair[][]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && value.every(isPair)) {
    output.push(value.map((point) => [Number(point[0]), Number(point[1])] as Pair));
    return;
  }
  for (const child of value) coordinateLines(child, output);
}

function polygonOuterRings(feature: GeoFeature) {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [] as Pair[][];
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    return Array.isArray(ring) ? [ring.filter(isPair).map((point) => [Number(point[0]), Number(point[1])] as Pair)] : [];
  }
  if (geometry.type === "MultiPolygon") {
    const result: Pair[][] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
      result.push(polygon[0].filter(isPair).map((point) => [Number(point[0]), Number(point[1])] as Pair));
    }
    return result;
  }
  return [];
}

function compactRing(ring: Pair[]) {
  if (ring.length < 3) return [] as Pair[];
  const result = ring.slice();
  const first = result[0];
  const last = result[result.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) result.pop();
  return result;
}

function insideRegion([longitude, latitude]: Pair, region: PlateReliefRegion, margin = 0.35) {
  const unwrapped = unwrapLongitude(longitude, region.centerLongitude);
  return unwrapped >= region.west - margin
    && unwrapped <= region.east + margin
    && latitude >= region.south - margin
    && latitude <= region.north + margin;
}

function regionalSegments(line: Pair[], region: PlateReliefRegion) {
  const result: Pair[][] = [];
  let current: Pair[] = [];
  for (const point of line) {
    if (insideRegion(point, region)) current.push(point);
    else if (current.length) {
      if (current.length >= 2) result.push(current);
      current = [];
    }
  }
  if (current.length >= 2) result.push(current);
  return result;
}

function worldPixelX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * (2 ** zoom) * TILE_SIZE;
}

function worldPixelY(latitude: number, zoom: number) {
  const lat = clamp(latitude, -85.05112878, 85.05112878) * Math.PI / 180;
  const normalized = (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2;
  return normalized * (2 ** zoom) * TILE_SIZE;
}

function terrainTileCount(region: PlateReliefRegion, zoom: number) {
  const xMin = Math.floor(worldPixelX(region.west, zoom) / TILE_SIZE);
  const xMax = Math.floor(worldPixelX(region.east, zoom) / TILE_SIZE);
  const yMin = Math.floor(worldPixelY(region.north, zoom) / TILE_SIZE);
  const yMax = Math.floor(worldPixelY(region.south, zoom) / TILE_SIZE);
  return Math.max(1, xMax - xMin + 1) * Math.max(1, yMax - yMin + 1);
}

function terrainZoomForRegion(region: PlateReliefRegion, isMobile: boolean) {
  const budget = isMobile ? 10 : 20;
  for (let zoom = 7; zoom >= 2; zoom -= 1) {
    if (terrainTileCount(region, zoom) <= budget) return zoom;
  }
  return 2;
}

function gridDimensions(region: PlateReliefRegion, isMobile: boolean) {
  const latitudeSpan = Math.max(0.1, region.north - region.south);
  const longitudeSpan = Math.max(0.1, (region.east - region.west) * Math.max(0.12, Math.cos(((region.north + region.south) / 2) * Math.PI / 180)));
  const aspect = clamp(longitudeSpan / latitudeSpan, 0.5, 2.5);
  const longest = isMobile ? 96 : 150;
  const width = aspect >= 1 ? longest : Math.max(48, Math.round(longest * aspect));
  const height = aspect >= 1 ? Math.max(48, Math.round(longest / aspect)) : longest;
  const sizeZ = 112;
  const sizeX = sizeZ * aspect;
  return { width, height, sizeX, sizeZ };
}

function createFallbackGrid(region: PlateReliefRegion, isMobile: boolean): ReliefGrid {
  const dimensions = gridDimensions(region, isMobile);
  const elevations = new Float32Array(dimensions.width * dimensions.height);
  elevations.fill(-2200);
  return { ...dimensions, elevations, terrainZoom: -1 };
}

function decodeTerrarium(red: number, green: number, blue: number) {
  return red * 256 + green + blue / 256 - 32768;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar ${source}`));
    image.src = source;
  });
}

async function loadReliefGrid(region: PlateReliefRegion, isMobile: boolean): Promise<ReliefGrid> {
  const terrainZoom = terrainZoomForRegion(region, isMobile);
  const xMin = Math.floor(worldPixelX(region.west, terrainZoom) / TILE_SIZE);
  const xMax = Math.floor(worldPixelX(region.east, terrainZoom) / TILE_SIZE);
  const yMin = Math.floor(worldPixelY(region.north, terrainZoom) / TILE_SIZE);
  const yMax = Math.floor(worldPixelY(region.south, terrainZoom) / TILE_SIZE);
  const tileColumns = xMax - xMin + 1;
  const tileRows = yMax - yMin + 1;
  const worldTiles = 2 ** terrainZoom;
  if (tileColumns <= 0 || tileRows <= 0 || tileColumns * tileRows > 28) throw new Error("La ventana de interacción requiere demasiados tiles.");

  const canvas = document.createElement("canvas");
  canvas.width = tileColumns * TILE_SIZE;
  canvas.height = tileRows * TILE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D no disponible para decodificar el relieve.");

  const requests: Promise<void>[] = [];
  for (let y = yMin; y <= yMax; y += 1) {
    if (y < 0 || y >= worldTiles) continue;
    for (let x = xMin; x <= xMax; x += 1) {
      const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;
      requests.push(loadImage(`/api/tectonic-relief/tile?z=${terrainZoom}&x=${wrappedX}&y=${y}`).then((image) => {
        context.drawImage(image, (x - xMin) * TILE_SIZE, (y - yMin) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }));
    }
  }
  if (!requests.length) throw new Error("No hay tiles de elevación válidos para esta región.");
  await Promise.all(requests);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const dimensions = gridDimensions(region, isMobile);
  const elevations = new Float32Array(dimensions.width * dimensions.height);
  for (let row = 0; row < dimensions.height; row += 1) {
    const latitude = region.north - (row / (dimensions.height - 1)) * (region.north - region.south);
    const sourceY = clamp(Math.round(worldPixelY(latitude, terrainZoom) - yMin * TILE_SIZE), 0, canvas.height - 1);
    for (let column = 0; column < dimensions.width; column += 1) {
      const longitude = region.west + (column / (dimensions.width - 1)) * (region.east - region.west);
      const sourceX = clamp(Math.round(worldPixelX(longitude, terrainZoom) - xMin * TILE_SIZE), 0, canvas.width - 1);
      const pixelIndex = (sourceY * canvas.width + sourceX) * 4;
      elevations[row * dimensions.width + column] = clamp(
        decodeTerrarium(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2]),
        -10_500,
        6_500,
      );
    }
  }
  return { ...dimensions, elevations, terrainZoom };
}

function terrainColor(elevation: number) {
  const color = new THREE.Color();
  if (elevation < -6500) return color.set("#24134f");
  if (elevation < -4200) return color.set("#1e3a78");
  if (elevation < -2200) return color.set("#155e8f");
  if (elevation < -500) return color.set("#1789a3");
  if (elevation < 0) return color.set("#4aa9b6");
  if (elevation < 350) return color.set("#4c8d55");
  if (elevation < 1100) return color.set("#78964b");
  if (elevation < 2200) return color.set("#b18e43");
  if (elevation < 3300) return color.set("#835739");
  return color.set("#c9c5bc");
}

function pointToScene(longitude: number, latitude: number, grid: ReliefGrid, region: PlateReliefRegion) {
  const unwrapped = unwrapLongitude(longitude, region.centerLongitude);
  const x = ((unwrapped - region.west) / (region.east - region.west) - 0.5) * grid.sizeX;
  const z = (0.5 - (latitude - region.south) / (region.north - region.south)) * grid.sizeZ;
  return { x, z };
}

function elevationAt(longitude: number, latitude: number, grid: ReliefGrid, region: PlateReliefRegion) {
  const unwrapped = unwrapLongitude(longitude, region.centerLongitude);
  const u = clamp((unwrapped - region.west) / (region.east - region.west), 0, 1) * (grid.width - 1);
  const v = clamp((region.north - latitude) / (region.north - region.south), 0, 1) * (grid.height - 1);
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = u - x0;
  const ty = v - y0;
  const a = grid.elevations[y0 * grid.width + x0];
  const b = grid.elevations[y0 * grid.width + x1];
  const c = grid.elevations[y1 * grid.width + x0];
  const d = grid.elevations[y1 * grid.width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function createTerrainMesh(grid: ReliefGrid, region: PlateReliefRegion) {
  const positions = new Float32Array(grid.width * grid.height * 3);
  const colors = new Float32Array(grid.width * grid.height * 3);
  for (let row = 0; row < grid.height; row += 1) {
    const latitude = region.north - row / (grid.height - 1) * (region.north - region.south);
    for (let column = 0; column < grid.width; column += 1) {
      const longitude = region.west + column / (grid.width - 1) * (region.east - region.west);
      const index = row * grid.width + column;
      const scene = pointToScene(longitude, latitude, grid, region);
      const elevation = grid.elevations[index];
      positions[index * 3] = scene.x;
      positions[index * 3 + 1] = elevation * BASE_TERRAIN_Y;
      positions[index * 3 + 2] = scene.z;
      const color = terrainColor(elevation);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < grid.height - 1; row += 1) {
    for (let column = 0; column < grid.width - 1; column += 1) {
      const a = row * grid.width + column;
      const b = a + 1;
      const c = a + grid.width;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }));
}

function createBlockSkirt(grid: ReliefGrid, region: PlateReliefRegion) {
  const border: number[] = [];
  for (let column = 0; column < grid.width; column += 1) border.push(column);
  for (let row = 1; row < grid.height; row += 1) border.push(row * grid.width + grid.width - 1);
  for (let column = grid.width - 2; column >= 0; column -= 1) border.push((grid.height - 1) * grid.width + column);
  for (let row = grid.height - 2; row > 0; row -= 1) border.push(row * grid.width);
  const vertices: number[] = [];
  const indices: number[] = [];
  const bottomY = -12;
  const point = (index: number) => {
    const row = Math.floor(index / grid.width);
    const column = index % grid.width;
    const longitude = region.west + column / (grid.width - 1) * (region.east - region.west);
    const latitude = region.north - row / (grid.height - 1) * (region.north - region.south);
    const scene = pointToScene(longitude, latitude, grid, region);
    return [scene.x, grid.elevations[index] * BASE_TERRAIN_Y, scene.z] as const;
  };
  for (let segment = 0; segment < border.length; segment += 1) {
    const next = (segment + 1) % border.length;
    const a = point(border[segment]);
    const b = point(border[next]);
    const base = vertices.length / 3;
    vertices.push(a[0], a[1], a[2], b[0], b[1], b[2], a[0], bottomY, a[2], b[0], bottomY, b[2]);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#0e2031", roughness: 1, side: THREE.DoubleSide }));
}

function createLineSegments(lines: Pair[][], grid: ReliefGrid, region: PlateReliefRegion, color: string, offset = 0.38, opacity = 0.95) {
  const positions: number[] = [];
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1];
      const b = line[index];
      const sceneA = pointToScene(a[0], a[1], grid, region);
      const sceneB = pointToScene(b[0], b[1], grid, region);
      positions.push(
        sceneA.x, elevationAt(a[0], a[1], grid, region) * BASE_TERRAIN_Y + offset, sceneA.z,
        sceneB.x, elevationAt(b[0], b[1], grid, region) * BASE_TERRAIN_Y + offset, sceneB.z,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

function plateLines(features: GeoFeature[], region: PlateReliefRegion) {
  const result: Pair[][] = [];
  for (const feature of features) {
    const lines: Pair[][] = [];
    coordinateLines(feature.geometry?.coordinates, lines);
    for (const line of lines) result.push(...regionalSegments(line, region));
  }
  return result;
}

function createPlateOverlay(features: GeoFeature[], grid: ReliefGrid, region: PlateReliefRegion, color: string, offset: number) {
  const positions: number[] = [];
  for (const feature of features) {
    for (const sourceRing of polygonOuterRings(feature)) {
      const ring = compactRing(sourceRing).filter((point) => insideRegion(point, region, 1));
      if (ring.length < 3) continue;
      const projected = ring.map(([lng, lat]) => {
        const scene = pointToScene(lng, lat, grid, region);
        return new THREE.Vector2(scene.x, scene.z);
      });
      let faces: number[][] = [];
      try { faces = THREE.ShapeUtils.triangulateShape(projected, []); } catch { faces = []; }
      for (const face of faces) {
        for (const index of face) {
          const [lng, lat] = ring[index];
          const scene = pointToScene(lng, lat, grid, region);
          const y = elevationAt(lng, lat, grid, region) * BASE_TERRAIN_Y + offset;
          positions.push(scene.x, y, scene.z);
        }
      }
    }
  }
  const group = new THREE.Group();
  if (!positions.length) return group;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  mesh.renderOrder = 3;
  group.add(mesh);
  return group;
}

function faultLines(features: ActiveFaultFeature[], region: PlateReliefRegion) {
  const groups = { reverse: [] as Pair[][], normal: [] as Pair[][], strike: [] as Pair[][], other: [] as Pair[][] };
  for (const feature of features) {
    const lines: Pair[][] = [];
    coordinateLines(feature.geometry?.coordinates, lines);
    const type = (feature.properties.slipType ?? "").toLowerCase();
    const target = type.includes("reverse") || type.includes("thrust") ? groups.reverse
      : type.includes("normal") ? groups.normal
        : type.includes("strike") || type.includes("sinistral") || type.includes("dextral") ? groups.strike
          : groups.other;
    for (const line of lines) target.push(...regionalSegments(line, region));
  }
  return groups;
}

function slabDepthColor(depthKm: number) {
  if (depthKm <= 70) return SLAB_SHALLOW;
  if (depthKm <= 300) return SLAB_INTERMEDIATE;
  return SLAB_DEEP;
}

function createSlabLayers(contours: SlabContour3D[], grid: ReliefGrid, region: PlateReliefRegion) {
  const groups = new Map<string, number[]>([
    [SLAB_SHALLOW, []],
    [SLAB_INTERMEDIATE, []],
    [SLAB_DEEP, []],
  ]);
  for (const contour of contours) {
    const positions = groups.get(slabDepthColor(contour.depthKm));
    if (!positions) continue;
    let previous: { lat: number; lng: number } | null = null;
    for (const point of contour.points) {
      if (!insideRegion([point.lng, point.lat], region, 0.6)) {
        previous = null;
        continue;
      }
      if (previous) {
        const a = pointToScene(previous.lng, previous.lat, grid, region);
        const b = pointToScene(point.lng, point.lat, grid, region);
        const y = -contour.depthKm * BASE_DEPTH_Y;
        positions.push(a.x, y, a.z, b.x, y, b.z);
      }
      previous = point;
    }
  }
  const group = new THREE.Group();
  for (const [color, positions] of groups) {
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.88 }),
    ));
  }
  return group;
}

function contoursInRegion(contours: SlabContour3D[], region: PlateReliefRegion) {
  return contours.filter((contour) => contour.points.some((point) => insideRegion([point.lng, point.lat], region, 0.8)));
}

function emptyQuakeCounts(): QuakeCounts {
  return { cortical: 0, interface: 0, intraslab: 0, deep: 0, unclassified: 0 };
}

function createEarthquakes(
  events: EarthquakeEvent[],
  slabContours: SlabContour3D[],
  grid: ReliefGrid,
  region: PlateReliefRegion,
  isMobile: boolean,
) {
  const selected = events
    .filter((event) => insideRegion([event.longitude, event.latitude], region, 0))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, isMobile ? 320 : 700);
  const samples = buildSlabSamples(slabContours, isMobile ? 2200 : 4200);
  const geometry = new THREE.SphereGeometry(0.78, 7, 5);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, selected.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const counts = emptyQuakeCounts();

  selected.forEach((event, index) => {
    const scene = pointToScene(event.longitude, event.latitude, grid, region);
    const classification = classifyEventRelativeToSlab(event, samples);
    counts[classification.kind] += 1;
    const scale = clamp(0.68 + (event.magnitude - 4) * 0.34, 0.68, 2.1);
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(scene.x, -Math.max(1, event.depthKm) * BASE_DEPTH_Y, scene.z);
    mesh.setMatrixAt(index, matrix);
    color.set(SLAB_EVENT_COLORS[classification.kind]);
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, count: selected.length, counts };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const item = child as THREE.Mesh;
    item.geometry?.dispose?.();
    const material = item.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose?.();
  });
}

export function TectonicRelief3DRenderer({
  tectonic,
  earthquakes,
  plateIds,
  reliefExaggeration,
  depthExaggeration,
  showPlates,
  showFaults,
  showSlabs,
  showEarthquakes,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const plateGroupRef = useRef<THREE.Group | null>(null);
  const faultGroupRef = useRef<THREE.Group | null>(null);
  const slabGroupRef = useRef<THREE.Group | null>(null);
  const quakeGroupRef = useRef<THREE.Group | null>(null);
  const [status, setStatus] = useState("Preparando zona de interacción…");
  const [faultCount, setFaultCount] = useState<number | null>(null);
  const [quakeCount, setQuakeCount] = useState(0);
  const [quakeCounts, setQuakeCounts] = useState<QuakeCounts>(emptyQuakeCounts());
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePlateIds = useMemo(() => [...new Set(plateIds.filter(Boolean))].slice(0, 4), [plateIds]);
  const region = useMemo(
    () => computePlatesReliefRegion(tectonic.platePolygons.features, activePlateIds),
    [activePlateIds, tectonic.platePolygons.features],
  );
  const selectedPlates = useMemo(() => activePlateIds.map((id, index) => {
    const features = plateFeatures(tectonic.platePolygons.features, id);
    return {
      id,
      name: features.length ? plateNameOf(features[0]) : id,
      features,
      color: PLATE_COLORS[index % PLATE_COLORS.length],
    };
  }), [activePlateIds, tectonic.platePolygons.features]);
  const selectedFeatureCount = selectedPlates.reduce((sum, plate) => sum + plate.features.length, 0);

  useEffect(() => {
    terrainGroupRef.current?.scale.set(1, reliefExaggeration, 1);
    plateGroupRef.current?.scale.set(1, reliefExaggeration, 1);
    faultGroupRef.current?.scale.set(1, reliefExaggeration, 1);
  }, [reliefExaggeration]);

  useEffect(() => {
    slabGroupRef.current?.scale.set(1, depthExaggeration, 1);
    quakeGroupRef.current?.scale.set(1, depthExaggeration, 1);
  }, [depthExaggeration]);

  useEffect(() => {
    if (plateGroupRef.current) plateGroupRef.current.visible = showPlates;
    if (faultGroupRef.current) faultGroupRef.current.visible = showFaults;
    if (slabGroupRef.current) slabGroupRef.current.visible = showSlabs;
    if (quakeGroupRef.current) quakeGroupRef.current.visible = showEarthquakes;
  }, [showEarthquakes, showFaults, showPlates, showSlabs]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !region) {
      if (!region) setError("No fue posible calcular la zona de interacción de las placas seleccionadas.");
      return;
    }
    const activeRegion = region;
    const regionalSlabs = contoursInRegion(tectonic.slabContours, activeRegion);
    let disposed = false;
    let frame = 0;
    const isMobile = window.matchMedia("(max-width: 700px)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", alpha: false });
    } catch (webglError) {
      setError(webglError instanceof Error ? webglError.message : "WebGL no está disponible.");
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#020712");
    scene.fog = new THREE.Fog("#020712", 250, 690);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1500);
    renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight("#d5ecff", "#17101f", 1.2));
    const key = new THREE.DirectionalLight("#fff3d0", 1.5);
    key.position.set(-80, 150, 90);
    scene.add(key);

    const fallbackGrid = createFallbackGrid(activeRegion, isMobile);
    const maxDimension = Math.max(fallbackGrid.sizeX, fallbackGrid.sizeZ);
    camera.position.set(maxDimension * 0.82, maxDimension * 0.6, maxDimension * 0.98);
    camera.far = Math.max(1000, maxDimension * 9);
    camera.updateProjectionMatrix();
    controls.minDistance = maxDimension * 0.4;
    controls.maxDistance = maxDimension * 4.6;
    controls.target.set(0, -2, 0);
    controls.update();

    const replaceGroup = (oldGroup: THREE.Group | null, nextGroup: THREE.Group) => {
      if (oldGroup) {
        scene.remove(oldGroup);
        disposeObject(oldGroup);
      }
      scene.add(nextGroup);
      return nextGroup;
    };

    const buildSurfaceGroups = (grid: ReliefGrid) => {
      const terrain = new THREE.Group();
      terrain.add(createTerrainMesh(grid, activeRegion));
      terrain.add(createBlockSkirt(grid, activeRegion));
      terrain.scale.y = reliefExaggeration;
      terrainGroupRef.current = replaceGroup(terrainGroupRef.current, terrain);

      const plates = new THREE.Group();
      plates.add(createLineSegments(plateLines(tectonic.platePolygons.features, activeRegion), grid, activeRegion, "#8fa6b8", 0.45, 0.28));
      selectedPlates.forEach((plate, index) => {
        const offset = 0.34 + index * 0.18;
        plates.add(createPlateOverlay(plate.features, grid, activeRegion, plate.color, offset));
        plates.add(createLineSegments(plateLines(plate.features, activeRegion), grid, activeRegion, plate.color, offset + 0.36, 1));
      });
      plates.scale.y = reliefExaggeration;
      plates.visible = showPlates;
      plateGroupRef.current = replaceGroup(plateGroupRef.current, plates);
      return grid;
    };

    const rebuildDepthLayers = (grid: ReliefGrid) => {
      const slabGroup = new THREE.Group();
      slabGroup.add(createSlabLayers(regionalSlabs, grid, activeRegion));
      slabGroup.scale.y = depthExaggeration;
      slabGroup.visible = showSlabs;
      slabGroupRef.current = replaceGroup(slabGroupRef.current, slabGroup);

      const quakeGroup = new THREE.Group();
      const quakeData = createEarthquakes(earthquakes, regionalSlabs, grid, activeRegion, isMobile);
      quakeGroup.add(quakeData.mesh);
      quakeGroup.scale.y = depthExaggeration;
      quakeGroup.visible = showEarthquakes;
      quakeGroupRef.current = replaceGroup(quakeGroupRef.current, quakeGroup);
      setQuakeCount(quakeData.count);
      setQuakeCounts(quakeData.counts);
    };

    const initialGrid = buildSurfaceGroups(fallbackGrid);
    rebuildDepthLayers(initialGrid);
    setFaultCount(null);
    setError(null);
    setWarning(null);
    const focusText = activeRegion.focusPlateName ? ` · foco ${activeRegion.focusPlateName}` : "";
    setStatus(`Base visible · ${selectedPlates.length} placas${focusText}`);

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = isMobile ? Math.max(500, Math.min(660, width * 1.08)) : Math.max(580, Math.min(780, width * 0.68));
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) setError("Chrome perdió el contexto WebGL. Recarga esta pestaña para reiniciar el visor.");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost, false);

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    void loadReliefGrid(activeRegion, isMobile)
      .then((grid) => {
        if (disposed) return;
        buildSurfaceGroups(grid);
        rebuildDepthLayers(grid);
        const focus = activeRegion.focusPlateName ? ` · foco ${activeRegion.focusPlateName}` : "";
        setStatus(`Relieve listo · ${selectedPlates.length} placas · DEM z${grid.terrainZoom}${focus}`);
        return fetch(`/api/faults?bbox=${encodeURIComponent(faultBboxForRegion(activeRegion))}&limit=1200`, { cache: "force-cache" })
          .then(async (response) => response.ok ? await response.json() as ActiveFaultCollection : null)
          .then((faults) => {
            if (disposed) return;
            const group = new THREE.Group();
            if (faults) {
              const grouped = faultLines(faults.features, activeRegion);
              group.add(createLineSegments(grouped.reverse, grid, activeRegion, "#ff3b3b", 0.82));
              group.add(createLineSegments(grouped.normal, grid, activeRegion, "#39d8ff", 0.79));
              group.add(createLineSegments(grouped.strike, grid, activeRegion, "#ffbf47", 0.85));
              group.add(createLineSegments(grouped.other, grid, activeRegion, "#f472b6", 0.78));
              setFaultCount(faults.features.length);
            } else setFaultCount(0);
            group.scale.y = reliefExaggeration;
            group.visible = showFaults;
            faultGroupRef.current = replaceGroup(faultGroupRef.current, group);
          });
      })
      .catch((demError: unknown) => {
        if (!disposed) {
          setWarning(`DEM no disponible: ${demError instanceof Error ? demError.message : "error de elevación"}. Se mantiene la base tectónica plana.`);
          setStatus(`Base tectónica visible · ${selectedPlates.length} placas`);
          setFaultCount(0);
        }
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      terrainGroupRef.current = null;
      plateGroupRef.current = null;
      faultGroupRef.current = null;
      slabGroupRef.current = null;
      quakeGroupRef.current = null;
      disposeObject(scene);
      renderer.dispose();
      if (host.contains(renderer.domElement)) renderer.domElement.remove();
    };
  }, [depthExaggeration, earthquakes, region, reliefExaggeration, selectedFeatureCount, selectedPlates, showEarthquakes, showFaults, showPlates, showSlabs, tectonic]);

  return (
    <div style={{ position: "relative", minHeight: 520, overflow: "hidden", borderRadius: 18, background: "#020712" }}>
      <div ref={containerRef} style={{ width: "100%", minHeight: 520, touchAction: "none" }} />

      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, display: "flex", gap: 7, flexWrap: "wrap", maxWidth: "calc(100% - 24px)", pointerEvents: "none" }}>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.86)", border: "1px solid rgba(125,211,252,.25)", color: "#d8f2ff", fontSize: 11, fontWeight: 800 }}>{selectedPlates.length} placas · {selectedFeatureCount} fragmentos agrupados</span>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.86)", border: "1px solid rgba(255,255,255,.13)", color: "#d9e4ef", fontSize: 11 }}>{status}</span>
      </div>

      <div style={{ position: "absolute", top: 48, left: 12, right: 12, zIndex: 4, display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "none" }}>
        {selectedPlates.map((plate) => (
          <span key={plate.id} style={{ padding: "5px 8px", borderRadius: 999, background: `${plate.color}22`, border: `1px solid ${plate.color}bb`, color: plate.color, fontSize: 10, fontWeight: 900 }}>{plate.name}</span>
        ))}
      </div>

      <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, zIndex: 4, display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "none" }}>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_SHALLOW, fontSize: 10 }}>— Slab2 0–70 km</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_INTERMEDIATE, fontSize: 10 }}>— Slab2 70–300</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_DEEP, fontSize: 10 }}>— Slab2 &gt;300</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_EVENT_COLORS.cortical, fontSize: 10 }}>● cortical {quakeCounts.cortical}</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_EVENT_COLORS.interface, fontSize: 10 }}>● interfaz {quakeCounts.interface}</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_EVENT_COLORS.intraslab, fontSize: 10 }}>● intraslab {quakeCounts.intraslab}</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: SLAB_EVENT_COLORS.deep, fontSize: 10 }}>● profundo {quakeCounts.deep}</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.82)", color: "#cad8e6", fontSize: 10 }}>{faultCount === null ? "fallas…" : `${faultCount} fallas`} · {quakeCount} sismos</span>
      </div>

      <div style={{ position: "absolute", right: 12, top: 84, zIndex: 4, maxWidth: 260, padding: "7px 9px", borderRadius: 10, background: "rgba(2,7,18,.78)", color: "#a8b8c8", fontSize: 9.5, lineHeight: 1.35, pointerEvents: "none" }}>
        Interfaz/intraslab = clasificación geométrica aproximada respecto a la superficie Slab2; no sustituye mecanismos focales ni interpretación publicada.
      </div>

      {warning && <div style={{ position: "absolute", top: 118, left: 12, right: 12, zIndex: 5, padding: 9, borderRadius: 10, background: "rgba(86,54,8,.9)", color: "#fde68a", fontSize: 11 }}>{warning}</div>}
      {error && <div style={{ position: "absolute", inset: "42% 16px auto", zIndex: 6, padding: 14, borderRadius: 12, background: "rgba(64,10,20,.94)", color: "#ffd7df", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
