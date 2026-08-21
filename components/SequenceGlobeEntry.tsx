"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import { Sequence3D } from "./Sequence3D";
import styles from "./SequenceGlobeEntry.module.css";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });
const DAY_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const DAY_MS = 86_400_000;
const MAX_LOCAL_EVENTS = 1500;

type Mode = "global" | "sequence";
type ColorMode = "depth" | "time";
type GlobeEvent = EarthquakeEvent & {
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
  sequence: boolean;
};

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function colorByDepth(depthKm: number) {
  if (depthKm < 35) return "#ff5d2e";
  if (depthKm < 70) return "#ffc857";
  if (depthKm < 150) return "#51c7e8";
  if (depthKm < 300) return "#3588d4";
  return "#3f51d7";
}

function colorByTime(timeUtc: string, minimumMs: number, maximumMs: number) {
  const time = Date.parse(timeUtc);
  const fraction = maximumMs > minimumMs ? Math.max(0, Math.min(1, (time - minimumMs) / (maximumMs - minimumMs))) : 1;
  const hue = 215 - fraction * 205;
  return `hsl(${hue.toFixed(0)} 88% 56%)`;
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

async function readPage(response: Response) {
  const payload = await response.json() as EarthquakePage & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

export function SequenceGlobeEntry() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 650 });
  const [mode, setMode] = useState<Mode>("global");
  const [days, setDays] = useState(60);
  const [minMagnitude, setMinMagnitude] = useState(4);
  const [colorMode, setColorMode] = useState<ColorMode>("depth");
  const [globalEvents, setGlobalEvents] = useState<EarthquakeEvent[]>([]);
  const [sequenceEvents, setSequenceEvents] = useState<EarthquakeEvent[]>([]);
  const [selected, setSelected] = useState<EarthquakeEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [beforeDays, setBeforeDays] = useState(2);
  const [afterDays, setAfterDays] = useState(10);
  const [radiusKm, setRadiusKm] = useState(150);
  const [sequenceMinMagnitude, setSequenceMinMagnitude] = useState(1);
  const [depthExaggeration, setDepthExaggeration] = useState(1.6);
  const [timelinePct, setTimelinePct] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({
      width: Math.max(320, element.clientWidth),
      height: Math.max(500, Math.min(760, element.clientWidth * 0.78)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotate && mode === "global";
    controls.autoRotateSpeed = 0.26;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate, mode]);

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
        const payload = await readPage(await fetch(`/api/earthquakes?${params}`, { cache: "no-store", signal: controller.signal }));
        setGlobalEvents(payload.events);
        if (mode === "global") setSelected((current) => current && payload.events.some((event) => event.id === current.id) ? current : null);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los terremotos recientes.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [days, minMagnitude, mode]);

  useEffect(() => {
    if (!playing || mode !== "sequence") return;
    const timer = window.setInterval(() => {
      setTimelinePct((current) => {
        if (current >= 100) {
          setPlaying(false);
          return 100;
        }
        return Math.min(100, current + 1.25);
      });
    }, 130);
    return () => window.clearInterval(timer);
  }, [playing, mode]);

  async function loadSequence(anchor: EarthquakeEvent) {
    setSelected(anchor);
    setMode("sequence");
    setAutoRotate(false);
    setPlaying(false);
    setTimelinePct(100);
    setSequenceLoading(true);
    setError(null);
    globeRef.current?.pointOfView({ lat: anchor.latitude, lng: anchor.longitude, altitude: 0.72 }, 900);
    try {
      const anchorMs = Date.parse(anchor.timeUtc);
      const starttime = new Date(anchorMs - beforeDays * DAY_MS).toISOString();
      const endtime = new Date(Math.min(Date.now(), anchorMs + afterDays * DAY_MS)).toISOString();
      const base = new URLSearchParams({
        starttime,
        endtime,
        minmagnitude: String(sequenceMinMagnitude),
        latitude: String(anchor.latitude),
        longitude: String(anchor.longitude),
        maxradiuskm: String(radiusKm),
        eventtype: "earthquake",
        orderby: "time-asc",
        limit: "500",
      });
      const gathered: EarthquakeEvent[] = [];
      for (let page = 0; page < 3; page += 1) {
        const params = new URLSearchParams(base);
        params.set("offset", String(page * 500 + 1));
        const payload = await readPage(await fetch(`/api/earthquakes?${params}`, { cache: "no-store" }));
        gathered.push(...payload.events);
        if (!payload.hasMore) break;
      }
      setSequenceEvents([...new Map(gathered.map((event) => [event.id, event])).values()]
        .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc))
        .slice(0, MAX_LOCAL_EVENTS));
    } catch (loadError) {
      setSequenceEvents([]);
      setError(loadError instanceof Error ? loadError.message : "No fue posible construir la secuencia local.");
    } finally {
      setSequenceLoading(false);
    }
  }

  function backToGlobal() {
    setMode("global");
    setSequenceEvents([]);
    setPlaying(false);
    setTimelinePct(100);
    setAdvancedOpen(false);
    globeRef.current?.pointOfView({ lat: 8, lng: -35, altitude: 2.05 }, 850);
  }

  const sequenceTimes = useMemo(() => sequenceEvents.map((event) => Date.parse(event.timeUtc)).filter(Number.isFinite), [sequenceEvents]);
  const sequenceMinTime = sequenceTimes.length ? Math.min(...sequenceTimes) : 0;
  const sequenceMaxTime = sequenceTimes.length ? Math.max(...sequenceTimes) : 0;
  const cutoffMs = sequenceMinTime + (sequenceMaxTime - sequenceMinTime) * (timelinePct / 100);
  const visibleSequence = useMemo(
    () => sequenceEvents.filter((event) => Date.parse(event.timeUtc) <= cutoffMs || timelinePct >= 100),
    [cutoffMs, sequenceEvents, timelinePct],
  );

  const activeEvents = mode === "global" ? globalEvents : visibleSequence;
  const activeMinTime = mode === "global" ? Date.now() - days * DAY_MS : sequenceMinTime;
  const activeMaxTime = mode === "global" ? Date.now() : Math.max(sequenceMaxTime, sequenceMinTime + 1);
  const maxDepth = Math.max(70, ...activeEvents.map((event) => event.depthKm));

  const points = useMemo<GlobeEvent[]>(() => activeEvents.map((event) => {
    const isSequence = mode === "sequence";
    const depthFraction = Math.max(0, Math.min(1, event.depthKm / Math.max(1, maxDepth)));
    return {
      ...event,
      lat: event.latitude,
      lng: event.longitude,
      // react-globe.gl extrudes above the surface. In local mode this is an explicit visual proxy for depth,
      // not a literal radial position inside the Earth.
      altitude: isSequence
        ? 0.012 + depthFraction * 0.17 * depthExaggeration
        : 0.012 + Math.max(0, Math.min(0.09, (event.magnitude - minMagnitude) * 0.022)),
      radius: isSequence
        ? Math.max(0.08, Math.min(0.33, 0.08 + Math.max(0, event.magnitude) * 0.035))
        : 0.13 + Math.max(0, Math.min(0.42, (event.magnitude - minMagnitude) * 0.12)),
      color: colorMode === "depth" ? colorByDepth(event.depthKm) : colorByTime(event.timeUtc, activeMinTime, activeMaxTime),
      sequence: isSequence,
    };
  }), [activeEvents, activeMaxTime, activeMinTime, colorMode, depthExaggeration, maxDepth, minMagnitude, mode]);

  const rings = useMemo(() => mode === "sequence" && selected ? [{
    lat: selected.latitude,
    lng: selected.longitude,
    maxRadius: Math.max(0.45, radiusKm / 111.2),
  }] : [], [mode, radiusKm, selected]);

  const timelineLabel = mode === "sequence" && sequenceTimes.length
    ? formatUtc(new Date(cutoffMs).toISOString())
    : "—";

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · SECUENCIA 3D INTEGRADA</span>
          <h1>{mode === "global" ? "Terremotos recientes sobre el planeta" : `Secuencia local · M${selected?.magnitude.toFixed(1) ?? "—"}`}</h1>
          <p>{mode === "global"
            ? "Elige un terremoto directamente sobre la Tierra. Al seleccionarlo, el mismo globo entra en modo secuencia y muestra la evolución local sin cambiar de visor."
            : "La misma Tierra permanece como referencia. Los hipocentros de la secuencia se extruyen sobre la superficie como proxy visual de profundidad y pueden reproducirse en el tiempo."}</p>
        </div>
        <div className={styles.count}><span>{mode === "global" ? "Eventos globales" : "Eventos de secuencia"}</span><strong>{activeEvents.length.toLocaleString("es-DO")}</strong><small>{mode === "global" ? `${days} días · M${minMagnitude.toFixed(1)}+` : `${radiusKm} km · M${sequenceMinMagnitude.toFixed(1)}+`}</small></div>
      </section>

      {mode === "global" ? (
        <section className={styles.controls}>
          <label><span>Ventana</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
          <label><span>Magnitud mínima</span><select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label>
          <label><span>Color</span><select value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)}><option value="depth">Profundidad</option><option value="time">Antigüedad</option></select></label>
          <label className={styles.toggle}><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span>Rotación suave</span></label>
        </section>
      ) : (
        <section className={`${styles.controls} ${styles.localControls}`}>
          <button type="button" className={styles.backButton} onClick={backToGlobal}>← Volver al globo</button>
          <label><span>Radio local</span><select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}><option value={50}>50 km</option><option value={100}>100 km</option><option value={150}>150 km</option><option value={300}>300 km</option><option value={500}>500 km</option></select></label>
          <label><span>Magnitud mínima</span><select value={sequenceMinMagnitude} onChange={(event) => setSequenceMinMagnitude(Number(event.target.value))}><option value={0}>M0+</option><option value={1}>M1+</option><option value={2}>M2+</option><option value={3}>M3+</option><option value={4}>M4+</option></select></label>
          <label><span>Profundidad visual</span><select value={depthExaggeration} onChange={(event) => setDepthExaggeration(Number(event.target.value))}><option value={0.8}>0.8×</option><option value={1.2}>1.2×</option><option value={1.6}>1.6×</option><option value={2.2}>2.2×</option><option value={3}>3.0×</option></select></label>
          <button type="button" onClick={() => selected && void loadSequence(selected)} disabled={!selected || sequenceLoading}>{sequenceLoading ? "Reconstruyendo…" : "Aplicar y reconstruir"}</button>
        </section>
      )}

      <section className={`${styles.globeCard} ${mode === "sequence" ? styles.sequenceMode : ""}`}>
        <div className={styles.legend}>
          {colorMode === "depth" ? <><span><i className={styles.shallow} /> &lt;35 km</span><span><i className={styles.mid} /> 35–150 km</span><span><i className={styles.deep} /> &gt;150 km</span></> : <span>Azul = más antiguo · rojo = más reciente</span>}
          {mode === "sequence" && <span className={styles.proxyNote}>Altura = profundidad exagerada, no posición radial literal</span>}
        </div>
        <div className={styles.globe} ref={containerRef}>
          {(loading || sequenceLoading) && <div className={styles.loading}>{sequenceLoading ? "Construyendo secuencia sobre el globo…" : "Cargando actividad sísmica reciente…"}</div>}
          {!loading && !sequenceLoading && error && <div className={styles.error}>{error}</div>}
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
                const event = point as GlobeEvent;
                return `<div class=\"globe-tooltip\"><strong>${event.sequence ? "Secuencia · " : ""}M${event.magnitude.toFixed(1)} · ${event.place}</strong><span>${formatUtc(event.timeUtc)} UTC</span><small>${event.depthKm.toFixed(1)} km de profundidad</small></div>`;
              }}
              onPointClick={(point: object) => {
                const event = point as GlobeEvent;
                if (mode === "global") void loadSequence(event);
                else setSelected(event);
              }}
              pointsTransitionDuration={420}
              ringsData={rings}
              ringLat="lat"
              ringLng="lng"
              ringAltitude={0.006}
              ringColor={() => ["rgba(2,132,199,.9)", "rgba(2,132,199,0)"]}
              ringMaxRadius="maxRadius"
              ringPropagationSpeed={0}
              ringRepeatPeriod={0}
              enablePointerInteraction
            />
          )}
        </div>

        {mode === "global" ? (
          selected ? <aside className={styles.selectedCard}>
            <div><span>Evento seleccionado</span><h2>M{selected.magnitude.toFixed(1)} · {selected.place}</h2></div>
            <div className={styles.selectedGrid}><span><b>{selected.depthKm.toFixed(1)} km</b>Profundidad</span><span><b>{formatUtc(selected.timeUtc)}</b>UTC</span><span><b>{selected.latitude.toFixed(2)}, {selected.longitude.toFixed(2)}</b>Coordenadas</span></div>
            <button type="button" onClick={() => void loadSequence(selected)}>Entrar a su secuencia 3D</button>
          </aside> : <div className={styles.hint}>Toca cualquier punto del globo para entrar directamente en su secuencia.</div>
        ) : (
          <aside className={styles.sequencePanel}>
            <div className={styles.sequenceHead}><div><span>Modo secuencia</span><h2>{selected?.place ?? "Evento local"}</h2></div><strong>{visibleSequence.length}/{sequenceEvents.length}</strong></div>
            <div className={styles.timelineRow}>
              <button type="button" onClick={() => { if (timelinePct >= 100) setTimelinePct(0); setPlaying((current) => !current); }}>{playing ? "Pausar" : "▶ Reproducir"}</button>
              <input type="range" min="0" max="100" step="1" value={timelinePct} onChange={(event) => { setPlaying(false); setTimelinePct(Number(event.target.value)); }} />
              <small>{timelineLabel}</small>
            </div>
            <div className={styles.sequenceStats}>
              <span><b>{Math.max(0, ...visibleSequence.map((event) => event.magnitude)).toFixed(1)}</b>Magnitud máx.</span>
              <span><b>{Math.max(0, ...visibleSequence.map((event) => event.depthKm)).toFixed(0)} km</b>Profundidad máx.</span>
              <span><b>{radiusKm} km</b>Radio analizado</span>
            </div>
          </aside>
        )}
      </section>

      {mode === "sequence" && (
        <details className={styles.advanced} open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
          <summary>Herramientas avanzadas: corte A–A′, Slab2, fallas, P/T y Coulomb</summary>
          {advancedOpen && <Sequence3D />}
        </details>
      )}
    </main>
  );
}
