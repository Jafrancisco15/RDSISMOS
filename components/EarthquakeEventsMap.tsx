"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";

function FocusEvent({ event }: { event: EarthquakeEvent | null }) {
  const map = useMap();
  useEffect(() => {
    if (event) map.setView([event.latitude, event.longitude], Math.max(map.getZoom(), 6), { animate: true });
  }, [event, map]);
  return null;
}

export function EarthquakeEventsMap({ events, selectedId, onSelect }: { events: EarthquakeEvent[]; selectedId: string | null; onSelect: (event: EarthquakeEvent) => void }) {
  const selected = events.find((event) => event.id === selectedId) ?? null;
  return (
    <MapContainer center={[15, -25]} zoom={2} minZoom={2} className="earthquake-events-map" worldCopyJump>
      <FocusEvent event={selected} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {events.slice(0, 2_500).map((event) => {
        const active = event.id === selectedId;
        const radius = Math.max(3, Math.min(16, 2 + Math.pow(Math.max(event.magnitude, 0), 1.35)));
        const opacity = Math.max(0.35, Math.min(0.95, 0.35 + event.magnitude / 10));
        return (
          <CircleMarker
            key={event.id}
            center={[event.latitude, event.longitude]}
            radius={active ? radius + 3 : radius}
            eventHandlers={{ click: () => onSelect(event) }}
            pathOptions={{ color: active ? "#facc15" : "#ef4444", fillColor: event.depthKm > 300 ? "#7c3aed" : event.depthKm > 70 ? "#f97316" : "#ef4444", fillOpacity: opacity, weight: active ? 3 : 1 }}
          >
            <Popup>
              <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><br />
              {new Date(event.timeUtc).toLocaleString(undefined, { timeZoneName: "short" })}<br />
              Profundidad: {event.depthKm.toFixed(1)} km<br />
              {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
