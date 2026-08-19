"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJSON, useMapEvents } from "react-leaflet";
import { tomographyColor, type MantleTomographyResponse } from "@/lib/mantleTomography";

type ViewBox = { west: number; south: number; east: number; north: number };

export interface MantleTomographyStatus {
  state: "idle" | "loading" | "ready" | "error";
  cellCount: number;
  depthKm: number;
  gridStepDeg: number;
  minDvsPct: number | null;
  maxDvsPct: number | null;
  fastPct: number | null;
  slowPct: number | null;
  warning: string | null;
}

export const EMPTY_MANTLE_STATUS: MantleTomographyStatus = {
  state: "idle",
  cellCount: 0,
  depthKm: 650,
  gridStepDeg: 0,
  minDvsPct: null,
  maxDvsPct: null,
  fastPct: null,
  slowPct: null,
  warning: null,
};

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function currentBox(map: ReturnType<typeof useMapEvents>): ViewBox {
  const bounds = map.getBounds();
  const width = bounds.getEast() - bounds.getWest();
  if (width >= 350) return { west: -180, south: -89, east: 180, north: 89 };
  return {
    west: normalizeLongitude(bounds.getWest()),
    south: Math.max(-89, bounds.getSouth()),
    east: normalizeLongitude(bounds.getEast()),
    north: Math.min(89, bounds.getNorth()),
  };
}

function bboxParam(box: ViewBox) {
  return [box.west, box.south, box.east, box.north].map((value) => value.toFixed(3)).join(",");
}

function featureCollection(data: MantleTomographyResponse) {
  const half = Math.max(0.45, data.gridStepDeg * 0.52);
  return {
    type: "FeatureCollection",
    features: data.cells.flatMap((cell, index) => {
      const west = Math.max(-180, cell.longitude - half);
      const east = Math.min(180, cell.longitude + half);
      const south = Math.max(-89.9, cell.latitude - half);
      const north = Math.min(89.9, cell.latitude + half);
      if (east <= west || north <= south) return [];
      return [{
        type: "Feature",
        id: `mantle-${index}`,
        properties: { dvsPct: cell.dvsPct, depthKm: data.depthKm },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, south], [east, south], [east, north], [west, north], [west, south],
          ]],
        },
      }];
    }),
  } as const;
}

export function MantleTomographyOverlay({
  enabled,
  depthKm,
  onStatus,
}: {
  enabled: boolean;
  depthKm: number;
  onStatus: (status: MantleTomographyStatus) => void;
}) {
  const [data, setData] = useState<MantleTomographyResponse | null>(null);
  const [viewportTick, setViewportTick] = useState(0);

  const map = useMapEvents({
    moveend() { setViewportTick((value) => value + 1); },
    zoomend() { setViewportTick((value) => value + 1); },
  });

  useEffect(() => {
    if (!enabled) {
      setData(null);
      onStatus({ ...EMPTY_MANTLE_STATUS, depthKm });
      return;
    }

    const controller = new AbortController();
    const box = currentBox(map);
    onStatus({ ...EMPTY_MANTLE_STATUS, state: "loading", depthKm });

    void (async () => {
      try {
        const params = new URLSearchParams({ depth: String(depthKm), bbox: bboxParam(box) });
        const response = await fetch(`/api/mantle-tomography?${params}`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        const payload = await response.json() as MantleTomographyResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setData(payload);
        onStatus({
          state: "ready",
          cellCount: payload.cells.length,
          depthKm: payload.depthKm,
          gridStepDeg: payload.gridStepDeg,
          minDvsPct: payload.minDvsPct,
          maxDvsPct: payload.maxDvsPct,
          fastPct: payload.fastPct,
          slowPct: payload.slowPct,
          warning: payload.warnings.join(" ") || null,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData(null);
        onStatus({
          ...EMPTY_MANTLE_STATUS,
          state: "error",
          depthKm,
          warning: error instanceof Error ? error.message : "No fue posible cargar la tomografía del manto.",
        });
      }
    })();

    return () => controller.abort();
  }, [depthKm, enabled, map, onStatus, viewportTick]);

  const geojson = useMemo(() => data ? featureCollection(data) : null, [data]);
  if (!enabled || !data || !geojson) return null;

  return (
    <GeoJSON
      key={`mantle-${data.depthKm}-${data.gridStepDeg}-${data.cells.length}`}
      data={geojson as never}
      style={(feature) => {
        const value = Number(feature?.properties?.dvsPct ?? 0);
        const color = tomographyColor(value, data.scaleAbsPct);
        return { color, fillColor: color, fillOpacity: 0.57, opacity: 0, weight: 0 };
      }}
      onEachFeature={(feature, layer) => {
        const value = Number(feature.properties?.dvsPct ?? 0);
        const interpretation = value >= 0.5
          ? "velocidad S alta · compatible con material relativamente frío/rigido"
          : value <= -0.5
            ? "velocidad S baja · compatible con material relativamente caliente/menos rígido"
            : "anomalía próxima al promedio del modelo";
        layer.bindTooltip(
          `SEISGLOB2 · ${data.depthKm} km · dVs ${value >= 0 ? "+" : ""}${value.toFixed(2)}% · ${interpretation}`,
          { sticky: true },
        );
      }}
    />
  );
}
