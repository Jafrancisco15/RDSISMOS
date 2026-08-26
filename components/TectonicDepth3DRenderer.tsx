"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { computePlateReliefRegion, plateFeatures, plateNameOf, unwrapLongitude, type PlateReliefRegion } from "@/lib/plateRelief";
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
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function plateColor(feature: GeoFeature) {
  const id = String(feature.properties?.plateId ?? feature.id ?? "plate");
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

function createPlateGroup(features: GeoFeature[], exploded: boolean) {
  const group = new THREE.Group();
  const fillPositions: number[] = [];
  const fillColors: number[] = [];
  const linePositions: number[] = [];
  const radius = EARTH_RADIUS_SCENE + (exploded ? 2.3 : 1.1);

  for (const feature of features) {
    const color = plateColor(feature);
    for (const sourceRing of polygonOuterRings(feature)) {
      const ring = compactRing(sourceRing);
      if (ring.length < 3) continue;
      const meanLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
      const referenceLon = ring[0][0];
      const projected = ring.map(([lng, lat]) => new THREE.Vector2(
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
          const [lng, lat] = ring[index];
          const vector = latLngVector(lat, lng, radius);
          fillPositions.push(vector.x, vector.y, vector.z);
          fillColors.push(color.r, color.g, color.b);
        }
      }
      for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index];
        const b = ring[(index + 1) % ring.length];
        const va = latLngVector(a[1], a[0], radius + 0.18);
        const vb = latLngVector(b[1], b[0], radius + 0.18);
        linePositions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
    }
  }

  if (fillPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(fillColors, 3));
    group.add(new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: exploded ? 0.58 : 0.38, side: THREE.DoubleSide, depthWrite: false }),
    ));
  }
  if (linePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#d8f3ff", transparent: true, opacity: 0.8 })));
  }
  return group;
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
  const radius = EARTH_RADIUS_SCENE + 0.35;
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
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#4c6d82", transparent: true, opacity: 0.2 }));
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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Preparando escena 3D…");
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
      new THREE.MeshPhongMaterial({ color: "#0a2639", emissive: "#03131e", shininess: 10, transparent: true, opacity: exploded ? 0.34 : 0.9 }),
    );
    scene.add(globe);
    if (!mobile) scene.add(createGraticule());
    scene.add(new THREE.AmbientLight("#8fd3ff", 1.1));
    const light = new THREE.DirectionalLight("#ffffff", 1.35);
    light.position.set(180, 120, 160);
    scene.add(light);

    const plateGroup = createPlateGroup(showPlates ? selectedPlateFeatures : [], exploded);
    scene.add(plateGroup);
    const contourSource = tectonic.slabContours.filter((contour) => !slabRegion || contour.region === slabRegion);
    const slabGroup = showSlabs ? createSlabContours(contourSource, selectedPlateRegion, depthExaggeration, exploded, mobile) : new THREE.Group();
    scene.add(slabGroup);
    const surfaceGroup = showSlabs ? createSlabSurfaces(surfaceTriangles, depthExaggeration, exploded, mobile) : new THREE.Group();
    scene.add(surfaceGroup);
    const quakes = showEarthquakes ? createQuakes(earthquakes, selectedPlateRegion, depthExaggeration, exploded, mobile) : { mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 0), count: 0 };
    scene.add(quakes.mesh);

    if (selectedPlateRegion) {
      const centerLat = (selectedPlateRegion.south + selectedPlateRegion.north) / 2;
      const span = Math.max(selectedPlateRegion.east - selectedPlateRegion.west, selectedPlateRegion.north - selectedPlateRegion.south);
      const distance = clamp(155 + span * 1.45, 170, 390);
      camera.position.copy(latLngVector(centerLat, selectedPlateRegion.centerLongitude, distance));
    } else {
      camera.position.set(0, 45, 285);
    }
    camera.lookAt(0, 0, 0);
    controls.update();

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = mobile ? Math.max(470, Math.min(620, width * 1.05)) : Math.max(560, Math.min(760, width * 0.68));
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) setError("Chrome perdió el contexto WebGL. Recarga la pestaña; la escena ahora usa un renderer más ligero.");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost, false);
    setError(null);
    setStatus(`${selectedPlateName || "Todas las placas"} · ${selectedPlateFeatures.length} polígonos · ${quakes.count} sismos`);

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      if (host.contains(renderer.domElement)) renderer.domElement.remove();
    };
  }, [autoRotate, depthExaggeration, earthquakes, exploded, selectedPlateFeatures, selectedPlateName, selectedPlateRegion, showEarthquakes, showPlates, showSlabs, slabRegion, surfaceTriangles, tectonic.slabContours]);

  return (
    <div className={styles.renderer} style={{ position: "relative", minHeight: 470, background: "#010812" }}>
      <div ref={containerRef} style={{ width: "100%", minHeight: 470, touchAction: "none" }} />
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, maxWidth: "calc(100% - 24px)", padding: "7px 10px", borderRadius: 12, background: "rgba(2,8,18,.88)", border: "1px solid rgba(125,211,252,.25)", color: "#d8f3ff", fontSize: 11, fontWeight: 800, pointerEvents: "none" }}>
        {status}{slabRegion ? ` · Slab2 ${slabRegion}${surfaceSourceCount ? ` (${surfaceSourceCount} caras fuente)` : ""}` : ""}
      </div>
      {surfaceWarning && <div className={styles.surfaceStatus}>{surfaceWarning}</div>}
      <div className={styles.depthScale} aria-label="Escala de profundidad">
        <span>0 km</span><i /><span>70</span><i /><span>300</span><i /><span>680 km</span>
      </div>
      {error && <div style={{ position: "absolute", inset: "42% 16px auto", zIndex: 5, padding: 14, borderRadius: 12, background: "rgba(64,10,20,.94)", color: "#ffd7df", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
