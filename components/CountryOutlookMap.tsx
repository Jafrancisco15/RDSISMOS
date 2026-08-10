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
import {
  formatProbability,
  formatSignedPercentagePoints,
  ParameterLabel,
  PROJECTION_PARAMETER_HELP,
} from "./ProjectionInfo";

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
          {outlook ? `Área proyectada · ${formatProbability(outlook.probabilityPct)}` : target.name}
        </Tooltip>
        <Popup>
          <strong>{target.name}</strong>
          {outlook ? (
            <div style={{ marginTop: 7, lineHeight: 1.6 }}>
              <div><ParameterLabel label="Probabilidad empírica" help={PROJECTION_PARAMETER_HELP.probability} />: <strong>{formatProbability(outlook.probabilityPct)}</strong></div>
              <div><ParameterLabel label="Línea base" help={PROJECTION_PARAMETER_HELP.baseline} />: {formatProbability(outlook.baselinePct)}</div>
              <div><ParameterLabel label="Exceso" help={PROJECTION_PARAMETER_HELP.lift} />: {formatSignedPercentagePoints(outlook.liftPct)}</div>
              <div><ParameterLabel label="Calidad de evidencia" help={PROJECTION_PARAMETER_HELP.confidence} />: {outlook.confidencePct.toFixed(0)}%</div>
              <div><ParameterLabel label="Mayor concentración" help={PROJECTION_PARAMETER_HELP.window} />: {formatDate(outlook.peakStart)}–{formatDate(outlook.peakEnd)}</div>
              <div>Vigilancia: hasta {formatDate(outlook.surveillanceEnd)}</div>
              <div><ParameterLabel label="Magnitud orientativa" help={PROJECTION_PARAMETER_HELP.magnitude} />: M{outlook.magnitudeMin.toFixed(1)}–M{outlook.magnitudeMax.toFixed(1)}</div>
              <p style={{ marginBottom: 0 }}>La calidad de evidencia no es una segunda probabilidad. La proyección combina los precedentes activos mostrados en rojo.</p>
            </div>
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
              <Tooltip direction="top">Origen M{event.magnitude.toFixed(1)} · {formatProbability(contribution.probabilityPct)}</Tooltip>
              <Popup>
                <strong>{event.place}</strong>
                <div style={{ marginTop: 7, lineHeight: 1.6 }}>
                  <div>Evento precedente: M{event.magnitude.toFixed(1)} · {event.depthKm.toFixed(0)} km</div>
                  <div>Fecha: {formatDate(event.time)}</div>
                  <div><ParameterLabel label="Probabilidad hacia el país" help={PROJECTION_PARAMETER_HELP.probability} />: <strong>{formatProbability(contribution.probabilityPct)}</strong></div>
                  <div><ParameterLabel label="Línea base" help={PROJECTION_PARAMETER_HELP.baseline} />: {formatProbability(contribution.baselinePct)}</div>
                  <div><ParameterLabel label="Exceso" help={PROJECTION_PARAMETER_HELP.lift} />: {formatSignedPercentagePoints(contribution.liftPct)}</div>
                  <div><ParameterLabel label="Calidad de evidencia" help={PROJECTION_PARAMETER_HELP.confidence} />: {contribution.confidencePct.toFixed(0)}%</div>
                  <div><ParameterLabel label="Análogos" help={PROJECTION_PARAMETER_HELP.analogs} />: {contribution.analogHits} coincidencias de {contribution.analogsEvaluated} evaluados</div>
                  <div>Vigilancia: {formatDate(contribution.surveillanceStart)}–{formatDate(contribution.surveillanceEnd)}</div>
                  <div>Magnitud orientativa: M{contribution.magnitudeMin.toFixed(1)}–M{contribution.magnitudeMax.toFixed(1)}</div>
                  <p style={{ marginBottom: 0 }}>Esta proyección se originó en este sismo precedente. Para cumplirse, el evento observado debe entrar simultáneamente en zona, tiempo y magnitud.</p>
                </div>
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
