"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import { Sequence3D } from "./Sequence3D";
import styles from "./SequenceGlobeEntry.module.css";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });
const DAY_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function colorByDepth(depthKm: number) {
  if (depthKm < 35) return "#ff6b35";
  if (depthKm < 70) return "#ffd166";
  if (depthKm < 150) return "#7bdff2";
  if (depthKm < 300) return "#4ea8de";
  return "#4361ee";
}

function colorByTime(timeUtc: string, days: number) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(timeUtc)) / 86_400_000);
  const t = Math.max(0, Math.min(1, ageDays / Math.max(1, days)));
  const hue = 12 + t * 195;
  return `hsl(${hue.toFixed(0)} 88% 58%)`;
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export function SequenceGlobeEntry() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const analysisRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 640 });
  const [days, setDays] = useState(60);
  const [minMagnitude, setMinMagnitude] = useState(4);
  const [colorMode, setColorMode] = useState<"depth" | "time">("depth");
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [selected, setSelected] = useState<EarthquakeEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(470, Math.min(720, element.clientWidth * 0.76)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.28;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate]);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 8, lng: -35, altitude: 2.05 }, 900);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({
          starttime: daysAgo(days),
          endtime: new Date().toISOString(),
          minmagnitude: String(minMagnitude),
          eventtype: "earthquake",
          orderby: "time",
          limit: "500",
        });
        const response = await fetch(`/api/earthquakes?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as EarthquakePage & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setEvents(payload.events);
        setSelected((current) => current && payload.events.some((event) => event.id === current.id) ? current : null);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los terremotos recientes.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [days, minMagnitude]);

  const points = useMemo(() => events.map((event) => ({
    ...event,
    lat: event.latitude,
    lng: event.longitude,
    altitude: 0.012 + Math.max(0, Math.min(0.09, (event.magnitude - minMagnitude) * 0.022)),
    radius: 0.13 + Math.max(0, Math.min(0.42, (event.magnitude - minMagnitude) * 0.12)),
    color: colorMode === "depth" ? colorByDepth(event.depthKm) : colorByTime(event.timeUtc, days),
  })), [colorMode, days, events, minMagnitude]);

  function selectEvent(event: EarthquakeEvent) {
    setSelected(event);
    setAutoRotate(false);
    globeRef.current?.pointOfView({ lat: event.latitude, lng: event.longitude, altitude: 1.35 }, 850);
  }

  function openAnalysis() {
    analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · SECUENCIA 3D</span>
          <h1>Elige un terremoto desde el planeta</h1>
          <p>Explora la actividad reciente sobre una vista satelital clara de la Tierra. Toca un sismo para inspeccionarlo y luego baja al análisis volumétrico de la secuencia local.</p>
        </div>
        <div className={styles.count}><span>Eventos visibles</span><strong>{events.length.toLocaleString("es-DO")}</strong><small>{days} días · M{minMagnitude.toFixed(1)}+</small></div>
      </section>

      <section className={styles.controls}>
        <label><span>Ventana</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
        <label><span>Magnitud mínima</span><select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label>
        <label><span>Color</span><select value={colorMode} onChange={(event) => setColorMode(event.target.value as "depth" | "time")}><option value="depth">Profundidad</option><option value="time">Antigüedad</option></select></label>
        <label className={styles.toggle}><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span>Rotación suave</span></label>
      </section>

      <section className={styles.globeCard}>
        <div className={styles.legend}>
          {colorMode === "depth" ? <><span><i className={styles.shallow} /> &lt;35 km</span><span><i className={styles.mid} /> 35–150 km</span><span><i className={styles.deep} /> &gt;150 km</span></> : <span>Rojo = más reciente · azul = más antiguo</span>}
        </div>
        <div className={styles.globe} ref={containerRef}>
          {loading && <div className={styles.loading}>Cargando actividad sísmica reciente…</div>}
          {!loading && error && <div className={styles.error}>{error}</div>}
          {!error && (
            <Globe
              ref={globeRef}
              width={size.width}
              height={size.height}
              globeImageUrl={DAY_TEXTURE}
              backgroundColor="rgba(221,235,244,0.08)"
              atmosphereColor="#8ed7f7"
              atmosphereAltitude={0.13}
              showGraticules={false}
              pointsData={points}
              pointLat="lat"
              pointLng="lng"
              pointAltitude="altitude"
              pointRadius="radius"
              pointColor="color"
              pointLabel={(point: object) => {
                const event = point as EarthquakeEvent;
                return `<div class=\"globe-tooltip\"><strong>M${event.magnitude.toFixed(1)} · ${event.place}</strong><span>${formatUtc(event.timeUtc)} UTC</span><small>${event.depthKm.toFixed(0)} km de profundidad</small></div>`;
              }}
              onPointClick={(point: object) => selectEvent(point as EarthquakeEvent)}
              pointsTransitionDuration={450}
              enablePointerInteraction
            />
          )}
        </div>

        {selected ? (
          <aside className={styles.selectedCard}>
            <div><span>Evento seleccionado</span><h2>M{selected.magnitude.toFixed(1)} · {selected.place}</h2></div>
            <div className={styles.selectedGrid}><span><b>{selected.depthKm.toFixed(1)} km</b>Profundidad</span><span><b>{formatUtc(selected.timeUtc)}</b>UTC</span><span><b>{selected.latitude.toFixed(2)}, {selected.longitude.toFixed(2)}</b>Coordenadas</span></div>
            <button type="button" onClick={openAnalysis}>Abrir análisis de Secuencia 3D ↓</button>
            <small>El análisis local inferior permite escoger este u otro evento de referencia, ajustar radio, profundidad, tiempo, Slab2, fallas y Coulomb.</small>
          </aside>
        ) : <div className={styles.hint}>Toca cualquier punto del globo para seleccionar un terremoto.</div>}
      </section>

      <div ref={analysisRef} className={styles.analysisAnchor}>
        <Sequence3D />
      </div>
    </main>
  );
}
