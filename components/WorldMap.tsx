"use client";

import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import { DOMINICAN_TARGET } from "@/lib/regions";
import type {
  AlertLevel,
  MigrationProjection,
  SeismicEvent,
  WatchedRegion,
} from "@/lib/types";

const levelColors: Record<AlertLevel, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

const projectionColors = {
  active: "#38bdf8",
  fulfilled: "#22c55e",
  expired: "#94a3b8",
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
  projection,
}: {
  events: SeismicEvent[];
  watchedRegions: WatchedRegion[];
  level: AlertLevel;
  projection: MigrationProjection | null;
}) {
  const displayedEvents = events.filter(
    (event) => event.isDominicanRegion || event.regionId || event.magnitude >= 6,
  );
  const projectionColor = projection
    ? projectionColors[projection.status]
    : projectionColors.expired;

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

      {projection && (
        <>
          <CircleMarker
            center={[projection.sourceEvent.latitude, projection.sourceEvent.longitude]}
            radius={10}
            pathOptions={{
              color: projectionColor,
              fillColor: projectionColor,
              fillOpacity: 0.92,
              weight: 3,
            }}
          >
            <Tooltip permanent direction="top" className="projection-label">
              Origen M{projection.sourceEvent.magnitude.toFixed(1)}
            </Tooltip>
            <Popup>
              <strong>Evento origen: {projection.sourceRegionName}</strong>
              <br />
              M{projection.sourceEvent.magnitude.toFixed(1)} · {projection.sourceEvent.place}
              <br />
              Ventana: {projection.maxDays} días
            </Popup>
          </CircleMarker>

          {projection.targets.map((target) => {
            const matched = projection.matchedTargetId === target.id;
            const targetColor = matched ? "#22c55e" : projectionColor;
            return (
              <Circle
                key={`${projection.id}-${target.id}`}
                center={[target.latitude, target.longitude]}
                radius={target.radiusKm * 1_000}
                pathOptions={{
                  color: targetColor,
                  fillColor: targetColor,
                  fillOpacity: matched ? 0.2 : 0.08,
                  weight: matched ? 3 : 2,
                  dashArray: matched ? undefined : "7 7",
                }}
              >
                <Tooltip sticky>
                  {matched ? "Proyección cumplida: " : "Destino candidato: "}{target.name}
                </Tooltip>
              </Circle>
            );
          })}

          {projection.targets.map((target) => (
            <Polyline
              key={`route-${projection.id}-${target.id}`}
              positions={[
                [projection.sourceEvent.latitude, projection.sourceEvent.longitude],
                [target.latitude, target.longitude],
              ]}
              pathOptions={{
                color: projection.matchedTargetId === target.id ? "#22c55e" : projectionColor,
                weight: projection.matchedTargetId === target.id ? 4 : 2,
                opacity: 0.82,
                dashArray: projection.matchedTargetId === target.id ? undefined : "10 9",
              }}
            />
          ))}
        </>
      )}

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
