"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GeoFeature } from "@/lib/plateDynamics";
import type { SlabContour3D, TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";
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

function altitudeForDepth(depthKm: number, exaggeration: number, exploded: boolean) {
  const factor = exploded ? exaggeration : 1;
  return -clamp((Math.max(0, depthKm) / EARTH_RADIUS_KM) * factor, 0, 0.92);
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

function plateLabel(feature: GeoFeature) {
  const name = String(feature.properties?.plateName ?? "Placa tectónica");
  const id = String(feature.properties?.plateId ?? feature.id ?? "—");
  return `<div class="globe-tooltip"><strong>${escapeHtml(name)}</strong><span>GPlates · ID ${escapeHtml(id)}</span><small>Polígono tectónico a 0 Ma. La profundidad real solo se modela en las losas Slab2.</small></div>`;
}

function slabLabel(path: SlabPath) {
  return `<div class="globe-tooltip"><strong>Slab2 · ${escapeHtml(path.region)}</strong><span>Contorno de ${path.depthKm.toFixed(0)} km</span><small>Profundidad geométrica de la superficie de la losa subducida.</small></div>`;
}

function quakeLabel(point: QuakePoint) {
  const event = point.event;
  return `<div class="globe-tooltip"><strong>Sismo · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatUtc(event.timeUtc)} UTC · hipocentro ${event.depthKm.toFixed(1)} km</small></div>`;
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
    globeRef.current?.pointOfView({ lat: 12, lng: -35, altitude: exploded ? 2.45 : 2.1 }, 700);
  }, [exploded]);

  const plates = useMemo(
    () => showPlates ? tectonic.platePolygons.features : [],
    [showPlates, tectonic.platePolygons.features],
  );

  const slabPaths = useMemo<SlabPath[]>(() => {
    if (!showSlabs) return [];
    return tectonic.slabContours
      .filter((contour) => !slabRegion || contour.region === slabRegion)
      .map((contour) => ({
        ...contour,
        color: slabColor(contour.depthKm),
        stroke: contour.depthKm % 100 === 0 ? 0.62 : 0.42,
        renderPoints: contour.points.map((point) => ({
          ...point,
          altitude: altitudeForDepth(contour.depthKm, depthExaggeration, exploded),
        })),
      }));
  }, [depthExaggeration, exploded, showSlabs, slabRegion, tectonic.slabContours]);

  const quakePoints = useMemo<QuakePoint[]>(() => {
    if (!showEarthquakes) return [];
    return earthquakes.map((event) => ({
      id: event.id,
      lat: event.latitude,
      lng: event.longitude,
      altitude: altitudeForDepth(event.depthKm, depthExaggeration, exploded),
      radius: 0.11 + clamp((event.magnitude - 4) / 4, 0, 1) * 0.34,
      color: quakeColor(event.depthKm),
      event,
    }));
  }, [depthExaggeration, earthquakes, exploded, showEarthquakes]);

  const plateLift = exploded ? 0.055 : 0.006;

  return (
    <div className={styles.renderer} ref={containerRef}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        showGlobe={!exploded}
        showAtmosphere={!exploded}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#7dd3fc"
        atmosphereAltitude={0.13}
        showGraticules={!exploded}
        polygonsData={plates}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={(item: unknown) => `${plateColor(item as GeoFeature)}${exploded ? "99" : "55"}`}
        polygonSideColor={(item: unknown) => `${plateColor(item as GeoFeature)}44`}
        polygonStrokeColor={(item: unknown) => plateColor(item as GeoFeature)}
        polygonAltitude={plateLift}
        polygonLabel={(item: unknown) => plateLabel(item as GeoFeature)}
        polygonsTransitionDuration={250}
        pathsData={slabPaths}
        pathPoints="renderPoints"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor="color"
        pathStroke="stroke"
        pathDashLength={1}
        pathDashGap={0}
        pathTransitionDuration={250}
        pathLabel={(item: unknown) => slabLabel(item as SlabPath)}
        pointsData={quakePoints}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(item: unknown) => quakeLabel(item as QuakePoint)}
        pointsTransitionDuration={300}
        onPointClick={(item: unknown) => {
          const point = item as QuakePoint;
          setSelectedEvent(point.event);
          globeRef.current?.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.25 }, 650);
        }}
        enablePointerInteraction
      />

      <div className={styles.depthScale} aria-label="Escala visual de profundidad">
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
    </div>
  );
}
