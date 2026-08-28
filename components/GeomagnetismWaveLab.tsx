"use client";

import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { readJsonResponse } from "@/lib/safeFetchJson";
import { GeomagnetismWaveGlobe } from "./GeomagnetismWaveGlobe";

const DAY = 86_400_000;
const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.16)", borderRadius: 16, background: "linear-gradient(145deg,#061322,#020914)", padding: 14 };
const control: React.CSSProperties = { width: "100%", background: "#071525", color: "white", border: "1px solid #1e3a52", borderRadius: 9, padding: 8, marginTop: 4 };

function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function daysAgo(days: number) { return dateKey(new Date(Date.now() - days * DAY)); }

type EventsPayload = { events?: EarthquakeEvent[]; error?: string };

export function GeomagnetismWaveLab() {
  const today = dateKey(new Date());
  const [startDate, setStartDate] = useState(() => daysAgo(3));
  const [endDate, setEndDate] = useState(today);
  const [minMagnitude, setMinMagnitude] = useState(3);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ starttime: startDate, endtime: endDate, minmagnitude: String(minMagnitude) });
    fetch(`/api/extractions/events?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await readJsonResponse<EventsPayload>(response);
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload.events ?? [];
    }).then((loaded) => {
      const sorted = loaded.slice().sort((a, b) => b.magnitude - a.magnitude || Date.parse(b.timeUtc) - Date.parse(a.timeUtc));
      setEvents(sorted);
      setSelectedEventId((current) => current && sorted.some((event) => event.id === current) ? current : sorted[0]?.id ?? "");
    }).catch((loadError) => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setEvents([]);
      setSelectedEventId("");
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los sismos del período.");
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [endDate, minMagnitude, startDate]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);

  return <div style={{ display: "grid", gap: 12, padding: "0 12px 22px" }}>
    <section style={panel}>
      <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>SEISMIC WAVE LAB · MAPA 3D</div>
      <h2 style={{ color: "white", margin: "5px 0 4px", fontSize: 20 }}>Selecciona los terremotos para visualizar sus ondas</h2>
      <p style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.55, margin: 0 }}>El catálogo usa el mismo endpoint sísmico de RDSISMOS. El selector principal define el evento de modo “Uno” y también permite añadirlo a “Varios” dentro del globo.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 8, marginTop: 10 }}>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Desde<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} style={control} /></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Hasta<input type="date" value={endDate} min={startDate} max={today} onChange={(event) => setEndDate(event.target.value)} style={control} /></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Magnitud mínima<select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={control}><option value={3}>M3.0+</option><option value={3.5}>M3.5+</option><option value={4.2}>M4.2+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option><option value={6.5}>M6.5+</option></select></label>
        <label style={{ color: "#cbd5e1", fontSize: 10 }}>Sismo seleccionado<select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} style={control}><option value="">— ninguno —</option>{events.slice(0, 1500).map((event) => <option key={event.id} value={event.id}>M{event.magnitude.toFixed(1)} · {new Date(event.timeUtc).toISOString().slice(0, 16)} · {event.place}</option>)}</select></label>
      </div>
      <div style={{ marginTop: 8, color: error ? "#fca5a5" : "#64748b", fontSize: 9 }}>{loading ? "Cargando catálogo sísmico…" : error ? error : `${events.length} sismos disponibles${selectedEvent ? ` · seleccionado M${selectedEvent.magnitude.toFixed(1)} ${selectedEvent.place}` : ""}`}</div>
    </section>

    <GeomagnetismWaveGlobe events={events} selectedEventId={selectedEventId} />
  </div>;
}
