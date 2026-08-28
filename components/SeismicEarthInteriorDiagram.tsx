"use client";

import { useEffect, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { SeismicWavefrontTable, TravelTimeModel } from "@/lib/seismicWavefronts";

const EARTH_RADIUS_KM = 6371;
const CMB_DEPTH_KM = 2891;
const ICB_DEPTH_KM = 5150;
const CX = 300;
const CY = 250;
const R = 205;

function radiusAtDepth(depthKm: number) { return Math.max(0, R * (EARTH_RADIUS_KM - depthKm) / EARTH_RADIUS_KM); }
function polar(distanceDeg: number, radius: number, side: 1 | -1) {
  const angle = (-90 + side * distanceDeg) * Math.PI / 180;
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}
function sectorPath(startDeg: number, endDeg: number, side: 1 | -1) {
  const start = polar(startDeg, R, side);
  const end = polar(endDeg, R, side);
  return `M ${CX} ${CY} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${R} ${R} 0 0 ${side === 1 ? 1 : 0} ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}
function radialLine(distanceDeg: number, side: 1 | -1) {
  return { inner: polar(distanceDeg, R * .81, side), outer: polar(distanceDeg, R + 5, side) };
}
function fmt(value: number | undefined) { return value === undefined ? "—" : `${value.toFixed(1)}°`; }

export function SeismicEarthInteriorDiagram({ event, model }: { event: EarthquakeEvent; model: TravelTimeModel }) {
  const [table, setTable] = useState<SeismicWavefrontTable | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTable(null); setError(null);
    const params = new URLSearchParams({ depth: event.depthKm.toFixed(1), model });
    fetch(`/api/geomagnetism/wavefronts?${params}`, { cache: "force-cache", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as SeismicWavefrontTable & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        return payload;
      })
      .then(setTable)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible calcular las zonas de sombra locales.");
      });
    return () => controller.abort();
  }, [event.depthKm, model]);

  const pShadow = table?.shadowZones?.directP ?? null;
  const sShadow = table?.shadowZones?.directS ?? null;
  const outerCoreR = radiusAtDepth(CMB_DEPTH_KM);
  const innerCoreR = radiusAtDepth(ICB_DEPTH_KM);
  const focus = polar(0, radiusAtDepth(Math.max(0, event.depthKm)), 1);
  const boundaries = Array.from(new Set([pShadow?.startDeg, pShadow?.endDeg, sShadow?.startDeg].filter((v): v is number => typeof v === "number" && Number.isFinite(v))));

  return <div style={{ border: "1px solid rgba(148,163,184,.18)", borderRadius: 14, background: "linear-gradient(180deg,#06111d,#020812)", overflow: "hidden" }}>
    <div style={{ padding: "10px 11px 0" }}>
      <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900, letterSpacing: ".08em" }}>CAPAS INTERNAS + ZONAS DE SOMBRA</div>
      <div style={{ color: "#94a3b8", fontSize: 9, lineHeight: 1.45, marginTop: 3 }}>Límites calculados por el trazador local RDSISMOS para {model.toUpperCase()} y un foco de {event.depthKm.toFixed(1)} km.</div>
    </div>
    <svg viewBox="0 0 600 505" role="img" aria-label="Corte terrestre con zonas de sombra P y S" style={{ width: "100%", display: "block" }}>
      <circle cx={CX} cy={CY} r={R} fill="#d97706" stroke="#f8fafc" strokeWidth="2" />
      <circle cx={CX} cy={CY} r={outerCoreR} fill="#ef5b2a" stroke="#fed7aa" strokeWidth="1.3" />
      <circle cx={CX} cy={CY} r={innerCoreR} fill="#facc15" stroke="#fef3c7" strokeWidth="1.2" />
      {sShadow && <><path d={sectorPath(sShadow.startDeg, 180, 1)} fill="#0f172a" opacity=".36"/><path d={sectorPath(sShadow.startDeg, 180, -1)} fill="#0f172a" opacity=".36"/></>}
      {pShadow && <><path d={sectorPath(pShadow.startDeg, pShadow.endDeg, 1)} fill="#7c3aed" opacity=".32"/><path d={sectorPath(pShadow.startDeg, pShadow.endDeg, -1)} fill="#7c3aed" opacity=".32"/></>}
      <circle cx={CX} cy={CY} r={outerCoreR} fill="none" stroke="#fed7aa" strokeWidth="1.2" />
      <circle cx={CX} cy={CY} r={innerCoreR} fill="none" stroke="#fff7cc" strokeWidth="1.2" />
      <circle cx={CX} cy={CY - R} r="5.5" fill="#fb7185" stroke="white" strokeWidth="1.4" />
      <circle cx={focus.x} cy={focus.y} r="5" fill="#fb7185" stroke="white" strokeWidth="1.2" />
      {boundaries.flatMap((distance) => ([1,-1] as const).map((side) => {
        const line = radialLine(distance, side);
        return <line key={`${distance}:${side}`} x1={line.inner.x} y1={line.inner.y} x2={line.outer.x} y2={line.outer.y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" opacity=".75"/>;
      }))}
      <text x={CX} y={CY - R - 13} textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="800">EPICENTRO · 0°</text>
      <text x={CX + 10} y={Math.max(42, focus.y - 8)} fill="#fecdd3" fontSize="10" fontWeight="700">FOCO · {event.depthKm.toFixed(1)} km</text>
      <text x={CX} y={CY - 132} textAnchor="middle" fill="#fff7ed" fontSize="14" fontWeight="900">MANTO</text>
      <text x={CX - 70} y={CY + 28} textAnchor="middle" fill="#fff7ed" fontSize="11" fontWeight="900">NÚCLEO EXTERNO</text>
      <text x={CX} y={CY + 5} textAnchor="middle" fill="#713f12" fontSize="8.5" fontWeight="900">NÚCLEO</text>
      <text x={CX} y={CY + 16} textAnchor="middle" fill="#713f12" fontSize="8.5" fontWeight="900">INTERNO</text>
      {pShadow && <text x={CX} y={CY + R - 58} textAnchor="middle" fill="#ddd6fe" fontSize="10" fontWeight="800">SOMBRA P DIRECTA · {pShadow.startDeg.toFixed(1)}°–{pShadow.endDeg.toFixed(1)}°</text>}
      {sShadow && <text x={CX} y={CY + R - 40} textAnchor="middle" fill="#cbd5e1" fontSize="10" fontWeight="800">SOMBRA S DIRECTA · {sShadow.startDeg.toFixed(1)}°–180°</text>}
      <text x={CX} y={CY + R + 18} textAnchor="middle" fill="#94a3b8" fontSize="9">180° · antípoda</text>
      <g transform="translate(25 447)">
        <rect width="13" height="9" rx="2" fill="#7c3aed" opacity=".7"/><text x="19" y="8" fill="#cbd5e1" fontSize="9">sombra P</text>
        <rect x="105" width="13" height="9" rx="2" fill="#0f172a" stroke="#64748b"/><text x="124" y="8" fill="#cbd5e1" fontSize="9">sombra S</text>
        <rect x="210" width="13" height="9" rx="2" fill="#d97706"/><text x="229" y="8" fill="#cbd5e1" fontSize="9">manto</text>
        <rect x="292" width="13" height="9" rx="2" fill="#ef5b2a"/><text x="311" y="8" fill="#cbd5e1" fontSize="9">núcleo externo</text>
        <rect x="430" width="13" height="9" rx="2" fill="#facc15"/><text x="449" y="8" fill="#cbd5e1" fontSize="9">interno</text>
      </g>
    </svg>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 11px 11px", color: error ? "#fca5a5" : "#94a3b8", fontSize: 9, lineHeight: 1.4 }}>
      {error ? <span>{error}</span> : !table ? <span>Calculando límites con el motor local…</span> : <>
        <span>P: {fmt(pShadow?.startDeg)}–{fmt(pShadow?.endDeg)}</span><span>S: {fmt(sShadow?.startDeg)}–180°</span>
        <span>{table.provider}</span>
      </>}
      <span>CMB/ICB a escala radial aproximada; modelos 1-D sin heterogeneidad lateral.</span>
    </div>
  </div>;
}
