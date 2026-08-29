"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapLayersResponse, GlobeMapPath, GlobeMapPoint } from "@/lib/globeLayers";
import {
  estimateCountryImpacts,
  solveImpactRadii,
  allen2012RhypoMmi,
  type CountryImpactEstimate,
} from "@/lib/seismicImpact";
import {
  distanceAtElapsed,
  geodesicCircle,
  type SeismicWavefrontTable,
  type TravelTimeModel,
} from "@/lib/seismicWavefronts";

interface RenderPath {
  id: string;
  name: string;
  kind: "country" | "impact" | "wave";
  points: Array<GlobeMapPoint & { altitude: number }>;
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
  label: string;
}

interface ImpactPoint extends CountryImpactEstimate {
  id: string;
  altitude: number;
  radius: number;
  color: string;
  label: string;
}

const EARTH_RADIUS_KM = 6371;
const panel: React.CSSProperties = { border: "1px solid rgba(56,189,248,.18)", borderRadius: 14, background: "linear-gradient(160deg,#030b14,#061827)", overflow: "hidden" };
const button: React.CSSProperties = { border: "1px solid #1e3a52", borderRadius: 9, background: "#071525", color: "#e2e8f0", padding: "7px 10px", fontSize: 10, fontWeight: 800, cursor: "pointer" };

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function pct(value: number) { return `${(value * 100).toFixed(value >= .1 ? 0 : 1)}%`; }
function mins(seconds: number | null) { return seconds === null ? "—" : seconds < 60 ? `${Math.round(seconds)} s` : `${(seconds / 60).toFixed(1)} min`; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

function impactColor(item: CountryImpactEstimate, alpha = 1) {
  if (item.probabilityMmi6 >= .2 || item.meanMmi >= 6) return `rgba(239,68,68,${alpha})`;
  if (item.probabilityMmi5 >= .3 || item.meanMmi >= 5) return `rgba(249,115,22,${alpha})`;
  if (item.probabilityMmi3 >= .35 || item.meanMmi >= 3) return `rgba(250,204,21,${alpha})`;
  if (item.probabilityMmi3 >= .05) return `rgba(45,212,191,${alpha})`;
  return `rgba(148,163,184,${alpha})`;
}

function countryLabel(item: CountryImpactEstimate) {
  return `<div class="globe-tooltip"><strong>${escapeHtml(item.country)}</strong><span>MMI media ${item.meanMmi.toFixed(1)} · ${escapeHtml(item.level)}</span><small>P(MMI≥III) ${pct(item.probabilityMmi3)} · P(MMI≥V) ${pct(item.probabilityMmi5)} · P(MMI≥VI) ${pct(item.probabilityMmi6)}</small><small>distancia superficial aprox. ${Math.round(item.surfaceDistanceKm).toLocaleString("es-DO")} km · P ${mins(item.pArrivalSec)} · S ${mins(item.sArrivalSec)}</small><small>${item.extrapolated ? "IPE extrapolada >500 km; usar como cribado, no ShakeMap." : "Allen et al. 2012 Rhypo; sin amplificación de sitio."}</small></div>`;
}

function countryPaths(borders: GlobeMapPath[], impacts: Map<string, CountryImpactEstimate>): RenderPath[] {
  return borders.map((path) => {
    const impact = impacts.get(path.name);
    const color = impact ? impactColor(impact, impact.probabilityMmi3 >= .05 ? .88 : .33) : "rgba(148,163,184,.24)";
    return {
      id: `country:${path.id}`,
      name: path.name,
      kind: "country",
      points: path.points.map((point) => ({ ...point, altitude: .006 })),
      color,
      stroke: impact && impact.probabilityMmi3 >= .35 ? .65 : .28,
      dashLength: 1,
      dashGap: 0,
      label: impact ? countryLabel(impact) : `<div class="globe-tooltip"><strong>${escapeHtml(path.name)}</strong><span>Sin impacto perceptible destacado en el cribado.</span></div>`,
    };
  });
}

function circlePath(id: string, name: string, lat: number, lng: number, radiusKm: number, color: string, kind: "impact" | "wave", altitude: number, dashLength = 1, dashGap = 0): RenderPath {
  const distanceDeg = radiusKm / EARTH_RADIUS_KM * 180 / Math.PI;
  return {
    id,
    name,
    kind,
    points: geodesicCircle(lat, lng, distanceDeg, 120).map((point) => ({ ...point, altitude })),
    color,
    stroke: kind === "wave" ? 1.35 : .9,
    dashLength,
    dashGap,
    label: `<div class="globe-tooltip"><strong>${escapeHtml(name)}</strong><span>radio aproximado ${Math.round(radiusKm).toLocaleString("es-DO")} km</span></div>`,
  };
}

function currentFront(curve: SeismicWavefrontTable["curves"]["P"], elapsedSec: number) {
  if (!curve.length) return null;
  const maxTime = Math.max(...curve.map((point) => point.timeSec));
  if (elapsedSec > maxTime + 25) return null;
  return distanceAtElapsed(curve, elapsedSec);
}

function ImpactProfile({ event, impacts }: { event: EarthquakeEvent; impacts: CountryImpactEstimate[] }) {
  const width = 900; const height = 275; const left = 44; const right = 18; const top = 20; const bottom = 42;
  const radii = solveImpactRadii(event.magnitude, event.depthKm);
  const furthest = Math.max(350, ...radii.map((item) => item.radiusKm ?? 0), ...impacts.slice(0, 8).map((item) => Math.min(2500, item.surfaceDistanceKm)));
  const maxKm = Math.min(3000, Math.ceil((furthest + 150) / 100) * 100);
  const samples = Array.from({ length: 101 }, (_, index) => {
    const distanceKm = maxKm * index / 100;
    const rhypo = Math.hypot(distanceKm, event.depthKm);
    return { distanceKm, mmi: clamp(allen2012RhypoMmi(event.magnitude, rhypo).mean, 0, 10) };
  });
  const x = (km: number) => left + km / maxKm * (width - left - right);
  const y = (mmi: number) => top + (10 - mmi) / 10 * (height - top - bottom);
  const line = samples.map((item) => `${x(item.distanceKm).toFixed(1)},${y(item.mmi).toFixed(1)}`).join(" ");
  const countryMarks = impacts.filter((item) => item.probabilityMmi3 >= .05).slice(0, 10);
  return <div style={{ padding: 11 }}>
    <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900, letterSpacing: ".08em" }}>PERFIL 2D · INTENSIDAD ESPERADA VS DISTANCIA</div>
    <div style={{ overflowX: "auto", marginTop: 6 }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 650, display: "block", background: "#020812", borderRadius: 12 }} role="img" aria-label="Perfil de intensidad MMI estimada por distancia">
        {[3,5,6].map((mmi) => <g key={mmi}><line x1={left} y1={y(mmi)} x2={width-right} y2={y(mmi)} stroke={mmi === 6 ? "#ef4444" : mmi === 5 ? "#f97316" : "#eab308"} strokeDasharray="5 4" opacity=".7"/><text x={left+5} y={y(mmi)-5} fill="#cbd5e1" fontSize="10">MMI {mmi}</text></g>)}
        <polyline points={line} fill="none" stroke="#38bdf8" strokeWidth="2.2"/>
        {countryMarks.map((item, index) => <g key={item.country}><circle cx={x(Math.min(maxKm, item.surfaceDistanceKm))} cy={y(item.meanMmi)} r="4" fill={impactColor(item,1)} stroke="white" strokeWidth="1"/><text x={x(Math.min(maxKm,item.surfaceDistanceKm))+5} y={y(item.meanMmi)-5-(index%2)*9} fill="#cbd5e1" fontSize="8.5">{item.country.slice(0,18)}</text></g>)}
        <line x1={left} y1={top} x2={left} y2={height-bottom} stroke="#475569"/><line x1={left} y1={height-bottom} x2={width-right} y2={height-bottom} stroke="#475569"/>
        <text x="8" y={top+8} fill="#94a3b8" fontSize="10">MMI 10</text><text x="18" y={height-bottom} fill="#94a3b8" fontSize="10">0</text>
        <text x={left} y={height-14} fill="#94a3b8" fontSize="10">0 km</text><text x={width-right-70} y={height-14} fill="#94a3b8" fontSize="10">{maxKm.toLocaleString("es-DO")} km</text>
      </svg>
    </div>
  </div>;
}

export function SeismicImpactPanel({ event, model, layers }: { event: EarthquakeEvent; model: TravelTimeModel; layers: GlobeMapLayersResponse | null }) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 560 });
  const [wavefronts, setWavefronts] = useState<SeismicWavefrontTable | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({ width: Math.max(320, element.clientWidth), height: Math.max(440, Math.min(680, element.clientWidth * .68)) });
    update(); const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ depth: event.depthKm.toFixed(1), model });
    fetch(`/api/geomagnetism/wavefronts?${params}`, { cache: "force-cache", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as SeismicWavefrontTable; if (!response.ok) throw new Error(`HTTP ${response.status}`); return payload; })
      .then((payload) => { setWavefronts(payload); setElapsedSec(0); setPlaying(false); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setWavefronts(null); });
    return () => controller.abort();
  }, [event.depthKm, model]);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (controls) { controls.autoRotate = false; controls.enableDamping = true; controls.dampingFactor = .08; }
    globeRef.current?.pointOfView({ lat: event.latitude, lng: event.longitude, altitude: 2.0 }, 800);
    const timer = window.setTimeout(() => {
      const api = globeRef.current as unknown as { globeMaterial?: () => { transparent?: boolean; opacity?: number; depthWrite?: boolean; color?: { set: (value: string) => void } } };
      const material = api.globeMaterial?.();
      if (material) { material.transparent = true; material.opacity = .10; material.depthWrite = false; material.color?.set("#0b2238"); }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [event.id, event.latitude, event.longitude]);

  const durationSec = useMemo(() => {
    if (!wavefronts) return 1800;
    const values = [...wavefronts.curves.P, ...wavefronts.curves.S].map((point) => point.timeSec);
    return Math.max(300, Math.ceil((values.length ? Math.max(...values) : 1800) / 60) * 60);
  }, [wavefronts]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setElapsedSec((current) => {
      const next = current + speed * .1;
      if (next >= durationSec) { setPlaying(false); return durationSec; }
      return next;
    }), 100);
    return () => window.clearInterval(timer);
  }, [durationSec, playing, speed]);

  const impacts = useMemo(() => estimateCountryImpacts(event, layers?.countryBorders ?? [], wavefronts), [event, layers, wavefronts]);
  const impactMap = useMemo(() => new Map(impacts.map((item) => [item.country, item])), [impacts]);
  const radii = useMemo(() => solveImpactRadii(event.magnitude, event.depthKm), [event.depthKm, event.magnitude]);

  const paths = useMemo<RenderPath[]>(() => {
    const base = countryPaths(layers?.countryBorders ?? [], impactMap);
    const impact = radii.flatMap((item) => item.radiusKm === null ? [] : [circlePath(`mmi:${item.mmi}`, `MMI ${item.mmi} media`, event.latitude, event.longitude, item.radiusKm, item.mmi === 6 ? "#ef4444" : item.mmi === 5 ? "#f97316" : "#eab308", "impact", .018, .08, .035)]);
    if (!wavefronts) return [...base, ...impact];
    const pDeg = currentFront(wavefronts.curves.P, elapsedSec);
    const sDeg = currentFront(wavefronts.curves.S, elapsedSec);
    const waves: RenderPath[] = [];
    if (pDeg !== null) waves.push(circlePath("wave:P", `Frente P · t+${Math.round(elapsedSec)} s`, event.latitude, event.longitude, pDeg * Math.PI / 180 * EARTH_RADIUS_KM, "#38bdf8", "wave", .035));
    if (sDeg !== null) waves.push(circlePath("wave:S", `Frente S · t+${Math.round(elapsedSec)} s`, event.latitude, event.longitude, sDeg * Math.PI / 180 * EARTH_RADIUS_KM, "#f59e0b", "wave", .041));
    return [...base, ...impact, ...waves];
  }, [elapsedSec, event.latitude, event.longitude, impactMap, layers, radii, wavefronts]);

  const points = useMemo<ImpactPoint[]>(() => impacts.filter((item) => item.probabilityMmi3 >= .03).slice(0, 28).map((item) => ({
    ...item,
    id: `impact:${item.country}`,
    altitude: .025 + clamp(item.probabilityMmi3, 0, 1) * .08,
    radius: .08 + clamp(item.probabilityMmi3, 0, 1) * .28,
    color: impactColor(item, 1),
    label: countryLabel(item),
  })), [impacts]);

  const sourcePoint = useMemo(() => ({ id: "source", lat: event.latitude, lng: event.longitude, altitude: .12, radius: .38, color: "#fb7185", label: `<div class="globe-tooltip"><strong>Epicentro · M${event.magnitude.toFixed(1)}</strong><span>${escapeHtml(event.place)}</span><small>${event.depthKm.toFixed(1)} km de profundidad</small></div>` }), [event]);

  return <section style={panel}>
    <div style={{ padding: "12px 12px 0" }}>
      <div style={{ color: "#67e8f9", fontSize: 9, fontWeight: 900, letterSpacing: ".09em" }}>ALCANCE E IMPACTO · GLOBO 3D TRANSPARENTE</div>
      <h4 style={{ color: "white", margin: "4px 0 3px", fontSize: 17 }}>Países alcanzados vs impacto humano estimado</h4>
      <p style={{ color: "#94a3b8", fontSize: 9.5, lineHeight: 1.5, margin: 0 }}>Azul/naranja = frentes P/S directos. Amarillo/naranja/rojo = radios de MMI media III/V/VI. Los países se resaltan por probabilidad de intensidad, no simplemente porque una onda instrumental los atraviese.</p>
    </div>

    <div ref={containerRef} style={{ width: "100%", position: "relative", marginTop: 7 }}>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#38bdf8"
        atmosphereAltitude={.12}
        showGraticules
        pathsData={paths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor="color"
        pathStroke="stroke"
        pathDashLength="dashLength"
        pathDashGap="dashGap"
        pathDashAnimateTime={0}
        pathLabel={(item) => String((item as RenderPath).label)}
        pathTransitionDuration={0}
        pointsData={[sourcePoint, ...points]}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="altitude"
        pointRadius="radius"
        pointColor="color"
        pointLabel={(item) => String((item as { label: string }).label)}
        enablePointerInteraction
      />
      <div style={{ position: "absolute", left: 10, right: 10, bottom: 10, padding: 9, borderRadius: 12, background: "rgba(2,8,18,.82)", backdropFilter: "blur(9px)", border: "1px solid rgba(125,211,252,.2)" }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={button} onClick={() => setPlaying((value) => !value)} disabled={!wavefronts}>{playing ? "Pausa" : "▶ P/S"}</button>
          <button type="button" style={button} onClick={() => { setPlaying(false); setElapsedSec(0); }}>Reiniciar</button>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} style={{ ...button, padding: "6px 8px" }}><option value={5}>5×</option><option value={10}>10×</option><option value={30}>30×</option><option value={60}>60×</option></select>
          <strong style={{ color: "white", fontSize: 10 }}>t + {mins(elapsedSec)}</strong>
          <input type="range" min={0} max={durationSec} step={1} value={elapsedSec} onChange={(event) => { setPlaying(false); setElapsedSec(Number(event.target.value)); }} style={{ flex: "1 1 220px" }} />
        </div>
      </div>
    </div>

    <ImpactProfile event={event} impacts={impacts} />

    <div style={{ padding: "0 11px 11px" }}>
      <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900, marginBottom: 6 }}>PAÍSES / ÁREAS CON MAYOR POSIBILIDAD DE PERCEPCIÓN</div>
      <div style={{ display: "grid", gap: 6 }}>
        {impacts.filter((item) => item.probabilityMmi3 >= .01).slice(0, 12).map((item) => <div key={item.country} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1.4fr) repeat(5,minmax(64px,.7fr))", gap: 7, alignItems: "center", padding: 8, borderRadius: 9, background: "rgba(15,23,42,.66)", color: "#cbd5e1", fontSize: 9, overflowX: "auto" }}>
          <b style={{ color: impactColor(item,1) }}>{item.country}</b><span>MMI {item.meanMmi.toFixed(1)}</span><span>III+ {pct(item.probabilityMmi3)}</span><span>V+ {pct(item.probabilityMmi5)}</span><span>P {mins(item.pArrivalSec)}</span><span>S {mins(item.sArrivalSec)}</span>
        </div>)}
        {!impacts.some((item) => item.probabilityMmi3 >= .01) && <div style={{ color: "#64748b", fontSize: 10 }}>No aparecen países con P(MMI≥III) ≥1% en este cribado.</div>}
      </div>
      <p style={{ color: "#64748b", fontSize: 8.8, lineHeight: 1.5, margin: "8px 0 0" }}><b style={{ color: "#94a3b8" }}>Límite:</b> Allen–Wald–Worden 2012 Rhypo es una IPE para regiones corticales activas y no incorpora Vs30, cuenca, directividad, mecanismo focal ni geometría finita de ruptura. Distancias &gt;500 km se muestran solo como extrapolación orientativa. Para un evento con ShakeMap oficial, ese producto debe tener prioridad.</p>
    </div>
  </section>;
}
