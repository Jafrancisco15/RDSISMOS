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
type GlobePoint = EarthquakeEvent & { lat:number; lng:number; altitude:number; radius:number; color:string };

function daysAgo(days:number){ const d=new Date(); d.setUTCDate(d.getUTCDate()-days); return d.toISOString(); }
function formatUtc(value:string){ return new Intl.DateTimeFormat("es-DO",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value)); }
function colorByDepth(d:number){ if(d<35)return"#ff5d2e"; if(d<70)return"#ffc857"; if(d<150)return"#51c7e8"; if(d<300)return"#3588d4"; return"#3f51d7"; }
function colorByTime(t:string,a:number,b:number){ const v=Date.parse(t); const f=b>a?Math.max(0,Math.min(1,(v-a)/(b-a))):1; return `hsl(${(215-f*205).toFixed(0)} 88% 56%)`; }

async function fetchPage(params:URLSearchParams, signal?:AbortSignal){
  const response=await fetch(`/api/sequence3d?${params}`,{cache:"no-store",signal});
  const text=await response.text();
  let payload:EarthquakePage & {error?:string};
  try{ payload=JSON.parse(text) as EarthquakePage & {error?:string}; }
  catch{ throw new Error(`Respuesta inválida del servidor (HTTP ${response.status}).`); }
  if(!response.ok) throw new Error(payload.error??`HTTP ${response.status}`);
  return payload;
}

function FloatingSection({events,anchor,exaggeration}:{events:EarthquakeEvent[];anchor:EarthquakeEvent;exaggeration:number}){
  const width=360, height=220, pad=30;
  const cos=Math.max(.2,Math.cos(anchor.latitude*Math.PI/180));
  const pts=events.map(e=>({
    e,
    x:(e.longitude-anchor.longitude)*111.32*cos,
    y:Math.max(0,e.depthKm),
  }));
  const maxX=Math.max(20,...pts.map(p=>Math.abs(p.x)));
  const maxDepth=Math.max(40,...pts.map(p=>p.y));
  const sx=(x:number)=>width/2+(x/maxX)*(width/2-pad);
  const sy=(d:number)=>pad+(d/maxDepth)*(height-pad*1.55)*Math.min(1.7,Math.max(.65,exaggeration/2));
  return <div className={styles.floatingSection}>
    <div className={styles.sectionTitle}><span>SECCIÓN HIPOCENTRAL</span><b>corte E–O aproximado</b></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sección vertical de hipocentros">
      <line x1={pad} y1={pad} x2={width-pad} y2={pad} className={styles.surfaceLine}/>
      <line x1={width/2} y1={pad} x2={width/2} y2={height-pad/2} className={styles.anchorLine}/>
      {[0.25,0.5,0.75,1].map(f=><g key={f}><line x1={pad} y1={pad+(height-pad*1.55)*f} x2={width-pad} y2={pad+(height-pad*1.55)*f} className={styles.depthGrid}/><text x={4} y={pad+(height-pad*1.55)*f+4} className={styles.depthLabel}>{Math.round(maxDepth*f)} km</text></g>)}
      {pts.map(({e,x,y})=><circle key={e.id} cx={sx(x)} cy={Math.min(height-pad/2,sy(y))} r={Math.max(2.4,Math.min(7,e.magnitude*1.05))} fill={colorByDepth(e.depthKm)} opacity={.9}><title>{`M${e.magnitude.toFixed(1)} · ${e.depthKm.toFixed(1)} km · ${e.place}`}</title></circle>)}
      <text x={width/2} y={18} textAnchor="middle" className={styles.surfaceLabel}>superficie</text>
      <text x={width-6} y={height-5} textAnchor="end" className={styles.axisLabel}>E →</text>
      <text x={6} y={height-5} className={styles.axisLabel}>← O</text>
    </svg>
    <small>La sección está desplazada visualmente sobre el globo; las profundidades numéricas son las del catálogo USGS.</small>
  </div>;
}

export function SequenceGlobeUnified(){
  const globeRef=useRef<GlobeMethods|undefined>(undefined);
  const containerRef=useRef<HTMLDivElement|null>(null);
  const [size,setSize]=useState({width:920,height:650});
  const [mode,setMode]=useState<Mode>("global");
  const [globalDays,setGlobalDays]=useState(60);
  const [globalMinMagnitude,setGlobalMinMagnitude]=useState(4);
  const [globalEvents,setGlobalEvents]=useState<EarthquakeEvent[]>([]);
  const [sequenceEvents,setSequenceEvents]=useState<EarthquakeEvent[]>([]);
  const [selected,setSelected]=useState<EarthquakeEvent|null>(null);
  const [colorMode,setColorMode]=useState<ColorMode>("depth");
  const [radiusKm,setRadiusKm]=useState(150);
  const [beforeDays,setBeforeDays]=useState(2);
  const [afterDays,setAfterDays]=useState(10);
  const [sequenceMinMagnitude,setSequenceMinMagnitude]=useState(1);
  const [depthExaggeration,setDepthExaggeration]=useState(2);
  const [timelinePct,setTimelinePct]=useState(100);
  const [playing,setPlaying]=useState(false);
  const [loading,setLoading]=useState(true);
  const [sequenceLoading,setSequenceLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{ const n=containerRef.current; if(!n)return; const u=()=>setSize({width:Math.max(320,n.clientWidth),height:Math.max(520,Math.min(780,n.clientWidth*.8))}); u(); const o=new ResizeObserver(u);o.observe(n);return()=>o.disconnect();},[]);
  useEffect(()=>{ const c=globeRef.current?.controls(); if(!c)return;c.enableDamping=true;c.dampingFactor=.08;c.autoRotate=mode==="global";c.autoRotateSpeed=.22;},[mode]);
  useEffect(()=>{globeRef.current?.pointOfView({lat:8,lng:-35,altitude:2.05},800);},[]);

  useEffect(()=>{ const controller=new AbortController(); setLoading(true);setError(null); void(async()=>{try{const p=new URLSearchParams({starttime:daysAgo(globalDays),endtime:new Date().toISOString(),minmagnitude:String(globalMinMagnitude),orderby:"time",limit:"500"});const r=await fetchPage(p,controller.signal);setGlobalEvents(r.events);}catch(e){if(e instanceof DOMException&&e.name==="AbortError")return;setError(e instanceof Error?e.message:"No fue posible cargar sismos recientes.");}finally{setLoading(false);}})();return()=>controller.abort();},[globalDays,globalMinMagnitude]);
  useEffect(()=>{if(!playing||mode!=="sequence")return;const t=window.setInterval(()=>setTimelinePct(v=>{if(v>=100){setPlaying(false);return 100;}return Math.min(100,v+1.2);}),120);return()=>window.clearInterval(t);},[mode,playing]);

  async function reconstruct(anchor:EarthquakeEvent){
    setSelected(anchor);setMode("sequence");setPlaying(false);setTimelinePct(100);setSequenceLoading(true);setError(null);
    globeRef.current?.pointOfView({lat:anchor.latitude,lng:anchor.longitude,altitude:.78},850);
    try{
      const ms=Date.parse(anchor.timeUtc); const starttime=new Date(ms-beforeDays*DAY_MS).toISOString(); const endtime=new Date(Math.min(Date.now(),ms+afterDays*DAY_MS)).toISOString();
      const base=new URLSearchParams({starttime,endtime,minmagnitude:String(sequenceMinMagnitude),latitude:String(anchor.latitude),longitude:String(anchor.longitude),maxradiuskm:String(radiusKm),orderby:"time-asc",limit:String(PAGE_SIZE)});
      const gathered:EarthquakeEvent[]=[];
      for(let page=0;page<3;page++){const p=new URLSearchParams(base);p.set("offset",String(page*PAGE_SIZE+1));const r=await fetchPage(p);gathered.push(...r.events);if(!r.hasMore)break;}
      const unique=[...new Map(gathered.map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(a.timeUtc)-Date.parse(b.timeUtc)).slice(0,MAX_SEQUENCE_EVENTS);
      setSequenceEvents(unique);
      if(!unique.length)setError("USGS no devolvió eventos para ese radio y ventana temporal.");
    }catch(e){setSequenceEvents([]);setError(e instanceof Error?e.message:"No fue posible reconstruir la secuencia.");}finally{setSequenceLoading(false);}
  }
  function returnGlobal(){setMode("global");setSequenceEvents([]);setTimelinePct(100);setPlaying(false);setError(null);setSelected(null);globeRef.current?.pointOfView({lat:8,lng:-35,altitude:2.05},800);}

  const times=useMemo(()=>sequenceEvents.map(e=>Date.parse(e.timeUtc)).filter(Number.isFinite),[sequenceEvents]);
  const t0=times.length?Math.min(...times):0,t1=times.length?Math.max(...times):0,cutoff=t0+(t1-t0)*(timelinePct/100);
  const visibleSequence=useMemo(()=>timelinePct>=100?sequenceEvents:sequenceEvents.filter(e=>Date.parse(e.timeUtc)<=cutoff),[cutoff,sequenceEvents,timelinePct]);
  const active=mode==="global"?globalEvents:visibleSequence;
  const minTime=mode==="global"?Date.now()-globalDays*DAY_MS:t0,maxTime=mode==="global"?Date.now():Math.max(t1,t0+1),maxDepth=Math.max(30,...active.map(e=>e.depthKm));
  const points=useMemo<GlobePoint[]>(()=>active.map(e=>{const df=Math.max(0,Math.min(1,e.depthKm/maxDepth));return{...e,lat:e.latitude,lng:e.longitude,altitude:mode==="sequence"?.018+df*.16*depthExaggeration:.012+Math.max(0,Math.min(.09,(e.magnitude-globalMinMagnitude)*.022)),radius:mode==="sequence"?Math.max(.07,Math.min(.24,.07+Math.max(0,e.magnitude)*.03)):.13+Math.max(0,Math.min(.42,(e.magnitude-globalMinMagnitude)*.12)),color:colorMode==="depth"?colorByDepth(e.depthKm):colorByTime(e.timeUtc,minTime,maxTime)};}),[active,colorMode,depthExaggeration,globalMinMagnitude,maxDepth,maxTime,minTime,mode]);
  const rings=useMemo(()=>mode==="sequence"&&selected?[{lat:selected.latitude,lng:selected.longitude,maxRadius:Math.max(.45,radiusKm/111.2)}]:[],[mode,radiusKm,selected]);

  return <main className={styles.page}>
    <section className={styles.hero}><div><span className={styles.eyebrow}>RDSISMOS · SECUENCIA 3D</span><h1>{mode==="global"?"Selecciona un terremoto reciente":`Secuencia local · M${selected?.magnitude.toFixed(1)??"—"}`}</h1><p>{mode==="global"?"Toca un sismo sobre el planeta. La secuencia se reconstruye en ese mismo globo y genera un corte hipocentral flotante.":"La nube sobre el planeta conserva la posición geográfica; la sección flotante separa horizontalmente la secuencia y muestra la profundidad hacia abajo."}</p></div><div className={styles.count}><span>{mode==="global"?"Eventos globales":"Hipocentros"}</span><strong>{active.length.toLocaleString("es-DO")}</strong><small>{mode==="global"?`${globalDays} días · M${globalMinMagnitude.toFixed(1)}+`:`${radiusKm} km · M${sequenceMinMagnitude.toFixed(1)}+`}</small></div></section>
    {mode==="global"?<section className={styles.controls}><label><span>Ventana</span><select value={globalDays} onChange={e=>setGlobalDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label><label><span>Magnitud mínima</span><select value={globalMinMagnitude} onChange={e=>setGlobalMinMagnitude(Number(e.target.value))}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label><label><span>Color</span><select value={colorMode} onChange={e=>setColorMode(e.target.value as ColorMode)}><option value="depth">Profundidad</option><option value="time">Antigüedad</option></select></label></section>:<section className={`${styles.controls} ${styles.localControls}`}><button className={styles.backButton} onClick={returnGlobal}>← Vista global</button><label><span>Radio</span><select value={radiusKm} onChange={e=>setRadiusKm(Number(e.target.value))}><option value={50}>50 km</option><option value={100}>100 km</option><option value={150}>150 km</option><option value={300}>300 km</option><option value={500}>500 km</option></select></label><label><span>Mínima</span><select value={sequenceMinMagnitude} onChange={e=>setSequenceMinMagnitude(Number(e.target.value))}><option value={0}>M0+</option><option value={1}>M1+</option><option value={2}>M2+</option><option value={3}>M3+</option><option value={4}>M4+</option></select></label><label><span>Antes</span><select value={beforeDays} onChange={e=>setBeforeDays(Number(e.target.value))}><option value={1}>1 día</option><option value={2}>2 días</option><option value={7}>7 días</option><option value={14}>14 días</option></select></label><label><span>Después</span><select value={afterDays} onChange={e=>setAfterDays(Number(e.target.value))}><option value={3}>3 días</option><option value={7}>7 días</option><option value={10}>10 días</option><option value={30}>30 días</option></select></label><label><span>Exageración</span><select value={depthExaggeration} onChange={e=>setDepthExaggeration(Number(e.target.value))}><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option><option value={3}>3×</option></select></label><button onClick={()=>selected&&void reconstruct(selected)} disabled={!selected||sequenceLoading}>{sequenceLoading?"Reconstruyendo…":"Reconstruir"}</button></section>}
    <section className={`${styles.globeCard} ${mode==="sequence"?styles.sequenceMode:""}`}>
      <div className={styles.legend}>{colorMode==="depth"?<><span><i className={styles.shallow}/>&lt;35 km</span><span><i className={styles.mid}/>35–150 km</span><span><i className={styles.deep}/>&gt;150 km</span></>:<span>Azul = antiguo · rojo = reciente</span>}</div>
      <div className={styles.globe} ref={containerRef}>{(loading||sequenceLoading)&&<div className={styles.loading}>{sequenceLoading?"Consultando USGS y levantando la sección…":"Cargando sismos recientes…"}</div>}{!loading&&!sequenceLoading&&error&&<div className={styles.error}>{error}</div>}{!error&&<Globe ref={globeRef} width={size.width} height={size.height} globeImageUrl={DAY_TEXTURE} backgroundColor="rgba(221,235,244,0.08)" atmosphereColor="#8ed7f7" atmosphereAltitude={.13} pointsData={points} pointLat="lat" pointLng="lng" pointAltitude="altitude" pointRadius="radius" pointColor="color" pointLabel={(p:object)=>{const e=p as GlobePoint;return `<div class=\"globe-tooltip\"><strong>M${e.magnitude.toFixed(1)} · ${e.place}</strong><span>${formatUtc(e.timeUtc)} UTC</span><small>${e.depthKm.toFixed(1)} km de profundidad</small></div>`;}} onPointClick={(p:object)=>{const e=p as GlobePoint;if(mode==="global")void reconstruct(e);else setSelected(e);}} pointsTransitionDuration={400} ringsData={rings} ringLat="lat" ringLng="lng" ringAltitude={.006} ringColor={()=>["rgba(2,132,199,.9)","rgba(2,132,199,0)"]} ringMaxRadius="maxRadius" ringPropagationSpeed={0} ringRepeatPeriod={0} enablePointerInteraction/>}
        {mode==="sequence"&&selected&&visibleSequence.length>0&&<FloatingSection events={visibleSequence} anchor={selected} exaggeration={depthExaggeration}/>}</div>
      {mode==="global"?<div className={styles.hint}>Toca un punto para reconstruir la secuencia.</div>:<aside className={styles.sequencePanel}><div className={styles.sequenceHead}><div><span>Secuencia USGS</span><h2>{selected?.place}</h2></div><strong>{visibleSequence.length}/{sequenceEvents.length}</strong></div><div className={styles.timelineRow}><button onClick={()=>{if(timelinePct>=100)setTimelinePct(0);setPlaying(v=>!v);}}>{playing?"Pausar":"▶ Reproducir"}</button><input type="range" min="0" max="100" value={timelinePct} onChange={e=>{setPlaying(false);setTimelinePct(Number(e.target.value));}}/><small>{sequenceEvents.length?formatUtc(new Date(cutoff).toISOString()):"—"}</small></div><div className={styles.sequenceStats}><span><b>{Math.max(0,...visibleSequence.map(e=>e.magnitude)).toFixed(1)}</b>Magnitud máx.</span><span><b>{Math.max(0,...visibleSequence.map(e=>e.depthKm)).toFixed(0)} km</b>Profundidad máx.</span><span><b>{radiusKm} km</b>Radio</span></div></aside>}
    </section>
  </main>;
}
