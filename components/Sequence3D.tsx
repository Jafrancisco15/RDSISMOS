"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActiveFaultCollection, ActiveFaultFeature } from "@/lib/activeFaults";
import { evaluateFaultStressBalance, stressBalanceColor, type FaultStressBalance } from "@/lib/coulombBalance";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import type { SeismicMechanism, SeismicMechanismResponse } from "@/lib/seismicMechanisms";
import {
  localPointFromLatLon,
  median,
  normalizeAngleDeg,
  profileCoordinates,
  projectLocalPoint,
  slabDepthOnLocalPlane,
  slabProfileSlope,
  timelineCutoffMs,
  type LocalPoint3D,
  type ProjectedPoint2D,
} from "@/lib/sequence3d";
import type { Slab2Context } from "@/lib/slab2";
import { tectonicRegimeLabel } from "@/lib/slab2";
import styles from "./Sequence3D.module.css";

type Pair = [number, number];
type SequenceConfig = {
  beforeDays: number;
  afterDays: number;
  radiusKm: number;
  minMagnitude: number;
};

type EventPoint = {
  event: EarthquakeEvent;
  local: LocalPoint3D;
  projected: ProjectedPoint2D;
};

type SlabPayload = { context: Slab2Context | null; methodology?: string; error?: string };

const MAX_SEQUENCE_EVENTS = 1500;
const VIEW_WIDTH = 920;
const VIEW_HEIGHT = 620;
const PROFILE_WIDTH = 920;
const PROFILE_HEIGHT = 380;
const DEFAULT_CONFIG: SequenceConfig = { beforeDays: 2, afterDays: 10, radiusKm: 150, minMagnitude: 1 };

function formatUtc(value: string, withTime = true) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function startDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

async function readJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function sequenceBounds(latitude: number, longitude: number, radiusKm: number) {
  const latDelta = radiusKm / 111.2;
  const lonDelta = Math.min(175, radiusKm / (111.2 * Math.max(0.15, Math.cos(latitude * Math.PI / 180))));
  return {
    west: normalizeLongitude(longitude - lonDelta),
    south: Math.max(-89.8, latitude - latDelta),
    east: normalizeLongitude(longitude + lonDelta),
    north: Math.min(89.8, latitude + latDelta),
  };
}

function bboxString(box: ReturnType<typeof sequenceBounds>) {
  return [box.west, box.south, box.east, box.north].map((value) => value.toFixed(4)).join(",");
}

function pointRadius(magnitude: number) {
  return Math.max(2.8, Math.min(11, 2.5 + Math.max(0, magnitude) * 1.15));
}

function eventColor(timeMs: number, minimum: number, maximum: number) {
  const fraction = maximum > minimum ? Math.max(0, Math.min(1, (timeMs - minimum) / (maximum - minimum))) : 1;
  const hue = 205 - 190 * fraction;
  return `hsl(${hue.toFixed(0)} 88% 58%)`;
}

function faultLines(feature: ActiveFaultFeature) {
  const geometry = feature.geometry;
  if (!geometry) return [] as Pair[][];
  const pairs = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is Pair => Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1])))
      .map((item) => [Number(item[0]), Number(item[1])] as Pair)
    : [] as Pair[];
  if (geometry.type === "LineString") return [pairs(geometry.coordinates)];
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) return geometry.coordinates.map(pairs);
  return [] as Pair[][];
}

function axisLocalLine(mechanism: SeismicMechanism, axis: "p" | "t", anchor: EarthquakeEvent) {
  const principal = axis === "p" ? mechanism.pAxis : mechanism.tAxis;
  const halfKm = Math.max(12, Math.min(45, 16 + (mechanism.magnitude - 5.5) * 10));
  const horizontalKm = halfKm * Math.max(0.15, Math.cos(principal.plungeDeg * Math.PI / 180));
  const az = principal.azimuthDeg * Math.PI / 180;
  const center = localPointFromLatLon(mechanism.latitude, mechanism.longitude, mechanism.depthKm, anchor.latitude, anchor.longitude);
  const east = Math.sin(az) * horizontalKm;
  const north = Math.cos(az) * horizontalKm;
  return [
    { eastKm: center.eastKm - east, northKm: center.northKm - north, depthKm: center.depthKm },
    { eastKm: center.eastKm + east, northKm: center.northKm + north, depthKm: center.depthKm },
  ] as [LocalPoint3D, LocalPoint3D];
}

function sceneTransform(points: ProjectedPoint2D[]) {
  if (!points.length) return (point: ProjectedPoint2D) => ({ x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((VIEW_WIDTH - 90) / spanX, (VIEW_HEIGHT - 90) / spanY);
  const offsetX = (VIEW_WIDTH - spanX * scale) / 2 - minX * scale;
  const offsetY = (VIEW_HEIGHT - spanY * scale) / 2 - minY * scale;
  return (point: ProjectedPoint2D) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY });
}

function profileScreen(alongKm: number, depthKm: number, radiusKm: number, maxDepthKm: number) {
  const x = 55 + ((alongKm + radiusKm) / Math.max(1, radiusKm * 2)) * (PROFILE_WIDTH - 90);
  const y = 35 + (depthKm / Math.max(1, maxDepthKm)) * (PROFILE_HEIGHT - 80);
  return { x, y };
}

export function Sequence3D() {
  const [anchors, setAnchors] = useState<EarthquakeEvent[]>([]);
  const [anchor, setAnchor] = useState<EarthquakeEvent | null>(null);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [faults, setFaults] = useState<ActiveFaultCollection | null>(null);
  const [mechanisms, setMechanisms] = useState<SeismicMechanism[]>([]);
  const [slab, setSlab] = useState<Slab2Context | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loadingAnchors, setLoadingAnchors] = useState(true);
  const [loadingSequence, setLoadingSequence] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [config, setConfig] = useState<SequenceConfig>({ ...DEFAULT_CONFIG });
  const [applied, setApplied] = useState<SequenceConfig>({ ...DEFAULT_CONFIG });
  const [viewAzimuth, setViewAzimuth] = useState(325);
  const [viewElevation, setViewElevation] = useState(34);
  const [verticalExaggeration, setVerticalExaggeration] = useState(1.6);
  const [profileAzimuth, setProfileAzimuth] = useState(90);
  const [profileWidthKm, setProfileWidthKm] = useState(45);
  const [progress, setProgress] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [showFaults, setShowFaults] = useState(true);
  const [showSlab, setShowSlab] = useState(true);
  const [showMechanisms, setShowMechanisms] = useState(false);
  const [showCoulomb, setShowCoulomb] = useState(false);

  const loadSequence = useCallback(async (source: EarthquakeEvent, nextConfig: SequenceConfig) => {
    setAnchor(source);
    setSelectedEventId(source.id);
    setLoadingSequence(true);
    setError(null);
    setWarnings([]);
    setPlaying(false);
    setProgress(100);
    try {
      const sourceMs = Date.parse(source.timeUtc);
      const sequenceStart = new Date(sourceMs - nextConfig.beforeDays * 86_400_000);
      const requestedEnd = sourceMs + nextConfig.afterDays * 86_400_000;
      const sequenceEnd = new Date(Math.min(Date.now(), requestedEnd));
      const baseParams = new URLSearchParams({
        starttime: sequenceStart.toISOString(),
        endtime: sequenceEnd.toISOString(),
        minmagnitude: String(nextConfig.minMagnitude),
        latitude: String(source.latitude),
        longitude: String(source.longitude),
        maxradiuskm: String(nextConfig.radiusKm),
        eventtype: "earthquake",
        orderby: "time-asc",
        limit: "500",
      });
      const gathered: EarthquakeEvent[] = [];
      let truncated = false;
      for (let page = 0; page < 3; page += 1) {
        const params = new URLSearchParams(baseParams);
        params.set("offset", String(page * 500 + 1));
        const response = await fetch(`/api/earthquakes?${params}`, { cache: "no-store" });
        const payload = await readJson<EarthquakePage & { error?: string }>(response);
        if (!response.ok) throw new Error(payload.error ?? `Catálogo: HTTP ${response.status}`);
        gathered.push(...payload.events);
        if (!payload.hasMore) break;
        if (page === 2 && payload.hasMore) truncated = true;
      }
      const unique = [...new Map(gathered.map((event) => [event.id, event])).values()]
        .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc))
        .slice(0, MAX_SEQUENCE_EVENTS);
      setEvents(unique);
      if (!unique.some((event) => event.id === source.id)) setSelectedEventId(unique[0]?.id ?? null);

      const box = sequenceBounds(source.latitude, source.longitude, nextConfig.radiusKm);
      const mechanismDays = Math.max(30, Math.min(1825, Math.ceil((Date.now() - sequenceStart.getTime()) / 86_400_000) + 2));
      const slabParams = new URLSearchParams({ lat: String(source.latitude), lon: String(source.longitude), depth: String(source.depthKm) });
      const faultParams = new URLSearchParams({ bbox: bboxString(box), limit: "1200" });
      const mechanismParams = new URLSearchParams({
        bbox: bboxString(box),
        days: String(mechanismDays),
        minMagnitude: "5.5",
        limit: "40",
        orderBy: "magnitude",
      });
      const [slabResult, faultResult, mechanismResult] = await Promise.allSettled([
        fetch(`/api/slab-context?${slabParams}`, { cache: "force-cache" }).then((response) => readJson<SlabPayload>(response)),
        fetch(`/api/faults?${faultParams}`, { cache: "force-cache" }).then((response) => readJson<ActiveFaultCollection>(response)),
        fetch(`/api/seismic-mechanisms?${mechanismParams}`, { cache: "force-cache" }).then((response) => readJson<SeismicMechanismResponse & { error?: string }>(response)),
      ]);

      const nextWarnings: string[] = [];
      if (truncated) nextWarnings.push(`La secuencia supera ${MAX_SEQUENCE_EVENTS.toLocaleString("es-DO")} eventos; la vista se truncó para mantener fluidez.`);
      if (slabResult.status === "fulfilled") {
        setSlab(slabResult.value.context ?? null);
        if (slabResult.value.context?.warning) nextWarnings.push(slabResult.value.context.warning);
      } else {
        setSlab(null);
        nextWarnings.push("Slab2 no respondió; la secuencia sigue disponible sin la losa 3D.");
      }
      if (faultResult.status === "fulfilled") {
        setFaults(faultResult.value);
        if (faultResult.value.warning) nextWarnings.push(faultResult.value.warning);
      } else {
        setFaults(null);
        nextWarnings.push("No fue posible cargar fallas GEM para esta ventana.");
      }
      if (mechanismResult.status === "fulfilled") {
        setMechanisms(mechanismResult.value.mechanisms ?? []);
        nextWarnings.push(...(mechanismResult.value.warnings ?? []));
      } else {
        setMechanisms([]);
        nextWarnings.push("No fue posible cargar mecanismos focales USGS para esta ventana.");
      }
      setWarnings(nextWarnings.filter(Boolean));
    } catch (loadError) {
      setEvents([]);
      setFaults(null);
      setMechanisms([]);
      setSlab(null);
      setError(loadError instanceof Error ? loadError.message : "No fue posible construir la secuencia 3D.");
    } finally {
      setLoadingSequence(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingAnchors(true);
      try {
        const params = new URLSearchParams({
          starttime: startDate(180),
          endtime: new Date().toISOString(),
          minmagnitude: "4",
          eventtype: "earthquake",
          orderby: "time",
          limit: "120",
        });
        const response = await fetch(`/api/earthquakes?${params}`, { cache: "no-store" });
        const payload = await readJson<EarthquakePage & { error?: string }>(response);
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (cancelled) return;
        setAnchors(payload.events);
        const first = payload.events[0] ?? null;
        if (first) void loadSequence(first, DEFAULT_CONFIG);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar sismos recientes.");
      } finally {
        if (!cancelled) setLoadingAnchors(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadSequence]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 100) {
          setPlaying(false);
          return 100;
        }
        return Math.min(100, current + 1.25);
      });
    }, 140);
    return () => window.clearInterval(timer);
  }, [playing]);

  const times = useMemo(() => events.map((event) => Date.parse(event.timeUtc)).filter(Number.isFinite), [events]);
  const minTime = times.length ? Math.min(...times) : 0;
  const maxTime = times.length ? Math.max(...times) : 0;
  const cutoffMs = useMemo(() => timelineCutoffMs(times, progress), [times, progress]);
  const visibleEvents = useMemo(() => events.filter((event) => Date.parse(event.timeUtc) <= cutoffMs), [events, cutoffMs]);
  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? anchor, [events, selectedEventId, anchor]);
  const maxDepth = useMemo(() => {
    const observed = events.reduce((best, event) => Math.max(best, event.depthKm), anchor?.depthKm ?? 0);
    const slabDepth = slab?.slabDepthKm ?? 0;
    return Math.max(40, Math.ceil(Math.max(observed, slabDepth) * 1.18 / 25) * 25);
  }, [anchor, events, slab]);

  const eventPoints = useMemo(() => {
    if (!anchor) return [] as EventPoint[];
    return visibleEvents.map((event) => {
      const local = localPointFromLatLon(event.latitude, event.longitude, event.depthKm, anchor.latitude, anchor.longitude);
      return { event, local, projected: projectLocalPoint(local, viewAzimuth, viewElevation, verticalExaggeration) };
    });
  }, [anchor, visibleEvents, viewAzimuth, viewElevation, verticalExaggeration]);

  const activeMechanisms = useMemo(() => mechanisms.filter((mechanism) => Date.parse(mechanism.timeUtc) <= cutoffMs), [mechanisms, cutoffMs]);
  const balances = useMemo(() => {
    if (!showCoulomb || !faults || !activeMechanisms.length) return [] as FaultStressBalance[];
    return faults.features
      .map((fault) => evaluateFaultStressBalance(fault, activeMechanisms))
      .filter((balance): balance is FaultStressBalance => balance !== null);
  }, [activeMechanisms, faults, showCoulomb]);
  const balanceByFaultId = useMemo(() => new Map(balances.map((balance) => [balance.faultId, balance])), [balances]);

  const scene = useMemo(() => {
    if (!anchor) return null;
    const radius = applied.radiusKm;
    const corners: LocalPoint3D[] = [
      { eastKm: -radius, northKm: -radius, depthKm: 0 },
      { eastKm: radius, northKm: -radius, depthKm: 0 },
      { eastKm: radius, northKm: radius, depthKm: 0 },
      { eastKm: -radius, northKm: radius, depthKm: 0 },
      { eastKm: -radius, northKm: -radius, depthKm: maxDepth },
      { eastKm: radius, northKm: -radius, depthKm: maxDepth },
      { eastKm: radius, northKm: radius, depthKm: maxDepth },
      { eastKm: -radius, northKm: radius, depthKm: maxDepth },
    ];
    const projectedCorners = corners.map((point) => projectLocalPoint(point, viewAzimuth, viewElevation, verticalExaggeration));
    const transform = sceneTransform([...projectedCorners, ...eventPoints.map((point) => point.projected)]);
    const screenCorners = projectedCorners.map(transform);
    return { transform, screenCorners, radius };
  }, [anchor, applied.radiusKm, eventPoints, maxDepth, viewAzimuth, viewElevation, verticalExaggeration]);

  const faultSceneLines = useMemo(() => {
    if (!anchor || !scene || !showFaults || !faults) return [] as Array<{ id: string; name: string; color: string; points: string }>;
    const output: Array<{ id: string; name: string; color: string; points: string }> = [];
    for (const fault of faults.features) {
      const balance = balanceByFaultId.get(fault.properties.id);
      const color = showCoulomb && balance ? stressBalanceColor(balance) : "#f59e0b";
      faultLines(fault).forEach((line, index) => {
        const points = line.map(([longitude, latitude]) => {
          const local = localPointFromLatLon(latitude, longitude, 0, anchor.latitude, anchor.longitude);
          return scene.transform(projectLocalPoint(local, viewAzimuth, viewElevation, verticalExaggeration));
        }).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
        if (points) output.push({ id: `${fault.properties.id}-${index}`, name: fault.properties.name, color, points });
      });
    }
    return output;
  }, [anchor, balanceByFaultId, faults, scene, showCoulomb, showFaults, verticalExaggeration, viewAzimuth, viewElevation]);

  const slabPolygon = useMemo(() => {
    if (!anchor || !scene || !showSlab || !slab?.available || slab.slabDepthKm === null || slab.strikeDeg === null || slab.dipDeg === null) return null;
    const r = applied.radiusKm * 0.72;
    const corners = [
      { eastKm: -r, northKm: -r }, { eastKm: r, northKm: -r }, { eastKm: r, northKm: r }, { eastKm: -r, northKm: r },
    ].map((point) => ({
      ...point,
      depthKm: Math.max(0, Math.min(maxDepth, slabDepthOnLocalPlane({
        ...point,
        centerDepthKm: slab.slabDepthKm!,
        strikeDeg: slab.strikeDeg!,
        dipDeg: slab.dipDeg!,
      }))),
    }));
    return corners.map((point) => scene.transform(projectLocalPoint(point, viewAzimuth, viewElevation, verticalExaggeration)))
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  }, [anchor, applied.radiusKm, maxDepth, scene, showSlab, slab, verticalExaggeration, viewAzimuth, viewElevation]);

  const profileLineScene = useMemo(() => {
    if (!scene) return null;
    const angle = normalizeAngleDeg(profileAzimuth) * Math.PI / 180;
    const endpoint = (distance: number): LocalPoint3D => ({
      eastKm: Math.sin(angle) * distance,
      northKm: Math.cos(angle) * distance,
      depthKm: 0,
    });
    return [-scene.radius, scene.radius].map((distance) => scene.transform(projectLocalPoint(endpoint(distance), viewAzimuth, viewElevation, verticalExaggeration)));
  }, [profileAzimuth, scene, verticalExaggeration, viewAzimuth, viewElevation]);

  const profileEvents = useMemo(() => eventPoints.map((point) => ({
    ...point,
    profile: profileCoordinates(point.local, profileAzimuth),
  })).filter((point) => Math.abs(point.profile.crossKm) <= profileWidthKm / 2), [eventPoints, profileAzimuth, profileWidthKm]);

  const profileSlab = useMemo(() => {
    if (!showSlab || !slab?.available || slab.slabDepthKm === null || slab.strikeDeg === null || slab.dipDeg === null) return null;
    const slope = slabProfileSlope({ profileAzimuthDeg: profileAzimuth, strikeDeg: slab.strikeDeg, dipDeg: slab.dipDeg });
    const leftDepth = slab.slabDepthKm - applied.radiusKm * slope;
    const rightDepth = slab.slabDepthKm + applied.radiusKm * slope;
    return {
      left: profileScreen(-applied.radiusKm, Math.max(0, Math.min(maxDepth, leftDepth)), applied.radiusKm, maxDepth),
      right: profileScreen(applied.radiusKm, Math.max(0, Math.min(maxDepth, rightDepth)), applied.radiusKm, maxDepth),
    };
  }, [applied.radiusKm, maxDepth, profileAzimuth, showSlab, slab]);

  const visibleDepthMedian = median(visibleEvents.map((event) => event.depthKm));
  const visibleMaxMagnitude = visibleEvents.reduce((best, event) => Math.max(best, event.magnitude), Number.NEGATIVE_INFINITY);
  const currentCutoffLabel = Number.isFinite(cutoffMs) && cutoffMs > 0 ? formatUtc(new Date(cutoffMs).toISOString()) : "—";

  function applyConfig() {
    if (!anchor) return;
    setApplied({ ...config });
    void loadSequence(anchor, config);
  }

  function alignProfileToSlabDip() {
    if (slab?.strikeDeg !== null && slab?.strikeDeg !== undefined) setProfileAzimuth(Math.round(normalizeAngleDeg(slab.strikeDeg + 90)));
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · ANÁLISIS LOCAL</span>
          <h1>Secuencia 3D</h1>
          <p>Explora un enjambre o secuencia como un volumen: longitud, latitud, profundidad y tiempo. Superpone fallas GEM, geometría Slab2, mecanismos focales y balance Coulomb cuando los datos existen.</p>
        </div>
        <div className={styles.sourceBadge}>
          <span>Fuentes</span>
          <strong>Catálogo RDSISMOS + USGS Slab2</strong>
          <small>USGS/EMSC/Raspberry Shake · GEM GAF-DB · USGS moment tensors</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Qué representa:</strong> la profundidad transforma el mapa en un volumen y la línea temporal permite ver migración aparente de la sismicidad. Una alineación visual no demuestra por sí sola que todos los eventos pertenezcan a la misma falla.
      </section>

      <section className={styles.anchorPanel}>
        <div className={styles.sectionTitle}>
          <div><span>Evento de referencia</span><h2>Elige el centro de la secuencia</h2></div>
          <small>{loadingAnchors ? "Cargando…" : `${anchors.length} sismos M4+ recientes`}</small>
        </div>
        <div className={styles.anchorList}>
          {anchors.slice(0, 36).map((event) => (
            <button
              type="button"
              key={event.id}
              className={anchor?.id === event.id ? styles.activeAnchor : ""}
              onClick={() => void loadSequence(event, applied)}
              disabled={loadingSequence}
            >
              <strong>M{event.magnitude.toFixed(1)}</strong>
              <span>{event.place}</span>
              <small>{formatUtc(event.timeUtc)} · {event.depthKm.toFixed(0)} km</small>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.controls}>
        <label><span>Días antes</span><select value={config.beforeDays} onChange={(event) => setConfig((current) => ({ ...current, beforeDays: Number(event.target.value) }))}><option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={7}>7</option><option value={30}>30</option></select></label>
        <label><span>Días después</span><select value={config.afterDays} onChange={(event) => setConfig((current) => ({ ...current, afterDays: Number(event.target.value) }))}><option value={3}>3</option><option value={7}>7</option><option value={10}>10</option><option value={30}>30</option><option value={90}>90</option></select></label>
        <label><span>Radio</span><select value={config.radiusKm} onChange={(event) => setConfig((current) => ({ ...current, radiusKm: Number(event.target.value) }))}><option value={50}>50 km</option><option value={100}>100 km</option><option value={150}>150 km</option><option value={300}>300 km</option><option value={500}>500 km</option></select></label>
        <label><span>Magnitud mínima</span><select value={config.minMagnitude} onChange={(event) => setConfig((current) => ({ ...current, minMagnitude: Number(event.target.value) }))}><option value={0}>M0+</option><option value={0.5}>M0.5+</option><option value={1}>M1+</option><option value={2}>M2+</option><option value={3}>M3+</option><option value={4}>M4+</option></select></label>
        <button type="button" onClick={applyConfig} disabled={!anchor || loadingSequence}>{loadingSequence ? "Construyendo…" : "Reconstruir secuencia"}</button>
      </section>

      {error && <div className={styles.error}>{error}</div>}
      {warnings.length > 0 && <details className={styles.warnings}><summary>{warnings.length} aviso(s) de datos</summary><ul>{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details>}

      {anchor && (
        <>
          <section className={styles.metrics}>
            <article><span>Eventos visibles</span><strong>{visibleEvents.length.toLocaleString("es-DO")}</strong><small>de {events.length.toLocaleString("es-DO")} cargados</small></article>
            <article><span>Magnitud máxima</span><strong>{Number.isFinite(visibleMaxMagnitude) ? `M${visibleMaxMagnitude.toFixed(1)}` : "—"}</strong><small>radio {applied.radiusKm} km</small></article>
            <article><span>Profundidad mediana</span><strong>{visibleDepthMedian === null ? "—" : `${visibleDepthMedian.toFixed(1)} km`}</strong><small>máx. escala {maxDepth} km</small></article>
            <article><span>Contexto Slab2</span><strong>{slab ? tectonicRegimeLabel(slab.regime) : "Sin cobertura"}</strong><small>{slab?.slabDepthKm === null || slab?.slabDepthKm === undefined ? "superficie no disponible" : `losa ≈ ${slab.slabDepthKm.toFixed(0)} km · confianza ${slab.confidence}`}</small></article>
          </section>

          <section className={styles.layerPanel}>
            <label><input type="checkbox" checked={showFaults} onChange={(event) => setShowFaults(event.target.checked)} /><span><strong>Fallas activas GEM</strong><small>Trazas superficiales de GAF-DB.</small></span></label>
            <label><input type="checkbox" checked={showSlab} onChange={(event) => setShowSlab(event.target.checked)} /><span><strong>Superficie Slab2</strong><small>Plano tangente local aproximado a partir de depth/dip/strike.</small></span></label>
            <label><input type="checkbox" checked={showMechanisms} onChange={(event) => setShowMechanisms(event.target.checked)} /><span><strong>Mecanismos P/T</strong><small>Solo eventos M5.5+ con tensor de momento USGS disponible.</small></span></label>
            <label><input type="checkbox" checked={showCoulomb} onChange={(event) => setShowCoulomb(event.target.checked)} /><span><strong>Balance Coulomb</strong><small>Colorea fallas por ΔCFS neta usando únicamente fuentes ya ocurridas en el tiempo reproducido.</small></span></label>
          </section>

          <section className={styles.viewerGrid}>
            <article className={styles.viewerCard}>
              <div className={styles.viewerHeader}><div><span>Volumen hipocentral</span><h2>Perspectiva 3D local</h2></div><small>Profundidad hacia abajo · tamaño ∝ magnitud</small></div>
              <div className={styles.viewControls}>
                <label><span>Azimut de cámara {viewAzimuth}°</span><input type="range" min="0" max="359" value={viewAzimuth} onChange={(event) => setViewAzimuth(Number(event.target.value))} /></label>
                <label><span>Elevación {viewElevation}°</span><input type="range" min="15" max="70" value={viewElevation} onChange={(event) => setViewElevation(Number(event.target.value))} /></label>
                <label><span>Exageración vertical {verticalExaggeration.toFixed(1)}×</span><input type="range" min="0.5" max="4" step="0.1" value={verticalExaggeration} onChange={(event) => setVerticalExaggeration(Number(event.target.value))} /></label>
              </div>
              <div className={styles.svgWrap}>
                <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="Vista tridimensional proyectada de hipocentros">
                  {scene && <>
                    <polygon points={scene.screenCorners.slice(0, 4).map((point) => `${point.x},${point.y}`).join(" ")} className={styles.groundPlane} />
                    {[0, 1, 2, 3].map((index) => <line key={`depth-edge-${index}`} x1={scene.screenCorners[index].x} y1={scene.screenCorners[index].y} x2={scene.screenCorners[index + 4].x} y2={scene.screenCorners[index + 4].y} className={styles.depthEdge} />)}
                    <polygon points={scene.screenCorners.slice(4, 8).map((point) => `${point.x},${point.y}`).join(" ")} className={styles.deepPlane} />
                    {slabPolygon && <polygon points={slabPolygon} className={styles.slabPlane} />}
                    {profileLineScene && <line x1={profileLineScene[0].x} y1={profileLineScene[0].y} x2={profileLineScene[1].x} y2={profileLineScene[1].y} className={styles.profileSurfaceLine} />}
                    {faultSceneLines.map((line) => <polyline key={line.id} points={line.points} fill="none" stroke={line.color} strokeWidth={showCoulomb ? 2.3 : 1.35} opacity={showCoulomb ? 0.9 : 0.65}><title>{line.name}</title></polyline>)}
                    {showMechanisms && activeMechanisms.flatMap((mechanism) => (["p", "t"] as const).map((axis) => {
                      const localLine = axisLocalLine(mechanism, axis, anchor);
                      const a = scene.transform(projectLocalPoint(localLine[0], viewAzimuth, viewElevation, verticalExaggeration));
                      const b = scene.transform(projectLocalPoint(localLine[1], viewAzimuth, viewElevation, verticalExaggeration));
                      return <line key={`${axis}-${mechanism.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={axis === "p" ? "#ef4444" : "#38bdf8"} strokeWidth="3" opacity="0.9"><title>{axis === "p" ? "P compresión" : "T extensión"} · M{mechanism.magnitude.toFixed(1)}</title></line>;
                    }))}
                    {[...eventPoints].sort((a, b) => a.projected.cameraDepth - b.projected.cameraDepth).map((point) => {
                      const screen = scene.transform(point.projected);
                      const eventMs = Date.parse(point.event.timeUtc);
                      const selected = selectedEventId === point.event.id;
                      const isAnchor = point.event.id === anchor.id || point.event.externalId === anchor.externalId;
                      return <circle
                        key={point.event.id}
                        cx={screen.x}
                        cy={screen.y}
                        r={pointRadius(point.event.magnitude) + (selected ? 2 : 0)}
                        fill={eventColor(eventMs, minTime, maxTime)}
                        stroke={isAnchor ? "#ffffff" : selected ? "#f8fafc" : "rgba(15,23,42,.8)"}
                        strokeWidth={isAnchor ? 3.5 : selected ? 2.5 : 0.8}
                        className={styles.eventPoint}
                        onClick={() => setSelectedEventId(point.event.id)}
                      ><title>M{point.event.magnitude.toFixed(1)} · {point.event.depthKm.toFixed(1)} km · {point.event.place}</title></circle>;
                    })}
                  </>}
                </svg>
              </div>
              <div className={styles.legend}><span><i className={styles.earlyDot} /> inicio</span><span><i className={styles.lateDot} /> final</span><span><i className={styles.faultLineLegend} /> falla</span><span><i className={styles.slabLegend} /> Slab2</span>{showCoulomb && <><span><i className={styles.loadLegend} /> carga</span><span><i className={styles.relaxLegend} /> relajación</span></>}</div>
            </article>

            <aside className={styles.detailCard}>
              <span className={styles.eyebrow}>Evento seleccionado</span>
              {selectedEvent ? <>
                <h2>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</h2>
                <dl>
                  <div><dt>Fecha UTC</dt><dd>{formatUtc(selectedEvent.timeUtc)}</dd></div>
                  <div><dt>Profundidad</dt><dd>{selectedEvent.depthKm.toFixed(1)} km</dd></div>
                  <div><dt>Coordenadas</dt><dd>{selectedEvent.latitude.toFixed(3)}, {selectedEvent.longitude.toFixed(3)}</dd></div>
                  <div><dt>Fuente</dt><dd>{selectedEvent.sourceCatalog}</dd></div>
                  <div><dt>Magnitud</dt><dd>{selectedEvent.magnitudeType} {selectedEvent.magnitude.toFixed(1)}</dd></div>
                </dl>
              </> : <p>Selecciona un hipocentro.</p>}
              {slab && <div className={styles.slabDetail}><strong>Slab2 del evento de referencia</strong><span>{tectonicRegimeLabel(slab.regime)}</span><small>Hipocentro {anchor.depthKm.toFixed(1)} km · losa {slab.slabDepthKm === null ? "—" : `${slab.slabDepthKm.toFixed(1)} km`} · offset {slab.depthOffsetKm === null ? "—" : `${slab.depthOffsetKm >= 0 ? "+" : ""}${slab.depthOffsetKm.toFixed(1)} km`}</small>{slab.dipDeg !== null && <small>dip {slab.dipDeg.toFixed(0)}° · strike {slab.strikeDeg?.toFixed(0) ?? "—"}° · incertidumbre {slab.uncertaintyKm?.toFixed(0) ?? "—"} km</small>}</div>}
              {showCoulomb && <div className={styles.coulombDetail}><strong>Coulomb al corte temporal</strong><span>{balances.length} fallas con balance calculable</span><small>{activeMechanisms.length} fuentes con tensor USGS ya ocurridas · receptor GEM nominal a 10 km.</small></div>}
            </aside>
          </section>

          <section className={styles.timelineCard}>
            <div className={styles.timelineHead}><div><span>Evolución temporal</span><h2>{currentCutoffLabel} UTC</h2></div><button type="button" onClick={() => { if (progress >= 100) setProgress(0); setPlaying((value) => !value); }}>{playing ? "Pausar" : "▶ Reproducir"}</button></div>
            <input className={styles.timeline} type="range" min="0" max="100" step="0.25" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }} />
            <div className={styles.timelineLabels}><span>{minTime ? formatUtc(new Date(minTime).toISOString(), false) : "—"}</span><span>{visibleEvents.length}/{events.length} eventos</span><span>{maxTime ? formatUtc(new Date(maxTime).toISOString(), false) : "—"}</span></div>
          </section>

          <section className={styles.profileCard}>
            <div className={styles.viewerHeader}><div><span>Corte vertical A–A′</span><h2>Perfil hipocentral</h2></div><small>{profileEvents.length} eventos dentro de ±{(profileWidthKm / 2).toFixed(0)} km del perfil</small></div>
            <div className={styles.profileControls}>
              <label><span>Azimut A→A′ {profileAzimuth}°</span><input type="range" min="0" max="359" value={profileAzimuth} onChange={(event) => setProfileAzimuth(Number(event.target.value))} /></label>
              <label><span>Ancho del corredor {profileWidthKm} km</span><input type="range" min="10" max="150" step="5" value={profileWidthKm} onChange={(event) => setProfileWidthKm(Number(event.target.value))} /></label>
              <button type="button" onClick={alignProfileToSlabDip} disabled={slab?.strikeDeg === null || slab?.strikeDeg === undefined}>Alinear con dip Slab2</button>
            </div>
            <div className={styles.profileSvgWrap}>
              <svg viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`} role="img" aria-label="Corte vertical de la secuencia sísmica">
                <rect x="55" y="35" width={PROFILE_WIDTH - 90} height={PROFILE_HEIGHT - 80} className={styles.profileFrame} />
                {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                  const depth = fraction * maxDepth;
                  const point = profileScreen(-applied.radiusKm, depth, applied.radiusKm, maxDepth);
                  return <g key={`depth-${fraction}`}><line x1="55" y1={point.y} x2={PROFILE_WIDTH - 35} y2={point.y} className={styles.profileGrid} /><text x="7" y={point.y + 4} className={styles.axisText}>{depth.toFixed(0)} km</text></g>;
                })}
                <text x="55" y={PROFILE_HEIGHT - 18} className={styles.axisText}>A · −{applied.radiusKm} km</text>
                <text x={PROFILE_WIDTH - 150} y={PROFILE_HEIGHT - 18} className={styles.axisText}>A′ · +{applied.radiusKm} km</text>
                {profileSlab && <line x1={profileSlab.left.x} y1={profileSlab.left.y} x2={profileSlab.right.x} y2={profileSlab.right.y} className={styles.profileSlab}><title>Slab2 · aproximación tangente local</title></line>}
                {profileEvents.map((point) => {
                  const screen = profileScreen(point.profile.alongKm, point.profile.depthKm, applied.radiusKm, maxDepth);
                  return <circle key={`profile-${point.event.id}`} cx={screen.x} cy={screen.y} r={Math.max(2.5, pointRadius(point.event.magnitude) * 0.68)} fill={eventColor(Date.parse(point.event.timeUtc), minTime, maxTime)} stroke={point.event.id === anchor.id ? "#fff" : "rgba(15,23,42,.75)"} strokeWidth={point.event.id === anchor.id ? 2.5 : 0.7} className={styles.eventPoint} onClick={() => setSelectedEventId(point.event.id)}><title>M{point.event.magnitude.toFixed(1)} · profundidad {point.event.depthKm.toFixed(1)} km · distancia al perfil {Math.abs(point.profile.crossKm).toFixed(1)} km</title></circle>;
                })}
              </svg>
            </div>
            <p className={styles.methodNote}>La línea Slab2 del perfil es una aproximación tangente local construida con profundidad, strike y dip del modelo cerca del evento de referencia. No sustituye un corte completo del grid Slab2 ni define una falla individual.</p>
          </section>

          <section className={styles.scienceGrid}>
            <article><span>Cómo leerlo</span><h2>Patrones que sí puedes explorar</h2><ul><li>Migración temporal aparente del enjambre.</li><li>Alineaciones hipocentrales y cambios de profundidad.</li><li>Relación geométrica con fallas superficiales y la losa subducida.</li><li>Orientación P/T cuando USGS publica tensor de momento.</li><li>Carga, relajación y cancelación Coulomb de fallas receptoras disponibles.</li></ul></article>
            <article><span>Límites</span><h2>Lo que no demuestra</h2><ul><li>Una nube alineada no identifica automáticamente una falla causal.</li><li>La profundidad puede tener errores mayores que la posición horizontal.</li><li>Los catálogos no tienen la misma completitud para magnitudes pequeñas en todas las regiones.</li><li>El Coulomb actual es exploratorio, de fuente puntual y receptores GEM simplificados.</li><li>La superficie Slab2 es un modelo 3D regional, no una observación directa del hipocentro.</li></ul></article>
          </section>
        </>
      )}
    </main>
  );
}
