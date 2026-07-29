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
  if (magnitude >= 7.5) return "#ff3b30";
  if (magnitude >= 6.5) return "#ff7a45";
  return "#fbbf24";
}

function projectionColor(probabilityPct: number) {
  if (probabilityPct >= 65) return "#d946ef";
  if (probabilityPct >= 35) return "#8b5cf6";
  return "#22d3ee";
}

function pointLabel(point: SeismicGlobePoint) {
  if (point.kind === "observed") {
    const event = point.event;
    return `<div class="globe-tooltip"><strong>Sismo observado · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${formatDate(event.timeUtc)} UTC · ${event.depthKm.toFixed(0)} km de profundidad</small></div>`;
  }
  const projection = point.projection;
  return `<div class="globe-tooltip"><strong>Proyección · ${escapeHtml(projection.countryName)}</strong><span>${projection.probabilityPct}% · M${projection.magnitudeMin.toFixed(1)}–M${projection.magnitudeMax.toFixed(1)}</span><small>${formatDate(projection.surveillanceStart)}–${formatDate(projection.surveillanceEnd)} · diferencia ${projection.liftPct > 0 ? "+" : ""}${projection.liftPct}%</small></div>`;
}

export function SeismicGlobeRenderer({
  observedEvents,
  projections,
  showObserved,
  showProjected,
  autoRotate,
  onSelect,
}: {
  observedEvents: EarthquakeEvent[];
  projections: GlobeProjection[];
  showObserved: boolean;
  showProjected: boolean;
  autoRotate: boolean;
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

  const points = useMemo<SeismicGlobePoint[]>(() => {
    const observed: SeismicGlobePoint[] = showObserved
      ? observedEvents.map((event) => ({
          kind: "observed",
          id: `observed:${event.id}`,
          lat: event.latitude,
          lng: event.longitude,
          altitude: 0.025 + clamp((event.magnitude - 5.5) / 3.5, 0, 1) * 0.1,
          radius: 0.18 + clamp((event.magnitude - 5.5) / 3.5, 0, 1) * 0.32,
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
          altitude: 0.16 + clamp(projection.probabilityPct / 100, 0, 1) * 0.24,
          radius: 0.28 + clamp(projection.magnitudeMax / 9, 0, 1) * 0.28,
          color: projectionColor(projection.probabilityPct),
          projection,
        }))
      : [];
    return [...observed, ...projected];
  }, [observedEvents, projections, showObserved, showProjected]);

  const arcs = useMemo<GlobeArc[]>(() => showProjected
    ? projections.map((projection) => ({
        id: `arc:${projection.id}`,
        startLat: projection.sourceEvent.latitude,
        startLng: projection.sourceEvent.longitude,
        endLat: projection.latitude,
        endLng: projection.longitude,
        color: projectionColor(projection.probabilityPct),
        altitude: 0.18 + clamp(projection.probabilityPct / 100, 0, 1) * 0.18,
      }))
    : [], [projections, showProjected]);

  const rings = useMemo(
    () => showProjected ? projections.map((projection) => ({
      ...projection,
      color: projectionColor(projection.probabilityPct),
    })) : [],
    [projections, showProjected],
  );

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
