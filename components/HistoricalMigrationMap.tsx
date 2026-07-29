"use client";

import { Fragment, useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { HistoricalMigrationCapsule } from "@/lib/types";

function FitCapsule({ capsule }: { capsule: HistoricalMigrationCapsule }) {
  const map = useMap();
  useEffect(() => {
    const points: Array<[number, number]> = [
      [capsule.sourceEvent.latitude, capsule.sourceEvent.longitude],
      [capsule.targetCountry.latitude, capsule.targetCountry.longitude],
      ...capsule.destinations.slice(0, 8).map(
        (destination) => [destination.latitude, destination.longitude] as [number, number],
      ),
    ];
    map.fitBounds(points, { padding: [35, 35], maxZoom: 4 });
  }, [capsule, map]);
  return null;
}

export function HistoricalMigrationMap({
  capsule,
}: {
  capsule: HistoricalMigrationCapsule;
}) {
  return (
    <MapContainer
      center={[capsule.sourceEvent.latitude, capsule.sourceEvent.longitude]}
      zoom={2}
      minZoom={2}
      className="historical-migration-map"
      worldCopyJump
    >
      <FitCapsule capsule={capsule} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Circle
        center={[capsule.targetCountry.latitude, capsule.targetCountry.longitude]}
        radius={capsule.targetCountry.radiusKm * 1_000}
        pathOptions={{
          color: "#22c55e",
          fillColor: "#22c55e",
          fillOpacity: 0.05,
          weight: 2,
        }}
      >
        <Tooltip sticky>País objetivo: {capsule.targetCountry.name}</Tooltip>
      </Circle>

      <CircleMarker
        center={[capsule.sourceEvent.latitude, capsule.sourceEvent.longitude]}
        radius={13}
        pathOptions={{
          color: "#ffffff",
          fillColor: "#dc2626",
          fillOpacity: 0.96,
          weight: 3,
        }}
      >
        <Tooltip permanent direction="top">
          Origen M{capsule.sourceEvent.magnitude.toFixed(1)}
        </Tooltip>
        <Popup>
          <strong>{capsule.sourceEvent.place}</strong>
          <br />M{capsule.sourceEvent.magnitude.toFixed(1)} · {capsule.sourceEvent.depthKm.toFixed(0)} km
        </Popup>
      </CircleMarker>

      {capsule.destinations.map((destination, index) => {
        const color = destination.targetOverlap ? "#22c55e" : "#ef4444";
        const fillOpacity = Math.max(0.05, Math.min(0.3, destination.recurrencePct / 250));
        return (
          <Fragment key={destination.zoneId}>
            <Circle
              center={[destination.latitude, destination.longitude]}
              radius={destination.radiusKm * 1_000}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity,
                weight: index < 3 ? 3 : 1.5,
                dashArray: "8 7",
              }}
            >
              <Tooltip sticky>
                {destination.name}: {destination.recurrencePct}% de recurrencia
              </Tooltip>
              <Popup>
                <strong>{destination.name}</strong>
                <br />Recurrencia ponderada: {destination.recurrencePct}%
                <br />Peso relativo: {destination.relativeWeightPct}%
                <br />Análogos coincidentes: {destination.analogHits}/{capsule.analogsEvaluated}
                {destination.medianLeadDays !== null && (
                  <><br />Mediana temporal: {destination.medianLeadDays} días</>
                )}
              </Popup>
            </Circle>
            <Polyline
              positions={[
                [capsule.sourceEvent.latitude, capsule.sourceEvent.longitude],
                [destination.latitude, destination.longitude],
              ]}
              pathOptions={{
                color,
                opacity: index < 3 ? 0.8 : 0.4,
                weight: index < 3 ? 2.8 : 1.2,
                dashArray: "10 9",
              }}
            />
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
