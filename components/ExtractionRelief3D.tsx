"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ActiveFaultCollection, ActiveFaultFeature } from "@/lib/activeFaults";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { EXTRACTION_KIND_COLORS, type ExtractionSite } from "@/lib/extractions";
import type { GeoFeature } from "@/lib/plateDynamics";
import type { TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

const TILE_SIZE = 256;
const TERRAIN_Y = 0.0011;
const DEPTH_Y = 0.11;
type Pair = [number, number];
type Region = { west: number; east: number; south: number; north: number; centerLongitude: number };
type Grid = { width: number; height: number; sizeX: number; sizeZ: number; elevations: Float32Array; zoom: number };

type Props = {
  site: ExtractionSite;
  tectonic: TectonicDepth3DResponse | null;
  earthquakes: EarthquakeEvent[];
  showFaults: boolean;
  showPlateBoundaries: boolean;
  showEarthquakes: boolean;
};

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function normalizeLon(value: number) { let out = value; while (out > 180) out -= 360; while (out < -180) out += 360; return out; }
function unwrapLon(value: number, center: number) { let out = normalizeLon(value); while (out - center > 180) out -= 360; while (out - center < -180) out += 360; return out; }
function isPair(value: unknown): value is Pair { return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])); }

function regionForSite(site: ExtractionSite): Region {
  const span = site.kind === "injection" || site.kind === "fracking" ? 4.2 : site.kind === "reservoir" ? 4.8 : 6.2;
  const latSpan = span * 0.72;
  return { west: site.longitude - span, east: site.longitude + span, south: clamp(site.latitude - latSpan, -84, 84), north: clamp(site.latitude + latSpan, -84, 84), centerLongitude: site.longitude };
}

function worldPixelX(longitude: number, zoom: number) { return ((longitude + 180) / 360) * (2 ** zoom) * TILE_SIZE; }
function worldPixelY(latitude: number, zoom: number) {
  const lat = clamp(latitude, -85.05112878, 85.05112878) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * (2 ** zoom) * TILE_SIZE;
}
function tileCount(region: Region, zoom: number) {
  const xMin = Math.floor(worldPixelX(region.west, zoom) / TILE_SIZE);
  const xMax = Math.floor(worldPixelX(region.east, zoom) / TILE_SIZE);
  const yMin = Math.floor(worldPixelY(region.north, zoom) / TILE_SIZE);
  const yMax = Math.floor(worldPixelY(region.south, zoom) / TILE_SIZE);
  return Math.max(1, xMax - xMin + 1) * Math.max(1, yMax - yMin + 1);
}
function chooseZoom(region: Region, mobile: boolean) {
  const budget = mobile ? 10 : 18;
  for (let zoom = 8; zoom >= 3; zoom -= 1) if (tileCount(region, zoom) <= budget) return zoom;
  return 3;
}
function decodeTerrarium(r: number, g: number, b: number) { return r * 256 + g + b / 256 - 32768; }
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.decoding = "async"; image.onload = () => resolve(image); image.onerror = () => reject(new Error(`No se pudo cargar ${src}`)); image.src = src;
  });
}

function dimensions(region: Region, mobile: boolean) {
  const latSpan = Math.max(0.1, region.north - region.south);
  const lonSpan = Math.max(0.1, (region.east - region.west) * Math.max(0.25, Math.cos(siteMidLat(region) * Math.PI / 180)));
  const aspect = clamp(lonSpan / latSpan, 0.65, 2.1);
  const longest = mobile ? 94 : 142;
  const width = aspect >= 1 ? longest : Math.max(54, Math.round(longest * aspect));
  const height = aspect >= 1 ? Math.max(54, Math.round(longest / aspect)) : longest;
  const sizeZ = 112;
  return { width, height, sizeX: sizeZ * aspect, sizeZ };
}
function siteMidLat(region: Region) { return (region.north + region.south) / 2; }

async function loadGrid(region: Region, mobile: boolean): Promise<Grid> {
  const zoom = chooseZoom(region, mobile);
  const xMin = Math.floor(worldPixelX(region.west, zoom) / TILE_SIZE);
  const xMax = Math.floor(worldPixelX(region.east, zoom) / TILE_SIZE);
  const yMin = Math.floor(worldPixelY(region.north, zoom) / TILE_SIZE);
  const yMax = Math.floor(worldPixelY(region.south, zoom) / TILE_SIZE);
  const cols = xMax - xMin + 1; const rows = yMax - yMin + 1; const worldTiles = 2 ** zoom;
  if (cols * rows > 24) throw new Error("La región requiere demasiados tiles de relieve.");
  const canvas = document.createElement("canvas"); canvas.width = cols * TILE_SIZE; canvas.height = rows * TILE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Canvas 2D no disponible.");
  const requests: Promise<void>[] = [];
  for (let y = yMin; y <= yMax; y += 1) for (let x = xMin; x <= xMax; x += 1) {
    if (y < 0 || y >= worldTiles) continue;
    const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;
    requests.push(loadImage(`/api/tectonic-relief/tile?z=${zoom}&x=${wrappedX}&y=${y}`).then((image) => ctx.drawImage(image, (x - xMin) * TILE_SIZE, (y - yMin) * TILE_SIZE, TILE_SIZE, TILE_SIZE)));
  }
  await Promise.all(requests);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const d = dimensions(region, mobile); const elevations = new Float32Array(d.width * d.height);
  for (let row = 0; row < d.height; row += 1) {
    const lat = region.north - row / (d.height - 1) * (region.north - region.south);
    const sy = clamp(Math.round(worldPixelY(lat, zoom) - yMin * TILE_SIZE), 0, canvas.height - 1);
    for (let col = 0; col < d.width; col += 1) {
      const lon = region.west + col / (d.width - 1) * (region.east - region.west);
      const sx = clamp(Math.round(worldPixelX(lon, zoom) - xMin * TILE_SIZE), 0, canvas.width - 1);
      const p = (sy * canvas.width + sx) * 4;
      elevations[row * d.width + col] = clamp(decodeTerrarium(pixels[p], pixels[p + 1], pixels[p + 2]), -10500, 6500);
    }
  }
  return { ...d, elevations, zoom };
}

function scenePoint(lon: number, lat: number, grid: Grid, region: Region) {
  const x = ((unwrapLon(lon, region.centerLongitude) - region.west) / (region.east - region.west) - 0.5) * grid.sizeX;
  const z = (0.5 - (lat - region.south) / (region.north - region.south)) * grid.sizeZ;
  return { x, z };
}
function elevationAt(lon: number, lat: number, grid: Grid, region: Region) {
  const u = clamp((unwrapLon(lon, region.centerLongitude) - region.west) / (region.east - region.west), 0, 1) * (grid.width - 1);
  const v = clamp((region.north - lat) / (region.north - region.south), 0, 1) * (grid.height - 1);
  const x = Math.round(u); const y = Math.round(v); return grid.elevations[y * grid.width + x] ?? 0;
}
function terrainColor(e: number) {
  const c = new THREE.Color();
  if (e < -5000) return c.set("#263a8b"); if (e < -2500) return c.set("#176ca4"); if (e < -500) return c.set("#1f9cb2"); if (e < 0) return c.set("#68bec8");
  if (e < 400) return c.set("#4c9a58"); if (e < 1400) return c.set("#96af55"); if (e < 2600) return c.set("#c49a4a"); return c.set("#cfc8b6");
}
function terrainMesh(grid: Grid, region: Region) {
  const positions = new Float32Array(grid.width * grid.height * 3); const colors = new Float32Array(grid.width * grid.height * 3); const indices: number[] = [];
  for (let row = 0; row < grid.height; row += 1) for (let col = 0; col < grid.width; col += 1) {
    const i = row * grid.width + col; const lon = region.west + col / (grid.width - 1) * (region.east - region.west); const lat = region.north - row / (grid.height - 1) * (region.north - region.south);
    const p = scenePoint(lon, lat, grid, region); const e = grid.elevations[i]; const c = terrainColor(e);
    positions[i * 3] = p.x; positions[i * 3 + 1] = e * TERRAIN_Y; positions[i * 3 + 2] = p.z; colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  for (let row = 0; row < grid.height - 1; row += 1) for (let col = 0; col < grid.width - 1; col += 1) { const a = row * grid.width + col, b = a + 1, c = a + grid.width, d = c + 1; indices.push(a, c, b, b, c, d); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
}

function coordinateLines(value: unknown, out: Pair[][]) {
  if (!Array.isArray(value)) return; if (value.length >= 2 && value.every(isPair)) { out.push(value.map((p) => [Number(p[0]), Number(p[1])] as Pair)); return; } for (const child of value) coordinateLines(child, out);
}
function inside(point: Pair, region: Region, margin = 0) { const lon = unwrapLon(point[0], region.centerLongitude); return lon >= region.west - margin && lon <= region.east + margin && point[1] >= region.south - margin && point[1] <= region.north + margin; }
function regionalLines(features: GeoFeature[], region: Region) {
  const out: Pair[][] = [];
  for (const feature of features) { const lines: Pair[][] = []; coordinateLines(feature.geometry?.coordinates, lines); for (const line of lines) { let current: Pair[] = []; for (const p of line) { if (inside(p, region, .25)) current.push(p); else { if (current.length >= 2) out.push(current); current = []; } } if (current.length >= 2) out.push(current); } }
  return out;
}
function lineObject(lines: Pair[][], grid: Grid, region: Region, color: string, offset = .4, opacity = .9) {
  const positions: number[] = [];
  for (const line of lines) for (let i = 1; i < line.length; i += 1) { const a = line[i - 1], b = line[i]; const pa = scenePoint(a[0], a[1], grid, region), pb = scenePoint(b[0], b[1], grid, region); positions.push(pa.x, elevationAt(a[0], a[1], grid, region) * TERRAIN_Y + offset, pa.z, pb.x, elevationAt(b[0], b[1], grid, region) * TERRAIN_Y + offset, pb.z); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}
function faultGroups(features: ActiveFaultFeature[], region: Region) {
  const groups = { reverse: [] as Pair[][], normal: [] as Pair[][], strike: [] as Pair[][], other: [] as Pair[][] };
  for (const feature of features) { const temp: Pair[][] = []; coordinateLines(feature.geometry?.coordinates, temp); const type = (feature.properties.slipType ?? "").toLowerCase(); const target = type.includes("reverse") || type.includes("thrust") ? groups.reverse : type.includes("normal") ? groups.normal : type.includes("strike") || type.includes("dextral") || type.includes("sinistral") ? groups.strike : groups.other; for (const line of temp) if (line.some((p) => inside(p, region, .3))) target.push(line.filter((p) => inside(p, region, .3))); }
  return groups;
}
function quakeMesh(events: EarthquakeEvent[], grid: Grid, region: Region, mobile: boolean) {
  const filtered = events.filter((e) => inside([e.longitude, e.latitude], region)).sort((a, b) => b.magnitude - a.magnitude).slice(0, mobile ? 350 : 700);
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.7, 7, 5), new THREE.MeshBasicMaterial({ vertexColors: true }), filtered.length); const matrix = new THREE.Matrix4(); const color = new THREE.Color();
  filtered.forEach((e, i) => { const p = scenePoint(e.longitude, e.latitude, grid, region); const s = clamp(.6 + (e.magnitude - 2.5) * .18, .55, 1.7); matrix.makeScale(s, s, s); matrix.setPosition(p.x, -Math.max(1, e.depthKm) * DEPTH_Y, p.z); mesh.setMatrixAt(i, matrix); color.set(e.depthKm < 70 ? "#fb7185" : e.depthKm < 300 ? "#f59e0b" : "#60a5fa"); mesh.setColorAt(i, color); });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; return { mesh, count: filtered.length };
}
function disposeObject(object: THREE.Object3D) { object.traverse((child) => { const item = child as THREE.Mesh; item.geometry?.dispose?.(); const material = item.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(material)) material.forEach((m) => m.dispose()); else material?.dispose?.(); }); }

export function ExtractionRelief3D({ site, tectonic, earthquakes, showFaults, showPlateBoundaries, showEarthquakes }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null); const [status, setStatus] = useState("Preparando relieve…"); const [faultCount, setFaultCount] = useState<number | null>(null); const [quakeCount, setQuakeCount] = useState(0);
  useEffect(() => {
    const host = hostRef.current; if (!host) return; let disposed = false; let frame = 0; const mobile = window.matchMedia("(max-width: 700px)").matches; const region = regionForSite(site);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" }); renderer.setPixelRatio(mobile ? 1 : Math.min(1.5, window.devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#020712"); scene.add(new THREE.HemisphereLight("#d7ecff", "#151820", 1.15)); const key = new THREE.DirectionalLight("#fff5df", 1.35); key.position.set(-70, 130, 90); scene.add(key);
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 1400); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08; controls.target.set(0, -2, 0);
    const build = (grid: Grid) => {
      const terrain = terrainMesh(grid, region); scene.add(terrain);
      if (showPlateBoundaries && tectonic) scene.add(lineObject(regionalLines(tectonic.platePolygons.features, region), grid, region, "#ffd166", .55, .75));
      const qp = scenePoint(site.longitude, site.latitude, grid, region); const topY = elevationAt(site.longitude, site.latitude, grid, region) * TERRAIN_Y + 1.1;
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(.75, .75, 5.2, 12), new THREE.MeshBasicMaterial({ color: EXTRACTION_KIND_COLORS[site.kind], transparent: true, opacity: .92 })); marker.position.set(qp.x, topY + 2.1, qp.z); scene.add(marker);
      const halo = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.1, 24), new THREE.MeshBasicMaterial({ color: EXTRACTION_KIND_COLORS[site.kind], side: THREE.DoubleSide, transparent: true, opacity: .8 })); halo.rotation.x = -Math.PI / 2; halo.position.set(qp.x, topY + .2, qp.z); scene.add(halo);
      if (showEarthquakes) { const q = quakeMesh(earthquakes, grid, region, mobile); scene.add(q.mesh); setQuakeCount(q.count); }
      const max = Math.max(grid.sizeX, grid.sizeZ); camera.position.set(max * .78, max * .62, max * 1.02); controls.minDistance = max * .38; controls.maxDistance = max * 4; controls.update();
      return grid;
    };
    let currentGrid: Grid | null = null;
    loadGrid(region, mobile).then((grid) => {
      if (disposed) return; currentGrid = build(grid); setStatus(`Relieve listo · DEM z${grid.zoom}`);
      if (!showFaults) { setFaultCount(0); return; }
      const bbox = `${normalizeLon(region.west)},${region.south},${normalizeLon(region.east)},${region.north}`;
      return fetch(`/api/faults?bbox=${encodeURIComponent(bbox)}&limit=900`, { cache: "force-cache" }).then((r) => r.ok ? r.json() as Promise<ActiveFaultCollection> : null).then((faults) => {
        if (disposed || !faults || !currentGrid) return; const grouped = faultGroups(faults.features, region); scene.add(lineObject(grouped.reverse, currentGrid, region, "#ff4d4f", .7)); scene.add(lineObject(grouped.normal, currentGrid, region, "#4dd7ff", .7)); scene.add(lineObject(grouped.strike, currentGrid, region, "#ffbf47", .7)); scene.add(lineObject(grouped.other, currentGrid, region, "#e96fff", .7)); setFaultCount(faults.features.length);
      });
    }).catch((error) => { if (!disposed) setStatus(error instanceof Error ? error.message : "No se pudo cargar el relieve."); });
    const resize = () => { const width = Math.max(320, host.clientWidth); const height = mobile ? Math.max(500, Math.min(650, width * 1.08)) : Math.max(580, Math.min(760, width * .65)); renderer.setSize(width, height, true); camera.aspect = width / height; camera.updateProjectionMatrix(); }; resize(); const observer = new ResizeObserver(resize); observer.observe(host);
    const animate = () => { if (disposed) return; controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); disposeObject(scene); renderer.dispose(); if (host.contains(renderer.domElement)) renderer.domElement.remove(); };
  }, [earthquakes, showEarthquakes, showFaults, showPlateBoundaries, site, tectonic]);
  return <div style={{ position: "relative", minHeight: 500, overflow: "hidden", borderRadius: 18, background: "#020712", border: "1px solid rgba(56,189,248,.16)" }}><div ref={hostRef} style={{ minHeight: 500, width: "100%", touchAction: "none" }} /><div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", gap: 7, flexWrap: "wrap", pointerEvents: "none" }}><span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.86)", color: EXTRACTION_KIND_COLORS[site.kind], fontWeight: 800, fontSize: 11 }}>{site.name}</span><span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.86)", color: "#d8f2ff", fontSize: 11 }}>{status}</span></div><div style={{ position: "absolute", bottom: 12, left: 12, padding: "6px 9px", borderRadius: 9, background: "rgba(2,7,18,.82)", color: "#cad8e6", fontSize: 10 }}>{faultCount === null ? "fallas…" : `${faultCount} fallas`} · {quakeCount} sismos regionales</div></div>;
}
