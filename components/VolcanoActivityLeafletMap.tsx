"use client";

import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { VolcanoActivityMapProps } from "./VolcanoActivityMap";

function volcanoColor(weekly: string | null | undefined, alert: string | null | undefined, colorCode: string | null | undefined) {
  const text = `${weekly ?? ""} ${alert ?? ""} ${colorCode ?? ""}`.toLowerCase();
  if (/(red|warning|new eruptive|continuing eruptive)/.test(text)) return "#ef4444";
  if (/(orange|watch|new unrest)/.test(text)) return "#f97316";
  if (/(yellow|advisory|continuing unrest|activity)/.test(text)) return "#eab308";
  return "#94a3b8";
}

function quakeColor(depthKm: number) {
  if (depthKm > 100) return "#8b5cf6";
  if (depthKm > 30) return "#f97316";
  return "#ef4444";
}

function FocusSelected({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (latitude === null || longitude === null) return;
    map.flyTo([latitude, longitude], Math.max(5, map.getZoom()), { duration: 0.8 });
  }, [latitude, longitude, map]);
  return null;
}

export function VolcanoActivityLeafletMap({ volcanoes, selectedId, events, onVolcanoSelect }: VolcanoActivityMapProps) {
  const selected = volcanoes.find((volcano) => volcano.id === selectedId) ?? null;
  return <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(249,115,22,.22)", background: "#07131f" }}>
    <MapContainer center={[10, -15]} zoom={2} minZoom={2} worldCopyJump style={{ height: "clamp(480px,68vh,720px)", width: "100%" }}>
      <TileLayer
        attribution="Tiles © Esri · Volcanoes © Smithsonian GVP · Earthquakes © USGS ComCat"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={18}
      />
      <FocusSelected latitude={selected?.latitude ?? null} longitude={selected?.longitude ?? null} />

      {selected && [10, 30, 100, 200].map((radiusKm) => <Circle
        key={radiusKm}
        center={[selected.latitude, selected.longitude]}
        radius={radiusKm * 1000}
        pathOptions={{ color: radiusKm <= 30 ? "#fb923c" : "#38bdf8", weight: 1, opacity: 0.55, fillOpacity: 0 }}
      />)}

      {volcanoes.slice(0, 1800).map((volcano) => {
        const active = volcano.id === selectedId;
        const color = volcanoColor(volcano.weeklyReportType, volcano.usgsAlertLevel, volcano.usgsColorCode);
        return <CircleMarker
          key={volcano.id}
          center={[volcano.latitude, volcano.longitude]}
          radius={active ? 9 : volcano.weeklyReportType || volcano.usgsAlertLevel ? 6 : 3.5}
          eventHandlers={{ click: () => onVolcanoSelect(volcano.id) }}
          pathOptions={{ color: active ? "#ffffff" : color, fillColor: color, fillOpacity: active ? 1 : 0.78, weight: active ? 3 : 1 }}
        >
          <Tooltip direction="top" opacity={0.94}>{volcano.name} · {volcano.country}</Tooltip>
          <Popup>
            <strong>{volcano.name}</strong><br />
            {volcano.country}<br />
            {volcano.region}<br />
            {volcano.volcanoNumber ? <>GVP #{volcano.volcanoNumber}<br /></> : null}
            {volcano.elevationM !== null ? <>Elevación: {volcano.elevationM.toFixed(0)} m<br /></> : null}
            {volcano.weeklyReportType ? <>GVP Weekly: {volcano.weeklyReportType}<br /></> : null}
            {volcano.usgsAlertLevel || volcano.usgsColorCode ? <>USGS: {volcano.usgsAlertLevel ?? ""} {volcano.usgsColorCode ?? ""}</> : null}
          </Popup>
        </CircleMarker>;
      })}

      {events.slice(0, 5000).map((event) => {
        const color = quakeColor(event.depthKm);
        const radius = Math.max(3, Math.min(11, 2 + Math.pow(Math.max(0, event.magnitude + 0.5), 1.15)));
        return <CircleMarker
          key={event.id}
          center={[event.latitude, event.longitude]}
          radius={radius}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.72, weight: 1 }}
        >
          <Tooltip direction="top" opacity={0.94}>M{event.magnitude.toFixed(1)} · {event.depthKm.toFixed(1)} km</Tooltip>
          <Popup>
            <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><br />
            {new Date(event.timeUtc).toLocaleString("es-DO")}<br />
            Profundidad: {event.depthKm.toFixed(1)} km
          </Popup>
        </CircleMarker>;
      })}
    </MapContainer>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "9px 11px", color: "#cbd5e1", fontSize: 10, background: "rgba(2,8,18,.96)" }}>
      <span><b style={{ color: "#ef4444" }}>●</b> eruptivo / alerta alta</span>
      <span><b style={{ color: "#f97316" }}>●</b> unrest / watch</span>
      <span><b style={{ color: "#eab308" }}>●</b> advisory / actividad</span>
      <span><b style={{ color: "#94a3b8" }}>●</b> catálogo GVP</span>
      <span><b style={{ color: "#ef4444" }}>●</b> sismo somero</span>
      <span>{volcanoes.length} volcanes · {events.length} sismos del volcán seleccionado</span>
    </div>
  </div>;
}
