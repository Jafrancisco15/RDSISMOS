"use client";

import { divIcon } from "leaflet";
import { CircleMarker, GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import type { GeoFeatureCollection, PlateMapEvent } from "@/lib/plateDynamics";
import { destinationPoint, type TectonicVector } from "@/lib/tectonicVectors";
import styles from "./PlateDynamicsDashboard.module.css";

type Pair = [number, number];

function boundaryColor(type: unknown) {
  if (type === "subduction") return "#ef4444";
  if (type === "divergent") return "#22c55e";
  if (type === "transform") return "#f59e0b";
  if (type === "convergent") return "#f97316";
  return "#38bdf8";
}

function vectorColor(speed: number) {
  if (speed >= 80) return "#f43f5e";
  if (speed >= 40) return "#f59e0b";
  return "#22d3ee";
}

function vectorEnd(vector: TectonicVector) {
  const displayDistanceKm = Math.max(180, Math.min(1200, vector.speedMmYr * 12));
  return destinationPoint(vector.latitude, vector.longitude, vector.bearingDeg, displayDistanceKm);
}

function vectorIcon(bearingDeg: number, color: string) {
  return divIcon({
    className: styles.vectorArrowIcon,
    html: `<span style="color:${color};transform:rotate(${bearingDeg - 90}deg)">➤</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function interactionLabel(type: unknown) {
  if (type === "subduction") return { glyph: "▼", label: "Subducción", color: "#ef4444" };
  if (type === "divergent") return { glyph: "↔", label: "Divergencia", color: "#22c55e" };
  if (type === "transform") return { glyph: "⇆", label: "Deslizamiento transformante", color: "#f59e0b" };
  if (type === "convergent") return { glyph: "→←", label: "Convergencia", color: "#f97316" };
  return null;
}

function interactionIcon(type: unknown) {
  const item = interactionLabel(type);
  if (!item) return null;
  return divIcon({
    className: styles.interactionGlyph,
    html: `<span style="border-color:${item.color};color:${item.color}">${item.glyph}</span>`,
    iconSize: [30, 24],
    iconAnchor: [15, 12],
  });
}

function isPair(value: unknown): value is Pair {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function toPairs(value: unknown) {
  if (!Array.isArray(value)) return [] as Pair[];
  return value.filter(isPair).map((pair) => [Number(pair[0]), Number(pair[1])] as Pair);
}

function guidePoints(boundaries: GeoFeatureCollection) {
  const guides: Array<{ id: string; latitude: number; longitude: number; type: unknown; name: string }> = [];
  for (let featureIndex = 0; featureIndex < boundaries.features.length; featureIndex += 1) {
    const feature = boundaries.features[featureIndex];
    if (!interactionLabel(feature.properties?.boundaryType)) continue;
    const geometry = feature.geometry;
    let lines: Pair[][] = [];
    if (geometry?.type === "LineString") lines = [toPairs(geometry.coordinates)];
    if (geometry?.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      lines = geometry.coordinates.map(toPairs);
    }
    const line = lines.sort((a, b) => b.length - a.length)[0];
    if (!line || line.length < 2) continue;
    const [longitude, latitude] = line[Math.floor(line.length / 2)];
    guides.push({
      id: String(feature.id ?? `guide-${featureIndex}`),
      latitude,
      longitude,
      type: feature.properties?.boundaryType,
      name: String(feature.properties?.name ?? "Límite tectónico"),
    });
  }
  if (guides.length <= 140) return guides;
  const stride = Math.ceil(guides.length / 140);
  return guides.filter((_, index) => index % stride === 0);
}

export function PlateDynamicsMap({
  polygons,
  boundaries,
  events,
  vectors,
  showVectors,
  showBoundaryGuides,
  selectedPlateId,
  onSelectPlate,
}: {
  polygons: GeoFeatureCollection;
  boundaries: GeoFeatureCollection;
  events: PlateMapEvent[];
  vectors: TectonicVector[];
  showVectors: boolean;
  showBoundaryGuides: boolean;
  selectedPlateId: string | null;
  onSelectPlate: (plateId: string) => void;
}) {
  const guides = showBoundaryGuides ? guidePoints(boundaries) : [];

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
            weight: showBoundaryGuides ? 2.1 : 1.5,
            opacity: showBoundaryGuides ? 1 : 0.88,
            dashArray: feature?.properties?.boundaryType === "transform" ? "5 5" : undefined,
          })}
        />

        {showBoundaryGuides && guides.map((guide) => {
          const icon = interactionIcon(guide.type);
          const meta = interactionLabel(guide.type);
          if (!icon || !meta) return null;
          return (
            <Marker key={`guide-${guide.id}`} position={[guide.latitude, guide.longitude]} icon={icon} interactive>
              <Tooltip direction="top">{meta.label} · {guide.name}</Tooltip>
            </Marker>
          );
        })}

        {showVectors && vectors.map((vector) => {
          const end = vectorEnd(vector);
          const color = vectorColor(vector.speedMmYr);
          const selected = selectedPlateId === null || selectedPlateId === vector.plateId;
          return (
            <Polyline
              key={`vector-${vector.plateId}`}
              positions={[[vector.latitude, vector.longitude], [end.latitude, end.longitude]]}
              pathOptions={{ color, weight: selected ? 3 : 1.4, opacity: selected ? 0.9 : 0.18 }}
              eventHandlers={{ click: () => onSelectPlate(vector.plateId) }}
            >
              <Tooltip direction="top">
                {vector.plateName} · {vector.speedMmYr.toFixed(1)} mm/año · azimut {vector.bearingDeg.toFixed(0)}°
              </Tooltip>
            </Polyline>
          );
        })}

        {showVectors && vectors.map((vector) => {
          const end = vectorEnd(vector);
          const color = vectorColor(vector.speedMmYr);
          const selected = selectedPlateId === null || selectedPlateId === vector.plateId;
          if (!selected) return null;
          return (
            <Marker
              key={`vector-head-${vector.plateId}`}
              position={[end.latitude, end.longitude]}
              icon={vectorIcon(vector.bearingDeg, color)}
              eventHandlers={{ click: () => onSelectPlate(vector.plateId) }}
            >
              <Popup>
                <strong>{vector.plateName}</strong>
                <div>Velocidad media: {vector.speedMmYr.toFixed(1)} mm/año</div>
                <div>Dirección: {vector.bearingDeg.toFixed(0)}°</div>
                <div>Estimación cinemática por reconstrucción 0–{vector.intervalMa.toFixed(0)} Ma.</div>
                <small>La longitud de la flecha está amplificada para visualización.</small>
              </Popup>
            </Marker>
          );
        })}

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
        {showVectors && <span><b className={styles.legendArrow}>➤</b> Movimiento de placa</span>}
        {showBoundaryGuides && <span><b className={styles.legendGlyph}>↔</b> Interacción del borde</span>}
      </div>
    </div>
  );
}
