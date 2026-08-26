"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import {
  extractionQuantityText,
  EXTRACTION_KIND_COLORS,
  EXTRACTION_KIND_LABELS,
  type ExtractionKind,
  type ExtractionSite,
} from "@/lib/extractions";
import type { GeoFeature } from "@/lib/plateDynamics";
import type { TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";

const RADIUS = 100;
type Pair = [number, number];

type Props = {
  tectonic: TectonicDepth3DResponse | null;
  sites: ExtractionSite[];
  earthquakes: EarthquakeEvent[];
  visibleKinds: Set<ExtractionKind>;
  selectedSiteId: string | null;
  selectedEarthquakeId: string | null;
  nearbyEventCount: number;
  radiusKm: number;
  onSelectSite: (site: ExtractionSite) => void;
  onSelectEarthquake: (event: EarthquakeEvent) => void;
  onOpenRelief: (site: ExtractionSite) => void;
  showEarthquakes: boolean;
  showPlateBoundaries: boolean;
};

type WorldResponse = { features?: GeoFeature[] };

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
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function rings(feature: GeoFeature) {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [] as Pair[][];
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    return Array.isArray(ring) ? [ring.filter(isPair).map((p) => [Number(p[0]), Number(p[1])] as Pair)] : [];
  }
  if (geometry.type === "MultiPolygon") {
    const out: Pair[][] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
      out.push(polygon[0].filter(isPair).map((p) => [Number(p[0]), Number(p[1])] as Pair));
    }
    return out;
  }
  return [];
}

function compact(ring: Pair[]) {
  if (ring.length < 2) return ring;
  const out = ring.slice();
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function triangulatedRingPositions(sourceRing: Pair[], radius: number) {
  const ring = compact(sourceRing);
  if (ring.length < 3) return [] as number[];
  const meanLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const referenceLon = ring[0][0];
  const unwrap = (value: number) => {
    let result = value;
    while (result - referenceLon > 180) result -= 360;
    while (result - referenceLon < -180) result += 360;
    return result;
  };
  const projected = ring.map(([lng, lat]) => new THREE.Vector2(unwrap(lng) * Math.max(0.12, Math.cos(meanLat * Math.PI / 180)), lat));
  let faces: number[][] = [];
  try { faces = THREE.ShapeUtils.triangulateShape(projected, []); } catch { faces = []; }
  const positions: number[] = [];
  for (const face of faces) for (const index of face) {
    const [lng, lat] = ring[index];
    const vector = latLngVector(lat, lng, radius);
    positions.push(vector.x, vector.y, vector.z);
  }
  return positions;
}

function linePositions(features: GeoFeature[], radius: number) {
  const positions: number[] = [];
  for (const feature of features) {
    for (const source of rings(feature)) {
      const ring = compact(source);
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const va = latLngVector(a[1], a[0], radius);
        const vb = latLngVector(b[1], b[0], radius);
        positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
    }
  }
  return positions;
}

function createCountries(features: GeoFeature[]) {
  const group = new THREE.Group();
  const fillPositions: number[] = [];
  for (const feature of features) for (const ring of rings(feature)) fillPositions.push(...triangulatedRingPositions(ring, RADIUS + 0.2));
  if (fillPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    group.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: "#1b6f9e", emissive: "#06293e", shininess: 5, transparent: true, opacity: 0.92, side: THREE.DoubleSide })));
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions(features, RADIUS + 0.48), 3));
  group.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: "#d9f4ff", transparent: true, opacity: 0.58 })));
  return group;
}

function createPlateLines(features: GeoFeature[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions(features, RADIUS + 0.85), 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.68 }));
}

function quakeColor(depthKm: number) {
  return depthKm < 70 ? "#fb7185" : depthKm < 300 ? "#f59e0b" : "#60a5fa";
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

function haloAt(latitude: number, longitude: number, radius: number, color: string) {
  const position = latLngVector(latitude, longitude, radius);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.45, 2.25, 28),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.94, depthWrite: false }),
  );
  halo.position.copy(position);
  halo.lookAt(new THREE.Vector3(0, 0, 0));
  return halo;
}

export function ExtractionGlobe3D({
  tectonic,
  sites,
  earthquakes,
  visibleKinds,
  selectedSiteId,
  selectedEarthquakeId,
  nearbyEventCount,
  radiusKm,
  onSelectSite,
  onSelectEarthquake,
  onOpenRelief,
  showEarthquakes,
  showPlateBoundaries,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<ExtractionSite | null>(() => sites.find((site) => site.id === selectedSiteId) ?? null);
  const [worldFeatures, setWorldFeatures] = useState<GeoFeature[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/world-borders", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: WorldResponse | null) => { if (active) setWorldFeatures(payload?.features ?? []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSelected(sites.find((site) => site.id === selectedSiteId) ?? null);
  }, [selectedSiteId, sites]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    let disposed = false;
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
    renderer.setPixelRatio(mobile ? 1 : Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#010711");
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1200);
    camera.position.set(0, 38, 278);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 128;
    controls.maxDistance = 430;
    scene.add(new THREE.AmbientLight("#d8ecff", 0.9));
    const light = new THREE.DirectionalLight("#ffffff", 1.2);
    light.position.set(100, 90, 120);
    scene.add(light);

    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, mobile ? 48 : 72, mobile ? 32 : 48),
      new THREE.MeshPhongMaterial({ color: "#075c9c", emissive: "#021a30", shininess: 12 }),
    ));
    if (worldFeatures.length) scene.add(createCountries(worldFeatures));
    if (showPlateBoundaries && tectonic?.platePolygons.features.length) scene.add(createPlateLines(tectonic.platePolygons.features));

    // Every extraction returned by the API and enabled by the filters is rendered.
    const visibleSites = sites.filter((site) => visibleKinds.has(site.kind));
    const siteGeometry = new THREE.SphereGeometry(mobile ? 0.95 : 0.8, 7, 5);
    const siteMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    const siteMesh = new THREE.InstancedMesh(siteGeometry, siteMaterial, visibleSites.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    visibleSites.forEach((site, index) => {
      const position = latLngVector(site.latitude, site.longitude, RADIUS + 2.05);
      const scale = site.kind === "mineral" ? 0.55 : 1.05;
      matrix.makeScale(scale, scale, scale);
      matrix.setPosition(position);
      siteMesh.setMatrixAt(index, matrix);
      color.set(EXTRACTION_KIND_COLORS[site.kind]);
      siteMesh.setColorAt(index, color);
    });
    siteMesh.instanceMatrix.needsUpdate = true;
    if (siteMesh.instanceColor) siteMesh.instanceColor.needsUpdate = true;
    scene.add(siteMesh);

    const selectedSite = visibleSites.find((site) => site.id === selectedSiteId);
    if (selectedSite) scene.add(haloAt(selectedSite.latitude, selectedSite.longitude, RADIUS + 3.35, "#ffffff"));

    let quakeMesh: THREE.InstancedMesh | null = null;
    const quakeData = showEarthquakes ? earthquakes : [];
    if (quakeData.length) {
      const quakeGeometry = new THREE.SphereGeometry(0.47, 6, 5);
      const quakeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86 });
      quakeMesh = new THREE.InstancedMesh(quakeGeometry, quakeMaterial, quakeData.length);
      quakeData.forEach((event, index) => {
        const position = latLngVector(event.latitude, event.longitude, RADIUS + 1.35);
        const scale = Math.max(0.5, Math.min(1.75, 0.52 + (event.magnitude - 2.5) * 0.22));
        matrix.makeScale(scale, scale, scale);
        matrix.setPosition(position);
        quakeMesh!.setMatrixAt(index, matrix);
        color.set(quakeColor(event.depthKm));
        quakeMesh!.setColorAt(index, color);
      });
      quakeMesh.instanceMatrix.needsUpdate = true;
      if (quakeMesh.instanceColor) quakeMesh.instanceColor.needsUpdate = true;
      scene.add(quakeMesh);
      const selectedQuake = quakeData.find((event) => event.id === selectedEarthquakeId);
      if (selectedQuake) scene.add(haloAt(selectedQuake.latitude, selectedQuake.longitude, RADIUS + 2.35, "#fb7185"));
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const siteHit = raycaster.intersectObject(siteMesh, false)[0];
      const quakeHit = quakeMesh ? raycaster.intersectObject(quakeMesh, false)[0] : undefined;
      if (siteHit && (!quakeHit || siteHit.distance <= quakeHit.distance) && siteHit.instanceId !== undefined) {
        const site = visibleSites[siteHit.instanceId];
        if (site) { setSelected(site); onSelectSite(site); }
        return;
      }
      if (quakeHit?.instanceId !== undefined) {
        const quake = quakeData[quakeHit.instanceId];
        if (quake) onSelectEarthquake(quake);
      }
    };
    renderer.domElement.addEventListener("pointerup", onPointer);

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = mobile ? Math.max(500, Math.min(650, width * 1.06)) : Math.max(570, Math.min(760, width * 0.64));
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

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
      renderer.domElement.removeEventListener("pointerup", onPointer);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      if (host.contains(renderer.domElement)) renderer.domElement.remove();
    };
  }, [earthquakes, onSelectEarthquake, onSelectSite, selectedEarthquakeId, selectedSiteId, showEarthquakes, showPlateBoundaries, sites, tectonic, visibleKinds, worldFeatures]);

  const selectedQuake = earthquakes.find((event) => event.id === selectedEarthquakeId) ?? null;

  return (
    <div style={{ position: "relative", minHeight: 500, borderRadius: 18, overflow: "hidden", background: "#010711", border: "1px solid rgba(56,189,248,.16)" }}>
      <div ref={hostRef} style={{ width: "100%", minHeight: 500, touchAction: "none" }} />
      <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", gap: 7, flexWrap: "wrap", pointerEvents: "none" }}>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.84)", color: "#d8f2ff", fontSize: 11, fontWeight: 800 }}>{sites.filter((site) => visibleKinds.has(site.kind)).length.toLocaleString("es-DO")} extracciones visibles</span>
        <span style={{ padding: "6px 9px", borderRadius: 999, background: "rgba(2,7,18,.84)", color: "#fda4af", fontSize: 11, fontWeight: 800 }}>{showEarthquakes ? earthquakes.length.toLocaleString("es-DO") : 0} sismos seleccionables</span>
      </div>
      {selected && (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: selectedQuake ? 126 : 12, padding: 12, borderRadius: 14, background: "rgba(2,7,18,.94)", border: `1px solid ${EXTRACTION_KIND_COLORS[selected.kind]}66`, color: "#eaf6ff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: EXTRACTION_KIND_COLORS[selected.kind], fontSize: 10, fontWeight: 900 }}>{EXTRACTION_KIND_LABELS[selected.kind]}</div>
              <strong style={{ fontSize: 13 }}>{selected.name}</strong>
              <div style={{ fontSize: 10, opacity: .8 }}>{selected.location ? `${selected.location} · ` : ""}{selected.country}</div>
              <div style={{ fontSize: 10, opacity: .72 }}>{selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)} · Cantidad: {extractionQuantityText(selected)}</div>
              <div style={{ fontSize: 10, color: "#7dd3fc", marginTop: 3 }}>{nearbyEventCount} sismos dentro de {radiusKm} km</div>
            </div>
            <button type="button" onClick={() => onOpenRelief(selected)} style={{ border: "1px solid rgba(125,211,252,.35)", borderRadius: 10, padding: "7px 10px", background: "#0c4a6e", color: "white", fontWeight: 800, cursor: "pointer" }}>Abrir Relieve 3D</button>
          </div>
        </div>
      )}
      {selectedQuake && (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, padding: 10, borderRadius: 12, background: "rgba(45,8,20,.94)", border: "1px solid rgba(251,113,133,.45)", color: "#ffe4e6" }}>
          <strong>M{selectedQuake.magnitude.toFixed(1)} · {selectedQuake.place}</strong>
          <div style={{ fontSize: 10, marginTop: 3 }}>{new Date(selectedQuake.timeUtc).toLocaleString("es-DO")} · {selectedQuake.depthKm.toFixed(1)} km profundidad · {selectedQuake.latitude.toFixed(3)}, {selectedQuake.longitude.toFixed(3)}</div>
        </div>
      )}
    </div>
  );
}
