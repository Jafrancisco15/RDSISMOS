"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ActiveFaultCollection, ActiveFaultFeature } from "@/lib/activeFaults";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GeoFeature } from "@/lib/plateDynamics";
import type { SlabContour3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

const TILE_SIZE = 256;
const TERRAIN_ZOOM = 5;
const BASE_TERRAIN_Y = 0.0009;
const BASE_DEPTH_Y = 0.1;
const REGION = {
  id: "caribbean-pr-hispaniola",
  name: "Caribe · Puerto Rico · La Española",
  west: -72.8,
  south: 16,
  east: -61,
  north: 22.8,
};

type Pair = [number, number];
type ReliefGrid = {
  width: number;
  height: number;
  elevations: Float32Array;
  sizeX: number;
  sizeZ: number;
};

type Props = {
  tectonic: TectonicDepth3DResponse;
  earthquakes: EarthquakeEvent[];
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

function insideRegion([longitude, latitude]: Pair, margin = 0.35) {
  return longitude >= REGION.west - margin
    && longitude <= REGION.east + margin
    && latitude >= REGION.south - margin
    && latitude <= REGION.north + margin;
}

function regionalSegments(line: Pair[]) {
  const result: Pair[][] = [];
  let current: Pair[] = [];
  for (const point of line) {
    if (insideRegion(point)) {
      current.push(point);
    } else if (current.length) {
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

async function loadReliefGrid(isMobile: boolean): Promise<ReliefGrid> {
  const xMin = Math.floor(worldPixelX(REGION.west, TERRAIN_ZOOM) / TILE_SIZE);
  const xMax = Math.floor(worldPixelX(REGION.east, TERRAIN_ZOOM) / TILE_SIZE);
  const yMin = Math.floor(worldPixelY(REGION.north, TERRAIN_ZOOM) / TILE_SIZE);
  const yMax = Math.floor(worldPixelY(REGION.south, TERRAIN_ZOOM) / TILE_SIZE);
  const tileColumns = xMax - xMin + 1;
  const tileRows = yMax - yMin + 1;

  const canvas = document.createElement("canvas");
  canvas.width = tileColumns * TILE_SIZE;
  canvas.height = tileRows * TILE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D no disponible para decodificar el relieve.");

  const requests: Promise<void>[] = [];
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      requests.push(
        loadImage(`/api/tectonic-relief/tile?z=${TERRAIN_ZOOM}&x=${x}&y=${y}`).then((image) => {
          context.drawImage(image, (x - xMin) * TILE_SIZE, (y - yMin) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }),
      );
    }
  }
  await Promise.all(requests);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const width = isMobile ? 96 : 144;
  const height = isMobile ? 60 : 88;
  const elevations = new Float32Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const latitude = REGION.north - (row / (height - 1)) * (REGION.north - REGION.south);
    const sourceY = clamp(Math.round(worldPixelY(latitude, TERRAIN_ZOOM) - yMin * TILE_SIZE), 0, canvas.height - 1);
    for (let column = 0; column < width; column += 1) {
      const longitude = REGION.west + (column / (width - 1)) * (REGION.east - REGION.west);
      const sourceX = clamp(Math.round(worldPixelX(longitude, TERRAIN_ZOOM) - xMin * TILE_SIZE), 0, canvas.width - 1);
      const pixelIndex = (sourceY * canvas.width + sourceX) * 4;
      const elevation = decodeTerrarium(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2]);
      elevations[row * width + column] = clamp(elevation, -10_500, 6_500);
    }
  }

  const latitudeSpan = REGION.north - REGION.south;
  const longitudeSpan = (REGION.east - REGION.west) * Math.cos(((REGION.north + REGION.south) / 2) * Math.PI / 180);
  const sizeZ = 112;
  const sizeX = sizeZ * longitudeSpan / latitudeSpan;
  return { width, height, elevations, sizeX, sizeZ };
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

function pointToScene(longitude: number, latitude: number, grid: ReliefGrid) {
  const x = ((longitude - REGION.west) / (REGION.east - REGION.west) - 0.5) * grid.sizeX;
  const z = (0.5 - (latitude - REGION.south) / (REGION.north - REGION.south)) * grid.sizeZ;
  return { x, z };
}

function elevationAt(longitude: number, latitude: number, grid: ReliefGrid) {
  const u = clamp((longitude - REGION.west) / (REGION.east - REGION.west), 0, 1) * (grid.width - 1);
  const v = clamp((REGION.north - latitude) / (REGION.north - REGION.south), 0, 1) * (grid.height - 1);
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

function createTerrainMesh(grid: ReliefGrid) {
  const positions = new Float32Array(grid.width * grid.height * 3);
  const colors = new Float32Array(grid.width * grid.height * 3);
  for (let row = 0; row < grid.height; row += 1) {
    const latitude = REGION.north - row / (grid.height - 1) * (REGION.north - REGION.south);
    for (let column = 0; column < grid.width; column += 1) {
      const longitude = REGION.west + column / (grid.width - 1) * (REGION.east - REGION.west);
      const index = row * grid.width + column;
      const scene = pointToScene(longitude, latitude, grid);
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
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createBlockSkirt(grid: ReliefGrid) {
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
    const aIndex = border[segment];
    const bIndex = border[next];
    const aRow = Math.floor(aIndex / grid.width);
    const aColumn = aIndex % grid.width;
    const bRow = Math.floor(bIndex / grid.width);
    const bColumn = bIndex % grid.width;
    const point = (row: number, column: number) => {
      const longitude = REGION.west + column / (grid.width - 1) * (REGION.east - REGION.west);
      const latitude = REGION.north - row / (grid.height - 1) * (REGION.north - REGION.south);
      const scene = pointToScene(longitude, latitude, grid);
      return [scene.x, grid.elevations[row * grid.width + column] * BASE_TERRAIN_Y, scene.z] as const;
    };
    const a = point(aRow, aColumn);
    const b = point(bRow, bColumn);
    const base = vertices.length / 3;
    vertices.push(a[0], a[1], a[2], b[0], b[1], b[2], a[0], bottomY, a[2], b[0], bottomY, b[2]);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: "#10253a", roughness: 1, transparent: true, opacity: 0.96, side: THREE.DoubleSide }),
  );
}

function createLineSegments(lines: Pair[][], grid: ReliefGrid, color: string, offset = 0.38) {
  const positions: number[] = [];
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1];
      const b = line[index];
      const sceneA = pointToScene(a[0], a[1], grid);
      const sceneB = pointToScene(b[0], b[1], grid);
      positions.push(
        sceneA.x, elevationAt(a[0], a[1], grid) * BASE_TERRAIN_Y + offset, sceneA.z,
        sceneB.x, elevationAt(b[0], b[1], grid) * BASE_TERRAIN_Y + offset, sceneB.z,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
}

function plateLines(features: GeoFeature[]) {
  const result: Pair[][] = [];
  for (const feature of features) {
    const lines: Pair[][] = [];
    coordinateLines(feature.geometry?.coordinates, lines);
    for (const line of lines) result.push(...regionalSegments(line));
  }
  return result;
}

function faultLines(features: ActiveFaultFeature[]) {
  const groups = { reverse: [] as Pair[][], normal: [] as Pair[][], strike: [] as Pair[][], other: [] as Pair[][] };
  for (const feature of features) {
    const lines: Pair[][] = [];
    coordinateLines(feature.geometry?.coordinates, lines);
    const type = (feature.properties.slipType ?? "").toLowerCase();
    const target = type.includes("reverse") || type.includes("thrust")
      ? groups.reverse
      : type.includes("normal")
        ? groups.normal
        : type.includes("strike") || type.includes("sinistral") || type.includes("dextral")
          ? groups.strike
          : groups.other;
    for (const line of lines) target.push(...regionalSegments(line));
  }
  return groups;
}

function slabLines(contours: SlabContour3D[], grid: ReliefGrid) {
  const positions: number[] = [];
  for (const contour of contours) {
    const regional = contour.points.filter((point) => insideRegion([point.lng, point.lat], 0.5));
    for (let index = 1; index < regional.length; index += 1) {
      const a = regional[index - 1];
      const b = regional[index];
      const sceneA = pointToScene(a.lng, a.lat, grid);
      const sceneB = pointToScene(b.lng, b.lat, grid);
      const y = -contour.depthKm * BASE_DEPTH_Y;
      positions.push(sceneA.x, y, sceneA.z, sceneB.x, y, sceneB.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: "#d88cff", transparent: true, opacity: 0.62 }),
  );
}

function createEarthquakes(events: EarthquakeEvent[], grid: ReliefGrid, isMobile: boolean) {
  const selected = events
    .filter((event) => event.longitude >= REGION.west && event.longitude <= REGION.east && event.latitude >= REGION.south && event.latitude <= REGION.north)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, isMobile ? 350 : 700);
  const geometry = new THREE.SphereGeometry(0.78, 8, 6);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, selected.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  selected.forEach((event, index) => {
    const scene = pointToScene(event.longitude, event.latitude, grid);
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

function disposeGroup(group: THREE.Object3D) {
  group.traverse((object) => {
    const item = object as THREE.Mesh;
    item.geometry?.dispose?.();
    const material = item.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose?.();
  });
}

export function TectonicRelief3DRenderer({
  tectonic,
  earthquakes,
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
  const [status, setStatus] = useState("Cargando topografía y batimetría…");
  const [faultCount, setFaultCount] = useState<number | null>(null);
  const [quakeCount, setQuakeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const isMobile = window.matchMedia("(max-width: 700px)").matches;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#020712");
    scene.fog = new THREE.Fog("#020712", 230, 430);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
    camera.position.set(155, 105, 175);

    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: "high-performance", alpha: false });
    renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 95;
    controls.maxDistance = 390;
    controls.target.set(0, -3, 0);
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight("#cfe9ff", "#1c1720", 1.05));
    const key = new THREE.DirectionalLight("#fff4d8", 1.55);
    key.position.set(-80, 150, 90);
    scene.add(key);
    const rim = new THREE.DirectionalLight("#74b9ff", 0.55);
    rim.position.set(120, 35, -110);
    scene.add(rim);

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = isMobile ? Math.max(430, Math.min(620, width * 0.92)) : Math.max(560, Math.min(760, width * 0.64));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    async function build() {
      try {
        setError(null);
        setStatus("Cargando topografía y batimetría…");
        const [grid, faultsResponse] = await Promise.all([
          loadReliefGrid(isMobile),
          fetch(`/api/faults?bbox=${REGION.west},${REGION.south},${REGION.east},${REGION.north}&limit=1200`, { cache: "force-cache" }),
        ]);
        if (disposed) return;
        const faults = faultsResponse.ok ? await faultsResponse.json() as ActiveFaultCollection : null;

        const terrainGroup = new THREE.Group();
        terrainGroup.add(createTerrainMesh(grid));
        terrainGroup.add(createBlockSkirt(grid));
        terrainGroup.scale.y = reliefExaggeration;
        scene.add(terrainGroup);
        terrainGroupRef.current = terrainGroup;

        const plateGroup = new THREE.Group();
        plateGroup.add(createLineSegments(plateLines(tectonic.platePolygons.features), grid, "#f7f4e8", 0.48));
        plateGroup.scale.y = reliefExaggeration;
        plateGroup.visible = showPlates;
        scene.add(plateGroup);
        plateGroupRef.current = plateGroup;

        const faultGroup = new THREE.Group();
        if (faults) {
          const grouped = faultLines(faults.features);
          faultGroup.add(createLineSegments(grouped.reverse, grid, "#ff4d4f", 0.66));
          faultGroup.add(createLineSegments(grouped.normal, grid, "#4dd7ff", 0.63));
          faultGroup.add(createLineSegments(grouped.strike, grid, "#ffbf47", 0.7));
          faultGroup.add(createLineSegments(grouped.other, grid, "#e96fff", 0.62));
          setFaultCount(faults.features.length);
        } else {
          setFaultCount(0);
        }
        faultGroup.scale.y = reliefExaggeration;
        faultGroup.visible = showFaults;
        scene.add(faultGroup);
        faultGroupRef.current = faultGroup;

        const slabGroup = new THREE.Group();
        slabGroup.add(slabLines(tectonic.slabContours, grid));
        slabGroup.scale.y = depthExaggeration;
        slabGroup.visible = showSlabs;
        scene.add(slabGroup);
        slabGroupRef.current = slabGroup;

        const quakeGroup = new THREE.Group();
        const quakes = createEarthquakes(earthquakes, grid, isMobile);
        quakeGroup.add(quakes.mesh);
        quakeGroup.scale.y = depthExaggeration;
        quakeGroup.visible = showEarthquakes;
        scene.add(quakeGroup);
        quakeGroupRef.current = quakeGroup;
        setQuakeCount(quakes.count);
        setStatus("Relieve listo");
      } catch (buildError) {
        if (!disposed) {
          setStatus("No disponible");
          setError(buildError instanceof Error ? buildError.message : "No fue posible construir el relieve 3D.");
        }
      }
    }
    void build();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      terrainGroupRef.current = null;
      plateGroupRef.current = null;
      faultGroupRef.current = null;
      slabGroupRef.current = null;
      quakeGroupRef.current = null;
      disposeGroup(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [earthquakes, tectonic]);

  return (
    <div style={{ position: "relative", minHeight: 430, overflow: "hidden", borderRadius: 18, background: "#020712" }}>
      <div ref={containerRef} style={{ width: "100%", touchAction: "none" }} />
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, display: "flex", gap: 7, flexWrap: "wrap", pointerEvents: "none" }}>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.78)", border: "1px solid rgba(125,211,252,.25)", color: "#d8f2ff", fontSize: 11, fontWeight: 800 }}>{REGION.name}</span>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.78)", border: "1px solid rgba(255,255,255,.13)", color: "#d9e4ef", fontSize: 11 }}>{status}</span>
      </div>
      <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, zIndex: 4, display: "flex", gap: 7, flexWrap: "wrap", pointerEvents: "none" }}>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.76)", color: "#f7f4e8", fontSize: 10 }}>— placa</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.76)", color: "#ff4d4f", fontSize: 10 }}>— inversa</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.76)", color: "#4dd7ff", fontSize: 10 }}>— normal</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.76)", color: "#ffbf47", fontSize: 10 }}>— rumbo</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.76)", color: "#d88cff", fontSize: 10 }}>— Slab2</span>
        <span style={{ padding: "5px 8px", borderRadius: 8, background: "rgba(2,7,18,.76)", color: "#cad8e6", fontSize: 10 }}>{faultCount === null ? "fallas…" : `${faultCount} fallas`} · {quakeCount} sismos regionales</span>
      </div>
      {error && <div style={{ position: "absolute", inset: "42% 16px auto", zIndex: 5, padding: 14, borderRadius: 12, background: "rgba(64,10,20,.94)", color: "#ffd7df", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
