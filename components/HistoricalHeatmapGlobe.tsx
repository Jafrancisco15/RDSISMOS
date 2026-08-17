"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { COUNTRIES } from "@/lib/countries";
import type { GlobeMapLayersResponse, GlobeMapPath, GlobeMapPoint } from "@/lib/globeLayers";
import type { HistoricalHeatmapEvent } from "@/lib/historicalHeatmap";
import { visualMagnitudeWeight } from "@/lib/historicalHeatmap";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";

type HeatMode = "density" | "magnitude";

interface RenderPath extends Omit<GlobeMapPath, "points"> {
  points: Array<GlobeMapPoint & { altitude: number }>;
  color: string;
  stroke: number;
}

interface HeatDataset {
  id: string;
  points: HistoricalHeatmapEvent[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function heatColor(value: number) {
  const x = clamp(value, 0, 1);
  if (x < 0.18) return `rgba(37,99,235,${0.12 + x * 1.8})`;
  if (x < 0.38) return `rgba(14,165,233,${0.28 + x})`;
  if (x < 0.58) return `rgba(34,211,238,${0.42 + x * 0.6})`;
  if (x < 0.76) return `rgba(250,204,21,${0.55 + x * 0.45})`;
  if (x < 0.9) return `rgba(249,115,22,${0.68 + x * 0.32})`;
  return "rgba(239,68,68,1)";
}

function magnitudeColor(magnitude: number) {
  if (magnitude >= 7) return "#ef4444";
  if (magnitude >= 6) return "#f97316";
  if (magnitude >= 5) return "#facc15";
  if (magnitude >= 4) return "#22d3ee";
  return "#60a5fa";
}

function pointLabel(event: HistoricalHeatmapEvent) {
  const date = new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(event.timeUtc));
  return `<div class="globe-tooltip"><strong>M${event.magnitude.toFixed(1)} · ${escapeHtml(event.place)}</strong><span>${date} UTC</span><small>Profundidad ${event.depthKm.toFixed(1)} km · USGS ComCat</small></div>`;
}

export function HistoricalHeatmapGlobe({
  events,
  mode,
  showCountryNames,
  showStrongEvents,
  autoRotate,
}: {
  events: HistoricalHeatmapEvent[];
  mode: HeatMode;
  showCountryNames: boolean;
  showStrongEvents: boolean;
  autoRotate: boolean;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 720 });
  const [layers, setLayers] = useState<GlobeMapLayersResponse | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resize = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(520, Math.min(820, element.clientWidth * 0.7)),
    });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/globe/layers", { cache: "force-cache", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<GlobeMapLayersResponse>;
      })
      .then(setLayers)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 12, lng: -20, altitude: 2.05 }, 800);
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.3;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  const heatmaps = useMemo<HeatDataset[]>(() => [{ id: "earthquakes", points: events }], [events]);

  const strongEvents = useMemo(() => {
    if (!showStrongEvents) return [];
    return [...events]
      .filter((event) => event.magnitude >= 5.5)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 350);
  }, [events, showStrongEvents]);

  const countryPaths = useMemo<RenderPath[]>(() => (layers?.countryBorders ?? []).map((path) => ({
    ...path,
    color: "rgba(226,232,240,.42)",
    stroke: 0.26,
    points: path.points.map((point) => ({ ...point, altitude: 0.006 })),
  })), [layers]);

  const labels = useMemo(() => showCountryNames ? COUNTRIES.map((country) => ({
    ...country,
    text: country.name,
    size: clamp(0.18 + country.radiusKm / 7_500, 0.18, 0.42),
  })) : [], [showCountryNames]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 520 }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.16}
        showGraticules
        pathsData={countryPaths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor="color"
        pathStroke="stroke"
        pathTransitionDuration={0}
        heatmapsData={heatmaps}
        heatmapPoints="points"
        heatmapPointLat="latitude"
        heatmapPointLng="longitude"
        heatmapPointWeight={(point: object) => mode === "density"
          ? 1
          : visualMagnitudeWeight((point as HistoricalHeatmapEvent).magnitude)}
        heatmapBandwidth={mode === "density" ? 1.45 : 1.2}
        heatmapColorFn={() => heatColor}
        heatmapColorSaturation={1.35}
        heatmapBaseAltitude={0.008}
        heatmapTopAltitude={mode === "density" ? 0.035 : 0.07}
        heatmapsTransitionDuration={480}
        pointsData={strongEvents}
        pointLat="latitude"
        pointLng="longitude"
        pointAltitude={(point: object) => 0.025 + clamp(((point as HistoricalHeatmapEvent).magnitude - 5.5) / 3.5, 0, 1) * 0.13}
        pointRadius={(point: object) => 0.09 + clamp(((point as HistoricalHeatmapEvent).magnitude - 5.5) / 3.5, 0, 1) * 0.34}
        pointColor={(point: object) => magnitudeColor((point as HistoricalHeatmapEvent).magnitude)}
        pointLabel={(point: object) => pointLabel(point as HistoricalHeatmapEvent)}
        pointsTransitionDuration={420}
        labelsData={labels}
        labelLat="latitude"
        labelLng="longitude"
        labelText="text"
        labelColor={() => "rgba(241,245,249,.86)"}
        labelAltitude={0.012}
        labelSize="size"
        labelIncludeDot={false}
        labelResolution={2}
        labelsTransitionDuration={250}
        enablePointerInteraction
      />
    </div>
  );
}
