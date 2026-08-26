"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GeoFeature } from "@/lib/plateDynamics";
import type { SlabContour3D, SlabSurfaceTriangle3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";
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
type SurfaceResponse = {
  region?: string;
  triangles?: SlabSurfaceTriangle3D[];
  sourceTriangleCount?: number;
  warning?: string | null;
  error?: string;
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

function displayAltitudeForDepth(depthKm: number, exaggeration: number, exploded: boolean) {
  const normalizedDepth = clamp(Math.max(0, depthKm) / EARTH_RADIUS_KM, 0, 0.18);
  if (exploded) return 0.055 + normalizedDepth * Math.max(1, exaggeration) * 0.62;
  return 0.01 + normalizedDepth * 0.2;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function isSlabSurface(item: unknown): item is SlabSurfaceRenderItem {
  return (item as { renderKind?: string } | null)?.renderKind === "slab-surface";
}

function plateLabel(feature: GeoFeature) {
  const name = String(feature.properties?.plateName ?? "Placa tectónica");
  const id = String(feature.properties?.plateId ?? feature.id ?? "—");
  return `<div class="globe-tooltip"><strong>${escapeHtml(name)}</strong><span>GPlates · ID ${escapeHtml(id)}</span><small>Polígono tectónico a 0 Ma.</small></div>`;
}

function slabLabel(path: SlabPath) {
  return `<div class="globe-tooltip"><strong>Slab2 · ${escapeHtml(path.region)}</strong><span>${path.depthKm.toFixed(0)} km</span><small>Isolínea de profundidad publicada por Slab2.</small></div>`;
}

function quakeLabel(point: QuakePoint) {
  const event = point.event;
  return `<div class="globe-tooltip"><strong>Sismo · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatUtc(event.timeUtc)} UTC · ${event.depthKm.toFixed(1)} km</small></div>`;
}

function slabSurfaceLabel(surface: SlabSurfaceRenderItem) {
  return `<div class="globe-tooltip"><strong>Superficie Slab2 · ${escapeHtml(surface.region)}</strong><span>≈${surface.depthKm.toFixed(0)} km</span><small>Interpolación entre isolíneas de ${surface.minDepthKm.toFixed(0)}–${surface.maxDepthKm.toFixed(0)} km.</small></div>`;
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
  const [surfaceTriangles, setSurfaceTriangles] = useState<SlabSurfaceTriangle3D[]>([]);
  const [surfaceSourceCount, setSurfaceSourceCount] = useState(0);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [surfaceWarning, setSurfaceWarning] = useState<string | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EarthquakeEvent | null>(null);
  const [selectedSlab, setSelectedSlab] = useState<SlabSurfaceTriangle3D | null>(null);

  const mobile = size.width < 620;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: element.clientWidth < 620 ? 520 : Math.max(560, Math.min(780, element.clientWidth * 0.68)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate && !mobile;
    controls.autoRotateSpeed = 0.22;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate, mobile]);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 15, lng: -35, altitude: mobile ? 2.65 : exploded ? 2.35 : 2.1 }, 0);
    const globe = globeRef.current as (GlobeMethods & { renderer?: () => { setPixelRatio?: (value: number) => void } }) | undefined;
    const renderer = globe?.renderer?.();
    renderer?.setPixelRatio?.(mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
  }, [exploded, mobile]);

  useEffect(() => {
    if (!showSlabs || !slabRegion) {
      setSurfaceTriangles([]);
      setSurfaceSourceCount(0);
      setSurfaceWarning(null);
      setSurfaceError(null);
      setSurfaceLoading(false);
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    setSurfaceLoading(true);
    setSurfaceError(null);
    setSurfaceWarning(null);

    void fetch(`/api/tectonic-depth-3d/surface?region=${encodeURIComponent(slabRegion)}`, {
      cache: "force-cache",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as SurfaceResponse;
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (disposed) return;
        setSurfaceTriangles(payload.triangles ?? []);
        setSurfaceSourceCount(payload.sourceTriangleCount ?? payload.triangles?.length ?? 0);
        setSurfaceWarning(payload.warning ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!disposed) setSurfaceError(error instanceof Error ? error.message : "No fue posible cargar la superficie Slab2.");
      })
      .finally(() => {
        if (!disposed) setSurfaceLoading(false);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [showSlabs, slabRegion]);

  const visibleSurfaceTriangles = useMemo(() => {
    const budget = mobile ? 220 : 700;
    if (surfaceTriangles.length <= budget) return surfaceTriangles;
    const stride = Math.ceil(surfaceTriangles.length / budget);
    return surfaceTriangles.filter((_, index) => index % stride === 0).slice(0, budget);
  }, [mobile, surfaceTriangles]);

  const polygonItems = useMemo<PolygonRenderItem[]>(() => {
    const plates: PlateRenderItem[] = showPlates
      ? tectonic.platePolygons.features.map((feature) => ({ ...feature, renderKind: "plate" as const }))
      : [];
    const surfaces: SlabSurfaceRenderItem[] = showSlabs
      ? visibleSurfaceTriangles.map((surface) => ({ ...surface, renderKind: "slab-surface" as const, color: slabColor(surface.depthKm) }))
      : [];
    return [...plates, ...surfaces];
  }, [showPlates, showSlabs, tectonic.platePolygons.features, visibleSurfaceTriangles]);

  const slabPaths = useMemo<SlabPath[]>(() => {
    if (!showSlabs) return [];
    const source = tectonic.slabContours.filter((contour) => !slabRegion || contour.region === slabRegion);
    const budget = slabRegion ? (mobile ? 120 : 260) : (mobile ? 160 : 360);
    const stride = source.length > budget ? Math.ceil(source.length / budget) : 1;
    return source
      .filter((_, index) => index % stride === 0)
      .slice(0, budget)
      .map((contour) => ({
        ...contour,
        color: slabColor(contour.depthKm),
        stroke: mobile ? 0.34 : contour.depthKm % 100 === 0 ? 0.55 : 0.36,
        renderPoints: contour.points.map((point) => ({
          ...point,
          altitude: displayAltitudeForDepth(contour.depthKm, depthExaggeration, exploded),
        })),
      }));
  }, [depthExaggeration, exploded, mobile, showSlabs, slabRegion, tectonic.slabContours]);

  const quakePoints = useMemo<QuakePoint[]>(() => {
    if (!showEarthquakes) return [];
    const budget = mobile ? 700 : 2_500;
    const source = earthquakes.length > budget ? earthquakes.slice(0, budget) : earthquakes;
    return source.map((event) => ({
      id: event.id,
      lat: event.latitude,
      lng: event.longitude,
      altitude: displayAltitudeForDepth(event.depthKm, depthExaggeration, exploded),
      radius: 0.1 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.28,
      color: quakeColor(event.depthKm),
      event,
    }));
  }, [depthExaggeration, earthquakes, exploded, mobile, showEarthquakes]);

  const plateLift = exploded ? 0.028 : 0.005;

  return (
    <div className={styles.renderer} ref={containerRef}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        showGlobe
        showAtmosphere={!mobile && !exploded}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#7dd3fc"
        atmosphereAltitude={0.12}
        showGraticules={!mobile && !exploded}
        polygonsData={polygonItems}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={(item: unknown) => isSlabSurface(item)
          ? `${item.color}8c`
          : `${plateColor(item as GeoFeature)}${exploded ? "9c" : "5f"}`}
        polygonSideColor={(item: unknown) => isSlabSurface(item) ? `${item.color}28` : `${plateColor(item as GeoFeature)}44`}
        polygonStrokeColor={(item: unknown) => isSlabSurface(item) ? `${item.color}b0` : plateColor(item as GeoFeature)}
        polygonAltitude={(item: unknown) => isSlabSurface(item)
          ? displayAltitudeForDepth(item.depthKm, depthExaggeration, exploded)
          : plateLift}
        polygonLabel={(item: unknown) => mobile ? "" : isSlabSurface(item) ? slabSurfaceLabel(item) : plateLabel(item as GeoFeature)}
        polygonsTransitionDuration={0}
        onPolygonClick={(item: unknown) => {
          if (mobile || !isSlabSurface(item)) return;
          setSelectedSlab(item);
          setSelectedEvent(null);
          const center = surfaceCenter(item);
          globeRef.current?.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.25 }, 500);
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
        pathTransitionDuration={0}
        pathLabel={(item: unknown) => mobile ? "" : slabLabel(item as SlabPath)}
        pointsData={quakePoints}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(item: unknown) => mobile ? "" : quakeLabel(item as QuakePoint)}
        pointsTransitionDuration={0}
        onPointClick={(item: unknown) => {
          if (mobile) return;
          const point = item as QuakePoint;
          setSelectedEvent(point.event);
          setSelectedSlab(null);
          globeRef.current?.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.2 }, 500);
        }}
        enablePointerInteraction={!mobile}
      />

      <div style={{
        position: "absolute",
        left: 12,
        top: 12,
        zIndex: 3,
        maxWidth: "calc(100% - 24px)",
        padding: "7px 10px",
        borderRadius: 12,
        border: "1px solid rgba(125,211,252,.22)",
        background: "rgba(2,6,23,.84)",
        color: "#bae6fd",
        fontSize: 11,
        fontWeight: 700,
        pointerEvents: "none",
      }}>
        {slabRegion
          ? surfaceLoading
            ? `Cargando superficie ${slabRegion}…`
            : `${slabRegion}: ${visibleSurfaceTriangles.length.toLocaleString("es-DO")} caras visibles${surfaceSourceCount ? ` / ${surfaceSourceCount.toLocaleString("es-DO")} fuente` : ""}`
          : "Modo global ligero · selecciona una Zona Slab2 para cargar su superficie 3D"}
        {mobile ? " · interacción táctil reducida para estabilidad" : ""}
      </div>

      {surfaceWarning && <div className={styles.surfaceStatus}>{surfaceWarning}</div>}
      {surfaceError && <div className={styles.surfaceStatus}>{surfaceError}</div>}

      <div className={styles.depthScale} aria-label="Escala de profundidad">
        <span>0 km</span><i /><span>70</span><i /><span>300</span><i /><span>680 km</span>
      </div>

      {selectedEvent && !mobile && (
        <div className={styles.selectedCard}>
          <button type="button" onClick={() => setSelectedEvent(null)} aria-label="Cerrar detalle">×</button>
          <span>SISMO SELECCIONADO</span>
          <strong>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.depthKm.toFixed(1)} km</strong>
          <p>{selectedEvent.place}</p>
          <small>{formatUtc(selectedEvent.timeUtc)} UTC</small>
        </div>
      )}

      {selectedSlab && !mobile && (
        <div className={styles.selectedCard}>
          <button type="button" onClick={() => setSelectedSlab(null)} aria-label="Cerrar detalle">×</button>
          <span>SUPERFICIE SLAB2</span>
          <strong>{selectedSlab.region} · ≈{selectedSlab.depthKm.toFixed(0)} km</strong>
          <p>Interpolada entre isolíneas de {selectedSlab.minDepthKm.toFixed(0)} y {selectedSlab.maxDepthKm.toFixed(0)} km.</p>
        </div>
      )}
    </div>
  );
}
