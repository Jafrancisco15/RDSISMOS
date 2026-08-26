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
import type { SlabContour3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

const TILE_SIZE = 256;
const BASE_TERRAIN_Y = 0.0009;
const BASE_DEPTH_Y = 0.1;
const SELECTED_COLORS = ["#fff0a6", "#67e8f9", "#c4b5fd", "#86efac"];

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
  for (let zoom = 6; zoom >= 1; zoom -= 1) {
    if (terrainTileCount(region, zoom) <= budget) return zoom;
  }
  return 1;
}

function gridDimensions(region: PlateReliefRegion, isMobile: boolean) {
  const latitudeSpan = Math.max(0.1, region.north - region.south);
  const longitudeSpan = Math.max(0.1, (region.east - region.west) * Math.max(0.12, Math.cos(((region.north + region.south) / 2) * Math.PI / 180)));
  const aspect = clamp(longitudeSpan / latitudeSpan, 0.45, 2.8);
  const longest = isMobile ? 96 : 148;
  const width = aspect >= 1 ? longest : Math.max(46, Math.round(longest * aspect));
  const height = aspect >= 1 ? Math.max(46, Math.round(longest / aspect)) : longest;
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
  if (tileColumns <= 0 || tileRows <= 0 || tileColumns * tileRows > 32) throw new Error("La extensión seleccionada requiere demasiados tiles de relieve.");

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
      const elevation = decodeTerrarium(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2]);
      elevations[row * dimensions.width + column] = clamp(elevation, -10_500, 6_500);
    }
  }
  return { ...dimensions, elevations, terrainZoom };
}

function terrainColor(elevation: number) {
  const color = new THREE.Color();
  if (elevation < -6500) return color.set("#32105f");
  if (elevation < -4200) return color.set("#233d9a");
  if (elevation < -2200) return color.set("#1778bd");
  if (elevation < -500) return color.set("#22a8c7");
  if (elevation < 0) return color.set("#63c9d7");
  if (elevation < 350) return color.set("#3f9e58");
  if (elevation < 1100) return color.set("#8db54a");
  if (elevation < 2200) return color.set("#d4ad47");
  if (elevation < 3300) return color.set("#9a6638");
  return color.set("#ded8c8");
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
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }));
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
  for (let segment = 0; segment < border.length; segment += 1) {
    const next = (segment + 1) % border.length;
    const point = (index: number) => {
      const row = Math.floor(index / grid.width);
      const column = index % grid.width;
      const longitude = region.west + column / (grid.width - 1) * (region.east - region.west);
      const latitude = region.north - row / (grid.height - 1) * (region.north - region.south);
      const scene = pointToScene(longitude, latitude, grid, region);
      return [scene.x, grid.elevations[index] * BASE_TERRAIN_Y, scene.z] as const;
    };
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
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#10253a", roughness: 1, side: THREE.DoubleSide }));
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

function createPlateOverlay(features: GeoFeature[], grid: ReliefGrid, region: PlateReliefRegion, color: string) {
  const positions: number[] = [];
  for (const feature of features) {
    for (const sourceRing of polygonOuterRings(feature)) {
      const ring = compactRing(sourceRing).filter((point) => insideRegion(point, region, 0.8));
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
          const y = elevationAt(lng, lat, grid, region) * BASE_TERRAIN_Y + 0.24;
          positions.push(scene.x, y, scene.z);
        }
      }
    }
  }
  if (!positions.length) return new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.renderOrder = 2;
  const group = new THREE.Group();
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

function slabLines(contours: SlabContour3D[], grid: ReliefGrid, region: PlateReliefRegion) {
  const positions: number[] = [];
  for (const contour of contours) {
    let previous: { lat: number; lng: number } | null = null;
    for (const point of contour.points) {
      if (!insideRegion([point.lng, point.lat], region, 0.5)) {
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#d88cff", transparent: true, opacity: 0.65 }));
}

function createEarthquakes(events: EarthquakeEvent[], grid: ReliefGrid, region: PlateReliefRegion, isMobile: boolean) {
  const selected = events.filter((event) => insideRegion([event.longitude, event.latitude], region, 0))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, isMobile ? 300 : 650);
  const geometry = new THREE.SphereGeometry(0.78, 7, 5);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, selected.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  selected.forEach((event, index) => {
    const scene = pointToScene(event.longitude, event.latitude, grid, region);
    const scale = clamp(0.65 + (event.magnitude - 4) * 0.32, 0.65, 1.9);
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(scene.x, -Math.max(1, event.depthKm) * BASE_DEPTH_Y, scene.z);
    mesh.setMatrixAt(index, matrix);
    color.set(event.depthKm < 70 ? "#ff3f68" : event.depthKm < 300 ? "#ffad33" : "#67a8ff");
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, count: selected.length };
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
  const [status, setStatus] = useState("Preparando placas…");
  const [faultCount, setFaultCount] = useState<number | null>(null);
  const [quakeCount, setQuakeCount] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePlateIds = useMemo(() => [...new Set(plateIds.filter(Boolean))].slice(0, 4), [plateIds]);
  const region = useMemo(() => computePlatesReliefRegion(tectonic.platePolygons.features, activePlateIds), [activePlateIds, tectonic.platePolygons.features]);
  const selectedPlates = useMemo(() => activePlateIds.map((id, index) => {
    const features = plateFeatures(tectonic.platePolygons.features, id);
    return {
      id,
      name: features.length ? plateNameOf(features[0]) : id,
      features,
      color: SELECTED_COLORS[index % SELECTED_COLORS.length],
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
      if (!region) setError("No fue posible calcular la extensión combinada de las placas seleccionadas.");
      return;
    }
    const activeRegion = region;
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
    scene.fog = new THREE.Fog("#020712", 260, 720);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1600);
    renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight("#cfe9ff", "#1c1720", 1.15));
    const key = new THREE.DirectionalLight("#fff4d8", 1.45);
    key.position.set(-80, 150, 90);
    scene.add(key);

    const fallbackGrid = createFallbackGrid(activeRegion, isMobile);
    const maxDimension = Math.max(fallbackGrid.sizeX, fallbackGrid.sizeZ);
    camera.position.set(maxDimension * 0.82, maxDimension * 0.58, maxDimension * 0.98);
    camera.far = Math.max(1000, maxDimension * 9);
    camera.updateProjectionMatrix();
    controls.minDistance = maxDimension * 0.4;
    controls.maxDistance = maxDimension * 4.8;
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
      plates.add(createLineSegments(plateLines(tectonic.platePolygons.features, activeRegion), grid, activeRegion, "#8fa6b8", 0.5, 0.42));
      selectedPlates.forEach((plate, index) => {
        const overlay = createPlateOverlay(plate.features, grid, activeRegion, plate.color);
        overlay.renderOrder = 2 + index;
        plates.add(overlay);
        plates.add(createLineSegments(plateLines(plate.features, activeRegion), grid, activeRegion, plate.color, 0.9 + index * 0.05, 1));
      });
      plates.scale.y = reliefExaggeration;
      plates.visible = showPlates;
      plateGroupRef.current = replaceGroup(plateGroupRef.current, plates);
      return grid;
    };

    const initialGrid = buildSurfaceGroups(fallbackGrid);
    const slabs = new THREE.Group();
    slabs.add(slabLines(tectonic.slabContours, initialGrid, activeRegion));
    slabs.scale.y = depthExaggeration;
    slabs.visible = showSlabs;
    scene.add(slabs);
    slabGroupRef.current = slabs;

    const quakes = new THREE.Group();
    const quakeData = createEarthquakes(earthquakes, initialGrid, activeRegion, isMobile);
    quakes.add(quakeData.mesh);
    quakes.scale.y = depthExaggeration;
    quakes.visible = showEarthquakes;
    scene.add(quakes);
    quakeGroupRef.current = quakes;
    setQuakeCount(quakeData.count);
    setFaultCount(null);
    setError(null);
    setWarning(null);
    setStatus(`Base visible · ${selectedPlates.length} placas · ${selectedFeatureCount} polígonos`);

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
        setStatus(`Relieve listo · ${selectedPlates.length} placas · DEM z${grid.terrainZoom}`);
        return fetch(`/api/faults?bbox=${encodeURIComponent(faultBboxForRegion(activeRegion))}&limit=1200`, { cache: "force-cache" })
          .then(async (response) => response.ok ? await response.json() as ActiveFaultCollection : null)
          .then((faults) => {
            if (disposed) return;
            const group = new THREE.Group();
            if (faults) {
              const grouped = faultLines(faults.features, activeRegion);
              group.add(createLineSegments(grouped.reverse, grid, activeRegion, "#ff4d4f", 0.72));
              group.add(createLineSegments(grouped.normal, grid, activeRegion, "#4dd7ff", 0.69));
              group.add(createLineSegments(grouped.strike, grid, activeRegion, "#ffbf47", 0.75));
              group.add(createLineSegments(grouped.other, grid, activeRegion, "#e96fff", 0.68));
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
    <div style={{ position: "relative", minHeight: 500, overflow: "hidden", borderRadius: 18, background: "#020712" }}>
      <div ref={containerRef} style={{ width: "100%", minHeight: 500, touchAction: "none" }} />
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, display: "flex", gap: 7, flexWrap: "wrap", maxWidth: "calc(100% - 24px)", pointerEvents: "none" }}>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.84)", border: "1px solid rgba(125,211,252,.25)", color: "#d8f2ff", fontSize: 11, fontWeight: 800 }}>{selectedPlates.length} placas · {selectedFeatureCount} polígonos</span>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.84)", border: "1px solid rgba(255,255,255,.13)", color: "#d9e4ef", fontSize: 11 }}>{status}</span>
      </div>
      <div style={{ position: "absolute", top: 48, left: 12, right: 12, zIndex: 4, display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "none" }}>
        {selectedPlates.map((plate) => <span key={plate.id} style={{ padding: "5px 8px", borderRadius: 999, background: "rgba(2,7,18,.82)", border: `1px solid ${plate.color}88`, color: plate.color, fontSize: 10, fontWeight: 800 }}>{plate.name}</span>)}
      </div>
      <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, zIndex: 4, display: "flex", gap: 7, flexWrap: "wrap", pointerEvents: "none" }}>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.8)", color: "#ff4d4f", fontSize: 10 }}>— inversa</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.8)", color: "#4dd7ff", fontSize: 10 }}>— normal</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.8)", color: "#ffbf47", fontSize: 10 }}>— rumbo</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.8)", color: "#d88cff", fontSize: 10 }}>— Slab2</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.8)", color: "#cad8e6", fontSize: 10 }}>{faultCount === null ? "fallas…" : `${faultCount} fallas`} · {quakeCount} sismos</span>
      </div>
      {warning && <div style={{ position: "absolute", top: 82, left: 12, right: 12, zIndex: 5, padding: 9, borderRadius: 10, background: "rgba(86,54,8,.9)", color: "#fde68a", fontSize: 11 }}>{warning}</div>}
      {error && <div style={{ position: "absolute", inset: "42% 16px auto", zIndex: 6, padding: 14, borderRadius: 12, background: "rgba(64,10,20,.94)", color: "#ffd7df", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
