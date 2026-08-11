"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { ScopeProjectionResponse, ScopeProjectionZone } from "@/lib/scopeProjection";

const EARTH_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg";
const DEGREE_KM = 111.2;

interface RenderPoint {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
  label: string;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scopeColor(index: number, alpha = 1) {
  if (index >= 80) return `rgba(251,113,133,${alpha})`;
  if (index >= 60) return `rgba(251,146,60,${alpha})`;
  if (index >= 40) return `rgba(250,204,21,${alpha})`;
  if (index >= 20) return `rgba(45,212,191,${alpha})`;
  return `rgba(125,211,252,${alpha})`;
}

function minutes(value: number | null) {
  if (value === null) return "—";
  return `${value.toFixed(value < 10 ? 1 : 0)} min`;
}

function zoneLabel(zone: ScopeProjectionZone) {
  return `<div class="globe-tooltip"><strong>Scope ${zone.scopeIndex}/100 · ${escapeHtml(zone.network)}.${escapeHtml(zone.station)}</strong><span>${escapeHtml(zone.siteName)}</span><small>PGV ${zone.pgvMmS.toExponential(2)} mm/s · cobertura ${zone.coveragePct}% · soporte ${zone.supportStations} estación(es)</small><small>P ${minutes(zone.pMinutes)} · S ${minutes(zone.sMinutes)} · radio visual ${zone.radiusKm} km</small><small>Respuesta dinámica observada; no es probabilidad de un nuevo terremoto.</small></div>`;
}

export function ScopeProjectionGlobe({ data }: { data: ScopeProjectionResponse }) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 960, height: 650 });
  const [showMetadata, setShowMetadata] = useState(true);
  const [showObserved, setShowObserved] = useState(true);
  const [showZones, setShowZones] = useState(true);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(520, Math.min(780, element.clientWidth * 0.7)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
    }
    globeRef.current?.pointOfView({
      lat: data.source.latitude,
      lng: data.source.longitude,
      altitude: 2.15,
    }, 850);
  }, [data.generatedAt, data.source.latitude, data.source.longitude]);

  const zoneHalos = useMemo<RenderPoint[]>(() => showZones
    ? data.zones.map((zone) => ({
        id: `zone:${zone.id}`,
        lat: zone.latitude,
        lng: zone.longitude,
        altitude: 0.006,
        radius: clamp(zone.radiusKm / DEGREE_KM, 0.55, 5.8),
        color: scopeColor(zone.scopeIndex, 0.20),
        label: zoneLabel(zone),
      }))
    : [], [data.zones, showZones]);

  const metadataPoints = useMemo<RenderPoint[]>(() => showMetadata
    ? data.stations.map((station) => ({
        id: `metadata:${station.network}:${station.station}`,
        lat: station.latitude,
        lng: station.longitude,
        altitude: 0.012,
        radius: 0.055,
        color: "rgba(125,211,252,.72)",
        label: `<div class="globe-tooltip"><strong>EarthScope · ${escapeHtml(station.network)}.${escapeHtml(station.station)}</strong><span>${escapeHtml(station.siteName)}</span><small>${station.distanceKm.toFixed(0)} km del evento · metadata FDSN</small></div>`,
      }))
    : [], [data.stations, showMetadata]);

  const observedPoints = useMemo<RenderPoint[]>(() => showObserved
    ? data.traces.map((trace) => {
        const zone = data.zones.find((candidate) => candidate.network === trace.network && candidate.station === trace.station);
        const quantitative = trace.quantitative && zone;
        return {
          id: `observed:${trace.network}:${trace.station}:${trace.channel}`,
          lat: trace.latitude,
          lng: trace.longitude,
          altitude: quantitative ? 0.075 + zone.scopeIndex / 850 : 0.045,
          radius: quantitative ? 0.12 + zone.scopeIndex / 260 : 0.11,
          color: quantitative ? scopeColor(zone.scopeIndex, 1) : "rgba(216,180,254,.88)",
          label: quantitative
            ? zoneLabel(zone)
            : `<div class="globe-tooltip"><strong>${escapeHtml(trace.network)}.${escapeHtml(trace.station)} · ${escapeHtml(trace.channel)}</strong><span>Traza EarthScope observada</span><small>${trace.maxAbs.toExponential(3)} ${escapeHtml(trace.units)} · ${escapeHtml(trace.calibration)}</small><small>No entra al Índice Scope cuantitativo porque la amplitud no es velocidad corregida comparable.</small></div>`,
        };
      })
    : [], [data.traces, data.zones, showObserved]);

  const sourcePoint = useMemo<RenderPoint>(() => ({
    id: "scope-source",
    lat: data.source.latitude,
    lng: data.source.longitude,
    altitude: 0.16,
    radius: 0.52,
    color: "#facc15",
    label: `<div class="globe-tooltip"><strong>Evento fuente · M${data.source.magnitude.toFixed(1)}</strong><span>${escapeHtml(data.source.place)}</span><small>${new Date(data.source.timeUtc).toLocaleString("es-DO", { timeZone: "UTC" })} UTC · ${data.source.depthKm.toFixed(0)} km</small></div>`,
  }), [data.source]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 520, position: "relative" }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl={EARTH_TEXTURE}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#69c7ff"
        atmosphereAltitude={0.18}
        showGraticules
        pointsData={[...zoneHalos, ...metadataPoints, ...observedPoints, sourcePoint]}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(point) => String((point as RenderPoint).label)}
        pointsTransitionDuration={400}
        enablePointerInteraction
      />

      <div style={{
        position: "absolute",
        left: 12,
        top: 12,
        maxWidth: 455,
        padding: "10px 12px",
        border: "1px solid rgba(125,211,252,.28)",
        borderRadius: 12,
        background: "rgba(7,16,24,.87)",
        backdropFilter: "blur(10px)",
        color: "#e8f1f5",
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        <strong>Scope Projection · EarthScope</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <button type="button" onClick={() => setShowZones((value) => !value)} style={{ opacity: showZones ? 1 : .5 }}>Zonas Scope</button>
          <button type="button" onClick={() => setShowObserved((value) => !value)} style={{ opacity: showObserved ? 1 : .5 }}>Trazas observadas</button>
          <button type="button" onClick={() => setShowMetadata((value) => !value)} style={{ opacity: showMetadata ? 1 : .5 }}>Estaciones FDSN</button>
        </div>
        <div style={{ marginTop: 7, color: "#aebfca" }}>
          <span style={{ color: "#fb7185" }}>● Scope alto</span> · <span style={{ color: "#facc15" }}>● intermedio</span> · <span style={{ color: "#7dd3fc" }}>● bajo</span><br />
          <span style={{ color: "#d8b4fe" }}>● traza no comparable</span> · <span style={{ color: "#facc15" }}>● evento fuente</span>
        </div>
        <div style={{ marginTop: 6, color: "#fde68a" }}>El halo representa soporte espacial aproximado de una observación instrumental, no una zona de ocurrencia futura.</div>
      </div>

      <div style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        maxWidth: 370,
        padding: "9px 11px",
        border: "1px solid rgba(125,211,252,.28)",
        borderRadius: 12,
        background: "rgba(7,16,24,.87)",
        color: "#dbeafe",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "none",
      }}>
        <strong>{data.quantitativeTraceCount} estaciones cuantitativas</strong><br />
        {data.observedTraceCount} trazas observadas · {data.stationMetadataCount} estaciones metadata<br />
        <span style={{ color: "#aebfca" }}>P/S: EarthScope {data.travelTimeModel} · modelo {data.model}</span>
      </div>
    </div>
  );
}
