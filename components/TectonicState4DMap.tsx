"use client";

import { CircleMarker, MapContainer, Pane, Polyline, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapPath } from "@/lib/globeLayers";
import type { TectonicStateCell } from "@/lib/tectonicState4d";

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }

function stateColor(value: number) {
  const t = Math.max(-1, Math.min(1, value));
  const strength = Math.abs(t);
  if (strength < .08) return "hsl(210 10% 72%)";
  if (t < 0) return `hsl(${(205 + 18 * strength).toFixed(0)} ${(62 + 28 * strength).toFixed(0)}% ${(70 - 27 * strength).toFixed(0)}%)`;
  return `hsl(${(28 - 26 * strength).toFixed(0)} ${(68 + 26 * strength).toFixed(0)}% ${(66 - 24 * strength).toFixed(0)}%)`;
}

function boundaryColor(path: GlobeMapPath) {
  if (path.boundaryClass === "SUB") return "#f59e0b";
  if (path.boundaryClass === "OSR" || path.boundaryClass === "CRB") return "#22d3ee";
  if (path.boundaryClass === "OTF" || path.boundaryClass === "CTF") return "#a78bfa";
  return "#94a3b8";
}

function quakeRadius(magnitude: number) {
  return Math.max(2, Math.min(8, 1.2 + Math.pow(Math.max(0, magnitude - 3), 1.35)));
}

function formatMoment(value: number) {
  if (!(value > 0)) return "0";
  return value.toExponential(2).replace("e+", "×10^");
}

export function TectonicState4DMap({
  cells,
  events,
  boundaries,
  faults,
}: {
  cells: TectonicStateCell[];
  events: EarthquakeEvent[];
  boundaries: GlobeMapPath[];
  faults: GlobeMapPath[];
}) {
  const visibleFaults = faults.length > 900 ? faults.filter((_, index) => index % Math.ceil(faults.length / 900) === 0) : faults;
  const visibleEvents = events.length > 1600 ? events.slice(0, 1600) : events;

  return <div style={{ border: "1px solid rgba(56,189,248,.2)", borderRadius: 14, overflow: "hidden", background: "#06111d" }}>
    <MapContainer center={[15, -20]} zoom={2} minZoom={2} worldCopyJump preferCanvas style={{ height: "clamp(520px,70vh,780px)", width: "100%" }}>
      <TileLayer
        attribution="Esri World Topographic Map"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={18}
      />

      <Pane name="state-cells" style={{ zIndex: 350 }}>
        {cells.map((cell) => {
          const half = cell.sizeDeg / 2;
          const opacity = .12 + .56 * clamp01(cell.changeStrength01) * (.35 + .65 * cell.supportScore / 100);
          return <Rectangle
            key={cell.id}
            bounds={[[cell.latitude - half, cell.longitude - half], [cell.latitude + half, cell.longitude + half]]}
            pathOptions={{ color: stateColor(cell.signedChange), fillColor: stateColor(cell.signedChange), fillOpacity: opacity, opacity: .18, weight: .4 }}
          ><Tooltip sticky opacity={.96}>
            <b>Tectonic State 4D</b><br />
            cambio firmado: {(cell.signedChange * 100).toFixed(0)}%<br />
            eventos t₀/t₁: {cell.earlyCount}/{cell.recentCount}<br />
            cambio momento: {cell.momentChangeLog10 >= 0 ? "+" : ""}{cell.momentChangeLog10.toFixed(2)} log10<br />
            Mw máx: {cell.maxMagnitude.toFixed(1)} · profundidad media {cell.meanDepthKm.toFixed(0)} km<br />
            mecanismos: {cell.mechanismCount} · dVs: {cell.tomographyDvsPct === null ? "N/D" : `${cell.tomographyDvsPct.toFixed(2)}%`}<br />
            soporte: {cell.supportScore}/100
          </Tooltip></Rectangle>;
        })}
      </Pane>

      <Pane name="tectonic-boundaries" style={{ zIndex: 430 }}>
        {boundaries.map((path) => <Polyline
          key={`b:${path.id}`}
          positions={path.points.map((point) => [point.lat, point.lng] as [number, number])}
          pathOptions={{ color: boundaryColor(path), opacity: .78, weight: path.boundaryClass === "SUB" ? 1.8 : 1.2 }}
        ><Tooltip sticky>{path.name} · {path.boundaryType ?? path.boundaryClass ?? "límite"}</Tooltip></Polyline>)}
      </Pane>

      <Pane name="active-faults-4d" style={{ zIndex: 440 }}>
        {visibleFaults.map((path) => <Polyline
          key={`f:${path.id}`}
          positions={path.points.map((point) => [point.lat, point.lng] as [number, number])}
          pathOptions={{ color: "#fb7185", opacity: .38, weight: .8 }}
        ><Tooltip sticky>{path.name} · {path.faultType ?? "falla activa GEM"}</Tooltip></Polyline>)}
      </Pane>

      <Pane name="state-events" style={{ zIndex: 510 }}>
        {visibleEvents.map((event) => <CircleMarker
          key={`e:${event.id}`}
          center={[event.latitude, event.longitude]}
          radius={quakeRadius(event.magnitude)}
          pathOptions={{ color: "#e0f2fe", fillColor: "#0ea5e9", fillOpacity: .72, opacity: .82, weight: event.magnitude >= 6 ? 1.7 : .55 }}
        ><Tooltip direction="top">M{event.magnitude.toFixed(1)} · {event.place}<br />{event.depthKm.toFixed(0)} km · {new Date(event.timeUtc).toISOString().slice(0,10)}</Tooltip></CircleMarker>)}
      </Pane>
    </MapContainer>

    <div style={{ padding: "8px 10px", background: "rgba(2,8,18,.96)", color: "#cbd5e1", fontSize: 9, lineHeight: 1.5 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
        <span>menos actividad/momento en t₁</span>
        <div style={{ width: "min(270px,42vw)", height: 10, borderRadius: 999, background: "linear-gradient(90deg,#1d4ed8,#93c5fd,#cbd5e1,#fdba74,#dc2626)" }} />
        <span style={{ textAlign: "right" }}>más actividad/momento en t₁</span>
      </div>
      <div style={{ marginTop: 5, color: "#64748b" }}>El color compara las dos mitades de la ventana; no significa acumulación de tensión ni probabilidad de futuro sismo. Momento liberado y conteo son observaciones retrospectivas.</div>
    </div>
  </div>;
}
