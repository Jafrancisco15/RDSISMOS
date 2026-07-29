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
import type { CountryOutlook } from "@/lib/countryOutlook";
import type { CountryTarget, SeismicEvent } from "@/lib/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function FitOutlook({
  target,
  outlook,
  candidates,
}: {
  target: CountryTarget;
  outlook: CountryOutlook | null;
  candidates: SeismicEvent[];
}) {
  const map = useMap();
  useEffect(() => {
    const sourcePoints = outlook?.contributors.map(
      (item) => [item.sourceEvent.latitude, item.sourceEvent.longitude] as [number, number],
    ) ?? candidates.slice(0, 3).map(
      (event) => [event.latitude, event.longitude] as [number, number],
    );
    map.fitBounds([
      [target.latitude, target.longitude],
      ...sourcePoints,
    ], { padding: [35, 35], maxZoom: 4 });
  }, [candidates, map, outlook, target]);
  return null;
}

export function CountryOutlookMap({
  target,
  outlook,
  candidates,
}: {
  target: CountryTarget;
  outlook: CountryOutlook | null;
  candidates: SeismicEvent[];
}) {
  const analyzedIds = new Set(outlook?.contributors.map((item) => item.sourceEvent.id) ?? []);

  return (
    <MapContainer
      center={[target.latitude, target.longitude]}
      zoom={2}
      minZoom={2}
      className="country-outlook-map"
      worldCopyJump
    >
      <FitOutlook target={target} outlook={outlook} candidates={candidates} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Circle
        center={[target.latitude, target.longitude]}
        radius={target.radiusKm * 1_000}
        pathOptions={{
          color: "#22c55e",
          fillColor: outlook ? "#a855f7" : "#22c55e",
          fillOpacity: outlook ? 0.14 : 0.04,
          weight: 3,
          dashArray: outlook ? "10 7" : undefined,
        }}
      >
        <Tooltip permanent direction="top">
          {outlook ? `Área proyectada · ${outlook.probabilityPct}%` : target.name}
        </Tooltip>
        <Popup>
          <strong>{target.name}</strong>
          {outlook ? (
            <>
              <br />Probabilidad empírica combinada: {outlook.probabilityPct}%
              <br />Línea base: {outlook.baselinePct}%
              <br />Diferencia: {outlook.liftPct > 0 ? "+" : ""}{outlook.liftPct}%
              <br />Mayor concentración: {formatDate(outlook.peakStart)}–{formatDate(outlook.peakEnd)}
              <br />Vigilancia: hasta {formatDate(outlook.surveillanceEnd)}
              <br />Magnitud orientativa: M{outlook.magnitudeMin.toFixed(1)}–M{outlook.magnitudeMax.toFixed(1)}
            </>
          ) : <><br />Esperando evidencia suficiente.</>}
        </Popup>
      </Circle>

      {outlook?.contributors.map((contribution, index) => {
        const event = contribution.sourceEvent;
        const lineColor = contribution.liftPct > 0 ? "#f97316" : "#94a3b8";
        return (
          <Fragment key={event.id}>
            <CircleMarker
              center={[event.latitude, event.longitude]}
              radius={Math.max(7, Math.min(15, event.magnitude * 1.65))}
              pathOptions={{
                color: "#ffffff",
                fillColor: "#dc2626",
                fillOpacity: 0.94,
                weight: index === 0 ? 3 : 2,
              }}
            >
              <Tooltip direction="top">Origen M{event.magnitude.toFixed(1)} · {contribution.probabilityPct}%</Tooltip>
              <Popup>
                <strong>{event.place}</strong>
                <br />Evento precedente: M{event.magnitude.toFixed(1)} · {event.depthKm.toFixed(0)} km
                <br />Fecha: {formatDate(event.time)}
                <br />Recurrencia hacia {target.name}: {contribution.probabilityPct}%
                <br />Línea base: {contribution.baselinePct}%
                <br />Vigilancia: {formatDate(contribution.surveillanceStart)}–{formatDate(contribution.surveillanceEnd)}
                <br />Magnitud orientativa: M{contribution.magnitudeMin.toFixed(1)}–M{contribution.magnitudeMax.toFixed(1)}
              </Popup>
            </CircleMarker>
            <Polyline
              positions={[
                [event.latitude, event.longitude],
                [target.latitude, target.longitude],
              ]}
              pathOptions={{
                color: lineColor,
                opacity: index === 0 ? 0.8 : 0.48,
                weight: index === 0 ? 3 : 1.6,
                dashArray: "11 9",
              }}
            />
          </Fragment>
        );
      })}

      {candidates.filter((event) => !analyzedIds.has(event.id)).slice(0, 3).map((event) => (
        <CircleMarker
          key={`pending-${event.id}`}
          center={[event.latitude, event.longitude]}
          radius={7}
          pathOptions={{
            color: "#64748b",
            fillColor: "#94a3b8",
            fillOpacity: 0.65,
            weight: 2,
          }}
        >
          <Tooltip>{`En análisis · M${event.magnitude.toFixed(1)}`}</Tooltip>
          <Popup>
            <strong>{event.place}</strong>
            <br />M{event.magnitude.toFixed(1)} · pendiente de análisis automático.
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
