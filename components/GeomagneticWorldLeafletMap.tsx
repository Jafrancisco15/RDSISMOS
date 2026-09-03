"use client";

import { CircleMarker, MapContainer, Pane, Popup, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GroundMagneticObservation, MagneticGridCell } from "@/lib/geomagneticWorld";
import type { SwarmMagneticPoint } from "@/lib/swarmGeomag";

export type WorldMapLayers = {
  field: boolean;
  anomalies: boolean;
  swarm: boolean;
  earthquakes: boolean;
  dataPoints: boolean;
};

export type GeomagneticWorldMapProps = {
  grid: MagneticGridCell[];
  groundPoints: GroundMagneticObservation[];
  anomalies: GroundMagneticObservation[];
  swarmPoints: SwarmMagneticPoint[];
  events: EarthquakeEvent[];
  layers: WorldMapLayers;
};

function heatColor(value: number) {
  const t = Math.max(0, Math.min(1, value));
  const hue = 54 * (1 - t);
  const lightness = 52 - 5 * t;
  return `hsl(${hue.toFixed(1)} 96% ${lightness.toFixed(1)}%)`;
}
function heatOpacity(cell: MagneticGridCell) {
  const support = Math.min(1, cell.supportCount / 4);
  const distance = Math.max(0, Math.min(1, 1 - cell.nearestKm / 3400));
  return .30 + .20 * support + .10 * distance;
}
function swarmColor(satellite: string) { return satellite === "B" ? "#818cf8" : satellite === "C" ? "#22d3ee" : "#60a5fa"; }
function quakeRadius(magnitude: number) { return Math.max(2.5, Math.min(9, 1.1 + Math.pow(Math.max(0, magnitude), 1.12))); }
function nT(value: number) { return `${Math.round(value).toLocaleString("es-DO")} nT`; }

export function GeomagneticWorldLeafletMap({ grid, groundPoints, anomalies, swarmPoints, events, layers }: GeomagneticWorldMapProps) {
  const anomalyCodes = new Set(anomalies.map((point) => point.stationCode));
  return <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(56,189,248,.22)", background: "#07131f" }}>
    <MapContainer center={[18, 0]} zoom={2} minZoom={2} worldCopyJump preferCanvas style={{ height: "clamp(480px,68vh,760px)", width: "100%" }}>
      <TileLayer
        attribution="Esri World Topographic Map"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={18}
      />

      <Pane name="geomagnetic-field" style={{ zIndex: 360, pointerEvents: "auto" }}>
        {layers.field && grid.map((cell) => {
          const half = cell.sizeDeg / 2;
          return <Rectangle
            key={`field:${cell.latitude}:${cell.longitude}`}
            bounds={[[Math.max(-90, cell.latitude - half), Math.max(-180, cell.longitude - half)], [Math.min(90, cell.latitude + half), Math.min(180, cell.longitude + half)]]}
            pathOptions={{
              color: heatColor(cell.intensity01),
              fillColor: heatColor(cell.intensity01),
              fillOpacity: heatOpacity(cell),
              opacity: .12,
              weight: .15,
            }}
          ><Tooltip sticky opacity={.93}>Campo interpolado {nT(cell.fieldNt)} · intensidad relativa {(cell.intensity01 * 100).toFixed(0)}% · soporte {cell.supportCount} · estación más próxima ~{cell.nearestKm.toLocaleString("es-DO")} km</Tooltip></Rectangle>;
        })}
      </Pane>

      {layers.dataPoints && groundPoints.map((point) => <CircleMarker
        key={point.id}
        center={[point.latitude, point.longitude]}
        radius={anomalyCodes.has(point.stationCode) ? 5 : 4}
        pathOptions={{ color: "#0f172a", fillColor: "#f8fafc", fillOpacity: .98, weight: 1.4 }}
      >
        <Tooltip direction="top" opacity={.94}>{point.stationCode} · {nT(point.strengthNt)}</Tooltip>
        <Popup><strong>{point.stationCode} · {point.stationName}</strong><br />{point.source}<br />|F|: {nT(point.strengthNt)}<br />baseline: {nT(point.baselineNt)}<br />z local preliminar: {point.anomalyZ.toFixed(2)}<br />{new Date(point.observedAt).toLocaleString("es-DO")}</Popup>
      </CircleMarker>)}

      {layers.anomalies && anomalies.map((point) => <CircleMarker
        key={`anomaly:${point.id}`}
        center={[point.latitude, point.longitude]}
        radius={10 + Math.min(9, point.anomalyZ)}
        pathOptions={{ color: "#f0abfc", fillColor: "#d946ef", fillOpacity: .10, weight: 2.5, dashArray: "4 3" }}
      ><Tooltip direction="top" opacity={.96}>ANOMALÍA · {point.stationCode} · z={point.anomalyZ.toFixed(1)}</Tooltip></CircleMarker>)}

      {layers.swarm && swarmPoints.map((point) => <CircleMarker
        key={point.id}
        center={[point.latitude, point.longitude]}
        radius={1.5}
        pathOptions={{ color: swarmColor(point.satellite), fillColor: swarmColor(point.satellite), fillOpacity: .84, opacity: .8, weight: .5 }}
      ><Tooltip sticky opacity={.9}>Swarm {point.satellite} · {nT(point.strengthNt)} · {new Date(point.observedAt).toISOString().slice(11, 16)} UTC</Tooltip></CircleMarker>)}

      {layers.earthquakes && events.slice(0, 3500).map((event) => <CircleMarker
        key={`quake30:${event.id}`}
        center={[event.latitude, event.longitude]}
        radius={quakeRadius(event.magnitude)}
        pathOptions={{ color: "#e0f2fe", fillColor: "#06b6d4", fillOpacity: .72, weight: event.magnitude >= 6 ? 2 : .8 }}
      ><Tooltip direction="top" opacity={.94}>M{event.magnitude.toFixed(1)} · {event.place}</Tooltip><Popup><strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><br />{new Date(event.timeUtc).toLocaleString("es-DO")}<br />Prof. {event.depthKm.toFixed(1)} km</Popup></CircleMarker>)}

      <Pane name="world-labels" style={{ zIndex: 650, pointerEvents: "none" }}>
        <TileLayer
          attribution="Esri boundaries and places"
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          maxZoom={18}
          opacity={.98}
        />
      </Pane>
    </MapContainer>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "8px 10px 4px", background: "rgba(2,8,18,.95)", color: "#cbd5e1", fontSize: 9 }}>
      <span>campo menor relativo</span>
      <div style={{ width: "min(240px,42vw)", height: 10, borderRadius: 999, background: "linear-gradient(90deg,hsl(54 96% 52%),hsl(38 96% 51%),hsl(20 96% 49%),hsl(0 96% 47%))", border: "1px solid rgba(255,255,255,.18)" }} />
      <span style={{ textAlign: "right" }}>campo alto relativo</span>
    </div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "4px 10px 8px", color: "#cbd5e1", fontSize: 9.5, background: "rgba(2,8,18,.95)" }}>
      <span><b style={{ color: "#f8fafc" }}>●</b> estación terrestre</span>
      <span><b style={{ color: "#f0abfc" }}>◯</b> anomalía z≥3</span>
      <span><b style={{ color: "#60a5fa" }}>●</b> Swarm</span>
      <span><b style={{ color: "#06b6d4" }}>●</b> sismos 30 días</span>
    </div>
  </div>;
}
