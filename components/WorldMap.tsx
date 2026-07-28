"use client";

import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from "react-leaflet";
import { DOMINICAN_TARGET } from "@/lib/regions";
import type { AlertLevel, SeismicEvent, WatchedRegion } from "@/lib/types";

const levelColors: Record<AlertLevel, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

function eventColor(event: SeismicEvent) {
  if (event.isDominicanRegion) return "#ef4444";
  if (event.regionId) return "#f59e0b";
  return "#94a3b8";
}

export function WorldMap({
  events,
  watchedRegions,
  level,
}: {
  events: SeismicEvent[];
  watchedRegions: WatchedRegion[];
  level: AlertLevel;
}) {
  const displayedEvents = events.filter(
    (event) => event.isDominicanRegion || event.regionId || event.magnitude >= 6,
  );

  return (
    <MapContainer center={[14, -36]} zoom={2} minZoom={2} className="world-map" worldCopyJump>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {watchedRegions.map((region) => (
        <Circle
          key={region.id}
          center={[region.latitude, region.longitude]}
          radius={region.radiusKm * 1_000}
          pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.035, weight: 1 }}
        >
          <Tooltip sticky>{region.name}</Tooltip>
        </Circle>
      ))}

      <Circle
        center={[DOMINICAN_TARGET.latitude, DOMINICAN_TARGET.longitude]}
        radius={DOMINICAN_TARGET.radiusKm * 1_000}
        pathOptions={{
          color: levelColors[level],
          fillColor: levelColors[level],
          fillOpacity: level === "red" ? 0.32 : 0.13,
          weight: level === "red" ? 3 : 2,
        }}
      >
        <Tooltip permanent direction="top" className="dominican-label">
          República Dominicana · {level.toUpperCase()}
        </Tooltip>
      </Circle>

      {displayedEvents.map((event) => (
        <CircleMarker
          key={`${event.source}-${event.id}`}
          center={[event.latitude, event.longitude]}
          radius={Math.max(3, (event.magnitude - 1.5) * 1.5)}
          pathOptions={{
            color: eventColor(event),
            fillColor: eventColor(event),
            fillOpacity: 0.72,
            weight: 1,
          }}
        >
          <Popup>
            <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong>
            <br />
            {new Intl.DateTimeFormat("es-DO", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "UTC",
            }).format(new Date(event.time))} UTC
            <br />
            Profundidad: {event.depthKm.toFixed(0)} km
            <br />
            Fuente: {event.source}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
