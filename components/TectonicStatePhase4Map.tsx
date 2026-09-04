"use client";

import { CircleMarker, MapContainer, Pane, Polyline, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { TectonicStatePhase4Result } from "@/lib/tectonicStatePhase4";

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }

function cellColor(value: number, scale: number) {
  const t = clamp01(value / Math.max(1, scale));
  const hue = 205 - 190 * t;
  const saturation = 64 + 22 * t;
  const lightness = 68 - 25 * t;
  return `hsl(${hue.toFixed(0)} ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
}

function vectorEnd(latitude: number, longitude: number, eastMm: number, northMm: number, maxHorizontalMm: number) {
  const magnitude = Math.hypot(eastMm, northMm);
  if (!(magnitude > 0)) return [latitude, longitude] as [number, number];
  const visualLengthDeg = 0.18 + 1.25 * clamp01(magnitude / Math.max(1, maxHorizontalMm));
  const northFraction = northMm / magnitude;
  const eastFraction = eastMm / magnitude;
  const cosLat = Math.max(0.25, Math.cos(latitude * Math.PI / 180));
  return [latitude + northFraction * visualLengthDeg, longitude + eastFraction * visualLengthDeg / cosLat] as [number, number];
}

export function TectonicStatePhase4Map({ result, event }: { result: TectonicStatePhase4Result; event: EarthquakeEvent }) {
  const maxCell = Math.max(1, ...result.cells.map((cell) => cell.vectorMm));
  const maxHorizontal = Math.max(1, ...result.gnss.stations.map((station) => station.horizontalMm));
  const visibleCells = result.cells.filter((cell) => cell.supportScore >= 18).slice(0, 500);

  return <div style={{ border: "1px solid rgba(34,211,238,.2)", borderRadius: 13, overflow: "hidden", background: "#06111d" }}>
    <MapContainer center={[event.latitude, event.longitude]} zoom={3} minZoom={2} worldCopyJump preferCanvas style={{ height: "clamp(430px,62vh,680px)", width: "100%" }}>
      <TileLayer
        attribution="Esri World Topographic Map"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={18}
      />
      <Pane name="phase4-field" style={{ zIndex: 360 }}>
        {visibleCells.map((cell) => {
          const half = cell.sizeDeg / 2;
          const support = clamp01(cell.supportScore / 100);
          const fill = cellColor(cell.vectorMm, maxCell);
          return <Rectangle
            key={cell.id}
            bounds={[[cell.latitude - half, cell.longitude - half], [cell.latitude + half, cell.longitude + half]]}
            pathOptions={{
              color: fill,
              fillColor: fill,
              fillOpacity: 0.08 + 0.52 * support,
              opacity: 0.18 + 0.42 * support,
              weight: cell.supportScore >= 42 ? 0.8 : 0.45,
              dashArray: cell.supportScore >= 42 ? undefined : "3 4",
            }}
          ><Tooltip sticky opacity={.97}>
            <b>Fase 4 · Ux/Uy/Uz</b><br />
            E {cell.uxMm >= 0 ? "+" : ""}{cell.uxMm.toFixed(1)} mm · N {cell.uyMm >= 0 ? "+" : ""}{cell.uyMm.toFixed(1)} mm<br />
            U {cell.uzMm >= 0 ? "+" : ""}{cell.uzMm.toFixed(1)} mm · |U| {cell.vectorMm.toFixed(1)} mm<br />
            incertidumbre {cell.uncertaintyMm.toFixed(1)} mm · soporte {cell.supportScore}/100<br />
            {cell.stationCount} estaciones · distancia media {cell.meanDistanceKm.toFixed(0)} km<br />
            estructura F3: {cell.phase3ConstraintCount} constraints · resolución {cell.structureResolutionScore ?? "N/D"}
          </Tooltip></Rectangle>;
        })}
      </Pane>

      <Pane name="phase4-vectors" style={{ zIndex: 490 }}>
        {result.gnss.stations.map((station) => {
          const end = vectorEnd(station.latitude, station.longitude, station.eastMm, station.northMm, maxHorizontal);
          return <Polyline
            key={`v-${station.code}`}
            positions={[[station.latitude, station.longitude], end]}
            pathOptions={{ color: "#22d3ee", opacity: .9, weight: 2 }}
          ><Tooltip sticky opacity={.97}>
            <b>{station.code} · vector horizontal</b><br />
            E {station.eastMm >= 0 ? "+" : ""}{station.eastMm.toFixed(1)} mm · N {station.northMm >= 0 ? "+" : ""}{station.northMm.toFixed(1)} mm<br />
            línea escalada solo para visualización
          </Tooltip></Polyline>;
        })}
      </Pane>

      <Pane name="phase4-stations" style={{ zIndex: 520 }}>
        {result.gnss.stations.map((station) => <CircleMarker
          key={station.code}
          center={[station.latitude, station.longitude]}
          radius={5 + 3 * clamp01(station.qualityScore / 100)}
          pathOptions={{ color: "#ecfeff", fillColor: "#0891b2", fillOpacity: .9, opacity: 1, weight: 1.3 }}
        ><Tooltip direction="top" opacity={.98}>
          <b>{station.code} · NGL IGS20</b><br />
          {station.sourceProduct} · calidad {station.qualityScore}/100<br />
          E {station.eastMm >= 0 ? "+" : ""}{station.eastMm.toFixed(1)} ± {station.uncertaintyEastMm.toFixed(1)} mm<br />
          N {station.northMm >= 0 ? "+" : ""}{station.northMm.toFixed(1)} ± {station.uncertaintyNorthMm.toFixed(1)} mm<br />
          U {station.upMm >= 0 ? "+" : ""}{station.upMm.toFixed(1)} ± {station.uncertaintyUpMm.toFixed(1)} mm<br />
          {station.distanceKm.toFixed(0)} km · pre/post {station.preSampleCount}/{station.postSampleCount}
        </Tooltip></CircleMarker>)}
      </Pane>

      <Pane name="phase4-event" style={{ zIndex: 560 }}>
        <CircleMarker center={[event.latitude, event.longitude]} radius={8} pathOptions={{ color: "#fef3c7", fillColor: "#f59e0b", fillOpacity: .95, opacity: 1, weight: 2 }}>
          <Tooltip direction="top"><b>Evento fuente</b><br />M{event.magnitude.toFixed(1)} · {event.place}<br />{event.depthKm.toFixed(1)} km</Tooltip>
        </CircleMarker>
      </Pane>
    </MapContainer>
    <div style={{ padding: "8px 10px", background: "rgba(2,8,18,.97)", color: "#94a3b8", fontSize: 8.6, lineHeight: 1.5 }}>
      Celdas = interpolación GNSS ponderada por distancia, precisión y calidad. Líneas cian = dirección horizontal de cada estación con longitud <b style={{ color: "#cbd5e1" }}>normalizada para visualización</b>, no escala geográfica de milímetros. Borde discontinuo = soporte bajo.
    </div>
  </div>;
}
