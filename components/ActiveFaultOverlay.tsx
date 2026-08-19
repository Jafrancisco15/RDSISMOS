"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, GeoJSON, Polyline, Popup, Tooltip, useMapEvents } from "react-leaflet";
import type { PlateMapEvent } from "@/lib/plateDynamics";
import type { SeismicMechanism } from "@/lib/seismicMechanisms";
import {
  bestFaultCompatibility,
  faultStyle,
  nearestFault,
  type ActiveFaultCollection,
  type ActiveFaultFeature,
  type FaultCompatibilityResult,
  type NearestFaultResult,
} from "@/lib/activeFaults";

export interface FaultOverlayStatus {
  state: "idle" | "zoom" | "loading" | "ready" | "error";
  faultCount: number;
  visibleStrongEvents: number;
  within25Km: number;
  within75Km: number;
  mechanismMatches: number;
  highCompatibility: number;
  warning: string | null;
}

const EMPTY_STATUS: FaultOverlayStatus = {
  state: "idle",
  faultCount: 0,
  visibleStrongEvents: 0,
  within25Km: 0,
  within75Km: 0,
  mechanismMatches: 0,
  highCompatibility: 0,
  warning: null,
};

type ViewBox = { west: number; south: number; east: number; north: number };

type MechanismAssociation = {
  mechanism: SeismicMechanism;
  nearest: NearestFaultResult | null;
  best: FaultCompatibilityResult | null;
};

function normalizeLongitude(value: number) {
  let lon = value;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

function insideBox(latitude: number, longitude: number, box: ViewBox) {
  if (latitude < box.south || latitude > box.north) return false;
  const lon = normalizeLongitude(longitude);
  if (box.west <= box.east) return lon >= box.west && lon <= box.east;
  return lon >= box.west || lon <= box.east;
}

function faultColor(feature?: { properties?: Record<string, unknown> }) {
  const style = faultStyle(String(feature?.properties?.slipType ?? ""));
  if (style === "reverse") return "#fb7185";
  if (style === "normal") return "#4ade80";
  if (style === "strike-slip") return "#fbbf24";
  return "#c084fc";
}

function compatibilityColor(level: FaultCompatibilityResult["level"]) {
  if (level === "high") return "#22c55e";
  if (level === "medium") return "#facc15";
  if (level === "low") return "#fb923c";
  return "#94a3b8";
}

function labelLevel(level: FaultCompatibilityResult["level"]) {
  if (level === "high") return "alta";
  if (level === "medium") return "media";
  if (level === "low") return "baja";
  return "débil";
}

function faultLabel(fault: ActiveFaultFeature) {
  const p = fault.properties;
  const parts = [p.name];
  if (p.slipType) parts.push(p.slipType);
  if (p.strikeSlipRate) parts.push(`strike-slip ${p.strikeSlipRate} mm/año`);
  if (p.dipSlipRate) parts.push(`dip-slip ${p.dipSlipRate} mm/año`);
  return parts.join(" · ");
}

function bboxParam(box: ViewBox) {
  return [box.west, box.south, box.east, box.north].map((value) => value.toFixed(4)).join(",");
}

export function ActiveFaultOverlay({
  enabled,
  events,
  mechanisms,
  onStatus,
}: {
  enabled: boolean;
  events: PlateMapEvent[];
  mechanisms: SeismicMechanism[];
  onStatus: (status: FaultOverlayStatus) => void;
}) {
  const [data, setData] = useState<ActiveFaultCollection | null>(null);
  const [box, setBox] = useState<ViewBox | null>(null);
  const [viewportTick, setViewportTick] = useState(0);
  const [zoom, setZoom] = useState(2);

  const map = useMapEvents({
    moveend() {
      setViewportTick((value) => value + 1);
    },
    zoomend() {
      setViewportTick((value) => value + 1);
    },
  });

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setBox(null);
      onStatus(EMPTY_STATUS);
      return;
    }

    const nextZoom = map.getZoom();
    setZoom(nextZoom);
    if (nextZoom < 3) {
      setData(null);
      setBox(null);
      onStatus({ ...EMPTY_STATUS, state: "zoom", warning: "Acerca el mapa a zoom 3+ para cargar fallas activas con detalle." });
      return;
    }

    const bounds = map.getBounds();
    const width = bounds.getEast() - bounds.getWest();
    if (width >= 330) {
      onStatus({ ...EMPTY_STATUS, state: "zoom", warning: "Acerca el mapa para limitar la consulta de fallas." });
      return;
    }
    const nextBox: ViewBox = {
      west: normalizeLongitude(bounds.getWest()),
      south: Math.max(-90, bounds.getSouth()),
      east: normalizeLongitude(bounds.getEast()),
      north: Math.min(90, bounds.getNorth()),
    };
    setBox(nextBox);

    const controller = new AbortController();
    onStatus({ ...EMPTY_STATUS, state: "loading" });
    void (async () => {
      try {
        const params = new URLSearchParams({ bbox: bboxParam(nextBox), limit: "3500" });
        const response = await fetch(`/api/faults?${params}`, { cache: "force-cache", signal: controller.signal });
        const payload = await response.json() as ActiveFaultCollection;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setData(payload);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData(null);
        onStatus({
          ...EMPTY_STATUS,
          state: "error",
          warning: error instanceof Error ? error.message : "No fue posible cargar las fallas activas.",
        });
      }
    })();

    return () => controller.abort();
  }, [enabled, map, onStatus, viewportTick]);

  const faults = data?.features ?? [];

  const associations = useMemo<MechanismAssociation[]>(() => {
    if (!enabled || !box || faults.length === 0) return [];
    return mechanisms
      .filter((mechanism) => insideBox(mechanism.latitude, mechanism.longitude, box))
      .map((mechanism) => ({
        mechanism,
        nearest: nearestFault(mechanism.latitude, mechanism.longitude, faults),
        best: bestFaultCompatibility(mechanism, faults),
      }));
  }, [box, enabled, faults, mechanisms]);

  const proximity = useMemo(() => {
    if (!enabled || !box || faults.length === 0) return [] as Array<{ event: PlateMapEvent; nearest: NearestFaultResult }>;
    return events
      .filter((event) => event.magnitude >= 6 && insideBox(event.latitude, event.longitude, box))
      .map((event) => ({ event, nearest: nearestFault(event.latitude, event.longitude, faults) }))
      .filter((item): item is { event: PlateMapEvent; nearest: NearestFaultResult } => item.nearest !== null);
  }, [box, enabled, events, faults]);

  useEffect(() => {
    if (!enabled || zoom < 3 || !data) return;
    onStatus({
      state: "ready",
      faultCount: faults.length,
      visibleStrongEvents: proximity.length,
      within25Km: proximity.filter((item) => item.nearest.distanceKm <= 25).length,
      within75Km: proximity.filter((item) => item.nearest.distanceKm <= 75).length,
      mechanismMatches: associations.filter((item) => item.best !== null).length,
      highCompatibility: associations.filter((item) => item.best?.level === "high").length,
      warning: data.warning ?? null,
    });
  }, [associations, data, enabled, faults.length, onStatus, proximity, zoom]);

  if (!enabled || !data || zoom < 3) return null;

  return (
    <>
      <GeoJSON
        key={`gem-faults-${bboxParam(box ?? { west: 0, south: 0, east: 0, north: 0 })}-${faults.length}`}
        data={data as never}
        style={(feature) => ({
          color: faultColor(feature as { properties?: Record<string, unknown> }),
          weight: 1.7,
          opacity: 0.85,
        })}
        onEachFeature={(feature, layer) => {
          const fault = feature as unknown as ActiveFaultFeature;
          layer.bindTooltip(faultLabel(fault), { sticky: true });
        }}
      />

      {associations.map(({ mechanism, nearest, best }) => {
        if (!best) return null;
        const color = compatibilityColor(best.level);
        return (
          <Polyline
            key={`fault-match-${mechanism.id}-${best.fault.properties.id}`}
            positions={[[mechanism.latitude, mechanism.longitude], [best.closestLatitude, best.closestLongitude]]}
            pathOptions={{ color, weight: best.level === "high" ? 3 : 2, opacity: 0.88, dashArray: "5 6" }}
          >
            <Tooltip direction="top">
              {best.fault.properties.name} · {best.distanceKm.toFixed(1)} km · compatibilidad {labelLevel(best.level)} ({best.score.toFixed(0)}/100)
            </Tooltip>
          </Polyline>
        );
      })}

      {associations.map(({ mechanism, nearest, best }) => {
        if (!best) return null;
        const color = compatibilityColor(best.level);
        return (
          <CircleMarker
            key={`fault-match-point-${mechanism.id}-${best.fault.properties.id}`}
            center={[best.closestLatitude, best.closestLongitude]}
            radius={4.5}
            pathOptions={{ color: "#ffffff", fillColor: color, fillOpacity: 0.95, weight: 1.2 }}
          >
            <Popup>
              <strong>{best.fault.properties.name}</strong>
              <div>Candidata geométrica para M{mechanism.magnitude.toFixed(1)} · {mechanism.place}</div>
              <div>Distancia epicentro–traza: {best.distanceKm.toFixed(1)} km</div>
              <div>Strike local de falla: {best.faultStrikeDeg.toFixed(0)}°</div>
              <div>Diferencia con NP{best.bestNodalPlane ?? "?"}: {best.strikeDifferenceDeg?.toFixed(0) ?? "—"}°</div>
              <div>Estilo mecanismo: {best.mechanismStyle} · falla: {best.faultStyle}</div>
              <div>Compatibilidad exploratoria: {labelLevel(best.level)} · {best.score.toFixed(0)}/100</div>
              {nearest && nearest.fault.properties.id !== best.fault.properties.id && (
                <div>Falla estrictamente más cercana: {nearest.fault.properties.name} · {nearest.distanceKm.toFixed(1)} km</div>
              )}
              {best.caveat && <small>{best.caveat}</small>}
              <small>No es una atribución automática de la ruptura; combina proximidad, geometría nodal y cinemática disponible.</small>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
