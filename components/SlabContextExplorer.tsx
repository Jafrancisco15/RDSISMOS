"use client";

import { useCallback, useEffect, useState } from "react";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import { tectonicRegimeLabel, type Slab2Context } from "@/lib/slab2";

interface SlabContextResponse {
  context: Slab2Context;
  methodology: string;
}

type RecentDays = 7 | 30 | 90 | 365;

function startDateFor(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

async function readJson<T>(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

export function SlabContextExplorer() {
  const [days, setDays] = useState<RecentDays>(90);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [selected, setSelected] = useState<EarthquakeEvent | null>(null);
  const [context, setContext] = useState<Slab2Context | null>(null);
  const [methodology, setMethodology] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingContext, setLoadingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspect = useCallback(async (event: EarthquakeEvent) => {
    setSelected(event);
    setLoadingContext(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: String(event.latitude),
        lon: String(event.longitude),
        depth: String(event.depthKm),
      });
      const response = await fetch(`/api/slab-context?${params}`, { cache: "no-store" });
      const payload = await readJson<SlabContextResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setContext(payload.context);
      setMethodology(payload.methodology);
    } catch (loadError) {
      setContext(null);
      setError(loadError instanceof Error ? loadError.message : "No fue posible consultar Slab2.");
    } finally {
      setLoadingContext(false);
    }
  }, []);

  const loadEvents = useCallback(async (range: RecentDays, autoSelect = false) => {
    setLoadingEvents(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        starttime: startDateFor(range),
        endtime: new Date().toISOString().slice(0, 10),
        minmagnitude: "5.9",
        eventtype: "earthquake",
        orderby: "time",
        limit: "80",
      });
      const response = await fetch(`/api/earthquakes?${params}`, { cache: "no-store" });
      const payload = await readJson<EarthquakePage & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setEvents(payload.events);
      if (autoSelect && payload.events[0]) void inspect(payload.events[0]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar sismos recientes.");
    } finally {
      setLoadingEvents(false);
    }
  }, [inspect]);

  useEffect(() => {
    void loadEvents(90, true);
  }, [loadEvents]);

  function changeRange(range: RecentDays) {
    setDays(range);
    void loadEvents(range, false);
  }

  const offset = context?.depthOffsetKm;
  const offsetText = offset === null || offset === undefined
    ? "—"
    : offset >= 0
      ? `${offset.toFixed(1)} km por debajo de la superficie Slab2`
      : `${Math.abs(offset).toFixed(1)} km por encima de la superficie Slab2`;

  return (
    <section style={{ maxWidth: 1320, margin: "18px auto 36px", padding: "0 16px" }}>
      <div style={{ border: "1px solid rgba(56,189,248,.22)", borderRadius: 22, background: "rgba(15,23,42,.88)", overflow: "hidden" }}>
        <header style={{ padding: 20, borderBottom: "1px solid rgba(148,163,184,.16)" }}>
          <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 800, letterSpacing: ".12em" }}>USGS SLAB2 · CONTEXTO HIPOCENTRAL 3D</span>
          <h2 style={{ margin: "7px 0", fontSize: "clamp(1.3rem,4vw,2rem)" }}>¿Dónde ocurrió realmente el sismo respecto a la placa subducida?</h2>
          <p style={{ margin: 0, color: "#a8b6c8", lineHeight: 1.55 }}>
            La estadística principal de GPlates asigna eventos a polígonos vistos desde la superficie. Este inspector usa profundidad + Slab2 para distinguir interfaz, interior de la losa y placa superior.
          </p>
        </header>

        <div style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {([7, 30, 90, 365] as RecentDays[]).map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => changeRange(range)}
              disabled={loadingEvents}
              style={{ border: range === days ? "1px solid #38bdf8" : "1px solid rgba(148,163,184,.28)", borderRadius: 10, background: range === days ? "rgba(56,189,248,.12)" : "transparent", color: "#e2e8f0", padding: "8px 11px" }}
            >
              {range === 365 ? "1 año" : `${range} días`}
            </button>
          ))}
        </div>

        <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 8, maxHeight: 280, overflow: "auto" }}>
          {events.map((event) => (
            <button
              type="button"
              key={event.id}
              onClick={() => void inspect(event)}
              style={{ textAlign: "left", border: selected?.id === event.id ? "1px solid #38bdf8" : "1px solid rgba(148,163,184,.18)", borderRadius: 12, background: selected?.id === event.id ? "rgba(56,189,248,.10)" : "rgba(2,6,23,.38)", color: "#e2e8f0", padding: 11 }}
            >
              <strong>M{event.magnitude.toFixed(1)}</strong>
              <div style={{ fontSize: 13, marginTop: 4 }}>{event.place}</div>
              <small style={{ color: "#94a3b8" }}>{event.depthKm.toFixed(0)} km · {formatDate(event.timeUtc)} UTC</small>
            </button>
          ))}
        </div>

        {error && <div style={{ margin: 16, padding: 12, borderRadius: 12, background: "rgba(239,68,68,.10)", color: "#fecaca" }}>{error}</div>}
        {loadingContext && <div style={{ padding: 18, color: "#bae6fd" }}>Interpolando la geometría Slab2 alrededor del hipocentro…</div>}

        {selected && context && !loadingContext && (
          <div style={{ padding: 18, borderTop: "1px solid rgba(148,163,184,.16)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
              <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.48)" }}><small style={{ color: "#94a3b8" }}>Clasificación 3D</small><strong style={{ display: "block", marginTop: 5 }}>{tectonicRegimeLabel(context.regime)}</strong><small>confianza {context.confidence}</small></article>
              <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.48)" }}><small style={{ color: "#94a3b8" }}>Hipocentro USGS</small><strong style={{ display: "block", marginTop: 5 }}>{selected.depthKm.toFixed(1)} km</strong><small>{selected.latitude.toFixed(2)}°, {selected.longitude.toFixed(2)}°</small></article>
              <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.48)" }}><small style={{ color: "#94a3b8" }}>Superficie Slab2</small><strong style={{ display: "block", marginTop: 5 }}>{context.slabDepthKm === null ? "—" : `${context.slabDepthKm.toFixed(1)} km`}</strong><small>punto próximo {context.nearestPointKm === null ? "—" : `${context.nearestPointKm.toFixed(1)} km`}</small></article>
              <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.48)" }}><small style={{ color: "#94a3b8" }}>Posición relativa</small><strong style={{ display: "block", marginTop: 5 }}>{offsetText}</strong><small>distancia 3D aprox. {context.distance3dKm === null ? "—" : `${context.distance3dKm.toFixed(1)} km`}</small></article>
              <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.48)" }}><small style={{ color: "#94a3b8" }}>Geometría local</small><strong style={{ display: "block", marginTop: 5 }}>dip {context.dipDeg?.toFixed(0) ?? "—"}° · strike {context.strikeDeg?.toFixed(0) ?? "—"}°</strong><small>espesor {context.thicknessKm?.toFixed(0) ?? "—"} km · incertidumbre {context.uncertaintyKm?.toFixed(0) ?? "—"} km</small></article>
            </div>
            <p style={{ color: "#a8b6c8", lineHeight: 1.55, marginBottom: 4 }}>{context.warning ?? methodology}</p>
            <small style={{ color: "#64748b" }}>{context.citation} · acceso: {context.access}. La clasificación es geométrica y no prueba qué falla específica rompió.</small>
          </div>
        )}
      </div>
    </section>
  );
}
