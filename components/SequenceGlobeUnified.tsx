"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import styles from "./SequenceGlobeEntry.module.css";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });
const DAY_TEXTURE = "https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg";
const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const DAY_MS = 86_400_000;
const PAGE_SIZE = 500;
const MAX_SEQUENCE_EVENTS = 1500;
const SURFACE_ALTITUDE = 0.56;
const BLOCK_BASE_ALTITUDE = 0.045;

type Mode = "global" | "sequence";
type ColorMode = "depth" | "time";
type GlobePoint = EarthquakeEvent & { lat:number; lng:number; altitude:number; radius:number; color:string };
type ScenePath = { id:string; color:string; width:number; points:Array<[number,number,number]> };
type SceneLabel = { id:string; lat:number; lng:number; altitude:number; text:string; color:string; size:number };
type UsgsFeature = { id:string; geometry?:{coordinates?:number[]}; properties?:Record<string,unknown> };
type RaisedBlock = { geometry:any; altitude:number };

function daysAgo(days:number){ const d=new Date(); d.setUTCDate(d.getUTCDate()-days); return d.toISOString(); }
function formatUtc(value:string){ return new Intl.DateTimeFormat("es-DO",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value)); }
function colorByDepth(d:number){ if(d<35)return"#ff5d2e"; if(d<70)return"#ffc857"; if(d<150)return"#51c7e8"; if(d<300)return"#3588d4"; return"#6d5dfc"; }
function colorByTime(t:string,a:number,b:number){ const v=Date.parse(t); const f=b>a?Math.max(0,Math.min(1,(v-a)/(b-a))):1; return `hsl(${(215-f*205).toFixed(0)} 88% 56%)`; }
function num(value:unknown,fallback=0){ const n=Number(value); return Number.isFinite(n)?n:fallback; }
function text(value:unknown,fallback=""){ return typeof value==="string"?value:fallback; }

function normalizeUsgs(feature:UsgsFeature):EarthquakeEvent|null{
  const c=feature.geometry?.coordinates; const p=feature.properties??{};
  if(!c||c.length<3)return null;
  const time=num(p.time,NaN); if(!Number.isFinite(time))return null;
  const place=text(p.place,"Ubicación no especificada");
  return {id:feature.id,externalId:feature.id,sourceCatalog:"USGS ComCat",timeUtc:new Date(time).toISOString(),updatedUtc:new Date(num(p.updated,time)).toISOString(),latitude:num(c[1]),longitude:num(c[0]),depthKm:Math.max(0,num(c[2])),magnitude:num(p.mag),magnitudeType:text(p.magType,"M"),place,countryOrRegion:place.split(",").at(-1)?.trim()??place,eventType:text(p.type,"earthquake"),status:text(p.status,"reported"),network:text(p.net,"USGS"),locationSource:text(p.locationSource,"us"),magnitudeSource:text(p.magSource,"us"),sourceUrl:text(p.url,"")};
}

async function parsePage(response:Response){
  const raw=await response.text(); let payload:EarthquakePage & {error?:string};
  try{payload=JSON.parse(raw) as EarthquakePage & {error?:string};}catch{throw new Error(`Respuesta inválida del servidor (HTTP ${response.status}).`);}
  if(!response.ok)throw new Error(payload.error??`HTTP ${response.status}`); return payload;
}

async function directUsgs(params:URLSearchParams,signal?:AbortSignal):Promise<EarthquakePage>{
  const direct=new URLSearchParams(params); direct.set("format","geojson"); direct.set("eventtype","earthquake");
  const response=await fetch(`${USGS_QUERY}?${direct}`,{cache:"no-store",signal,headers:{Accept:"application/geo+json, application/json"}});
  if(!response.ok)throw new Error(`USGS HTTP ${response.status}`);
  const payload=await response.json() as {features?:UsgsFeature[]};
  const events=(payload.features??[]).map(normalizeUsgs).filter((e):e is EarthquakeEvent=>Boolean(e));
  const limit=num(params.get("limit"),PAGE_SIZE); const offset=num(params.get("offset"),1);
  return {events,total:offset-1+events.length+(events.length===limit?1:0),limit,offset,hasMore:events.length===limit,generatedAt:new Date().toISOString(),provider:"USGS ComCat",providerStatus:["fallback directo USGS"],warnings:[],catalogMode:"historical-usgs"};
}

async function fetchPage(params:URLSearchParams,signal?:AbortSignal){
  try{return await parsePage(await fetch(`/api/sequence3d?${params}`,{cache:"no-store",signal}));}
  catch(error){if(error instanceof DOMException&&error.name==="AbortError")throw error;return directUsgs(params,signal);}
}

export function SequenceGlobeUnified(){
  const globeRef=useRef<GlobeMethods|undefined>(undefined); const containerRef=useRef<HTMLDivElement|null>(null);
  const [size,setSize]=useState({width:920,height:720}); const [mode,setMode]=useState<Mode>("global");
  const [globalDays,setGlobalDays]=useState(60); const [globalMinMagnitude,setGlobalMinMagnitude]=useState(4);
  const [globalEvents,setGlobalEvents]=useState<EarthquakeEvent[]>([]); const [sequenceEvents,setSequenceEvents]=useState<EarthquakeEvent[]>([]);
  const [selected,setSelected]=useState<EarthquakeEvent|null>(null); const [colorMode,setColorMode]=useState<ColorMode>("depth");
  const [radiusKm,setRadiusKm]=useState(150); const [beforeDays]=useState(2); const [afterDays]=useState(10);
  const [sequenceMinMagnitude,setSequenceMinMagnitude]=useState(1); const [depthExaggeration,setDepthExaggeration]=useState(2.2);
  const [timelinePct,setTimelinePct]=useState(100); const [playing,setPlaying]=useState(false); const [loading,setLoading]=useState(true);
  const [sequenceLoading,setSequenceLoading]=useState(false); const [error,setError]=useState<string|null>(null);

  useEffect(()=>{const n=containerRef.current;if(!n)return;const u=()=>setSize({width:Math.max(320,n.clientWidth),height:Math.max(650,Math.min(930,window.innerHeight*.8))});u();const o=new ResizeObserver(u);o.observe(n);return()=>o.disconnect();},[]);
  useEffect(()=>{const c=globeRef.current?.controls();if(!c)return;c.enableDamping=true;c.dampingFactor=.08;c.autoRotate=mode==="global";c.autoRotateSpeed=.18;},[mode]);
  useEffect(()=>{globeRef.current?.pointOfView({lat:8,lng:-35,altitude:2.05},800);},[]);

  useEffect(()=>{const controller=new AbortController();setLoading(true);setError(null);void(async()=>{try{const p=new URLSearchParams({starttime:daysAgo(globalDays),endtime:new Date().toISOString(),minmagnitude:String(globalMinMagnitude),orderby:"time",limit:"500",offset:"1"});const r=await fetchPage(p,controller.signal);setGlobalEvents(r.events);if(!r.events.length)setError("No llegaron eventos del catálogo. Toca Recargar.");}catch(e){if(e instanceof DOMException&&e.name==="AbortError")return;setError(e instanceof Error?e.message:"No fue posible cargar sismos recientes.");}finally{setLoading(false);}})();return()=>controller.abort();},[globalDays,globalMinMagnitude]);
  useEffect(()=>{if(!playing||mode!=="sequence")return;const t=window.setInterval(()=>setTimelinePct(v=>{if(v>=100){setPlaying(false);return 100;}return Math.min(100,v+1.25);}),130);return()=>window.clearInterval(t);},[mode,playing]);

  async function reconstruct(anchor:EarthquakeEvent){
    setSelected(anchor);setMode("sequence");setPlaying(false);setTimelinePct(100);setSequenceLoading(true);setError(null);
    globeRef.current?.pointOfView({lat:anchor.latitude-10,lng:anchor.longitude+8,altitude:.92},1100);
    try{const ms=Date.parse(anchor.timeUtc);const starttime=new Date(ms-beforeDays*DAY_MS).toISOString();const endtime=new Date(Math.min(Date.now(),ms+afterDays*DAY_MS)).toISOString();const base=new URLSearchParams({starttime,endtime,minmagnitude:String(sequenceMinMagnitude),latitude:String(anchor.latitude),longitude:String(anchor.longitude),maxradiuskm:String(radiusKm),orderby:"time-asc",limit:String(PAGE_SIZE)});const gathered:EarthquakeEvent[]=[];for(let page=0;page<3;page++){const p=new URLSearchParams(base);p.set("offset",String(page*PAGE_SIZE+1));const r=await fetchPage(p);gathered.push(...r.events);if(!r.hasMore)break;}const unique=[...new Map(gathered.map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(a.timeUtc)-Date.parse(b.timeUtc)).slice(0,MAX_SEQUENCE_EVENTS);setSequenceEvents(unique);if(!unique.length)setError("USGS no devolvió eventos para ese radio y ventana temporal.");}catch(e){setSequenceEvents([]);setError(e instanceof Error?e.message:"No fue posible reconstruir la secuencia.");}finally{setSequenceLoading(false);}
  }

  function returnGlobal(){setMode("global");setSequenceEvents([]);setTimelinePct(100);setPlaying(false);setError(null);setSelected(null);globeRef.current?.pointOfView({lat:8,lng:-35,altitude:2.05},800);}

  const times=useMemo(()=>sequenceEvents.map(e=>Date.parse(e.timeUtc)).filter(Number.isFinite),[sequenceEvents]);
  const t0=times.length?Math.min(...times):0,t1=times.length?Math.max(...times):0,cutoff=t0+(t1-t0)*(timelinePct/100);
  const visibleSequence=useMemo(()=>timelinePct>=100?sequenceEvents:sequenceEvents.filter(e=>Date.parse(e.timeUtc)<=cutoff),[cutoff,sequenceEvents,timelinePct]);
  const active=mode==="global"?globalEvents:visibleSequence;
  const minTime=mode==="global"?Date.now()-globalDays*DAY_MS:t0,maxTime=mode==="global"?Date.now():Math.max(t1,t0+1);
  const maxDepth=Math.max(30,...sequenceEvents.map(e=>e.depthKm));
  const usableDepthSpan=SURFACE_ALTITUDE-BLOCK_BASE_ALTITUDE;
  const depthScale=usableDepthSpan/Math.max(50,maxDepth);

  const blockBounds=useMemo(()=>{
    if(!selected)return null;
    const latHalf=Math.max(.35,radiusKm/111.2);
    const cos=Math.max(.18,Math.cos(selected.latitude*Math.PI/180));
    const lngHalf=Math.min(18,Math.max(.35,radiusKm/(111.2*cos)));
    return {south:selected.latitude-latHalf,north:selected.latitude+latHalf,west:selected.longitude-lngHalf,east:selected.longitude+lngHalf};
  },[radiusKm,selected]);

  const raisedBlock=useMemo<RaisedBlock[]>(()=>{
    if(mode!=="sequence"||!blockBounds)return[];
    const {south,north,west,east}=blockBounds;
    return [{altitude:SURFACE_ALTITUDE,geometry:{type:"Polygon",coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}}];
  },[blockBounds,mode]);

  const points=useMemo<GlobePoint[]>(()=>active.map(e=>{
    const projectedDepth=Math.min(usableDepthSpan,(e.depthKm*depthScale)*depthExaggeration);
    const altitude=mode==="sequence"?Math.max(BLOCK_BASE_ALTITUDE,SURFACE_ALTITUDE-projectedDepth):.012+Math.max(0,Math.min(.09,(e.magnitude-globalMinMagnitude)*.022));
    return {...e,lat:e.latitude,lng:e.longitude,altitude,radius:mode==="sequence"?Math.max(.05,Math.min(.16,.05+Math.max(0,e.magnitude)*.022)):.13+Math.max(0,Math.min(.42,(e.magnitude-globalMinMagnitude)*.12)),color:colorMode==="depth"?colorByDepth(e.depthKm):colorByTime(e.timeUtc,minTime,maxTime)};
  }),[active,colorMode,depthExaggeration,depthScale,globalMinMagnitude,maxTime,minTime,mode,usableDepthSpan]);

  const scenePaths=useMemo<ScenePath[]>(()=>{
    if(mode!=="sequence"||!blockBounds)return[];
    const paths:ScenePath[]=[];
    for(const p of points)paths.push({id:`stem-${p.id}`,color:p.color,width:.55,points:[[p.latitude,p.longitude,SURFACE_ALTITUDE],[p.latitude,p.longitude,p.altitude]]});
    const {south,north,west,east}=blockBounds;
    const corners:Array<[number,number]>=[[south,west],[south,east],[north,east],[north,west]];
    for(let i=0;i<4;i++){
      const [lat1,lng1]=corners[i], [lat2,lng2]=corners[(i+1)%4];
      paths.push({id:`top-edge-${i}`,color:"rgba(255,255,255,.96)",width:1.15,points:[[lat1,lng1,SURFACE_ALTITUDE+.004],[lat2,lng2,SURFACE_ALTITUDE+.004]]});
      paths.push({id:`base-edge-${i}`,color:"rgba(125,211,252,.72)",width:.7,points:[[lat1,lng1,BLOCK_BASE_ALTITUDE],[lat2,lng2,BLOCK_BASE_ALTITUDE]]});
      paths.push({id:`corner-${i}`,color:"rgba(255,255,255,.88)",width:.9,points:[[lat1,lng1,BLOCK_BASE_ALTITUDE],[lat1,lng1,SURFACE_ALTITUDE]]});
    }
    for(let i=0;i<=4;i++){
      const f=i/4,lat=south+(north-south)*f,lng=west+(east-west)*f;
      paths.push({id:`lat-${i}`,color:"rgba(235,245,255,.75)",width:.38,points:[[lat,west,SURFACE_ALTITUDE+.006],[lat,east,SURFACE_ALTITUDE+.006]]});
      paths.push({id:`lng-${i}`,color:"rgba(235,245,255,.75)",width:.38,points:[[south,lng,SURFACE_ALTITUDE+.006],[north,lng,SURFACE_ALTITUDE+.006]]});
    }
    return paths;
  },[blockBounds,mode,points]);

  const depthLabels=useMemo<SceneLabel[]>(()=>{
    if(mode!=="sequence"||!blockBounds||!selected)return[];
    const tickMax=Math.max(50,Math.ceil(maxDepth/50)*50);
    const ticks=[0,.25,.5,.75,1].map(f=>Math.round(tickMax*f/10)*10);
    return ticks.map((km,i)=>({id:`depth-${i}`,lat:blockBounds.south,lng:blockBounds.west,altitude:Math.max(BLOCK_BASE_ALTITUDE,SURFACE_ALTITUDE-Math.min(usableDepthSpan,(km*depthScale)*depthExaggeration)),text:`${km} km`,color:"#ffffff",size:.62}));
  },[blockBounds,depthExaggeration,depthScale,maxDepth,mode,selected,usableDepthSpan]);

  const maxMag=Math.max(0,...visibleSequence.map(e=>e.magnitude));
  const selectedDepth=selected?.depthKm??0;

  return <main className={styles.csicPage}><section className={styles.csicViewer}><div className={styles.csicGlobe} ref={containerRef}>
    <Globe ref={globeRef} width={size.width} height={size.height} globeImageUrl={DAY_TEXTURE} backgroundColor="#b8d2df" atmosphereColor="#bfe9f7" atmosphereAltitude={.12}
      polygonsData={raisedBlock} polygonGeoJsonGeometry={(d:object)=>(d as RaisedBlock).geometry} polygonAltitude={(d:object)=>(d as RaisedBlock).altitude} polygonCapColor={()=>"rgba(196,173,117,.90)"} polygonSideColor={()=>"rgba(25,45,58,.88)"} polygonStrokeColor={()=>"rgba(255,255,255,.98)"} polygonsTransitionDuration={700}
      pointsData={points} pointLat="lat" pointLng="lng" pointAltitude="altitude" pointRadius="radius" pointColor="color" pointsMerge={false}
      pointLabel={(point:object)=>{const e=point as GlobePoint;return `<div class=\"globe-tooltip\"><strong>M${e.magnitude.toFixed(1)} · ${e.place}</strong><span>${formatUtc(e.timeUtc)} UTC</span><small>${e.depthKm.toFixed(1)} km de profundidad</small></div>`;}}
      onPointClick={(point:object)=>{const e=point as GlobePoint;if(mode==="global")void reconstruct(e);else setSelected(e);}}
      pathsData={scenePaths} pathPoints="points" pathPointLat={(p:object)=>Number((p as [number,number,number])[0])} pathPointLng={(p:object)=>Number((p as [number,number,number])[1])} pathPointAlt={(p:object)=>Number((p as [number,number,number])[2])} pathColor={(d:object)=>[(d as ScenePath).color,(d as ScenePath).color]} pathStroke={(d:object)=>(d as ScenePath).width} pathDashLength={1} pathDashGap={0}
      labelsData={depthLabels} labelLat="lat" labelLng="lng" labelAltitude="altitude" labelText="text" labelColor="color" labelSize="size" labelDotRadius={.12} labelResolution={2}
      enablePointerInteraction />

    {(loading||sequenceLoading)&&<div className={styles.csicLoading}>{sequenceLoading?"Levantando bloque geológico…":"Cargando catálogo sísmico…"}</div>}
    {!loading&&!sequenceLoading&&error&&<div className={styles.csicError}>{error}<button onClick={()=>window.location.reload()}>Recargar</button></div>}

    {mode==="sequence"&&<div className={styles.depthScale} aria-label="Escala de profundidad"><b>PROFUNDIDAD</b><span>0 km</span><i/><span>{Math.round(maxDepth/2)} km</span><i/><span>{Math.round(maxDepth)} km</span><small>proyección vertical {depthExaggeration.toFixed(1)}×</small></div>}

    <aside className={styles.csicPanel}><div className={styles.csicPanelHead}><span>RDSISMOS</span><h2>SISMICIDAD 3D</h2><small>{mode==="global"?"Planeta · últimos sismos":selected?.place??"Secuencia local"}</small></div><div className={styles.csicMetrics}><div><b>{mode==="global"?globalEvents.length:visibleSequence.length}</b><span>eventos</span></div><div><b>{mode==="global"?Math.max(0,...globalEvents.map(e=>e.magnitude)).toFixed(1):maxMag.toFixed(1)}</b><span>mag. máx.</span></div></div>
    {mode==="global"?<><label><span>Ventana</span><select value={globalDays} onChange={e=>setGlobalDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label><label><span>Magnitud mínima</span><select value={globalMinMagnitude} onChange={e=>setGlobalMinMagnitude(Number(e.target.value))}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option></select></label><label><span>Color</span><select value={colorMode} onChange={e=>setColorMode(e.target.value as ColorMode)}><option value="depth">Profundidad</option><option value="time">Antigüedad</option></select></label><div className={styles.csicHint}>Toca un terremoto. El área local se separará claramente del planeta como un bloque geológico 3D.</div></>:<><div className={styles.csicDateRow}><span>{sequenceEvents.length?formatUtc(sequenceEvents[0].timeUtc):"—"}</span><b>→</b><span>{sequenceEvents.length?formatUtc(sequenceEvents.at(-1)!.timeUtc):"—"}</span></div><label><span>Radio</span><select value={radiusKm} onChange={e=>setRadiusKm(Number(e.target.value))}><option value={50}>50 km</option><option value={100}>100 km</option><option value={150}>150 km</option><option value={300}>300 km</option><option value={500}>500 km</option></select></label><label><span>Magnitud mínima</span><select value={sequenceMinMagnitude} onChange={e=>setSequenceMinMagnitude(Number(e.target.value))}><option value={0}>M0+</option><option value={1}>M1+</option><option value={2}>M2+</option><option value={3}>M3+</option><option value={4}>M4+</option></select></label><label><span>Proyección de profundidad</span><select value={depthExaggeration} onChange={e=>setDepthExaggeration(Number(e.target.value))}><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2.2}>2.2×</option><option value={3}>3×</option><option value={4}>4×</option></select></label><button className={styles.csicPrimary} onClick={()=>selected&&void reconstruct(selected)} disabled={!selected||sequenceLoading}>Actualizar bloque 3D</button><div className={styles.csicTimeline}><button onClick={()=>{if(!playing&&timelinePct>=100)setTimelinePct(0);setPlaying(v=>!v);}}>{playing?"Ⅱ":"▶"}</button><input type="range" min={0} max={100} value={timelinePct} onChange={e=>{setPlaying(false);setTimelinePct(Number(e.target.value));}}/><span>{visibleSequence.length} / {sequenceEvents.length} eventos</span></div><div className={styles.csicHint}>La placa beige es la superficie elevada. Los sismos quedan suspendidos debajo según profundidad; el marco blanco marca las paredes del bloque. Evento seleccionado: {selectedDepth.toFixed(1)} km.</div><button className={styles.csicSecondary} onClick={returnGlobal}>← Volver al planeta</button></>}
    <div className={styles.csicLegend}><i className={styles.shallow}/><span>&lt;35 km</span><i className={styles.mid}/><span>35–150 km</span><i className={styles.deep}/><span>&gt;150 km</span></div></aside>
  </div></section></main>;
}