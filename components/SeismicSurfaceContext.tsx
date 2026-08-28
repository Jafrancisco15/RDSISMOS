"use client";

import { useMemo } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapLayersResponse, GlobeMapPath, GlobeMapPoint, GlobeTectonicPlate } from "@/lib/globeLayers";

const EARTH_RADIUS_KM = 6371;
const WIDTH = 1000;
const HEIGHT = 330;
const HALF_WIDTH = WIDTH / 2;
const SPAN_LON = 74;
const SPAN_LAT = 54;

type Center = { lat: number; lng: number; title: string; subtitle: string };

type LabelPoint = { name: string; x: number; y: number };

function radians(value: number) { return value * Math.PI / 180; }
function degrees(value: number) { return value * 180 / Math.PI; }
function wrapLongitude(value: number) { return ((value + 540) % 360) - 180; }
function relativeLongitude(value: number, center: number) { return wrapLongitude(value - center); }

export function antipode(latitude: number, longitude: number) {
  return { lat: -latitude, lng: wrapLongitude(longitude + 180) };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(relativeLongitude(b.lng, a.lng));
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function project(point: GlobeMapPoint, center: Center, xOffset: number) {
  const dx = relativeLongitude(point.lng, center.lng);
  const dy = point.lat - center.lat;
  const x = xOffset + HALF_WIDTH / 2 + dx / SPAN_LON * (HALF_WIDTH * 0.92);
  const y = HEIGHT / 2 - dy / SPAN_LAT * (HEIGHT * 0.86);
  return { x, y, visible: Math.abs(dx) <= SPAN_LON / 2 && Math.abs(dy) <= SPAN_LAT / 2 };
}

function visibleSegments(path: GlobeMapPath, center: Center, xOffset: number) {
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of path.points) {
    const projected = project(point, center, xOffset);
    if (!projected.visible) {
      if (current.length >= 2) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${projected.x.toFixed(1)},${projected.y.toFixed(1)}`);
  }
  if (current.length >= 2) segments.push(current.join(" "));
  return segments;
}

function centroid(path: GlobeMapPath) {
  if (!path.points.length) return null;
  let x = 0; let y = 0; let z = 0;
  for (const point of path.points) {
    const lat = radians(point.lat);
    const lng = radians(point.lng);
    x += Math.cos(lat) * Math.cos(lng);
    y += Math.cos(lat) * Math.sin(lng);
    z += Math.sin(lat);
  }
  const lng = degrees(Math.atan2(y, x));
  const lat = degrees(Math.atan2(z, Math.hypot(x, y)));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function nearestPath(paths: GlobeMapPath[], center: Center) {
  let best: { path: GlobeMapPath; distanceKm: number } | null = null;
  for (const path of paths) {
    const step = Math.max(1, Math.ceil(path.points.length / 30));
    for (let index = 0; index < path.points.length; index += step) {
      const point = path.points[index];
      const distanceKm = haversineKm(center, point);
      if (!best || distanceKm < best.distanceKm) best = { path, distanceKm };
    }
  }
  return best;
}

function pointInRing(longitude: number, latitude: number, ring: unknown) {
  if (!Array.isArray(ring)) return false;
  const points = ring.filter((value): value is number[] => Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])));
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = Number(points[i][0]); const yi = Number(points[i][1]);
    const xj = Number(points[j][0]); const yj = Number(points[j][1]);
    const intersects = ((yi > latitude) !== (yj > latitude))
      && longitude < (xj - xi) * (latitude - yi) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function plateContains(plate: GlobeTectonicPlate, center: Center) {
  const geometry = plate.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as unknown[];
    return rings.length > 0 && pointInRing(center.lng, center.lat, rings[0]);
  }
  for (const polygon of geometry.coordinates as unknown[]) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    if (pointInRing(center.lng, center.lat, polygon[0])) return true;
  }
  return false;
}

function relevantPlate(plates: GlobeTectonicPlate[], center: Center) {
  const containing = plates.find((plate) => plateContains(plate, center));
  if (containing) return containing;
  return [...plates].sort((a, b) => haversineKm(center, { lat: a.latitude, lng: a.longitude }) - haversineKm(center, { lat: b.latitude, lng: b.longitude }))[0] ?? null;
}

function countryLabels(paths: GlobeMapPath[], center: Center, xOffset: number) {
  const byName = new Map<string, { lat: number; lng: number; distance: number }>();
  for (const path of paths) {
    const c = centroid(path);
    if (!c) continue;
    const projected = project(c, center, xOffset);
    if (!projected.visible) continue;
    const distance = haversineKm(center, c);
    const existing = byName.get(path.name);
    if (!existing || distance < existing.distance) byName.set(path.name, { ...c, distance });
  }
  return [...byName.entries()]
    .sort((a, b) => a[1].distance - b[1].distance)
    .slice(0, 6)
    .map(([name, point]): LabelPoint => {
      const p = project(point, center, xOffset);
      return { name, x: p.x, y: p.y };
    });
}

function LayerPaths({ paths, center, xOffset, stroke, strokeWidth, opacity }: { paths: GlobeMapPath[]; center: Center; xOffset: number; stroke: string; strokeWidth: number; opacity: number }) {
  const visible = useMemo(() => {
    const selected: string[] = [];
    for (const path of paths) {
      const c = centroid(path);
      if (c && haversineKm(center, c) > 7000) continue;
      selected.push(...visibleSegments(path, center, xOffset));
      if (selected.length > 520) break;
    }
    return selected;
  }, [center, paths, xOffset]);
  return <>{visible.map((points, index) => <polyline key={`${stroke}-${index}`} points={points} fill="none" stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} vectorEffect="non-scaling-stroke" />)}</>;
}

function Window({ center, xOffset, layers, eventColor }: { center: Center; xOffset: number; layers: GlobeMapLayersResponse; eventColor: string }) {
  const eventPoint = project(center, center, xOffset);
  const labels = useMemo(() => countryLabels(layers.countryBorders, center, xOffset), [center, layers.countryBorders, xOffset]);
  const plate = useMemo(() => relevantPlate(layers.tectonicPlates ?? [], center), [center, layers.tectonicPlates]);
  const boundary = useMemo(() => nearestPath(layers.plateBoundaries, center), [center, layers.plateBoundaries]);
  const fault = useMemo(() => nearestPath(layers.activeFaults, center), [center, layers.activeFaults]);

  return <g>
    <rect x={xOffset + 8} y={10} width={HALF_WIDTH - 16} height={HEIGHT - 20} rx={14} fill="#07111d" stroke="#1e3a52" />
    <text x={xOffset + 26} y={36} fill="#e2e8f0" fontSize="15" fontWeight="800">{center.title}</text>
    <text x={xOffset + 26} y={55} fill="#94a3b8" fontSize="10">{center.subtitle}</text>
    <LayerPaths paths={layers.countryBorders} center={center} xOffset={xOffset} stroke="#64748b" strokeWidth={0.7} opacity={0.72} />
    <LayerPaths paths={layers.plateBoundaries} center={center} xOffset={xOffset} stroke="#38bdf8" strokeWidth={1.15} opacity={0.92} />
    <LayerPaths paths={layers.activeFaults} center={center} xOffset={xOffset} stroke="#fb7185" strokeWidth={0.85} opacity={0.82} />
    {labels.map((label) => <text key={label.name} x={label.x} y={label.y} fill="#cbd5e1" fontSize="8.5" textAnchor="middle" opacity={0.86}>{label.name}</text>)}
    <circle cx={eventPoint.x} cy={eventPoint.y} r={8} fill={eventColor} stroke="white" strokeWidth={2} />
    <circle cx={eventPoint.x} cy={eventPoint.y} r={15} fill="none" stroke={eventColor} strokeWidth={1.5} opacity={0.45} />
    <text x={eventPoint.x + 12} y={eventPoint.y - 10} fill="white" fontSize="10" fontWeight="800">{center.title === "Epicentro" ? "SISMO" : "ANTÍPODA"}</text>
    <g transform={`translate(${xOffset + 24} ${HEIGHT - 66})`}>
      <text y="0" fill="#a5b4fc" fontSize="9" fontWeight="800">PLACA</text><text x="48" y="0" fill="#e2e8f0" fontSize="9">{plate?.name ?? "N/D"}</text>
      <text y="16" fill="#38bdf8" fontSize="9" fontWeight="800">LÍMITE</text><text x="48" y="16" fill="#cbd5e1" fontSize="9">{boundary ? `${boundary.path.name} · ${Math.round(boundary.distanceKm)} km` : "N/D"}</text>
      <text y="32" fill="#fb7185" fontSize="9" fontWeight="800">FALLA</text><text x="48" y="32" fill="#cbd5e1" fontSize="9">{fault && fault.distanceKm < 2500 ? `${fault.path.name} · ${Math.round(fault.distanceKm)} km` : "sin falla catalogada cercana"}</text>
    </g>
  </g>;
}

export function SeismicSurfaceContext({ event, layers }: { event: EarthquakeEvent; layers: GlobeMapLayersResponse }) {
  const opposite = antipode(event.latitude, event.longitude);
  const epicenter: Center = {
    lat: event.latitude,
    lng: event.longitude,
    title: "Epicentro",
    subtitle: `${event.latitude.toFixed(2)}°, ${event.longitude.toFixed(2)}° · ${event.place}`,
  };
  const anti: Center = {
    ...opposite,
    title: "Antípoda",
    subtitle: `${opposite.lat.toFixed(2)}°, ${opposite.lng.toFixed(2)}° · 180° del epicentro`,
  };
  const eventColor = event.magnitude >= 7 ? "#fb7185" : event.magnitude >= 5.5 ? "#fb923c" : "#fbbf24";

  return <div style={{ overflowX: "auto", borderRadius: 14, background: "#030914" }}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: "100%", minWidth: 760, display: "block" }} role="img" aria-label={`Contexto tectónico del sismo M${event.magnitude.toFixed(1)} y su antípoda`}>
      <Window center={epicenter} xOffset={0} layers={layers} eventColor={eventColor} />
      <Window center={anti} xOffset={HALF_WIDTH} layers={layers} eventColor="#c084fc" />
      <g transform="translate(382 19)"><rect width="236" height="24" rx="12" fill="rgba(2,8,18,.9)" stroke="#334155"/><circle cx="15" cy="12" r="4" fill="#38bdf8"/><text x="24" y="15" fill="#cbd5e1" fontSize="8.5">placas</text><circle cx="75" cy="12" r="4" fill="#fb7185"/><text x="84" y="15" fill="#cbd5e1" fontSize="8.5">fallas</text><line x1="132" y1="12" x2="146" y2="12" stroke="#64748b"/><text x="152" y="15" fill="#cbd5e1" fontSize="8.5">países</text></g>
    </svg>
  </div>;
}
