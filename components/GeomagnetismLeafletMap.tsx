"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GeomagneticMapProps, GeomagneticMapStation } from "./GeomagnetismMap2D";

function FocusSelection({ station, event }: { station: GeomagneticMapStation | null; event: EarthquakeEvent | null }) {
  const map = useMap();
  useEffect(() => {
    if (event) {
      map.flyTo([event.latitude, event.longitude], Math.max(4, map.getZoom()), { duration: 0.8 });
      return;
    }
    if (station?.latitude !== null && station?.longitude !== null && station?.latitude !== undefined && station?.longitude !== undefined) {
      map.flyTo([station.latitude, station.longitude], Math.max(3, map.getZoom()), { duration: 0.8 });
    }
  }, [event, map, station]);
  return null;
}

function quakeColor(depthKm: number) {
  if (depthKm > 300) return "#8b5cf6";
  if (depthKm > 70) return "#f97316";
  return "#ef4444";
}

export function GeomagnetismLeafletMap({ stations, targetCode, referenceCodes, events, selectedEventId, onStationSelect, onEventSelect }: GeomagneticMapProps) {
  const mappedStations = stations.filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude));
  const target = mappedStations.find((station) => station.code === targetCode) ?? null;
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const references = new Set(referenceCodes);

  return <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(56,189,248,.2)", background: "#07131f" }}>
    <MapContainer center={[15, -25]} zoom={2} minZoom={2} worldCopyJump style={{ height: "clamp(430px,64vh,680px)", width: "100%" }}>
      <FocusSelection station={target} event={selectedEvent} />
      <TileLayer
        attribution="Tiles © Esri — INTERMAGNET stations — USGS/ComCat earthquakes"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={18}
      />

      {mappedStations.map((station) => {
        const isTarget = station.code === targetCode;
        const isReference = references.has(station.code);
        const color = isTarget ? "#fde047" : isReference ? "#22d3ee" : "#38bdf8";
        return <CircleMarker
          key={station.code}
          center={[station.latitude!, station.longitude!]}
          radius={isTarget ? 8 : isReference ? 6 : 4}
          eventHandlers={{ click: () => onStationSelect(station.code) }}
          pathOptions={{ color, fillColor: color, fillOpacity: isTarget ? 0.95 : 0.72, weight: isTarget ? 3 : 1 }}
        >
          <Tooltip direction="top" offset={[0, -4]} opacity={0.92}>{station.code} · {station.name}</Tooltip>
          <Popup>
            <strong>{station.code} · {station.name}</strong><br />
            INTERMAGNET observatory<br />
            {station.latitude!.toFixed(3)}, {station.longitude!.toFixed(3)}<br />
            {station.elevationM !== null && station.elevationM !== undefined ? `Elevación: ${station.elevationM.toFixed(0)} m` : ""}
            {station.hasOneSecond ? <><br />Datos de 1 s disponibles en el catálogo</> : null}
          </Popup>
        </CircleMarker>;
      })}

      {events.slice(0, 4000).map((event) => {
        const active = event.id === selectedEventId;
        const radius = Math.max(3, Math.min(14, 2.1 + Math.pow(Math.max(event.magnitude, 0), 1.23)));
        const color = quakeColor(event.depthKm);
        return <CircleMarker
          key={event.id}
          center={[event.latitude, event.longitude]}
          radius={active ? radius + 3 : radius}
          eventHandlers={{ click: () => onEventSelect(event) }}
          pathOptions={{ color: active ? "#ffffff" : color, fillColor: color, fillOpacity: active ? 0.98 : 0.68, weight: active ? 3 : 1 }}
        >
          <Tooltip direction="top" opacity={0.92}>M{event.magnitude.toFixed(1)} · {event.place}</Tooltip>
          <Popup>
            <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><br />
            {new Date(event.timeUtc).toLocaleString("es-DO", { timeZoneName: "short" })}<br />
            Profundidad: {event.depthKm.toFixed(1)} km<br />
            {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
          </Popup>
        </CircleMarker>;
      })}
    </MapContainer>
    <div style={{ display: "flex", gap: 13, flexWrap: "wrap", padding: "8px 10px", color: "#cbd5e1", fontSize: 10, background: "rgba(2,8,18,.94)" }}>
      <span><b style={{ color: "#fde047" }}>●</b> objetivo</span>
      <span><b style={{ color: "#22d3ee" }}>●</b> referencias</span>
      <span><b style={{ color: "#38bdf8" }}>●</b> estaciones INTERMAGNET</span>
      <span><b style={{ color: "#ef4444" }}>●</b> sismo cortical</span>
      <span><b style={{ color: "#f97316" }}>●</b> 70–300 km</span>
      <span><b style={{ color: "#8b5cf6" }}>●</b> &gt;300 km</span>
      <span>{mappedStations.length} estaciones · {events.length} sismos en el período</span>
    </div>
  </div>;
}
