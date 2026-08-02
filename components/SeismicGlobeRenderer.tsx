"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeProjection } from "@/lib/globeTypes";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";

export type SeismicGlobePoint =
  | {
      kind: "observed";
      id: string;
      lat: number;
      lng: number;
      altitude: number;
      radius: number;
      color: string;
      event: EarthquakeEvent;
    }
  | {
      kind: "projected";
      id: string;
      lat: number;
      lng: number;
      altitude: number;
      radius: number;
      color: string;
      comparison: boolean;
      projection: GlobeProjection;
    };

interface GlobeArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  altitude: number;
}

interface FocusTarget {
  key: string;
  latitude: number;
  longitude: number;
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function observedColor(magnitude: number) {
  if (magnitude >= 7) return "#ff3b30";
  if (magnitude >= 5.5) return "#ff7a45";
  return "#fbbf24";
}

function projectionColor(projection: GlobeProjection, comparison = false) {
  if (comparison) return "#22c55e";
  if (projection.projectionKind === "regional-etas") return "#22d3ee";
  if (projection.probabilityPct >= 65) return "#d946ef";
  if (projection.probabilityPct >= 35) return "#8b5cf6";
  return "#60a5fa";
}

function pointLabel(point: SeismicGlobePoint) {
  if (point.kind === "observed") {
    const event = point.event;
    return `<div class="globe-tooltip"><strong>Sismo observado · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatDate(event.timeUtc)} UTC · ${event.depthKm.toFixed(0)} km · ${escapeHtml(event.sourceCatalog)}</small></div>`;
  }
  const projection = point.projection;
  const model = projection.projectionKind === "regional-etas" ? "ETAS regional" : "analogía histórica";
  return `<div class="globe-tooltip"><strong>${point.comparison ? "Comparación" : "Proyección"} · ${escapeHtml(projection.countryName)}</strong><span>${projection.probabilityPct}% · M${projection.magnitudeMin.toFixed(1)}–M${projection.magnitudeMax.toFixed(1)}</span><small>${formatDate(projection.surveillanceStart)}–${formatDate(projection.surveillanceEnd)} · ${model}</small></div>`;
}

export function SeismicGlobeRenderer({
  observedEvents,
  projections,
  comparisonProjections,
  showObserved,
  showProjected,
  showComparison,
  autoRotate,
  focusTarget,
  onSelect,
}: {
  observedEvents: EarthquakeEvent[];
  projections: GlobeProjection[];
  comparisonProjections: GlobeProjection[];
  showObserved: boolean;
  showProjected: boolean;
  showComparison: boolean;
  autoRotate: boolean;
  focusTarget: FocusTarget | null;
  onSelect: (point: SeismicGlobePoint) => void;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 680 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(480, Math.min(760, element.clientWidth * 0.72)),
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
    controls.autoRotateSpeed = 0.38;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 15, lng: -25, altitude: 2.15 }, 900);
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    globeRef.current?.pointOfView({
      lat: focusTarget.latitude,
      lng: focusTarget.longitude,
      altitude: 1.35,
    }, 850);
  }, [focusTarget]);

  const points = useMemo<SeismicGlobePoint[]>(() => {
    const observed: SeismicGlobePoint[] = showObserved
      ? observedEvents.map((event) => ({
          kind: "observed",
          id: `observed:${event.id}`,
          lat: event.latitude,
          lng: event.longitude,
          altitude: 0.018 + clamp((event.magnitude - 4.2) / 4.3, 0, 1) * 0.11,
          radius: 0.12 + clamp((event.magnitude - 4.2) / 4.3, 0, 1) * 0.38,
          color: observedColor(event.magnitude),
          event,
        }))
      : [];
    const projected: SeismicGlobePoint[] = showProjected
      ? projections.map((projection) => ({
          kind: "projected",
          id: `projected:${projection.id}`,
          lat: projection.latitude,
          lng: projection.longitude,
          altitude: 0.15 + clamp(projection.probabilityPct / 100, 0, 1) * 0.25,
          radius: 0.24 + clamp(projection.magnitudeMax / 9, 0, 1) * 0.3,
          color: projectionColor(projection),
          comparison: false,
          projection,
        }))
      : [];
    const comparison: SeismicGlobePoint[] = showComparison
      ? comparisonProjections.map((projection) => ({
          kind: "projected",
          id: `comparison:${projection.id}`,
          lat: projection.latitude,
          lng: projection.longitude,
          altitude: 0.11 + clamp(projection.probabilityPct / 100, 0, 1) * 0.19,
          radius: 0.2 + clamp(projection.magnitudeMax / 9, 0, 1) * 0.24,
          color: projectionColor(projection, true),
          comparison: true,
          projection,
        }))
      : [];
    return [...observed, ...projected, ...comparison];
  }, [observedEvents, projections, comparisonProjections, showObserved, showProjected, showComparison]);

  const arcs = useMemo<GlobeArc[]>(() => {
    const primary = showProjected ? projections.map((projection) => ({
      id: `arc:${projection.id}`,
      startLat: projection.sourceEvent.latitude,
      startLng: projection.sourceEvent.longitude,
      endLat: projection.latitude,
      endLng: projection.longitude,
      color: projectionColor(projection),
      altitude: 0.18 + clamp(projection.probabilityPct / 100, 0, 1) * 0.18,
    })) : [];
    const comparison = showComparison ? comparisonProjections.map((projection) => ({
      id: `comparison-arc:${projection.id}`,
      startLat: projection.sourceEvent.latitude,
      startLng: projection.sourceEvent.longitude,
      endLat: projection.latitude,
      endLng: projection.longitude,
      color: projectionColor(projection, true),
      altitude: 0.13 + clamp(projection.probabilityPct / 100, 0, 1) * 0.13,
    })) : [];
    return [...primary, ...comparison];
  }, [comparisonProjections, projections, showComparison, showProjected]);

  const rings = useMemo(() => {
    const primary = showProjected ? projections.map((projection) => ({
      ...projection,
      color: projectionColor(projection),
    })) : [];
    const comparison = showComparison ? comparisonProjections.map((projection) => ({
      ...projection,
      id: `comparison:${projection.id}`,
      color: projectionColor(projection, true),
    })) : [];
    return [...primary, ...comparison];
  }, [comparisonProjections, projections, showComparison, showProjected]);

  return (
    <div className="seismic-globe-canvas" ref={containerRef}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.18}
        showGraticules
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => pointLabel(point as SeismicGlobePoint)}
        pointsTransitionDuration={550}
        onPointClick={(point) => onSelect(point as SeismicGlobePoint)}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcAltitude="altitude"
        arcColor="color"
        arcStroke={0.32}
        arcDashLength={0.42}
        arcDashGap={0.18}
        arcDashAnimateTime={2_200}
        ringsData={rings}
        ringLat="latitude"
        ringLng="longitude"
        ringAltitude={0.012}
        ringColor={(ring: unknown) => [String((ring as { color: string }).color), "rgba(255,255,255,0)"]}
        ringMaxRadius={(ring: unknown) => 2.5 + clamp(Number((ring as GlobeProjection).radiusKm) / 600, 0, 7)}
        ringPropagationSpeed={1.6}
        ringRepeatPeriod={1_450}
        enablePointerInteraction
      />
    </div>
  );
}
