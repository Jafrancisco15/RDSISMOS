"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  buildPlateOptions,
  computePlateReliefRegion,
  plateFeatures,
  plateNameOf,
  unwrapLongitude,
  type PlateReliefRegion,
} from "@/lib/plateRelief";
import type { GeoFeature } from "@/lib/plateDynamics";
import type { SlabContour3D, SlabSurfaceTriangle3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";
import styles from "./TectonicDepth3D.module.css";

const EARTH_RADIUS_SCENE = 100;
const EARTH_RADIUS_KM = 6371;
const PLATE_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#c084fc", "#4ade80"];

type Pair = [number, number];
type SurfaceResponse = {
  triangles?: SlabSurfaceTriangle3D[];
  sourceTriangleCount?: number;
  warning?: string | null;
  error?: string;
};
type WorldBordersResponse = {
  features?: GeoFeature[];
  error?: string;
};

type Props = {
  tectonic: TectonicDepth3DResponse;
  earthquakes: EarthquakeEvent[];
  plateId: string;
  exploded: boolean;
  depthExaggeration: number;
  showPlates: boolean;
  showSlabs: boolean;
  showEarthquakes: boolean;
  slabRegion: string;
  autoRotate: boolean;
  onPlateSelect: (plateId: string) => void;
  onOpenRelief: (plateId: string) => void;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function plateColorFromId(id: string) {
  return new THREE.Color(PLATE_COLORS[hashText(id) % PLATE_COLORS.length]);
}

function slabColor(depthKm: number) {
  if (depthKm <= 80) return new THREE.Color("#ef4444");
  if (depthKm <= 180) return new THREE.Color("#f97316");
  if (depthKm <= 300) return new THREE.Color("#facc15");
  if (depthKm <= 440) return new THREE.Color("#84cc16");
  if (depthKm <= 560) return new THREE.Color("#22c55e");
  return new THREE.Color("#38bdf8");
}

function quakeColor(depthKm: number) {
  return new THREE.Color(depthKm < 70 ? "#f43f5e" : depthKm < 300 ? "#f59e0b" : "#60a5fa");
}

function depthRadius(depthKm: number, exaggeration: number, exploded: boolean) {
  const fraction = clamp(Math.max(0, depthKm) / EARTH_RADIUS_KM, 0, 0.18);
  return exploded
    ? EARTH_RADIUS_SCENE + 5 + fraction * EARTH_RADIUS_SCENE * Math.max(1, exaggeration) * 0.72
    : EARTH_RADIUS_SCENE + 1 + fraction * EARTH_RADIUS_SCENE * 0.12;
}

function latLngVector(latitude: number, longitude: number, radius: number) {
  const phi = (90 - latitude) * Math.PI / 180;
  const theta = (longitude + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function polygonOuterRings(feature: GeoFeature) {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [] as Pair[][];
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    return Array.isArray(ring) ? [ring.filter(isPair).map((p) => [Number(p[0]), Number(p[1])] as Pair)] : [];
  }
  if (geometry.type === "MultiPolygon") {
    const result: Pair[][] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
      result.push(polygon[0].filter(isPair).map((p) => [Number(p[0]), Number(p[1])] as Pair));
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

function triangulatedRingPositions(ring: Pair[], radius: number) {
  const positions: number[] = [];
  const compact = compactRing(ring);
  if (compact.length < 3) return positions;
  const meanLat = compact.reduce((sum, point) => sum + point[1], 0) / compact.length;
  const referenceLon = compact[0][0];
  const projected = compact.map(([lng, lat]) => new THREE.Vector2(
    unwrapLongitude(lng, referenceLon) * Math.max(0.12, Math.cos(meanLat * Math.PI / 180)),
    lat,
  ));
  let faces: number[][] = [];
  try {
    faces = THREE.ShapeUtils.triangulateShape(projected, []);
  } catch {
    faces = [];
  }
  for (const face of faces) {
    for (const index of face) {
      const [lng, lat] = compact[index];
      const vector = latLngVector(lat, lng, radius);
      positions.push(vector.x, vector.y, vector.z);
    }
  }
  return positions;
}

function ringLinePositions(ring: Pair[], radius: number) {
  const positions: number[] = [];
  const compact = compactRing(ring);
  for (let index = 0; index < compact.length; index += 1) {
    const a = compact[index];
    const b = compact[(index + 1) % compact.length];
    const va = latLngVector(a[1], a[0], radius);
    const vb = latLngVector(b[1], b[0], radius);
    positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
  }
  return positions;
}

function createCountryGroup(features: GeoFeature[], mobile: boolean) {
  const group = new THREE.Group();
  const fillPositions: number[] = [];
  const linePositions: number[] = [];
  const fillRadius = EARTH_RADIUS_SCENE + 0.22;
  const lineRadius = EARTH_RADIUS_SCENE + 0.42;
  const countryBudget = mobile ? 180 : 240;

  for (const feature of features.slice(0, countryBudget)) {
    for (const ring of polygonOuterRings(feature)) {
      fillPositions.push(...triangulatedRingPositions(ring, fillRadius));
      linePositions.push(...ringLinePositions(ring, lineRadius));
    }
  }

  if (fillPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    group.add(new THREE.Mesh(
      geometry,
      new THREE.MeshPhongMaterial({ color: "#244a44", emissive: "#0a1716", shininess: 3, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    ));
  }
  if (linePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    group.add(new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: "#b6cbd3", transparent: true, opacity: mobile ? 0.48 : 0.6 }),
    ));
  }
  return group;
}

function createInteractivePlateGroup(features: GeoFeature[], exploded: boolean, selectedId: string) {
  const group = new THREE.Group();
  const pickMeshes: THREE.Mesh[] = [];
  const radius = EARTH_RADIUS_SCENE + (exploded ? 2.3 : 1.15);
  const options = buildPlateOptions(features);

  for (const option of options) {
    const logicalFeatures = plateFeatures(features, option.id);
    const fillPositions: number[] = [];
    const linePositions: number[] = [];
    for (const feature of logicalFeatures) {
      for (const ring of polygonOuterRings(feature)) {
        fillPositions.push(...triangulatedRingPositions(ring, radius));
        linePositions.push(...ringLinePositions(ring, radius + 0.18));
      }
    }
    if (!fillPositions.length) continue;

    const selected = option.id === selectedId;
    const baseColor = plateColorFromId(option.id);
    const displayColor = selected ? baseColor.clone().lerp(new THREE.Color("#fff7cc"), 0.46) : baseColor;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: displayColor,
        transparent: true,
        opacity: selected ? 0.78 : exploded ? 0.36 : 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.userData.plateId = option.id;
    mesh.userData.plateName = option.name;
    mesh.userData.selectablePlate = true;
    mesh.renderOrder = selected ? 6 : 4;
    group.add(mesh);
    pickMeshes.push(mesh);

    if (linePositions.length) {
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
      const lines = new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({
          color: selected ? "#fff8dc" : displayColor,
          transparent: true,
          opacity: selected ? 1 : 0.72,
        }),
      );
      lines.renderOrder = selected ? 7 : 5;
      group.add(lines);
    }
  }
  return { group, pickMeshes, logicalPlateCount: options.length };
}

function pointInsideRegion(longitude: number, latitude: number, region: PlateReliefRegion | null, margin = 3) {
  if (!region) return true;
  const unwrapped = unwrapLongitude(longitude, region.centerLongitude);
  return unwrapped >= region.west - margin && unwrapped <= region.east + margin
    && latitude >= region.south - margin && latitude <= region.north + margin;
}

function createSlabContours(contours: SlabContour3D[], region: PlateReliefRegion | null, depthExaggeration: number, exploded: boolean, mobile: boolean) {
  const candidates = contours.filter((contour) => contour.points.some((point) => pointInsideRegion(point.lng, point.lat, region, 4)));
  const budget = region ? (mobile ? 120 : 250) : (mobile ? 150 : 320);
  const stride = candidates.length > budget ? Math.ceil(candidates.length / budget) : 1;
  const group = new THREE.Group();

  for (const contour of candidates.filter((_, index) => index % stride === 0).slice(0, budget)) {
    const positions: number[] = [];
    let previous: { lat: number; lng: number } | null = null;
    for (const point of contour.points) {
      if (!pointInsideRegion(point.lng, point.lat, region, 4)) {
        previous = null;
        continue;
      }
      if (previous) {
        const radius = depthRadius(contour.depthKm, depthExaggeration, exploded);
        const a = latLngVector(previous.lat, previous.lng, radius);
        const b = latLngVector(point.lat, point.lng, radius);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      previous = point;
    }
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: slabColor(contour.depthKm), transparent: true, opacity: 0.82 })));
  }
  return group;
}

function createSlabSurfaces(triangles: SlabSurfaceTriangle3D[], depthExaggeration: number, exploded: boolean, mobile: boolean) {
  const budget = mobile ? 180 : 500;
  const stride = triangles.length > budget ? Math.ceil(triangles.length / budget) : 1;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const surface of triangles.filter((_, index) => index % stride === 0).slice(0, budget)) {
    const ring = surface.geometry.coordinates[0] ?? [];
    if (ring.length < 3) continue;
    const color = slabColor(surface.depthKm);
    const radius = depthRadius(surface.depthKm, depthExaggeration, exploded);
    for (const point of ring.slice(0, 3)) {
      const vector = latLngVector(Number(point[1]), Number(point[0]), radius);
      positions.push(vector.x, vector.y, vector.z);
      colors.push(color.r, color.g, color.b);
    }
  }
  const group = new THREE.Group();
  if (!positions.length) return group;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false })));
  return group;
}

function createQuakes(events: EarthquakeEvent[], region: PlateReliefRegion | null, depthExaggeration: number, exploded: boolean, mobile: boolean) {
  const filtered = events
    .filter((event) => pointInsideRegion(event.longitude, event.latitude, region, 3))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, mobile ? 500 : 1600);
  const geometry = new THREE.SphereGeometry(0.55, 7, 5);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, filtered.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  filtered.forEach((event, index) => {
    const position = latLngVector(event.latitude, event.longitude, depthRadius(event.depthKm, depthExaggeration, exploded) + 0.8);
    const scale = clamp(0.7 + (event.magnitude - 4) * 0.34, 0.65, 2.1);
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(position);
    mesh.setMatrixAt(index, matrix);
    color.copy(quakeColor(event.depthKm));
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, count: filtered.length };
}

function createGraticule() {
  const positions: number[] = [];
  const radius = EARTH_RADIUS_SCENE + 0.12;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lng = -180; lng < 180; lng += 5) {
      const a = latLngVector(lat, lng, radius);
      const b = latLngVector(lat, lng + 5, radius);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (let lng = -150; lng <= 180; lng += 30) {
    for (let lat = -85; lat < 85; lat += 5) {
      const a = latLngVector(lat, lng, radius);
      const b = latLngVector(lat + 5, lng, radius);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#5d7d8e", transparent: true, opacity: 0.18 }));
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

export function TectonicDepth3DRenderer({
  tectonic,
  earthquakes,
  plateId,
  exploded,
  depthExaggeration,
  showPlates,
  showSlabs,
  showEarthquakes,
  slabRegion,
  autoRotate,
  onPlateSelect,
  onOpenRelief,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Preparando escena 3D…");
  const [countryStatus, setCountryStatus] = useState("Cargando mapa mundial…");
  const [surfaceTriangles, setSurfaceTriangles] = useState<SlabSurfaceTriangle3D[]>([]);
  const [surfaceSourceCount, setSurfaceSourceCount] = useState(0);
  const [surfaceWarning, setSurfaceWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPlateFeatures = useMemo(
    () => plateFeatures(tectonic.platePolygons.features, plateId),
    [plateId, tectonic.platePolygons.features],
  );
  const selectedPlateName = plateId && selectedPlateFeatures.length ? plateNameOf(selectedPlateFeatures[0]) : "";
  const selectedPlateRegion = useMemo(
    () => plateId ? computePlateReliefRegion(tectonic.platePolygons.features, plateId) : null,
    [plateId, tectonic.platePolygons.features],
  );

  useEffect(() => {
    if (!showSlabs || !slabRegion) {
      setSurfaceTriangles([]);
      setSurfaceSourceCount(0);
      setSurfaceWarning(null);
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    setSurfaceWarning(null);
    void fetch(`/api/tectonic-depth-3d/surface?region=${encodeURIComponent(slabRegion)}`, { cache: "force-cache", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as SurfaceResponse;
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (disposed) return;
        setSurfaceTriangles(payload.triangles ?? []);
        setSurfaceSourceCount(payload.sourceTriangleCount ?? payload.triangles?.length ?? 0);
        setSurfaceWarning(payload.warning ?? null);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (!disposed) setSurfaceWarning(fetchError instanceof Error ? fetchError.message : "No se pudo cargar la superficie Slab2.");
      });
    return () => { disposed = true; controller.abort(); };
  }, [showSlabs, slabRegion]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", alpha: false });
    } catch (webglError) {
      setError(webglError instanceof Error ? webglError.message : "WebGL no está disponible en este navegador.");
      return;
    }

    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#010812");
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 1200);
    renderer.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.cursor = "grab";
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 135;
    controls.maxDistance = 520;
    controls.target.set(0, 0, 0);
    controls.autoRotate = autoRotate && !mobile;
    controls.autoRotateSpeed = 0.25;

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_SCENE, mobile ? 40 : 64, mobile ? 28 : 40),
      new THREE.MeshPhongMaterial({ color: "#08273d", emissive: "#020d15", shininess: 14, transparent: true, opacity: exploded ? 0.72 : 1 }),
    );
    scene.add(globe);
    if (!mobile) scene.add(createGraticule());
    scene.add(new THREE.AmbientLight("#8fd3ff", 1.05));
    const light = new THREE.DirectionalLight("#ffffff", 1.3);
    light.position.set(180, 120, 160);
    scene.add(light);

    const plates = createInteractivePlateGroup(tectonic.platePolygons.features, exploded, plateId);
    if (showPlates) scene.add(plates.group);
    const contourSource = tectonic.slabContours.filter((contour) => !slabRegion || contour.region === slabRegion);
    const slabGroup = showSlabs ? createSlabContours(contourSource, selectedPlateRegion, depthExaggeration, exploded, mobile) : new THREE.Group();
    scene.add(slabGroup);
    const surfaceGroup = showSlabs ? createSlabSurfaces(surfaceTriangles, depthExaggeration, exploded, mobile) : new THREE.Group();
    scene.add(surfaceGroup);
    const quakes = showEarthquakes ? createQuakes(earthquakes, selectedPlateRegion, depthExaggeration, exploded, mobile) : { mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 0), count: 0 };
    scene.add(quakes.mesh);

    const countryController = new AbortController();
    setCountryStatus("Cargando mapa mundial…");
    void fetch("/api/world-borders", { cache: "force-cache", signal: countryController.signal })
      .then(async (response) => {
        const payload = await response.json() as WorldBordersResponse;
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (disposed) return;
        const group = createCountryGroup(payload.features ?? [], mobile);
        scene.add(group);
        setCountryStatus(`${payload.features?.length ?? 0} países · Natural Earth`);
      })
      .catch((mapError: unknown) => {
        if (mapError instanceof DOMException && mapError.name === "AbortError") return;
        if (!disposed) setCountryStatus("Países no disponibles · esfera base activa");
      });

    if (selectedPlateRegion) {
      const centerLat = (selectedPlateRegion.south + selectedPlateRegion.north) / 2;
      const span = Math.max(selectedPlateRegion.east - selectedPlateRegion.west, selectedPlateRegion.north - selectedPlateRegion.south);
      const distance = clamp(150 + span * 1.25, 165, 360);
      camera.position.copy(latLngVector(centerLat, selectedPlateRegion.centerLongitude, distance));
    } else {
      camera.position.set(0, 35, 285);
    }
    camera.lookAt(0, 0, 0);
    controls.update();

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = mobile ? Math.max(500, Math.min(650, width * 1.08)) : Math.max(580, Math.min(780, width * 0.7));
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
      renderer.domElement.style.cursor = "grabbing";
    };
    const onPointerUp = (event: PointerEvent) => {
      renderer.domElement.style.cursor = "grab";
      if (!pointerDown || !showPlates) return;
      const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      pointerDown = null;
      if (distance > 10) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(plates.pickMeshes, false)[0];
      const hitPlateId = String(hit?.object.userData.plateId ?? "");
      if (hitPlateId) onPlateSelect(hitPlateId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) setError("Chrome perdió el contexto WebGL. Recarga la pestaña para reiniciar el visor.");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost, false);
    setError(null);
    setStatus(`${selectedPlateName || "Toca una placa"} · ${plates.logicalPlateCount} placas · ${quakes.count} sismos`);

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      countryController.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      if (host.contains(renderer.domElement)) renderer.domElement.remove();
    };
  }, [autoRotate, depthExaggeration, earthquakes, exploded, onPlateSelect, plateId, selectedPlateName, selectedPlateRegion, showEarthquakes, showPlates, showSlabs, slabRegion, surfaceTriangles, tectonic]);

  return (
    <div className={styles.renderer} style={{ position: "relative", minHeight: 500, background: "#010812" }}>
      <div ref={containerRef} style={{ width: "100%", minHeight: 500, touchAction: "none" }} />
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, maxWidth: "calc(100% - 24px)", padding: "7px 10px", borderRadius: 12, background: "rgba(2,8,18,.88)", border: "1px solid rgba(125,211,252,.25)", color: "#d8f3ff", fontSize: 11, fontWeight: 800, pointerEvents: "none" }}>
        {status}{slabRegion ? ` · Slab2 ${slabRegion}${surfaceSourceCount ? ` (${surfaceSourceCount} caras)` : ""}` : ""} · {countryStatus}
      </div>
      <div style={{ position: "absolute", top: 48, left: 12, zIndex: 4, padding: "6px 9px", borderRadius: 10, background: "rgba(2,8,18,.78)", color: "#c7e8f5", fontSize: 10, pointerEvents: "none" }}>
        Toca una placa para seleccionarla · arrastra para rotar
      </div>
      {selectedPlateName && (
        <div style={{ position: "absolute", right: 12, bottom: 14, zIndex: 7, display: "flex", gap: 8, alignItems: "center", padding: 8, borderRadius: 12, background: "rgba(2,8,18,.9)", border: "1px solid rgba(255,247,204,.32)" }}>
          <span style={{ color: "#fff7cc", fontSize: 11, fontWeight: 800 }}>{selectedPlateName}</span>
          <button type="button" onClick={() => onOpenRelief(plateId)} style={{ border: "1px solid rgba(56,189,248,.5)", background: "#075985", color: "white", borderRadius: 9, padding: "7px 9px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>
            Ver en Relieve 3D
          </button>
        </div>
      )}
      {surfaceWarning && <div className={styles.surfaceStatus}>{surfaceWarning}</div>}
      <div className={styles.depthScale} aria-label="Escala de profundidad">
        <span>0 km</span><i /><span>70</span><i /><span>300</span><i /><span>680 km</span>
      </div>
      {error && <div style={{ position: "absolute", inset: "42% 16px auto", zIndex: 8, padding: 14, borderRadius: 12, background: "rgba(64,10,20,.94)", color: "#ffd7df", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
