"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { GeoJsonObject } from "geojson";
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type {
  AlertLevel,
  CountryTarget,
  HistoricalMigrationCapsule,
  MapLayerVisibility,
  MigrationProjection,
  SeismicEvent,
} from "@/lib/types";

const levelColors: Record<AlertLevel, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

const projectionColors = {
  active: "#a855f7",
  fulfilled: "#22c55e",
  expired: "#64748b",
};

function RecenterMap({ target }: { target: CountryTarget }) {
  const map = useMap();
  useEffect(() => {
    const zoom = target.radiusKm < 400 ? 6 : target.radiusKm < 900 ? 5 : 4;
    map.setView([target.latitude, target.longitude], zoom, { animate: true });
  }, [map, target]);
  return null;
}

function FitHistoricalCapsule({ capsule }: { capsule: HistoricalMigrationCapsule | null }) {
  const map = useMap();
  useEffect(() => {
    if (!capsule || !capsule.destinations.length) return;
    const points: Array<[number, number]> = [
      [capsule.sourceEvent.latitude, capsule.sourceEvent.longitude],
      ...capsule.destinations.slice(0, 6).map(
        (destination) => [destination.latitude, destination.longitude] as [number, number],
      ),
    ];
    map.fitBounds(points, { padding: [35, 35], maxZoom: 4, animate: true });
  }, [capsule, map]);
  return null;
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function occurredColor(event: SeismicEvent) {
  if (event.isTargetRegion) return "#38bdf8";
  return "#94a3b8";
}

export function WorldMap({
  events,
  target,
  level,
  projections,
  selectedProjection,
  historicalCapsule,
  layers,
}: {
  events: SeismicEvent[];
  target: CountryTarget;
  level: AlertLevel;
  projections: MigrationProjection[];
  selectedProjection: MigrationProjection | null;
  historicalCapsule: HistoricalMigrationCapsule | null;
  layers: MapLayerVisibility;
}) {
  const [faultData, setFaultData] = useState<GeoJsonObject | null>(null);
  const [faultStatus, setFaultStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!layers.faults) return;
    const controller = new AbortController();
    setFaultStatus("Cargando fallas activas…");
    fetch(`/api/faults?country=${encodeURIComponent(target.code)}`, {
      cache: "force-cache",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<
          GeoJsonObject & { warning?: string; attribution?: string }
        >;
      })
      .then((payload) => {
        setFaultData(payload);
        setFaultStatus(payload.warning ?? payload.attribution ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFaultData(null);
        setFaultStatus(
          error instanceof Error ? error.message : "No se pudieron cargar las fallas.",
        );
      });
    return () => controller.abort();
  }, [layers.faults, target.code]);

  const occurredEvents = useMemo(
    () =>
      events
        .filter(
          (event) =>
            layers.occurred && (event.isTargetRegion || event.magnitude >= 5.5),
        )
        .slice(0, 1_200),
    [events, layers.occurred],
  );

  const displayedProjections = layers.projected
    ? projections.filter(
        (projection) =>
          projection.status === "active" || projection.id === selectedProjection?.id,
      )
    : [];
  const parentEvents = layers.preceding
    ? projections.map((projection) => projection.sourceEvent)
    : [];
  const historicalDestinations =
    layers.historical && historicalCapsule
      ? historicalCapsule.destinations.slice(0, 8)
      : [];

  return (
    <div className="map-wrapper">
      <MapContainer
        center={[target.latitude, target.longitude]}
        zoom={5}
        minZoom={2}
        className="world-map"
        worldCopyJump
      >
        {layers.historical && historicalCapsule ? (
          <FitHistoricalCapsule capsule={historicalCapsule} />
        ) : (
          <RecenterMap target={target} />
        )}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {layers.faults && faultData && (
          <GeoJSON
            key={`faults-${target.code}`}
            data={faultData}
            style={{ color: "#f97316", weight: 1.6, opacity: 0.78 }}
            onEachFeature={(feature, layer) => {
              const properties = feature.properties as Record<string, unknown> | undefined;
              const name =
                properties?.name ??
                properties?.fault_name ??
                properties?.Fault_Name ??
                "Falla activa registrada";
              layer.bindTooltip(String(name), { sticky: true });
            }}
          />
        )}

        <Circle
          center={[target.latitude, target.longitude]}
          radius={target.radiusKm * 1_000}
          pathOptions={{
            color: levelColors[level],
            fillColor: levelColors[level],
            fillOpacity: 0.055,
            weight: 2,
          }}
        >
          <Tooltip permanent direction="top" className="target-label">
            {target.name} · {level.toUpperCase()}
          </Tooltip>
        </Circle>

        {displayedProjections.map((projection) => {
          const selected = projection.id === selectedProjection?.id;
          const color = projectionColors[projection.status];
          return (
            <Fragment key={projection.id}>
              <Circle
                center={[
                  projection.projectedZone.latitude,
                  projection.projectedZone.longitude,
                ]}
                radius={projection.projectedZone.radiusKm * 1_000}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: selected ? 0.2 : 0.08,
                  weight: selected ? 3 : 1.5,
                  dashArray: projection.status === "fulfilled" ? undefined : "8 7",
                }}
              >
                <Tooltip sticky>
                  {projection.projectedZone.name} · {projection.probabilityPct}%
                </Tooltip>
              </Circle>
              <Polyline
                positions={[
                  [projection.sourceEvent.latitude, projection.sourceEvent.longitude],
                  [projection.projectedZone.latitude, projection.projectedZone.longitude],
                ]}
                pathOptions={{
                  color,
                  weight: selected ? 3 : 1.5,
                  opacity: selected ? 0.9 : 0.55,
                  dashArray: "9 8",
                }}
              />
            </Fragment>
          );
        })}

        {parentEvents.map((event) => (
          <CircleMarker
            key={`parent-${event.source}-${event.id}`}
            center={[event.latitude, event.longitude]}
            radius={9}
            pathOptions={{
              color: "#facc15",
              fillColor: "#7c3aed",
              fillOpacity: 0.95,
              weight: 3,
            }}
          >
            <Tooltip sticky>Evento precedente M{event.magnitude.toFixed(1)}</Tooltip>
            <Popup>
              <strong>Evento padre / precedente</strong>
              <br />M{event.magnitude.toFixed(1)} · {event.place}
              <br />{formatUtc(event.time)} UTC
              <br />Fuente: {event.source}
            </Popup>
          </CircleMarker>
        ))}

        {layers.historical && historicalCapsule && (
          <CircleMarker
            center={[
              historicalCapsule.sourceEvent.latitude,
              historicalCapsule.sourceEvent.longitude,
            ]}
            radius={12}
            pathOptions={{
              color: "#ffffff",
              fillColor: "#dc2626",
              fillOpacity: 0.95,
              weight: 3,
            }}
          >
            <Tooltip permanent direction="top">
              Origen histórico M{historicalCapsule.sourceEvent.magnitude.toFixed(1)}
            </Tooltip>
            <Popup>
              <strong>Evento origen de la cápsula histórica</strong>
              <br />{historicalCapsule.sourceEvent.place}
              <br />{formatUtc(historicalCapsule.sourceEvent.time)} UTC
            </Popup>
          </CircleMarker>
        )}

        {historicalDestinations.map((destination, index) => {
          const opacity = Math.max(0.06, Math.min(0.28, destination.recurrencePct / 260));
          const color = destination.targetOverlap ? "#22c55e" : "#ef4444";
          return (
            <Fragment key={`historical-${destination.zoneId}`}>
              <Circle
                center={[destination.latitude, destination.longitude]}
                radius={destination.radiusKm * 1_000}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: opacity,
                  weight: index < 3 ? 2.8 : 1.5,
                  dashArray: "7 6",
                }}
              >
                <Tooltip sticky>
                  {destination.name}: recurrencia {destination.recurrencePct}%
                </Tooltip>
                <Popup>
                  <strong>{destination.name}</strong>
                  <br />Recurrencia ponderada: {destination.recurrencePct}%
                  <br />Peso relativo: {destination.relativeWeightPct}%
                  <br />Coincidencias: {destination.analogHits}/{historicalCapsule.analogsEvaluated}
                  {destination.medianLeadDays !== null && (
                    <><br />Mediana temporal: {destination.medianLeadDays} días</>
                  )}
                </Popup>
              </Circle>
              <Polyline
                positions={[
                  [historicalCapsule.sourceEvent.latitude, historicalCapsule.sourceEvent.longitude],
                  [destination.latitude, destination.longitude],
                ]}
                pathOptions={{
                  color,
                  opacity: index < 3 ? 0.75 : 0.42,
                  weight: index < 3 ? 2.5 : 1.2,
                  dashArray: "10 9",
                }}
              />
            </Fragment>
          );
        })}

        {occurredEvents.map((event) => (
          <CircleMarker
            key={`occurred-${event.source}-${event.id}`}
            center={[event.latitude, event.longitude]}
            radius={Math.max(3, Math.min(11, (event.magnitude - 1) * 1.45))}
            pathOptions={{
              color: occurredColor(event),
              fillColor: occurredColor(event),
              fillOpacity: event.isTargetRegion ? 0.84 : 0.52,
              weight: event.isTargetRegion ? 1.7 : 1,
            }}
          >
            <Popup>
              <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong>
              <br />{formatUtc(event.time)} UTC
              <br />Profundidad: {event.depthKm.toFixed(0)} km
              <br />Fuente: {event.source}
              {event.detailUrl && (
                <>
                  <br />
                  <a href={event.detailUrl} target="_blank" rel="noreferrer">
                    Ver registro original
                  </a>
                </>
              )}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {layers.faults && faultStatus && (
        <div className="fault-attribution">{faultStatus}</div>
      )}
    </div>
  );
}
