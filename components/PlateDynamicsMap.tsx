"use client";

import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, Tooltip } from "react-leaflet";
import type { GeoFeatureCollection, PlateMapEvent } from "@/lib/plateDynamics";
import styles from "./PlateDynamicsDashboard.module.css";

function boundaryColor(type: unknown) {
  if (type === "subduction") return "#ef4444";
  if (type === "divergent") return "#22c55e";
  if (type === "transform") return "#f59e0b";
  if (type === "convergent") return "#f97316";
  return "#38bdf8";
}

export function PlateDynamicsMap({
  polygons,
  boundaries,
  events,
  selectedPlateId,
  onSelectPlate,
}: {
  polygons: GeoFeatureCollection;
  boundaries: GeoFeatureCollection;
  events: PlateMapEvent[];
  selectedPlateId: string | null;
  onSelectPlate: (plateId: string) => void;
}) {
  return (
    <div className={styles.mapWrap}>
      <MapContainer center={[18, -25]} zoom={2} minZoom={2} className={styles.map} worldCopyJump>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <GeoJSON
          key={`plates-${selectedPlateId ?? "all"}`}
          data={polygons as never}
          style={(feature) => {
            const plateId = String(feature?.properties?.plateId ?? "");
            const selected = selectedPlateId === plateId;
            return {
              color: selected ? "#ffffff" : "#64748b",
              weight: selected ? 2.6 : 0.7,
              fillColor: selected ? "#7c3aed" : "#1e293b",
              fillOpacity: selected ? 0.32 : 0.08,
            };
          }}
          onEachFeature={(feature, layer) => {
            const plateId = String(feature.properties?.plateId ?? "");
            const plateName = String(feature.properties?.plateName ?? `Placa ${plateId}`);
            layer.bindTooltip(`${plateName} · ID ${plateId}`, { sticky: true });
            layer.on("click", () => onSelectPlate(plateId));
          }}
        />

        <GeoJSON
          data={boundaries as never}
          style={(feature) => ({
            color: boundaryColor(feature?.properties?.boundaryType),
            weight: 1.5,
            opacity: 0.88,
            dashArray: feature?.properties?.boundaryType === "transform" ? "5 5" : undefined,
          })}
        />

        {events.map((event) => {
          const selected = selectedPlateId === null || selectedPlateId === event.plateId;
          return (
            <CircleMarker
              key={event.id}
              center={[event.latitude, event.longitude]}
              radius={Math.max(3, Math.min(9, 2 + (event.magnitude - 4.5) * 2.2))}
              pathOptions={{
                color: selected ? "#ffffff" : "#475569",
                fillColor: event.magnitude >= 7 ? "#dc2626" : event.magnitude >= 6 ? "#f97316" : "#eab308",
                fillOpacity: selected ? 0.86 : 0.18,
                opacity: selected ? 0.9 : 0.25,
                weight: selected ? 1.2 : 0.5,
              }}
              eventHandlers={{ click: () => onSelectPlate(event.plateId) }}
            >
              <Tooltip direction="top">M{event.magnitude.toFixed(1)} · {event.plateName}</Tooltip>
              <Popup>
                <strong>{event.place}</strong>
                <div>M{event.magnitude.toFixed(1)} · {event.depthKm.toFixed(0)} km</div>
                <div>{event.plateName} · ID {event.plateId}</div>
                <div>{new Date(event.timeUtc).toLocaleString("es-DO", { timeZone: "UTC" })} UTC</div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <div className={styles.mapLegend}>
        <span><i style={{ background: "#ef4444" }} /> Subducción</span>
        <span><i style={{ background: "#22c55e" }} /> Divergente</span>
        <span><i style={{ background: "#f59e0b" }} /> Transformante</span>
        <span><i style={{ background: "#38bdf8" }} /> Otro límite</span>
      </div>
    </div>
  );
}
