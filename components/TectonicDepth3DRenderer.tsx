"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GeoFeature } from "@/lib/plateDynamics";
import type {
  SlabContour3D,
  SlabSurfaceTriangle3D,
  TectonicDepth3DResponse,
} from "@/lib/tectonicDepth3d";
import styles from "./TectonicDepth3D.module.css";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const EARTH_RADIUS_KM = 6371;
const PLATE_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#c084fc", "#4ade80"];

type SlabPath = SlabContour3D & {
  color: string;
  stroke: number;
  renderPoints: Array<{ lat: number; lng: number; altitude: number }>;
};

type QuakePoint = {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
  event: EarthquakeEvent;
};

type PlateRenderItem = GeoFeature & { renderKind: "plate" };
type SlabSurfaceRenderItem = SlabSurfaceTriangle3D & { renderKind: "slab-surface"; color: string };
type PolygonRenderItem = PlateRenderItem | SlabSurfaceRenderItem;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function plateColor(feature: GeoFeature) {
  const plateId = String(feature.properties?.plateId ?? feature.id ?? "plate");
  return PLATE_COLORS[hashText(plateId) % PLATE_COLORS.length];
}

function slabColor(depthKm: number) {
  if (depthKm <= 80) return "#ef4444";
  if (depthKm <= 180) return "#f97316";
  if (depthKm <= 300) return "#facc15";
  if (depthKm <= 440) return "#84cc16";
  if (depthKm <= 560) return "#22c55e";
  return "#38bdf8";
}

function quakeColor(depthKm: number) {
  if (depthKm < 70) return "#f43f5e";
  if (depthKm < 300) return "#f59e0b";
  return "#60a5fa";
}

// react-globe.gl is optimized for layers at or above the globe surface. Negative
// polygon/path altitudes can disappear or invalidate the WebGL layer on mobile.
// In exploded mode we therefore preserve the physical depth value in the data,
// color and labels, but separate deeper levels progressively OUTWARD so every
// layer remains inspectable. This is an exploded diagram, not a radial scale.
function displayAltitudeForDepth(depthKm: number, exaggeration: number, exploded: boolean) {
  const normalizedDepth = clamp(Math.max(0, depthKm) / EARTH_RADIUS_KM, 0, 0.18);
  if (exploded) return 0.075 + normalizedDepth * Math.max(1, exaggeration) * 0.7;
  return 0.012 + normalizedDepth * 0.24;
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isSlabSurface(item: unknown): item is SlabSurfaceRenderItem {
  return (item as { renderKind?: string } | null)?.renderKind === "slab-surface";
}

function plateLabel(feature: GeoFeature) {
  const name = String(feature.properties?.plateName ?? "Placa tectónica");
  const id = String(feature.properties?.plateId ?? feature.id ?? "—");
  return `<div class="globe-tooltip"><strong>${escapeHtml(name)}</strong><span>GPlates · ID ${escapeHtml(id)}</span><small>Polígono tectónico a 0 Ma. La profundidad real solo se modela en las losas Slab2.</small></div>`;
}

function slabLabel(path: SlabPath) {
  return `<div class="globe-tooltip"><strong>Slab2 · ${escapeHtml(path.region)}</strong><span>Isolínea de ${path.depthKm.toFixed(0)} km</span><small>Profundidad Slab2 real; su separación radial es visual cuando Exploded view está activo.</small></div>`;
}

function slabSurfaceLabel(surface: SlabSurfaceRenderItem) {
  return `<div class="globe-tooltip"><strong>Superficie Slab2 · ${escapeHtml(surface.region)}</strong><span>≈${surface.depthKm.toFixed(0)} km</span><small>Triangulación interpolada entre isolíneas Slab2 de ${surface.minDepthKm.toFixed(0)}–${surface.maxDepthKm.toFixed(0)} km.</small></div>`;
}

function quakeLabel(point: QuakePoint) {
  const event = point.event;
  return `<div class="globe-tooltip"><strong>Sismo · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatUtc(event.timeUtc)} UTC · hipocentro ${event.depthKm.toFixed(1)} km</small></div>`;
}

function surfaceCenter(surface: SlabSurfaceTriangle3D) {
  const ring = surface.geometry.coordinates[0] ?? [];
  const points = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (!points.length) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((sum, point) => sum + Number(point[1] ?? 0), 0) / points.length,
    lng: points.reduce((sum, point) => sum + Number(point[0] ?? 0), 0) / points.length,
  };
}

export function TectonicDepth3DRenderer({
  tectonic,
  earthquakes,
  exploded,
  depthExaggeration,
  showPlates,
  showSlabs,
  showEarthquakes,
  slabRegion,
  autoRotate,
}: {
  tectonic: TectonicDepth3DResponse;
  earthquakes: EarthquakeEvent[];
  exploded: boolean;
  depthExaggeration: number;
  showPlates: boolean;
  showSlabs: boolean;
  showEarthquakes: boolean;
  slabRegion: string;
  autoRotate: boolean;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 980, height: 720 });
  const [selectedEvent, setSelectedEvent] = useState<EarthquakeEvent | null>(null);
  const [selectedSlab, setSelectedSlab] = useState<SlabSurfaceTriangle3D | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(520, Math.min(820, element.clientWidth * 0.72)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.28;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 12, lng: -35, altitude: exploded ? 2.35 : 2.1 }, 700);
  }, [exploded]);

  const surfaceBudget = size.width < 620 ? 1_800 : size.width < 900 ? 3_200 : 6_000;

  const visibleSurfaceTriangles = useMemo(() => {
    if (!showSlabs) return [] as SlabSurfaceTriangle3D[];
    const source = tectonic.slabSurfaceTriangles.filter((surface) => !slabRegion || surface.region === slabRegion);
    if (source.length <= surfaceBudget) return source;
    const stride = Math.ceil(source.length / surfaceBudget);
    return source.filter((_, index) => index % stride === 0).slice(0, surfaceBudget);
  }, [showSlabs, slabRegion, surfaceBudget, tectonic.slabSurfaceTriangles]);

  const polygonItems = useMemo<PolygonRenderItem[]>(() => {
    const plates: PlateRenderItem[] = showPlates
      ? tectonic.platePolygons.features.map((feature) => ({ ...feature, renderKind: "plate" as const }))
      : [];
    const surfaces: SlabSurfaceRenderItem[] = visibleSurfaceTriangles.map((surface) => ({
      ...surface,
      renderKind: "slab-surface" as const,
      color: slabColor(surface.depthKm),
    }));
    return [...plates, ...surfaces];
  }, [showPlates, tectonic.platePolygons.features, visibleSurfaceTriangles]);

  const slabPaths = useMemo<SlabPath[]>(() => {
    if (!showSlabs) return [];
    const source = tectonic.slabContours.filter((contour) => !slabRegion || contour.region === slabRegion);
    const pathStride = size.width < 620 && source.length > 520 ? 2 : 1;
    return source
      .filter((_, index) => index % pathStride === 0)
      .map((contour) => ({
        ...contour,
        color: slabColor(contour.depthKm),
        stroke: contour.depthKm % 100 === 0 ? 0.58 : 0.34,
        renderPoints: contour.points.map((point) => ({
          ...point,
          altitude: displayAltitudeForDepth(contour.depthKm, depthExaggeration, exploded),
        })),
      }));
  }, [depthExaggeration, exploded, showSlabs, slabRegion, size.width, tectonic.slabContours]);

  const quakePoints = useMemo<QuakePoint[]>(() => {
    if (!showEarthquakes) return [];
    return earthquakes.map((event) => ({
      id: event.id,
      lat: event.latitude,
      lng: event.longitude,
      altitude: displayAltitudeForDepth(event.depthKm, depthExaggeration, exploded),
      radius: 0.11 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.34,
      color: quakeColor(event.depthKm),
      event,
    }));
  }, [depthExaggeration, earthquakes, exploded, showEarthquakes]);

  const plateLift = exploded ? 0.035 : 0.006;

  return (
    <div className={styles.renderer} ref={containerRef}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        showGlobe
        showAtmosphere={!exploded}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#7dd3fc"
        atmosphereAltitude={0.13}
        showGraticules={!exploded}
        polygonsData={polygonItems}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={(item: unknown) => {
          if (isSlabSurface(item)) return `${item.color}${exploded ? "8f" : "66"}`;
          return `${plateColor(item as GeoFeature)}${exploded ? "b0" : "66"}`;
        }}
        polygonSideColor={(item: unknown) => isSlabSurface(item) ? `${item.color}3d` : `${plateColor(item as GeoFeature)}55`}
        polygonStrokeColor={(item: unknown) => isSlabSurface(item) ? `${item.color}aa` : plateColor(item as GeoFeature)}
        polygonAltitude={(item: unknown) => isSlabSurface(item)
          ? displayAltitudeForDepth(item.depthKm, depthExaggeration, exploded)
          : plateLift}
        polygonLabel={(item: unknown) => isSlabSurface(item)
          ? slabSurfaceLabel(item)
          : plateLabel(item as GeoFeature)}
        polygonsTransitionDuration={180}
        onPolygonClick={(item: unknown) => {
          if (!isSlabSurface(item)) return;
          setSelectedSlab(item);
          setSelectedEvent(null);
          const center = surfaceCenter(item);
          globeRef.current?.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.25 }, 650);
        }}
        pathsData={slabPaths}
        pathPoints="renderPoints"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor="color"
        pathStroke="stroke"
        pathDashLength={1}
        pathDashGap={0}
        pathTransitionDuration={180}
        pathLabel={(item: unknown) => slabLabel(item as SlabPath)}
        pointsData={quakePoints}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(item: unknown) => quakeLabel(item as QuakePoint)}
        pointsTransitionDuration={220}
        onPointClick={(item: unknown) => {
          const point = item as QuakePoint;
          setSelectedEvent(point.event);
          setSelectedSlab(null);
          globeRef.current?.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.2 }, 650);
        }}
        enablePointerInteraction
      />

      <div style={{
        position: "absolute",
        left: 12,
        top: 12,
        zIndex: 3,
        padding: "7px 10px",
        borderRadius: 999,
        border: "1px solid rgba(125,211,252,.22)",
        background: "rgba(2,6,23,.78)",
        color: "#bae6fd",
        fontSize: 11,
        fontWeight: 700,
        pointerEvents: "none",
      }}>
        {exploded ? "Exploded: profundidad separada hacia afuera" : "Vista compacta"} · {visibleSurfaceTriangles.length.toLocaleString("es-DO")} triángulos visibles
      </div>

      <div className={styles.depthScale} aria-label="Escala de profundidad">
        <span>0 km</span>
        <i />
        <span>70</span>
        <i />
        <span>300</span>
        <i />
        <span>680 km</span>
      </div>

      {selectedEvent && (
        <div className={styles.selectedCard}>
          <button type="button" onClick={() => setSelectedEvent(null)} aria-label="Cerrar detalle">×</button>
          <span>SISMO SELECCIONADO</span>
          <strong>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.depthKm.toFixed(1)} km</strong>
          <p>{selectedEvent.place}</p>
          <small>{formatUtc(selectedEvent.timeUtc)} UTC · {selectedEvent.latitude.toFixed(2)}°, {selectedEvent.longitude.toFixed(2)}°</small>
        </div>
      )}

      {selectedSlab && (
        <div className={styles.selectedCard}>
          <button type="button" onClick={() => setSelectedSlab(null)} aria-label="Cerrar detalle">×</button>
          <span>SUPERFICIE SLAB2</span>
          <strong>{selectedSlab.region} · ≈{selectedSlab.depthKm.toFixed(0)} km</strong>
          <p>Triángulo interpolado entre isolíneas de {selectedSlab.minDepthKm.toFixed(0)} y {selectedSlab.maxDepthKm.toFixed(0)} km.</p>
          <small>La cifra en km conserva la profundidad Slab2. En Exploded view la separación radial está amplificada y desplazada hacia afuera únicamente para poder verla.</small>
        </div>
      )}
    </div>
  );
}
