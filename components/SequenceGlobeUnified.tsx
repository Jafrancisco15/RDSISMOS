"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import styles from "./SequenceGlobeEntry.module.css";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });
const DAY_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const DAY_MS = 86_400_000;
const PAGE_SIZE = 500;
const MAX_SEQUENCE_EVENTS = 1500;

type Mode = "global" | "sequence";
type ColorMode = "depth" | "time";
type GlobePoint = EarthquakeEvent & {
  lat: number;
  lng: number;
  altitude: number;
  radius: number;
  color: string;
};

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function colorByDepth(depthKm: number) {
  if (depthKm < 35) return "#ff5d2e";
  if (depthKm < 70) return "#ffc857";
  if (depthKm < 150) return "#51c7e8";
  if (depthKm < 300) return "#3588d4";
  return "#3f51d7";
}

function colorByTime(timeUtc: string, minTime: number, maxTime: number) {
  const value = Date.parse(timeUtc);
  const fraction = maxTime > minTime ? Math.max(0, Math.min(1, (value - minTime) / (maxTime - minTime))) : 1;
  const hue = 215 - fraction * 205;
  return `hsl(${hue.toFixed(0)} 88% 56%)`;
}

async function fetchPage(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(`/api/earthquakes?${params}`, {
    cache: "no-store",
    signal,
  });
  const payload = await response.json() as EarthquakePage & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

export function SequenceGlobeUnified() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 920, height: 650 });
  const [mode, setMode] = useState<Mode>("global");
  const [globalDays, setGlobalDays] = useState(60);
  const [globalMinMagnitude, setGlobalMinMagnitude] = useState(4);
  const [globalEvents, setGlobalEvents] = useState<EarthquakeEvent[]>([]);
  const [sequenceEvents, setSequenceEvents] = useState<EarthquakeEvent[]>([]);
  const [selected, setSelected] = useState<EarthquakeEvent | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("depth");
  const [radiusKm, setRadiusKm] = useState(150);
  const [beforeDays, setBeforeDays] = useState(2);
  const [afterDays, setAfterDays] = useState(10);
  const [sequenceMinMagnitude, setSequenceMinMagnitude] = useState(1);
  const [depthExaggeration, setDepthExaggeration] = useState(2);
  const [timelinePct, setTimelinePct] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setSize({
      width: Math.max(320, node.clientWidth),
      height: Math.max(500, Math.min(760, node.clientWidth * 0.78)),
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = mode === "global";
    controls.autoRotateSpeed = 0.22;
  }, [mode]);

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 8, lng: -35, altitude: 2.05 }, 800);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({
          source: "usgs",
          starttime: daysAgo(globalDays),
          endtime: new Date().toISOString(),
          minmagnitude: String(globalMinMagnitude),
          eventtype: "earthquake",
          orderby: "time",
          limit: "500",
        });
        const payload = await fetchPage(params, controller.signal);
        setGlobalEvents(payload.events);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catálogo global.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [globalDays, globalMinMagnitude]);

  useEffect(() => {
    if (!playing || mode !== "sequence") return;
    const timer = window.setInterval(() => {
      setTimelinePct((value) => {
        if (value >= 100) {
          setPlaying(false);
          return 100;
        }
        return Math.min(100, value + 1.2);
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [mode, playing]);

  async function reconstruct(anchor: EarthquakeEvent) {
    setSelected(anchor);
    setMode("sequence");
    setPlaying(false);
    setTimelinePct(100);
    setSequenceLoading(true);
    setError(null);
    globeRef.current?.pointOfView({ lat: anchor.latitude, lng: anchor.longitude, altitude: 0.68 }, 850);

    try {
      const anchorTime = Date.parse(anchor.timeUtc);
      const starttime = new Date(anchorTime - beforeDays * DAY_MS).toISOString();
      const endtime = new Date(Math.min(Date.now(), anchorTime + afterDays * DAY_MS)).toISOString();
      const base = new URLSearchParams({
        source: "usgs",
        starttime,
        endtime,
        minmagnitude: String(sequenceMinMagnitude),
        latitude: String(anchor.latitude),
        longitude: String(anchor.longitude),
        maxradiuskm: String(radiusKm),
        eventtype: "earthquake",
        orderby: "time-asc",
        limit: String(PAGE_SIZE),
      });

      const gathered: EarthquakeEvent[] = [];
      for (let page = 0; page < 3; page += 1) {
        const params = new URLSearchParams(base);
        params.set("offset", String(page * PAGE_SIZE + 1));
        const payload = await fetchPage(params);
        gathered.push(...payload.events);
        if (!payload.hasMore) break;
      }

      const unique = [...new Map(gathered.map((event) => [event.id, event])).values()]
        .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc))
        .slice(0, MAX_SEQUENCE_EVENTS);
      setSequenceEvents(unique);
    } catch (loadError) {
      setSequenceEvents([]);
      setError(loadError instanceof Error ? loadError.message : "No fue posible reconstruir la secuencia.");
    } finally {
      setSequenceLoading(false);
    }
  }

  function returnGlobal() {
    setMode("global");
    setSequenceEvents([]);
    setTimelinePct(100);
    setPlaying(false);
    setError(null);
    globeRef.current?.pointOfView({ lat: 8, lng: -35, altitude: 2.05 }, 800);
  }

  const sequenceTimes = useMemo(
    () => sequenceEvents.map((event) => Date.parse(event.timeUtc)).filter(Number.isFinite),
    [sequenceEvents],
  );
  const minSequenceTime = sequenceTimes.length ? Math.min(...sequenceTimes) : 0;
  const maxSequenceTime = sequenceTimes.length ? Math.max(...sequenceTimes) : 0;
  const cutoff = minSequenceTime + (maxSequenceTime - minSequenceTime) * (timelinePct / 100);
  const visibleSequence = useMemo(
    () => timelinePct >= 100 ? sequenceEvents : sequenceEvents.filter((event) => Date.parse(event.timeUtc) <= cutoff),
    [cutoff, sequenceEvents, timelinePct],
  );

  const activeEvents = mode === "global" ? globalEvents : visibleSequence;
  const minTime = mode === "global" ? Date.now() - globalDays * DAY_MS : minSequenceTime;
  const maxTime = mode === "global" ? Date.now() : Math.max(maxSequenceTime, minSequenceTime + 1);
  const maxDepth = Math.max(30, ...activeEvents.map((event) => event.depthKm));

  const points = useMemo<GlobePoint[]>(() => activeEvents.map((event) => {
    const depthFraction = Math.max(0, Math.min(1, event.depthKm / maxDepth));
    const sequenceAltitude = 0.015 + depthFraction * 0.19 * depthExaggeration;
    return {
      ...event,
      lat: event.latitude,
      lng: event.longitude,
      altitude: mode === "sequence"
        ? sequenceAltitude
        : 0.012 + Math.max(0, Math.min(0.09, (event.magnitude - globalMinMagnitude) * 0.022)),
      radius: mode === "sequence"
        ? Math.max(0.07, Math.min(0.25, 0.07 + Math.max(0, event.magnitude) * 0.03))
        : 0.13 + Math.max(0, Math.min(0.42, (event.magnitude - globalMinMagnitude) * 0.12)),
      color: colorMode === "depth" ? colorByDepth(event.depthKm) : colorByTime(event.timeUtc, minTime, maxTime),
    };
  }), [activeEvents, colorMode, depthExaggeration, globalMinMagnitude, maxDepth, maxTime, minTime, mode]);

  const rings = useMemo(() => mode === "sequence" && selected ? [{
    lat: selected.latitude,
    lng: selected.longitude,
    maxRadius: Math.max(0.45, radiusKm / 111.2),
  }] : [], [mode, radiusKm, selected]);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · SECUENCIA 3D SOBRE EL GLOBO</span>
          <h1>{mode === "global" ? "Selecciona un terremoto reciente" : `Reconstrucción 3D · M${selected?.magnitude.toFixed(1) ?? "—"}`}</h1>
          <p>{mode === "global"
            ? "El planeta muestra la actividad reciente. Toca un sismo y RDSISMOS reconstruirá su entorno directamente sobre este mismo globo."
            : "Cada punto es un hipocentro de la secuencia local. La altura codifica la profundidad con exageración visual para hacer visible la geometría 3D; la profundidad numérica real permanece en el dato USGS."}</p>
        </div>
        <div className={styles.count}>
          <span>{mode === "global" ? "Eventos globales" : "Hipocentros visibles"}</span>
          <strong>{activeEvents.length.toLocaleString("es-DO")}</strong>
          <small>{mode === "global" ? `${globalDays} días · M${globalMinMagnitude.toFixed(1)}+` : `${radiusKm} km · M${sequenceMinMagnitude.toFixed(1)}+`}</small>
        </div>
      </section>

      {mode === "global" ? (
        <section className={styles.controls}>
          <label><span>Ventana</span><select value={globalDays} onChange={(event) => setGlobalDays(Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label>
          <label><span>Magnitud mínima</span><select value={globalMinMagnitude} onChange={(event) => setGlobalMinMagnitude(Number(event.target.value))}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label>
          <label><span>Color</span><select value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)}><option value="depth">Profundidad</option><option value="time">Antigüedad</option></select></label>
        </section>
      ) : (
        <section className={`${styles.controls} ${styles.localControls}`}>
          <button type="button" className={styles.backButton} onClick={returnGlobal}>← Vista global</button>
          <label><span>Radio</span><select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}><option value={50}>50 km</option><option value={100}>100 km</option><option value={150}>150 km</option><option value={300}>300 km</option><option value={500}>500 km</option></select></label>
          <label><span>Magnitud local</span><select value={sequenceMinMagnitude} onChange={(event) => setSequenceMinMagnitude(Number(event.target.value))}><option value={0}>M0+</option><option value={1}>M1+</option><option value={2}>M2+</option><option value={3}>M3+</option><option value={4}>M4+</option></select></label>
          <label><span>Antes</span><select value={beforeDays} onChange={(event) => setBeforeDays(Number(event.target.value))}><option value={1}>1 día</option><option value={2}>2 días</option><option value={7}>7 días</option><option value={14}>14 días</option></select></label>
          <label><span>Después</span><select value={afterDays} onChange={(event) => setAfterDays(Number(event.target.value))}><option value={3}>3 días</option><option value={7}>7 días</option><option value={10}>10 días</option><option value={30}>30 días</option></select></label>
          <label><span>Profundidad 3D</span><select value={depthExaggeration} onChange={(event) => setDepthExaggeration(Number(event.target.value))}><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option><option value={3}>3×</option></select></label>
          <button type="button" onClick={() => selected && void reconstruct(selected)} disabled={!selected || sequenceLoading}>{sequenceLoading ? "Reconstruyendo…" : "Reconstruir en el globo"}</button>
        </section>
      )}

      <section className={`${styles.globeCard} ${mode === "sequence" ? styles.sequenceMode : ""}`}>
        <div className={styles.legend}>
          {colorMode === "depth" ? <><span><i className={styles.shallow} /> &lt;35 km</span><span><i className={styles.mid} /> 35–150 km</span><span><i className={styles.deep} /> &gt;150 km</span></> : <span>Azul = más antiguo · rojo = más reciente</span>}
          {mode === "sequence" && <span className={styles.proxyNote}>Altura = profundidad codificada y exagerada</span>}
        </div>
        <div className={styles.globe} ref={containerRef}>
          {(loading || sequenceLoading) && <div className={styles.loading}>{sequenceLoading ? "Consultando USGS y reconstruyendo la nube 3D…" : "Cargando actividad sísmica…"}</div>}
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
              pointsData={points}
              pointLat="lat"
              pointLng="lng"
              pointAltitude="altitude"
              pointRadius="radius"
              pointColor="color"
              pointLabel={(point: object) => {
                const event = point as GlobePoint;
                return `<div class=\"globe-tooltip\"><strong>M${event.magnitude.toFixed(1)} · ${event.place}</strong><span>${formatUtc(event.timeUtc)} UTC</span><small>${event.depthKm.toFixed(1)} km de profundidad</small></div>`;
              }}
              onPointClick={(point: object) => {
                const event = point as GlobePoint;
                if (mode === "global") void reconstruct(event);
                else setSelected(event);
              }}
              pointsTransitionDuration={400}
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
          <div className={styles.hint}>Toca un terremoto para reconstruir su secuencia directamente sobre el globo.</div>
        ) : (
          <aside className={styles.sequencePanel}>
            <div className={styles.sequenceHead}>
              <div><span>Secuencia USGS</span><h2>{selected?.place ?? "Evento seleccionado"}</h2></div>
              <strong>{visibleSequence.length}/{sequenceEvents.length}</strong>
            </div>
            <div className={styles.timelineRow}>
              <button type="button" onClick={() => { if (timelinePct >= 100) setTimelinePct(0); setPlaying((value) => !value); }}>{playing ? "Pausar" : "▶ Reproducir"}</button>
              <input type="range" min="0" max="100" step="1" value={timelinePct} onChange={(event) => { setPlaying(false); setTimelinePct(Number(event.target.value)); }} />
              <small>{sequenceEvents.length ? formatUtc(new Date(cutoff).toISOString()) : "—"}</small>
            </div>
            <div className={styles.sequenceStats}>
              <span><b>{Math.max(0, ...visibleSequence.map((event) => event.magnitude)).toFixed(1)}</b>Magnitud máx.</span>
              <span><b>{Math.max(0, ...visibleSequence.map((event) => event.depthKm)).toFixed(0)} km</b>Profundidad máx.</span>
              <span><b>{radiusKm} km</b>Radio</span>
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}
