"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { DEFAULT_ASSUMPTIONS, TIME_STOPS, type MaterialAssumptions, type MechanicsDataset, type ReceiverFault } from "@/lib/tectonicMechanics/types";
import { frameAt, maxwellTime, prepareNodes } from "@/lib/tectonicMechanics/physics";
import { acceptedTomography, faultReceivers, waveformRays } from "@/lib/tectonicMechanics/adapters";
import { volumeGrid } from "@/lib/tectonicMechanics/geometry";
import { evaluateRetrospective, type ValidationInput } from "@/lib/tectonicMechanics/validation";
import type { MechanicsLayers, MechanicsView } from "./TectonicMechanicsScene";
import styles from "./TectonicMechanics.module.css";

const Scene=dynamic(()=>import("./TectonicMechanicsScene").then(m=>m.TectonicMechanicsScene),{ssr:false,loading:()=> <div className={styles.loading}>Inicializando geometría 3D…</div>});
const INITIAL_LAYERS:MechanicsLayers={globe:true,plates:true,slab:true,faults:true,events:true,rupture:true,euler:true,velocity:false,residual:false,gnss:true,rays:true,reactions:true,grid:true,deform:false,insar:true};
const INITIAL_VIEW:MechanicsView={mode:"region",exploded:false,depthMin:0,depthMax:700,depthScale:1,cut:false,cutKm:0,field:"cfs",gain:1e7,motionScale:2};
const DEPTHS=[{label:"Todo",min:0,max:700},{label:"Surface",min:0,max:1},{label:"0–30",min:0,max:30},{label:"30–70",min:30,max:70},{label:"70–150",min:70,max:150},{label:"150–300",min:150,max:300},{label:"300–700",min:300,max:700}];
const display=(v:number|null|undefined,d=3)=>v===null||v===undefined?"—":Math.abs(v)>0 && Math.abs(v)<.001?v.toExponential(2):v.toLocaleString("es-DO",{maximumFractionDigits:d});
async function json<T>(url:string,signal:AbortSignal,body?:unknown):Promise<T> {
  const r=await fetch(url,{signal,...(body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok || data.error)throw new Error(data.error??`HTTP ${r.status}`);return data as T;
}
function checkDataset(value:unknown):asserts value is MechanicsDataset {
  if(!value || typeof value!=="object")throw new Error("Archivo JSON inválido.");
  const d=value as MechanicsDataset;
  if(d.version!=="1.0" || !Array.isArray(d.events) || !Array.isArray(d.sources) || !d.bounds || ![d.bounds.west,d.bounds.east,d.bounds.south,d.bounds.north].every(Number.isFinite) || d.bounds.east-d.bounds.west>12 || d.bounds.north-d.bounds.south>12 || d.bounds.east<=d.bounds.west || d.bounds.north<=d.bounds.south || d.events.length>20000 || d.sources.length>64 || !Array.isArray(d.poles) || !Array.isArray(d.velocities)||!Array.isArray(d.rays)||!Array.isArray(d.insar)||!Array.isArray(d.warnings)||!Array.isArray(d.provenance))throw new Error("Contrato 1.0 requerido; MVP regional ≤12° y ≤64 fuentes.");
  if(d.sources.some(s=>![s.lat,s.lon,s.depth,s.magnitude].every(Number.isFinite)||!Number.isFinite(Date.parse(s.originTime))||s.momentTensor && (s.momentTensor.length!==3 || s.momentTensor.some(r=>r.length!==3||!r.every(Number.isFinite)))))throw new Error("Coordenadas, tiempos o tensores inválidos.");
}

export function TectonicMechanics() {
  const [data,setData]=useState<MechanicsDataset|null>(null),[busy,setBusy]=useState("Cargando caso observado de Puerto Rico…"),[error,setError]=useState("");
  const [anchorId,setAnchorId]=useState(""),[selection,setSelection]=useState<string[]>([]),[mode,setMode]=useState<"one"|"many"|"all">("one");
  const [params,setParams]=useState<MaterialAssumptions>({...DEFAULT_ASSUMPTIONS,allowAssumedReceivers:true});
  const [layers,setLayers]=useState(INITIAL_LAYERS),[view,setView]=useState(INITIAL_VIEW),[plateCode,setPlateCode]=useState("CA");
  const [cursor,setCursor]=useState(6),[playing,setPlaying]=useState(false),[customTime,setCustomTime]=useState("");
  const [start,setStart]=useState("2020-01-01"),[end,setEnd]=useState("2020-01-31"),[bbox,setBbox]=useState("-70,16,-64,20"),[minMag,setMinMag]=useState(4.2);
  const [inspection,setInspection]=useState<Record<string,unknown>|null>(null),[report,setReport]=useState<ReturnType<typeof evaluateRetrospective>|null>(null);
  const [calEnd,setCalEnd]=useState("2020-01-15"),[valEnd,setValEnd]=useState("2020-02-01");
  const controller=useRef<AbortController|null>(null),fileRef=useRef<HTMLInputElement>(null);
  const onInspect=useCallback((value:Record<string,unknown>)=>setInspection(value),[]);
  const install=useCallback((d:MechanicsDataset)=>{
    checkDataset(d);const main=[...d.events].sort((a,b)=>b.magnitude-a.magnitude).find(e=>d.sources.some(s=>s.eventId===e.externalId && s.momentTensor))??d.events[0];
    setData(d);setAnchorId(main?.externalId??"");setSelection(main?[main.externalId]:[]);setMode("one");setCursor(6);setCustomTime("");setPlaying(false);setReport(null);setInspection(null);
  },[]);
  useEffect(()=>{
    const c=new AbortController();controller.current=c;
    json<MechanicsDataset>("/tectonic-mechanics/puerto-rico-2020.json",c.signal).then(install).catch(e=>{if(!c.signal.aborted)setError(String(e));}).finally(()=>{if(!c.signal.aborted)setBusy("");});
    return ()=>controller.current?.abort();
  },[install]);
  useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>{setCursor(v=>{if(v>=TIME_STOPS.length-1){setPlaying(false);return v;}return Math.min(TIME_STOPS.length-1,v+.12);});},220);return ()=>window.clearInterval(timer);},[playing]);
  const anchor=data?.events.find(e=>e.externalId===anchorId);
  const selectedSources=useMemo(()=>data?.sources.filter(s=>mode==="all" || (mode==="one"?s.eventId===anchorId:selection.includes(s.eventId)))??[],[data,mode,anchorId,selection]);
  const knownIds=useMemo(()=>new Set(selectedSources.map(s=>s.eventId)),[selectedSources]);
  const grid=useMemo(()=>data?volumeGrid(data.bounds):[],[data]);
  const receivers=useMemo(()=>faultReceivers(data?.faults??null,params,data?.generatedAt??""),[data,params]);
  const prepared=useMemo(()=>{
    if(!data)return [];
    const gridWithReceivers=grid.map(p=>({...p,receiver:params.allowAssumedReceivers?{...p,name:"Plano receptor uniforme (assumption)",plane:params.receiverPlane,assumptions:["Orientación receptora uniforme experimental; no identifica una falla real."],supportScore:30,resolutionScore:25,uncertainty:null,sourceCount:0,lastUpdated:data.generatedAt,confidenceKind:"heuristic-model"} as ReceiverFault:undefined}));
    return prepareNodes([...gridWithReceivers,...receivers.map(r=>({...r,receiver:r}))],selectedSources,params);
  },[data,grid,receivers,selectedSources,params]);
  const timestamp=useMemo(()=>{
    if(customTime && Number.isFinite(Date.parse(customTime)))return new Date(customTime).toISOString();
    const lo=Math.floor(cursor),hi=Math.min(TIME_STOPS.length-1,lo+1),f=cursor-lo;
    const seconds=TIME_STOPS[lo].seconds*(1-f)+TIME_STOPS[hi].seconds*f;
    return new Date((anchor?Date.parse(anchor.timeUtc):0)+seconds*1000).toISOString();
  },[cursor,customTime,anchor]);
  const frame=useMemo(()=>frameAt(prepared,selectedSources,timestamp,params),[prepared,selectedSources,timestamp,params]);
  const tomography=useMemo(()=>acceptedTomography(data?.phase3??null),[data?.phase3]);
  const modeled=frame.voxels.filter(v=>v.status==="modeled").length;
  function begin(label:string) {controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(label);setError("");setPlaying(false);return c;}
  async function refresh() {
    const bounds=bbox.split(",").map(Number);
    if(bounds.length!==4 || !bounds.every(Number.isFinite) || bounds[2]-bounds[0]>12 || bounds[3]-bounds[1]>12 || bounds[0]>=bounds[2] || bounds[1]>=bounds[3]){setError("Define oeste,sur,este,norte; el MVP admite regiones de hasta 12° × 12°.");return;}
    const c=begin("Consultando catálogo, GPlates, Slab2 y GEM…");
    try {
      const results=await Promise.allSettled([
        json<Pick<MechanicsDataset,"events"|"sources"|"bounds"|"startTime"|"endTime"|"warnings"|"provenance">>(`/api/tectonic-mechanics/catalog?${new URLSearchParams({start,end,bbox,min:String(minMag)})}`,c.signal),
        json<MechanicsDataset["structure"]>("/api/tectonic-depth-3d",c.signal),json<MechanicsDataset["faults"]>(`/api/faults?bbox=${encodeURIComponent(bbox)}&limit=3000`,c.signal),
      ]);
      if(c.signal.aborted)return;if(results[0].status!=="fulfilled")throw results[0].reason;
      const catalog=results[0].value;
      install({...catalog,version:"1.0",generatedAt:new Date().toISOString(),structure:results[1].status==="fulfilled"?results[1].value:null,faults:results[2].status==="fulfilled"?results[2].value:null,gnss:null,gnssEventId:null,velocities:[],poles:[],phase3:null,waveforms:null,rays:[],insar:[],warnings:[...catalog.warnings,...results.flatMap(r=>r.status==="rejected"?[String(r.reason)]:[])]});
    } catch(e){if(!c.signal.aborted)setError(String(e));}finally{if(!c.signal.aborted)setBusy("");}
  }
  async function loadObservations(kind:"gnss"|"waveforms") {
    if(!anchor||!data)return;const capturedId=anchorId;
    const c=begin(kind==="gnss"?"Descargando series GNSS y modelos de referencia NGL…":"Consultando waveforms reales Z/N/E y Fase 3…");
    try {
      if(kind==="gnss") {
        const result=await json<Pick<MechanicsDataset,"gnss"|"gnssEventId"|"velocities"|"poles"|"warnings"|"provenance">>("/api/tectonic-mechanics/geodesy",c.signal,{event:{...anchor,id:anchor.externalId}});
        if(!c.signal.aborted)setData(d=>d?{...d,...result,warnings:[...d.warnings,...result.warnings],provenance:[...d.provenance,...result.provenance]}:d);
      } else {
        const result=await json<{waveforms:MechanicsDataset["waveforms"];phase3:MechanicsDataset["phase3"];warnings:string[]}>("/api/tectonic-state-4d/phase2",c.signal,{event:anchor});
        if(!c.signal.aborted)setData(d=>d?{...d,waveforms:result.waveforms,phase3:result.phase3,rays:result.waveforms?waveformRays(result.waveforms):[],warnings:[...d.warnings,...result.warnings],provenance:[...d.provenance,{name:`Fases 2/3 de ${capturedId}`,url:"https://service.earthscope.org/",retrievedAt:new Date().toISOString()}]}:d);
      }
    } catch(e){if(!c.signal.aborted)setError(String(e));}finally{if(!c.signal.aborted)setBusy("");}
  }
  function selectAnchor(id:string) {controller.current?.abort();setBusy("");setAnchorId(id);setSelection([id]);setCustomTime("");setCursor(6);setReport(null);setPlaying(false);}
  function update<K extends keyof MaterialAssumptions>(key:K,value:MaterialAssumptions[K]) {setParams(p=>({...p,[key]:value,...(key==="maxwell" && value?{afterslipFraction:0}:{}),...(key==="afterslipFraction" && Number(value)>0?{maxwell:false}:{})}));setReport(null);}
  function exportExperiment() {
    const blob=new Blob([JSON.stringify({schema:"rdsismos-tectonic-mechanics-experiment/1.0",engine:"Kelvin-full-space-point-moment-v1",dataset:data,params,view,layers,anchorId,selection,mode,timestamp,plateCode,frame,acceptedTomography:tomography,validation:report},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`tectonic-state-4d-${anchorId||"experiment"}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importExperiment(file:File) {
    try {
      if(file.size>20000000)throw new Error("Archivo demasiado grande (máximo 20 MB).");
      const payload=JSON.parse(await file.text()),dataset=payload.dataset??payload;
      checkDataset(dataset);
      if(payload.schema==="rdsismos-tectonic-mechanics-experiment/1.0") {
        const p=payload.params as MaterialAssumptions;
        if(!p || ![p.shearModulusPa,p.poissonRatio,p.viscosityPaS,p.friction,p.crustKm,p.lithosphereKm,p.afterslipDays,p.afterslipFraction,p.receiverDepthKm,p.receiverPlane?.strike,p.receiverPlane?.dip,p.receiverPlane?.rake].every(Number.isFinite) || p.shearModulusPa<=0||p.viscosityPaS<=0||p.poissonRatio<=-1||p.poissonRatio>=.5||p.afterslipDays<=0||p.maxwell&&p.afterslipFraction>0)throw new Error("Supuestos físicos inválidos.");
        install(dataset);setParams(p);if(dataset.events.some(e=>e.externalId===payload.anchorId))setAnchorId(payload.anchorId);
        setSelection(Array.isArray(payload.selection)?payload.selection:[]);setMode(["one","many","all"].includes(payload.mode)?payload.mode:"one");
        if(Number.isFinite(Date.parse(payload.timestamp)))setCustomTime(payload.timestamp);
        const v=payload.view as MechanicsView;
        if(v && [v.depthMin,v.depthMax,v.depthScale,v.cutKm,v.gain,v.motionScale].every(Number.isFinite) && v.depthMin>=0 && v.depthMax<=700 && v.depthMin<=v.depthMax && v.depthScale>=1 && v.depthScale<=5 && v.gain>=1e3 && v.gain<=1e8 && ["region","globe"].includes(v.mode) && ["cfs","stress","support","dvp","dvs"].includes(v.field))setView(v);
        if(payload.layers && Object.keys(INITIAL_LAYERS).every(k=>typeof payload.layers[k]==="boolean"))setLayers(payload.layers);
        if(dataset.poles.some(p=>p.plate===payload.plateCode))setPlateCode(payload.plateCode);
      } else install(dataset);
      setError("");
    } catch(e){setError(String(e));}finally{if(fileRef.current)fileRef.current.value="";}
  }
  function validate() {
    if(!data || !selectedSources.length)return;
    try {
      const cutoff=new Date(Math.max(...selectedSources.map(s=>Date.parse(s.originTime)))+1000).toISOString();
      const frozen=frameAt(prepared,selectedSources,cutoff,params);
      const nodes=frozen.voxels.filter(v=>v.depth===10 && !v.id.startsWith("fault:") && v.deltaCFS!==null);
      const input:ValidationInput={calibration:{start:cutoff,end:`${calEnd}T00:00:00Z`},validation:{start:`${calEnd}T00:00:00Z`,end:`${valEnd}T00:00:00Z`},control:{start:`${data.startTime.slice(0,10)}T00:00:00Z`,end:new Date(Math.min(...selectedSources.map(s=>Date.parse(s.originTime)))).toISOString()},sourceEventIds:selectedSources.map(s=>s.eventId),sourceOriginTimes:selectedSources.map(s=>s.originTime),calibrationEventIds:[],validationEventIds:[],controlEventIds:[],bins:nodes.map(v=>({id:v.id,areaKm2:(6371*Math.PI/180*.5)**2*Math.cos(v.lat*Math.PI/180),deltaCfsPa:v.deltaCFS!,calibrationCount:0,validationCount:0,controlCount:0})),excludedEvents:0};
      if(Date.parse(input.validation.end)>Date.parse(`${data.endTime.slice(0,10)}T23:59:59.999Z`)+1)throw new Error("La ventana de validación supera el catálogo cargado.");
      for(const event of data.events) {
        if(knownIds.has(event.externalId))continue;
        const t=Date.parse(event.timeUtc),window=(t>=Date.parse(input.calibration.start)&&t<Date.parse(input.calibration.end))?"calibration":(t>=Date.parse(input.validation.start)&&t<Date.parse(input.validation.end))?"validation":(t>=Date.parse(input.control.start)&&t<Date.parse(input.control.end))?"control":null;
        if(!window)continue;
        const i=event.depthKm<=30 && event.depthKm>=0?nodes.findIndex(n=>Math.abs(event.latitude-n.lat)<=.25 && Math.abs(event.longitude-n.lon)<=.25):-1;
        if(i<0){input.excludedEvents++;continue;}
        input.bins[i][`${window}Count`]++;input[`${window}EventIds`].push(event.externalId);
      }
      setReport(evaluateRetrospective(input));
    }catch(e){setError(String(e));}
  }
  function toggle(key:keyof MechanicsLayers) {setLayers(p=>({...p,[key]:!p[key]}));}
  const switchLayer=(key:keyof MechanicsLayers,label:string)=> <label key={key} className={styles.switch}><input type="checkbox" checked={layers[key]} onChange={()=>toggle(key)}/>{label}</label>;

  return <main className={styles.module}>
    <header className={styles.header}><div><span className={styles.eyebrow}>RDSISMOS · LABORATORIO EXPERIMENTAL</span><h1>Tectonic State 4D <span>Estado mecánico 3D</span></h1><p>Reconstrucción en X / Y / Z / tiempo. Observaciones, estructura y respuesta mecánica con procedencia visible.</p></div><button onClick={exportExperiment} disabled={!data}>Exportar experimento JSON</button></header>
    <div className={styles.notice}><strong>Modelo experimental, sin predicción sísmica.</strong> Kelvin en medio infinito homogéneo; sin superficie libre. ΔCFS es un cambio sobre un plano receptor declarado. Los colores de actividad de Fase 1 y δV de Fase 3 conservan su significado independiente.</div>
    <details className={styles.panel}><summary>Región, catálogo e importación reproducible</summary><div className={styles.controls}>
      <label>Desde (UTC)<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Hasta (UTC)<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Oeste,sur,este,norte<input value={bbox} onChange={e=>setBbox(e.target.value)}/></label><label>Magnitud mínima<input type="number" min={4} max={9} step={.1} value={minMag} onChange={e=>setMinMag(Number(e.target.value))}/></label><button onClick={refresh} disabled={!!busy}>Consultar región</button><button onClick={()=>fileRef.current?.click()} disabled={!!busy}>Importar JSON</button><input hidden ref={fileRef} type="file" accept="application/json,.json" onChange={e=>{if(e.target.files?.[0])void importExperiment(e.target.files[0]);}}/>
    </div><p>Puerto Rico 2020 es el caso inicial observado. La mecánica se evalúa por regiones; globo, coordenadas y contratos permiten incorporar otras regiones. La consulta actualiza el catálogo; los experimentos exportados conservan sus entradas.</p></details>
    {busy && <div role="status" className={styles.status}>{busy}</div>}{error && <div role="alert" className={styles.error}>{error}</div>}
    {data && <>
      <div className={styles.metrics}><article><span>Catálogo observado</span><b>{data.events.length}</b><small>{data.startTime.slice(0,10)} → {data.endTime.slice(0,10)}</small></article><article><span>Fuentes con tensor</span><b>{data.sources.filter(s=>s.momentTensor).length}</b><small>{selectedSources.length} seleccionadas · {frame.activeSourceIds.length} activas</small></article><article><span>Nodos calculables</span><b>{modeled} / {frame.voxels.length}</b><small>Resolución mecánica heurística ≤30/100</small></article><article><span>GNSS / tomografía aceptada</span><b>{data.gnss?.stationCount??0} / {tomography.length}</b><small>Estaciones / voxeles que pasan el gate</small></article></div>
      <div className={styles.controls}>
        <label className={styles.eventSelect}>Evento de referencia<select aria-label="Evento de referencia" value={anchorId} disabled={!!busy} onChange={e=>selectAnchor(e.target.value)}>{[...data.events].sort((a,b)=>b.magnitude-a.magnitude).map(e=><option key={e.externalId} value={e.externalId}>M{e.magnitude.toFixed(1)} · {e.timeUtc.slice(0,16)} · {e.place}</option>)}</select></label>
        <label>Fuentes acumuladas<select value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setReport(null);}}><option value="one">Un evento</option><option value="many">Selección múltiple</option><option value="all">Todos los productos consultados</option></select></label>
        <button disabled={!!busy||!anchor} onClick={()=>loadObservations("gnss")}>Cargar GNSS / Euler</button><button disabled={!!busy||!anchor} onClick={()=>loadObservations("waveforms")}>Cargar waveforms / Fase 3</button>
      </div>
      {mode==="many" && <div className={styles.eventList}>{data.sources.map(s=><label key={s.eventId}><input type="checkbox" checked={selection.includes(s.eventId)} onChange={e=>{setSelection(ids=>e.target.checked?[...ids,s.eventId]:ids.filter(id=>id!==s.eventId));setReport(null);}}/>M{s.magnitude} · {s.originTime.slice(0,16)} · {s.momentTensor?"tensor":"sin tensor"}</label>)}</div>}
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <h2>Capas independientes</h2><h3>Observación directa</h3>{switchLayer("events","Sismos a profundidad")}{switchLayer("gnss","GNSS ENU · época diaria")}{switchLayer("velocity","GNSS MIDAS · mm/año")}{switchLayer("insar","InSAR LOS, si existe")}
          <h3>Modelos estructurales</h3>{switchLayer("globe","Globo transparente")}{switchLayer("plates","Volúmenes de placas")}{switchLayer("slab","Slab2 · isobatas / interpolación")}{switchLayer("faults","Fallas GEM")}{switchLayer("euler","Movimiento Euler")}{switchLayer("residual","Residual GNSS − Euler")}
          <label>Modelo de placa<select value={plateCode} onChange={e=>setPlateCode(e.target.value)}>{data.poles.map(p=><option key={p.plate} value={p.plate}>{p.plate} · {p.frame}</option>)}</select></label><small>Asignación CA/NA y microbloques debe comprobarse. MIDAS es contexto de sus propias épocas, separado del estado de 2020.</small>
          <h3>Modelo mecánico</h3>{switchLayer("rupture","Planos nodales / slip")}{switchLayer("grid","Nodos / campo interior")}{switchLayer("reactions","Reaction Vectors")}{switchLayer("deform","Deformar malla, amplificado")}{switchLayer("rays","Trayectorias P/S transitorias")}
          <label>Campo mostrado<select value={view.field} onChange={e=>setView(v=>({...v,field:e.target.value as MechanicsView["field"]}))}><option value="cfs">ΔCFS · Pa</option><option value="stress">Norma del tensor Δσ · Pa</option><option value="support">Soporte / regiones desconocidas</option><option value="dvp">δVp/Vp · %</option><option value="dvs">δVs/Vs · %</option></select></label>
          <h3>Perturbaciones externas</h3><p>Geomagnetismo, actividad solar y luna permanecen en sus pestañas independientes. No entran en estas ecuaciones de stress.</p>
        </aside>
        <section className={styles.viewport}>
          <div className={styles.viewControls}><button onClick={()=>setView(v=>({...v,mode:v.mode==="region"?"globe":"region"}))}>{view.mode==="region"?"Ver globo":"Enfocar región"}</button><label><input type="checkbox" checked={view.exploded} onChange={e=>setView(v=>({...v,exploded:e.target.checked}))}/> Exploded view</label><label><input type="checkbox" checked={view.cut} onChange={e=>setView(v=>({...v,cut:e.target.checked}))}/> Corte E–O</label>{view.cut && <label>Corte, km E<input aria-label="Posición del corte" type="range" min={-600} max={600} step={10} value={view.cutKm} onChange={e=>setView(v=>({...v,cutKm:Number(e.target.value)}))}/></label>}</div>
          <div className={styles.canvas}><Scene data={data} frame={frame} params={params} layers={layers} view={view} anchorId={anchorId} plateCode={plateCode} onInspect={onInspect}/><div className={styles.canvasLabel}>ENU · profundidad positiva hacia abajo<br/>Arrastrar: rotar · rueda: zoom · clic: inspeccionar</div></div>
          <div className={styles.depthControls}>{DEPTHS.map(d=><button key={d.label} aria-pressed={view.depthMin===d.min&&view.depthMax===d.max} onClick={()=>setView(v=>({...v,depthMin:d.min,depthMax:d.max}))}>{d.label}</button>)}<label>Desde km<input aria-label="Profundidad mínima" type="number" min={0} max={view.depthMax} value={view.depthMin} onChange={e=>setView(v=>({...v,depthMin:Math.max(0,Math.min(v.depthMax,Number(e.target.value)))}))}/></label><label>Hasta {view.depthMax} km<input aria-label="Profundidad máxima" type="range" min={view.depthMin} max={700} value={view.depthMax} onChange={e=>setView(v=>({...v,depthMax:Number(e.target.value)}))}/></label></div>
          <div className={styles.legend}><span className={styles.green}>● ΔCFS positivo: carga</span><span className={styles.blue}>● ΔCFS negativo: descarga</span><span>● gris / transparente: insuficiente</span><span>δV+: más rápido · δV−: más lento</span><span>Color mecánico satura a |10 kPa|; norma Δσ, amarillo. Flechas de malla: 1 de cada 12.</span></div>
          <div className={styles.timeline}><div><strong>TIME MACHINE</strong><time>{timestamp.replace("T"," ").slice(0,19)} UTC</time><button onClick={()=>{setCustomTime("");if(cursor>=10)setCursor(0);setPlaying(v=>!v);}}>{playing?"Pausar":"Reproducir"}</button></div><input aria-label="Evolución temporal" type="range" min={0} max={10} step={.01} value={cursor} onChange={e=>{setPlaying(false);setCustomTime("");setCursor(Number(e.target.value));}}/><div className={styles.stops}>{TIME_STOPS.map((t,i)=><button key={t.label} aria-pressed={Math.round(cursor)===i && !customTime} onClick={()=>{setCursor(i);setCustomTime("");setPlaying(false);}}>{t.label}</button>)}</div><label>Instante personalizado (UTC)<input type="datetime-local" value={timestamp.slice(0,19)} step={1} onChange={e=>{setPlaying(false);setCustomTime(`${e.target.value}Z`);}}/></label><p>Se superponen tensores de fuentes ya ocurridas. Las trayectorias desaparecen tras el paso de la onda; su brillo no está calibrado en Pa. PP/SS no están disponibles en el trazador actual.</p></div>
        </section>
      </div>
      <div className={styles.twoColumns}>
        <details className={styles.panel} open><summary>Supuestos físicos activos y escalas</summary><div className={styles.controls}>
          <label>μ (GPa)<input type="number" min={1} max={100} value={params.shearModulusPa/1e9} onChange={e=>update("shearModulusPa",Math.max(1,Math.min(100,Number(e.target.value)))*1e9)}/></label><label>η (log10 Pa·s)<input type="number" min={16} max={23} step={.25} value={Math.log10(params.viscosityPaS)} onChange={e=>update("viscosityPaS",10**Math.max(16,Math.min(23,Number(e.target.value))))}/></label><label>μ′ fricción efectiva<input type="number" min={0} max={1} step={.05} value={params.friction} onChange={e=>update("friction",Math.max(0,Math.min(1,Number(e.target.value))))}/></label>
          <label>Espesor cortical supuesto, km<input type="number" min={5} max={params.lithosphereKm-5} value={params.crustKm} onChange={e=>update("crustKm",Math.max(5,Math.min(params.lithosphereKm-5,Number(e.target.value))))}/></label><label>Base litosfera supuesta, km<input type="number" min={params.crustKm+5} max={200} value={params.lithosphereKm} onChange={e=>update("lithosphereKm",Math.max(params.crustKm+5,Math.min(200,Number(e.target.value))))}/></label>
        </div><label className={styles.switch}><input type="checkbox" checked={params.allowAssumedReceivers} onChange={e=>update("allowAssumedReceivers",e.target.checked)}/> Permitir planos receptores asumidos para explorar ΔCFS</label><div className={styles.controls}>{(["strike","dip","rake"] as const).map(k=><label key={k}>{k} receptor uniforme, °<input type="number" min={k==="rake"?-180:0} max={k==="dip"?90:k==="strike"?360:180} value={params.receiverPlane[k]} onChange={e=>update("receiverPlane",{...params.receiverPlane,[k]:Math.max(k==="rake"?-180:0,Math.min(k==="dip"?90:k==="strike"?360:180,Number(e.target.value)))})}/></label>)}<label>Profundidad receptores GEM, km<input type="number" min={0} max={40} value={params.receiverDepthKm} onChange={e=>update("receiverDepthKm",Math.max(0,Math.min(40,Number(e.target.value))))}/></label></div>
          <label className={styles.switch}><input type="checkbox" checked={params.maxwell} onChange={e=>update("maxwell",e.target.checked)}/> Maxwell local: deformación total fija bajo la litosfera</label><p>τ = η/μ = <b>{display(maxwellTime(params.viscosityPaS,params.shearModulusPa)/86400,1)} días</b>. Relaja stress desviador; conserva la parte volumétrica. No resuelve el equilibrio espacial ni genera desplazamiento postsísmico superficial. Burgers requiere otro solver.</p>
          <label>Afterslip prescrito, fracción del M₀ inicial (0–0.5)<input type="number" min={0} max={.5} step={.05} value={params.afterslipFraction} onChange={e=>update("afterslipFraction",Math.max(0,Math.min(.5,Number(e.target.value))))}/></label><p>Escenario de slip en el mismo plano: f(t)=A(1−e⁻ᵗ/ᵀ), T={params.afterslipDays} días. Se activa separado de Maxwell para evitar una superposición temporal incorrecta.</p>
          <div className={styles.controls}><label>Exageración de profundidad ×{view.depthScale}<input type="range" min={1} max={5} step={.5} value={view.depthScale} onChange={e=>setView(v=>({...v,depthScale:Number(e.target.value)}))}/></label><label>Desplazamiento visual ×10^{Math.log10(view.gain)}<input type="range" min={3} max={8} step={1} value={Math.log10(view.gain)} onChange={e=>setView(v=>({...v,gain:10**Number(e.target.value)}))}/></label></div><p>Flechas limitadas visualmente a 280 km. La malla usa el nodo calculable próximo dentro de la misma celda. Es interpolación visual; no modifica las mediciones ni sus unidades.</p>
        </details>
        <section className={styles.panel}><h2>Inspector de evidencia</h2><label>Inspección numérica de nodos<select aria-label="Inspeccionar voxel" value="" onChange={e=>{const voxel=frame.voxels.find(v=>v.id===e.target.value);if(voxel)onInspect({layer:"Voxel mecánico · SI",...voxel});}}><option value="">Seleccionar lat / lon / profundidad</option>{frame.voxels.map(v=><option key={v.id} value={v.id}>{v.lat.toFixed(2)}, {v.lon.toFixed(2)} · {v.depth} km · {v.status}</option>)}</select></label>{inspection?<pre>{JSON.stringify(inspection,null,2)}</pre>:<p>Selecciona un sismo, plano, falla, voxel o vector en el visor para ver coordenadas, valores, unidades y procedencia.</p>}<p>ΔCFS = s·(Δσ·n) + μ′ n·(Δσ·n), normal positiva en tensión. Reaction Vector = u − (u·n)n. El vector es desplazamiento inducido tangente al receptor; su color expresa ΔCFS.</p><p>Insufficient constraints: fuente sin tensor, distancia menor que max(15 km, 2 longitudes de ruptura), distancia mayor de 700 km o receptor sin orientación habilitada. La incertidumbre mecánica está sin cuantificar; support/resolution son indicadores heurísticos del MVP.</p></section>
      </div>
      <section className={styles.panel}><h2>Observaciones que sostienen este estado</h2><div className={styles.tableWrap}><table><thead><tr><th>Familia</th><th>Disponibilidad</th><th>Interpretación / restricciones</th></tr></thead><tbody>
        <tr><td>Placas / volumen</td><td>{data.structure?.platePolygons.features.length??0} polígonos</td><td>GPlates {data.structure?.gplatesModel}; espesor cortical y LAB son assumptions. CRUST1.0 no integrado.</td></tr><tr><td>Slab / fallas</td><td>{data.structure?.slabContours.length??0} isobatas / {data.faults?.features.length??0} fallas</td><td>Slab2 es geometría modelada; GEM es una traza con orientación variable.</td></tr><tr><td>GNSS ENU</td><td>{data.gnss?.stationCount??0} estaciones · {data.gnssEventId===anchorId?"mismo evento":"otro evento / cargar"}</td><td>IGS20; tendencia presísmica removida. Solo muestra una muestra diaria pasada de menos de 36 horas. Fuera de cobertura, no extrapola.</td></tr><tr><td>δVp / δVs</td><td>{tomography.length?`${tomography.length} voxeles aceptados`:"insufficient constraints"}</td><td>Fase 3: gate de evento, resolución ≥42 y consistencia de signo ≥0.67 por componente; opacidad ∝ resolución².</td></tr><tr><td>Waveforms / raypaths</td><td>{data.waveforms?.traceCount??0} trazas / {data.rays.length} trayectorias</td><td>Geometría IASP91 con estaciones observadas. Falta calibración para estimar dynamic stress en Pa.</td></tr><tr><td>InSAR LOS</td><td>{data.insar.length||"insufficient constraints"}</td><td>Contrato LOS con look vector y fechas; sin fusión ENU automática ni raster precargado.</td></tr>
      </tbody></table></div>{data.waveforms?.stations.map(station=><details key={`${station.network}.${station.station}`}><summary>{station.network}.{station.station} · {station.components.length} componentes reales</summary>{station.components.map(trace=>{
        const samples=trace.samples;const min=samples[0]?.tSec??0,max=samples.at(-1)?.tSec??1;
        return <div key={trace.channel}><small>{trace.channel} · amplitud normalizada, no Pa</small><svg viewBox="0 0 600 55" width="100%" height={55} aria-label={`Waveform ${trace.channel}`}><path fill="none" stroke="#7acbd7" strokeWidth="1" d={samples.map((p,i)=>`${i?"L":"M"}${((p.tSec-min)/Math.max(1,max-min)*600).toFixed(2)},${(27-p.normalized*24).toFixed(2)}`).join(" ")}/></svg></div>;
      })}</details>)}</section>
      <details className={styles.panel}><summary>Validación retrospectiva con ventanas disjuntas</summary><p>Campo ΔCFS congelado después de la última fuente seleccionada. Ajuste log-lineal espacial en calibración; evaluación en otra ventana; control anterior como placebo. Las celdas sin solución se excluyen y se contabilizan.</p><div className={styles.controls}><label>Fin de calibración / inicio validación<input type="date" value={calEnd} onChange={e=>setCalEnd(e.target.value)}/></label><label>Fin validación, exclusivo<input type="date" value={valEnd} onChange={e=>setValEnd(e.target.value)}/></label><button onClick={validate} disabled={!params.allowAssumedReceivers}>Evaluar separación temporal</button></div>{report && <pre>{JSON.stringify(report,null,2)}</pre>}<p>Se calcula likelihood gain espacial, ROC/PR, falsos positivos/negativos y asociación ΔCFS–actividad cuando hay suficientes casos. Deformación–actividad requiere pares geodésicos independientes; actualmente sin resultado. Sin validación prospectiva ni afirmación predictiva.</p></details>
      <details className={styles.panel}><summary>Procedencia, advertencias y reproducibilidad</summary><p>Snapshot: {data.generatedAt}. {data.events.filter(e=>!data.sources.some(s=>s.eventId===e.externalId)).length} eventos de catálogo sin producto físico consultado. Los productos revisados pueden ser posteriores a t₀: este es un análisis retrospectivo.</p><ul>{[...data.warnings,...(data.structure?.warnings??[]),...(data.gnss?.warnings??[])].map((w,i)=><li key={`${i}:${w}`}>{w}</li>)}</ul><ul>{data.provenance.map((p,i)=><li key={`${i}:${p.name}`}><a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> · {p.retrievedAt}{p.sha256 && <small>SHA256 {p.sha256}</small>}</li>)}</ul><p>Referencias: <a href="https://pubs.usgs.gov/of/2011/1060/" target="_blank" rel="noreferrer">Coulomb / USGS</a> · <a href="https://www.usgs.gov/data/slab2-a-comprehensive-subduction-zone-geometry-model" target="_blank" rel="noreferrer">Slab2</a> · <a href="https://pylith.readthedocs.io/en/latest/user/governingeqns/elasticity/bulk-rheologies/linear-maxwell.html" target="_blank" rel="noreferrer">Maxwell / PyLith</a>. El motor puntual no es Okada ni PyLith. Los módulos anteriores permanecen independientes.</p></details>
    </>}
  </main>;
}
