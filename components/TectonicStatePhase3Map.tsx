"use client";

import { CircleMarker, MapContainer, Pane, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { Phase3VelocityVoxel, Phase3Wave } from "@/lib/tectonicStatePhase3";

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }

function valueFor(voxel: Phase3VelocityVoxel, wave: Phase3Wave) {
  return wave === "P" ? voxel.deltaVpPct : voxel.deltaVsPct;
}

function velocityColor(value: number) {
  const t = Math.max(-1, Math.min(1, value / 3));
  const strength = Math.abs(t);
  if (strength < .05) return "hsl(215 12% 72%)";
  if (t < 0) return `hsl(${(214 + 7 * strength).toFixed(0)} ${(64 + 24 * strength).toFixed(0)}% ${(71 - 28 * strength).toFixed(0)}%)`;
  return `hsl(${(18 - 15 * strength).toFixed(0)} ${(68 + 26 * strength).toFixed(0)}% ${(68 - 29 * strength).toFixed(0)}%)`;
}

export function TectonicStatePhase3Map({
  voxels,
  event,
  wave,
}: {
  voxels: Phase3VelocityVoxel[];
  event: EarthquakeEvent;
  wave: Phase3Wave;
}) {
  const visible = voxels
    .filter((voxel) => valueFor(voxel, wave) !== null && voxel.supportScore >= 8)
    .slice(0, 1000);

  return <div style={{ border: "1px solid rgba(167,139,250,.2)", borderRadius: 13, overflow: "hidden", background: "#06111d" }}>
    <MapContainer center={[event.latitude, event.longitude]} zoom={2} minZoom={2} worldCopyJump preferCanvas style={{ height: "clamp(430px,62vh,680px)", width: "100%" }}>
      <TileLayer
        attribution="Esri World Topographic Map"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={18}
      />
      <Pane name="phase3-voxels" style={{ zIndex: 370 }}>
        {visible.map((voxel) => {
          const value = valueFor(voxel, wave) ?? 0;
          const half = voxel.horizontalSizeDeg / 2;
          const strength = clamp01(Math.abs(value) / 3);
          const support = clamp01(voxel.supportScore / 100);
          const fillOpacity = .10 + .58 * strength * (.35 + .65 * support);
          return <Rectangle
            key={`${wave}:${voxel.id}`}
            bounds={[[voxel.latitude - half, voxel.longitude - half], [voxel.latitude + half, voxel.longitude + half]]}
            pathOptions={{
              color: velocityColor(value),
              fillColor: velocityColor(value),
              fillOpacity,
              opacity: .22 + .35 * support,
              weight: .5,
            }}
          ><Tooltip sticky opacity={.96}>
            <b>Fase 3 · δV{wave.toLowerCase()}</b><br />
            {value >= 0 ? "+" : ""}{value.toFixed(2)}% relativo a IASP91<br />
            profundidad voxel: {voxel.depthKm.toFixed(0)} km<br />
            rayos P/S: {voxel.pRayCount}/{voxel.sRayCount}<br />
            estaciones: {voxel.stationCount}<br />
            soporte: {voxel.supportScore}/100
          </Tooltip></Rectangle>;
        })}
      </Pane>
      <Pane name="phase3-source" style={{ zIndex: 540 }}>
        <CircleMarker
          center={[event.latitude, event.longitude]}
          radius={8}
          pathOptions={{ color: "#fef3c7", fillColor: "#f59e0b", fillOpacity: .95, opacity: 1, weight: 2 }}
        ><Tooltip direction="top"><b>Evento fuente</b><br />M{event.magnitude.toFixed(1)} · {event.place}<br />{event.depthKm.toFixed(1)} km</Tooltip></CircleMarker>
      </Pane>
    </MapContainer>
    <div style={{ padding: "8px 10px", background: "rgba(2,8,18,.97)", color: "#cbd5e1", fontSize: 8.8, lineHeight: 1.5 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
        <span>más lento que IASP91</span>
        <div style={{ width: "min(270px,42vw)", height: 9, borderRadius: 999, background: "linear-gradient(90deg,#1d4ed8,#93c5fd,#cbd5e1,#fca5a5,#dc2626)" }} />
        <span style={{ textAlign: "right" }}>más rápido que IASP91</span>
      </div>
      <div style={{ marginTop: 5, color: "#64748b" }}>La intensidad visual combina magnitud de δV y soporte de rayos. Un color fuerte no significa tensión ni riesgo sísmico.</div>
    </div>
  </div>;
}
