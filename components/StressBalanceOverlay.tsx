"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, GeoJSON, Tooltip, useMapEvents } from "react-leaflet";
import type { ActiveFaultCollection, ActiveFaultFeature } from "@/lib/activeFaults";
import {
  evaluateFaultStressBalance,
  stressBalanceColor,
  summarizeStressBalances,
  type FaultStressBalance,
} from "@/lib/coulombBalance";
import type { SeismicMechanismResponse } from "@/lib/seismicMechanisms";

export interface StressBalanceStatus {
  state: "idle" | "zoom" | "loading" | "ready" | "error";
  sourceCount: number;
  faultCount: number;
  evaluatedFaults: number;
  loadedFaults: number;
  relaxedFaults: number;
  nearNeutralFaults: number;
  highCancellationFaults: number;
  medianCancellationPct: number;
  maxAbsNetMpa: number;
  warning: string | null;
}

export const EMPTY_STRESS_STATUS: StressBalanceStatus = {
  state: "idle",
  sourceCount: 0,
  faultCount: 0,
  evaluatedFaults: 0,
  loadedFaults: 0,
  relaxedFaults: 0,
  nearNeutralFaults: 0,
  highCancellationFaults: 0,
  medianCancellationPct: 0,
  maxAbsNetMpa: 0,
  warning: null,
};

type ViewBox = { west: number; south: number; east: number; north: number };

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function bboxParam(box: ViewBox) {
  return [box.west, box.south, box.east, box.north].map((value) => value.toFixed(4)).join(",");
}

function longitudeSpan(box: ViewBox) {
  if (box.west <= box.east) return box.east - box.west;
  return 360 - box.west + box.east;
}

function expandBox(box: ViewBox, marginDeg = 7) {
  const span = longitudeSpan(box);
  if (span + marginDeg * 2 >= 350) {
    return { west: -180, east: 180, south: Math.max(-89, box.south - marginDeg), north: Math.min(89, box.north + marginDeg) };
  }
  return {
    west: normalizeLongitude(box.west - marginDeg),
    east: normalizeLongitude(box.east + marginDeg),
    south: Math.max(-89, box.south - marginDeg),
    north: Math.min(89, box.north + marginDeg),
  };
}

function signed(value: number, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char] ?? char));
}

function balancePopup(balance: FaultStressBalance) {
  const sources = balance.contributions.map((item) =>
    `<li>M${item.sourceMagnitude.toFixed(1)} ${escapeHtml(item.sourcePlace)}: ${signed(item.deltaCfsMpa)} MPa · ${item.distanceKm.toFixed(0)} km</li>`).join("");
  const confidence = balance.confidence === "high" ? "alta" : balance.confidence === "medium" ? "media" : "baja";
  return `
    <strong>${escapeHtml(balance.faultName)}</strong>
    <div>ΔCFS neta aprox.: <b>${signed(balance.netMpa)} MPa</b></div>
    <div>Carga positiva acumulada: +${balance.positiveMpa.toFixed(3)} MPa</div>
    <div>Relajación acumulada: ${balance.negativeMpa.toFixed(3)} MPa</div>
    <div>Cancelación: ${balance.cancellationPct.toFixed(0)}%</div>
    <div>Fuentes usadas: ${balance.sourceCount} · confianza geométrica ${confidence}</div>
    <div>Receptor: strike ${balance.strikeDeg.toFixed(0)}° · dip ${balance.dipDeg.toFixed(0)}° · rake ${balance.rakeDeg.toFixed(0)}°</div>
    ${balance.note ? `<small>${escapeHtml(balance.note)}</small>` : ""}
    ${sources ? `<ul style="margin:6px 0 4px;padding-left:18px">${sources}</ul>` : ""}
    <small>Modelo exploratorio de transferencia estática: fuente puntual double-couple, medio elástico homogéneo, μ′=0.4 y receptor a 10 km. No equivale a un modelo finite-fault/Okada ni predice ruptura.</small>
  `;
}

export function StressBalanceOverlay({
  enabled,
  onStatus,
}: {
  enabled: boolean;
  onStatus: (status: StressBalanceStatus) => void;
}) {
  const [faultData, setFaultData] = useState<ActiveFaultCollection | null>(null);
  const [mechanismData, setMechanismData] = useState<SeismicMechanismResponse | null>(null);
  const [box, setBox] = useState<ViewBox | null>(null);
  const [zoom, setZoom] = useState(2);
  const [viewportTick, setViewportTick] = useState(0);

  const map = useMapEvents({
    moveend() { setViewportTick((value) => value + 1); },
    zoomend() { setViewportTick((value) => value + 1); },
  });

  useEffect(() => {
    if (!enabled) {
      setFaultData(null);
      setMechanismData(null);
      setBox(null);
      onStatus(EMPTY_STRESS_STATUS);
      return;
    }

    const nextZoom = map.getZoom();
    setZoom(nextZoom);
    if (nextZoom < 3) {
      setFaultData(null);
      setMechanismData(null);
      onStatus({ ...EMPTY_STRESS_STATUS, state: "zoom", warning: "Acerca el mapa a zoom 3+ para calcular balance de esfuerzos sobre fallas." });
      return;
    }

    const bounds = map.getBounds();
    const nextBox: ViewBox = {
      west: normalizeLongitude(bounds.getWest()),
      south: Math.max(-89, bounds.getSouth()),
      east: normalizeLongitude(bounds.getEast()),
      north: Math.min(89, bounds.getNorth()),
    };
    if (longitudeSpan(nextBox) > 175) {
      onStatus({ ...EMPTY_STRESS_STATUS, state: "zoom", warning: "Acerca un poco más el mapa: la transferencia estática es una interacción regional, no una capa global uniforme." });
      return;
    }
    setBox(nextBox);

    const controller = new AbortController();
    onStatus({ ...EMPTY_STRESS_STATUS, state: "loading" });
    void (async () => {
      try {
        const sourceBox = expandBox(nextBox, 7);
        const faultParams = new URLSearchParams({ bbox: bboxParam(nextBox), limit: "900" });
        const mechanismParams = new URLSearchParams({
          bbox: bboxParam(sourceBox),
          days: "730",
          minMagnitude: "6",
          limit: "36",
          orderBy: "magnitude",
        });
        const [faultResponse, mechanismResponse] = await Promise.all([
          fetch(`/api/faults?${faultParams}`, { cache: "force-cache", signal: controller.signal }),
          fetch(`/api/seismic-mechanisms?${mechanismParams}`, { cache: "force-cache", signal: controller.signal }),
        ]);
        const faults = await faultResponse.json() as ActiveFaultCollection;
        const mechanisms = await mechanismResponse.json() as SeismicMechanismResponse & { error?: string };
        if (!faultResponse.ok) throw new Error(`Fallas GEM: HTTP ${faultResponse.status}`);
        if (!mechanismResponse.ok) throw new Error(mechanisms.error ?? `USGS: HTTP ${mechanismResponse.status}`);
        setFaultData(faults);
        setMechanismData(mechanisms);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFaultData(null);
        setMechanismData(null);
        onStatus({ ...EMPTY_STRESS_STATUS, state: "error", warning: error instanceof Error ? error.message : "No fue posible calcular el balance de esfuerzos." });
      }
    })();
    return () => controller.abort();
  }, [enabled, map, onStatus, viewportTick]);

  const balances = useMemo(() => {
    if (!enabled || !faultData || !mechanismData) return [] as FaultStressBalance[];
    return faultData.features
      .map((fault) => evaluateFaultStressBalance(fault, mechanismData.mechanisms))
      .filter((item): item is FaultStressBalance => item !== null);
  }, [enabled, faultData, mechanismData]);

  const balanceById = useMemo(() => new Map(balances.map((item) => [item.faultId, item])), [balances]);
  const displayed = useMemo(() => {
    if (!faultData) return null;
    const features = faultData.features.filter((fault) => balanceById.has(fault.properties.id));
    return { ...faultData, features };
  }, [balanceById, faultData]);

  useEffect(() => {
    if (!enabled || zoom < 3 || !faultData || !mechanismData) return;
    const summary = summarizeStressBalances(balances);
    const warnings = [faultData.warning, ...mechanismData.warnings].filter(Boolean).join(" ");
    onStatus({
      state: "ready",
      sourceCount: mechanismData.mechanisms.length,
      faultCount: faultData.features.length,
      ...summary,
      warning: warnings || (mechanismData.mechanisms.length === 0 ? "No hay fuentes M6+ con tensor de momento en la ventana ampliada durante los últimos 730 días." : null),
    });
  }, [balances, enabled, faultData, mechanismData, onStatus, zoom]);

  if (!enabled || !displayed || zoom < 3) return null;

  return (
    <>
      <GeoJSON
        key={`stress-${box ? bboxParam(box) : "none"}-${balances.length}`}
        data={displayed as never}
        style={(feature) => {
          const id = String(feature?.properties?.id ?? "");
          const balance = balanceById.get(id);
          if (!balance) return { opacity: 0, weight: 0 };
          return {
            color: stressBalanceColor(balance),
            weight: Math.abs(balance.netMpa) >= 0.02 ? 3.2 : 2.2,
            opacity: balance.confidence === "low" ? 0.5 : 0.92,
            dashArray: balance.confidence === "low" ? "5 5" : undefined,
          };
        }}
        onEachFeature={(feature, layer) => {
          const fault = feature as unknown as ActiveFaultFeature;
          const balance = balanceById.get(fault.properties.id);
          if (!balance) return;
          layer.bindTooltip(`${balance.faultName} · ΔCFS ${signed(balance.netMpa)} MPa · cancelación ${balance.cancellationPct.toFixed(0)}%`, { sticky: true });
          layer.bindPopup(balancePopup(balance), { maxWidth: 380 });
        }}
      />

      {mechanismData?.mechanisms.map((mechanism) => (
        <CircleMarker
          key={`stress-source-${mechanism.id}`}
          center={[mechanism.latitude, mechanism.longitude]}
          radius={Math.max(4, Math.min(8, 3 + (mechanism.magnitude - 6) * 2))}
          pathOptions={{ color: "#ffffff", fillColor: "#f97316", fillOpacity: 0.85, weight: 1 }}
        >
          <Tooltip direction="top">Fuente de esfuerzo · M{mechanism.magnitude.toFixed(1)} · {mechanism.place}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
