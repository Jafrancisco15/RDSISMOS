"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MeshPhongMaterial } from "three";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { GlobeMapLayersResponse } from "@/lib/globeLayers";

export type CoreGlobeData = {
  poles: { source: string; url: string; points: Array<{ year: number; lat: number; lon: number }> };
  events: Array<{ year: number; magnitude: number; lat?: number; lon?: number; timeUtc?: string }>;
};
type Props = { data: CoreGlobeData; currentYear: number; jerks: Array<{ year: number; source: string }> };

export default function CoreSeismicGlobe({ data, currentYear, jerks }: Props) {
  const material = useMemo(() => new MeshPhongMaterial({ color: "#12354c", shininess: 8 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const container = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [width, setWidth] = useState(320);
  const [year, setYear] = useState(Math.min(currentYear, data.poles.points.at(-1)?.year ?? currentYear));
  const [playing, setPlaying] = useState(false);
  const [showQuakes, setShowQuakes] = useState(true);
  const [showPole, setShowPole] = useState(true);
  const [cumulative, setCumulative] = useState(false);
  const [borders, setBorders] = useState<GlobeMapLayersResponse["countryBorders"]>([]);
  const [mapError, setMapError] = useState(false);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    observer.observe(el);
    setWidth(Math.max(240, el.clientWidth));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/globe/layers?include=countries", { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<GlobeMapLayersResponse>; })
      .then(r => setBorders(r.countryBorders)).catch(() => { if (!controller.signal.aborted) setMapError(true); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setYear(y => y >= currentYear ? 1904 : y + 1), 900);
    return () => clearInterval(timer);
  }, [playing, currentYear]);
  const pole = data.poles.points.find(p => p.year === year);
  const quakes = useMemo(() => data.events.filter(e => (cumulative ? e.year <= year : e.year === year) && e.lat !== undefined && e.lon !== undefined), [data.events, year, cumulative]);
  const points = useMemo(() => [
    ...(showQuakes ? quakes.map(e => ({ lat: e.lat!, lng: e.lon!, color: e.magnitude >= 8 ? "#ff5252" : "#ffab72", radius: 0.2 + (e.magnitude - 7) * 0.2, label: `M${e.magnitude.toFixed(1)} · ${e.timeUtc?.slice(0, 10) ?? e.year} · ${e.lat!.toFixed(2)}°, ${e.lon!.toFixed(2)}°` })) : []),
    ...(showPole && pole ? [{ lat: pole.lat, lng: pole.lon, color: "#6ce0dc", radius: 0.65, label: `Polo norte magnético · ${year} · ${pole.lat.toFixed(3)}°, ${pole.lon.toFixed(3)}° (modelado)` }] : []),
  ], [showQuakes, quakes, showPole, pole, year]);
  const paths = useMemo(() => [
    ...borders.map(b => ({ coords: b.points.map(p => [p.lat, p.lng]), color: "#61778d", stroke: 0.45 })),
    ...(showPole ? [{ coords: data.poles.points.filter(p => p.year <= year).map(p => [p.lat, p.lon]), color: "#6ce0dc", stroke: 2.5 }] : []),
  ], [borders, data.poles.points, showPole, year]);
  const activeJerks = jerks.filter(j => j.year === year);
  return <div style={{ marginTop: 20, padding: 16, background: "#081724", border: "1px solid #20384a", borderRadius: 15 }}>
    <h3 style={{ marginTop: 0 }}>Globo histórico · polo magnético y M7+</h3>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
      <button onClick={() => setPlaying(p => !p)}>{playing ? "Pausar" : "Reproducir"}</button>
      <label>Año <select aria-label="Año del globo" value={year} onChange={e => { setYear(Number(e.target.value)); setPlaying(false); setSelected(""); }}>{Array.from({ length: currentYear - 1903 }, (_, i) => 1904 + i).map(y => <option key={y}>{y}</option>)}</select></label>
      <label><input type="checkbox" checked={showPole} onChange={e => setShowPole(e.target.checked)} /> Polo y trayectoria</label>
      <label><input type="checkbox" checked={showQuakes} onChange={e => setShowQuakes(e.target.checked)} /> M7+</label>
      <label><input type="checkbox" checked={cumulative} onChange={e => setCumulative(e.target.checked)} /> Sismos acumulados</label>
      <button onClick={() => globe.current?.pointOfView({ lat: 75, lng: pole?.lon ?? -90, altitude: 1.8 }, 700)}>Ver Ártico</button>
    </div>
    <input aria-label="Recorrer historia" type="range" min={1904} max={currentYear} value={year} onChange={e => { setYear(Number(e.target.value)); setPlaying(false); setSelected(""); }} style={{ width: "100%", marginTop: 16 }} />
    <p style={{ color: "#aec3d0" }}>{year} · {quakes.length} M7+ {cumulative ? "acumulados" : "del año"}{year === currentYear ? " (año incompleto)" : ""} · {pole ? `Polo: ${pole.lat.toFixed(2)}°, ${pole.lon.toFixed(2)}°` : "Sin posición del polo para este año"}</p>
    <div ref={container} style={{ width: "100%", overflow: "hidden", borderRadius: 12 }}>
      <Globe ref={globe} globeMaterial={material} width={width} height={Math.min(580, Math.max(340, width * 0.6))} backgroundColor="#06121e" showGraticules
        pointsData={points} pointColor="color" pointRadius="radius" pointAltitude={0.012} pointLabel="label" pointsTransitionDuration={0}
        onPointClick={p => setSelected((p as { label: string }).label)}
        pathsData={paths} pathPoints="coords" pathPointLat={p => (p as number[])[0]} pathPointLng={p => (p as number[])[1]} pathColor="color" pathStroke="stroke" pathPointAlt={0.008} pathTransitionDuration={0}
        onGlobeReady={() => globe.current?.pointOfView({ lat: 50, lng: -65, altitude: 2.1 })} />
    </div>
    {selected && <p role="status">{selected}</p>}
    {mapError && <p>Contornos geográficos no disponibles. Coordenadas y eventos siguen visibles.</p>}
    <p style={{ color: "#6ce0dc" }}>{activeJerks.length ? `Magnetic jerk del catálogo: ${activeJerks.map(j => j.source).join(" · ")}` : "Sin jerk catalogado en el año seleccionado."}</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Épocas de jerks">{jerks.map(j => <button key={j.year} aria-pressed={year === j.year} onClick={() => { setYear(j.year); setPlaying(false); setSelected(""); }}>{j.year}{j.year === 2024 ? "*" : ""}</button>)}</div>
    <p style={{ color: "#9eb4c2", fontSize: 12, lineHeight: 1.5 }}>Turquesa: trayectoria y posición modelada del polo norte magnético. Naranja: M7+; rojo: M8+. Toca un punto para ver sus datos. Los jerks son hitos temporales: este catálogo no contiene coordenadas para ubicarlos como epicentros. *2024: entrada provisional del catálogo existente.</p>
    <p style={{ color: "#9eb4c2", fontSize: 12 }}>Polo: <a href={data.poles.url} target="_blank" rel="noreferrer">{data.poles.source}</a>, {data.poles.points[0]?.year}–{data.poles.points.at(-1)?.year}. Sismos: USGS ComCat. La trayectoria se usa como contexto visual; la prueba histórica usa las medias BGS.</p>
  </div>;
}
