"use client";

import { CircleMarker, MapContainer, Pane, Popup, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GroundMagneticObservation, MagneticGridCell } from "@/lib/geomagneticWorld";
import type { SwarmMagneticPoint } from "@/lib/swarmGeomag";

export type WorldMapViewMode = "change" | "anomaly" | "reference";

export type WorldMapLayers = {
  anomalies: boolean;
  swarm: boolean;
  earthquakes: boolean;
  dataPoints: boolean;
};

export type GeomagneticWorldMapProps = {
  grid: MagneticGridCell[];
  referenceGrid: MagneticGridCell[];
  viewMode: WorldMapViewMode;
  groundPoints: GroundMagneticObservation[];
  anomalies: GroundMagneticObservation[];
  swarmPoints: SwarmMagneticPoint[];
  events: EarthquakeEvent[];
  layers: WorldMapLayers;
};

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }
function referenceColor(value: number) {
  const t = clamp01(value);
  const hue = 186 + 72 * t;
  const lightness = 62 - 13 * t;
  return `hsl(${hue.toFixed(1)} 82% ${lightness.toFixed(1)}%)`;
}
function changeColor(value: number) {
  const t = Math.max(-1, Math.min(1, value));
  const strength = Math.abs(t);
  if (strength < .035) return "hsl(42 18% 90%)";
  if (t < 0) return `hsl(${(204 + 18 * strength).toFixed(1)} ${(52 + 40 * strength).toFixed(0)}% ${(79 - 32 * strength).toFixed(0)}%)`;
  return `hsl(${(22 - 22 * strength).toFixed(1)} ${(58 + 38 * strength).toFixed(0)}% ${(78 - 31 * strength).toFixed(0)}%)`;
}
function anomalyColor(value: number) {
  const t = clamp01(value);
  if (t < .34) return `hsl(${(54 - 12 * t / .34).toFixed(1)} 92% ${(66 - 8 * t / .34).toFixed(0)}%)`;
  if (t < .68) return `hsl(${(42 - 20 * (t - .34) / .34).toFixed(1)} 94% ${(58 - 8 * (t - .34) / .34).toFixed(0)}%)`;
  return `hsl(${(22 + 300 * (t - .68) / .32).toFixed(1)} 88% ${(50 - 7 * (t - .68) / .32).toFixed(0)}%)`;
}
function activeColor(cell: MagneticGridCell, viewMode: WorldMapViewMode) {
  if (viewMode === "reference") return referenceColor(cell.intensity01);
  if (viewMode === "anomaly") return anomalyColor(cell.intensity01);
  return changeColor(cell.signed01);
}
function activeOpacity(cell: MagneticGridCell, viewMode: WorldMapViewMode) {
  if (viewMode === "reference") return .38;
  const radius = viewMode === "anomaly" ? 1700 : 2400;
  const support = Math.min(1, cell.supportCount / 4);
  const distance = Math.max(0, Math.min(1, 1 - cell.nearestKm / radius));
  const signal = .25 + .75 * clamp01(cell.intensity01);
  return Math.min(.78, .15 + .20 * support + .15 * distance + .30 * signal);
}
function swarmColor(satellite: string) { return satellite === "B" ? "#818cf8" : satellite === "C" ? "#22d3ee" : "#60a5fa"; }
function quakeRadius(magnitude: number) { return Math.max(2.5, Math.min(9, 1.1 + Math.pow(Math.max(0, magnitude), 1.12))); }
function nT(value: number) { return `${Math.round(value).toLocaleString("es-DO")} nT`; }
function signedNt(value: number) { return `${value >= 0 ? "+" : ""}${Math.round(value).toLocaleString("es-DO")} nT`; }
function signedZ(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }

function activeTooltip(cell: MagneticGridCell, viewMode: WorldMapViewMode) {
  if (viewMode === "reference") return <>WMM2025 · campo principal esperado {nT(cell.fieldNt)}</>;
  if (viewMode === "anomaly") return <>robust-Z interpolado {signedZ(cell.fieldNt)} · soporte {cell.supportCount} · estación más próxima ~{cell.nearestKm.toLocaleString("es-DO")} km</>;
  return <>ΔF reciente {signedNt(cell.fieldNt)} · escala visual ±{nT(cell.scaleAbs ?? 0)} · soporte {cell.supportCount} · estación más próxima ~{cell.nearestKm.toLocaleString("es-DO")} km</>;
}

function legend(viewMode: WorldMapViewMode) {
  if (viewMode === "reference") return { left: "campo esperado menor", right: "campo esperado mayor", gradient: "linear-gradient(90deg,hsl(186 82% 62%),hsl(220 82% 55%),hsl(258 82% 49%))" };
  if (viewMode === "anomaly") return { left: "desviación pequeña", right: "|z| alto", gradient: "linear-gradient(90deg,hsl(54 92% 66%),hsl(38 94% 56%),hsl(18 94% 49%),hsl(322 88% 43%))" };
  return { left: "ΔF disminuye", right: "ΔF aumenta", gradient: "linear-gradient(90deg,hsl(222 92% 47%),hsl(205 58% 78%),hsl(42 18% 90%),hsl(20 90% 60%),hsl(0 96% 47%))" };
}

export function GeomagneticWorldLeafletMap({ grid, referenceGrid, viewMode, groundPoints, anomalies, swarmPoints, events, layers }: GeomagneticWorldMapProps) {
  const anomalyCodes = new Set(anomalies.map((point) => point.stationCode));
  const legendData = legend(viewMode);
  return <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(56,189,248,.22)", background: "#07131f" }}>
    <MapContainer center={[18, 0]} zoom={2} minZoom={2} worldCopyJump preferCanvas style={{ height: "clamp(480px,68vh,760px)", width: "100%" }}>
      <TileLayer attribution="Esri World Topographic Map" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}" maxZoom={18} />

      {viewMode !== "reference" && <Pane name="geomagnetic-reference-background" style={{ zIndex: 345, pointerEvents: "none" }}>
        {referenceGrid.map((cell) => {
          const half = cell.sizeDeg / 2;
          return <Rectangle key={`ref:${cell.latitude}:${cell.longitude}`} bounds={[[Math.max(-90, cell.latitude - half), Math.max(-180, cell.longitude - half)], [Math.min(90, cell.latitude + half), Math.min(180, cell.longitude + half)]]} pathOptions={{ color: referenceColor(cell.intensity01), fillColor: referenceColor(cell.intensity01), fillOpacity: .085, opacity: 0, weight: 0 }} />;
        })}
      </Pane>}

      <Pane name="geomagnetic-active" style={{ zIndex: 360, pointerEvents: "auto" }}>
        {grid.map((cell) => {
          const half = cell.sizeDeg / 2;
          return <Rectangle
            key={`${viewMode}:${cell.latitude}:${cell.longitude}`}
            bounds={[[Math.max(-90, cell.latitude - half), Math.max(-180, cell.longitude - half)], [Math.min(90, cell.latitude + half), Math.min(180, cell.longitude + half)]]}
            pathOptions={{ color: activeColor(cell, viewMode), fillColor: activeColor(cell, viewMode), fillOpacity: activeOpacity(cell, viewMode), opacity: viewMode === "reference" ? .08 : .18, weight: .12 }}
          ><Tooltip sticky opacity={.95}>{activeTooltip(cell, viewMode)}</Tooltip></Rectangle>;
        })}
      </Pane>

      {layers.dataPoints && groundPoints.map((point) => <CircleMarker
        key={point.id}
        center={[point.latitude, point.longitude]}
        radius={anomalyCodes.has(point.stationCode) ? 5 : 4}
        pathOptions={{ color: "#0f172a", fillColor: "#f8fafc", fillOpacity: .98, weight: 1.4 }}
      >
        <Tooltip direction="top" opacity={.94}>{point.stationCode} · ΔF {signedNt(point.changeNt)} · z {signedZ(point.signedAnomalyZ)}</Tooltip>
        <Popup>
          <strong>{point.stationCode} · {point.stationName}</strong><br />
          {point.source}<br />
          observado |F|: {nT(point.strengthNt)}<br />
          mediana reciente: {nT(point.baselineNt)}<br />
          <b>ΔF reciente: {signedNt(point.changeNt)}</b><br />
          robust-Z firmado: {signedZ(point.signedAnomalyZ)}<br />
          WMM2025 esperado: {point.expectedMainFieldNt === null ? "N/D" : nT(point.expectedMainFieldNt)}<br />
          observado − WMM2025: {point.modelResidualNt === null ? "N/D" : signedNt(point.modelResidualNt)}<br />
          <span style={{ color: "#64748b" }}>El residuo vs WMM puede contener estructura crustal estática y no se trata como anomalía temporal.</span><br />
          {new Date(point.observedAt).toLocaleString("es-DO")}
        </Popup>
      </CircleMarker>)}

      {layers.anomalies && anomalies.map((point) => <CircleMarker
        key={`anomaly:${point.id}`}
        center={[point.latitude, point.longitude]}
        radius={10 + Math.min(9, point.anomalyZ)}
        pathOptions={{ color: "#f0abfc", fillColor: "#d946ef", fillOpacity: .10, weight: 2.5, dashArray: "4 3" }}
      ><Tooltip direction="top" opacity={.96}>ANOMALÍA TEMPORAL · {point.stationCode} · z={signedZ(point.signedAnomalyZ)} · ΔF={signedNt(point.changeNt)}</Tooltip></CircleMarker>)}

      {layers.swarm && swarmPoints.map((point) => <CircleMarker
        key={point.id}
        center={[point.latitude, point.longitude]}
        radius={1.5}
        pathOptions={{ color: swarmColor(point.satellite), fillColor: swarmColor(point.satellite), fillOpacity: .84, opacity: .8, weight: .5 }}
      ><Tooltip sticky opacity={.9}>Swarm {point.satellite} · {nT(point.strengthNt)} · {new Date(point.observedAt).toISOString().slice(11, 16)} UTC · contexto orbital</Tooltip></CircleMarker>)}

      {layers.earthquakes && events.slice(0, 3500).map((event) => <CircleMarker
        key={`quake30:${event.id}`}
        center={[event.latitude, event.longitude]}
        radius={quakeRadius(event.magnitude)}
        pathOptions={{ color: "#e0f2fe", fillColor: "#06b6d4", fillOpacity: .72, weight: event.magnitude >= 6 ? 2 : .8 }}
      ><Tooltip direction="top" opacity={.94}>M{event.magnitude.toFixed(1)} · {event.place}</Tooltip><Popup><strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><br />{new Date(event.timeUtc).toLocaleString("es-DO")}<br />Prof. {event.depthKm.toFixed(1)} km</Popup></CircleMarker>)}

      <Pane name="world-labels" style={{ zIndex: 650, pointerEvents: "none" }}>
        <TileLayer attribution="Esri boundaries and places" url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={18} opacity={.98} />
      </Pane>
    </MapContainer>

    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "8px 10px 4px", background: "rgba(2,8,18,.95)", color: "#cbd5e1", fontSize: 9 }}>
      <span>{legendData.left}</span>
      <div style={{ width: "min(260px,42vw)", height: 10, borderRadius: 999, background: legendData.gradient, border: "1px solid rgba(255,255,255,.18)" }} />
      <span style={{ textAlign: "right" }}>{legendData.right}</span>
    </div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "4px 10px 8px", color: "#cbd5e1", fontSize: 9.5, background: "rgba(2,8,18,.95)" }}>
      <span><b style={{ color: viewMode === "change" ? "#fb7185" : viewMode === "anomaly" ? "#f0abfc" : "#60a5fa" }}>■</b> {viewMode === "change" ? "ΔF temporal observado" : viewMode === "anomaly" ? "robust-Z temporal" : "WMM2025 esperado"}</span>
      {viewMode !== "reference" && <span><b style={{ color: "#60a5fa" }}>■</b> fondo tenue = WMM2025, no anomalía</span>}
      <span><b style={{ color: "#f8fafc" }}>●</b> estación terrestre</span>
      <span><b style={{ color: "#f0abfc" }}>◯</b> anomalía |z|≥3</span>
      <span><b style={{ color: "#60a5fa" }}>●</b> Swarm</span>
      <span><b style={{ color: "#06b6d4" }}>●</b> sismos 30 días</span>
    </div>
  </div>;
}
