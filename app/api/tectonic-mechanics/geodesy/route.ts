import { NextRequest, NextResponse } from "next/server";
import { loadNglGnssDeformation, emptyNglGnssResult, type GnssEventSource } from "@/lib/nglGnss";
import { GSRM_POLES_URL, MIDAS_URL, parseMidas, parsePoles, recoverNglEuler } from "@/lib/tectonicMechanics/adapters";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function POST(request:NextRequest) {
  const body=await request.json().catch(()=>null) as {event?:GnssEventSource}|null;
  const e=body?.event;
  if(!e || typeof e.id!=="string" || !e.id || !Number.isFinite(Date.parse(e.timeUtc)) || ![e.latitude,e.longitude,e.depthKm,e.magnitude].every(v=>typeof v==="number" && Number.isFinite(v)) || Math.abs(e.latitude)>90 || Math.abs(e.longitude)>180 || e.depthKm<0 || e.depthKm>800) return NextResponse.json({error:"Evento válido requerido."},{status:400});
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(48000)]),now=new Date().toISOString();
  const getText=async(url:string)=>{const r=await fetch(url,{signal,cache:"force-cache"});if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`);return r.text();};
  const caUrl="https://geodesy.unr.edu/gps_timeseries/IGS20/midas/midas.CA.txt",naUrl="https://geodesy.unr.edu/gps_timeseries/IGS20/midas/midas.NA.txt";
  const results=await Promise.allSettled([loadNglGnssDeformation(e,{signal,maxStations:8}),getText(GSRM_POLES_URL),getText(MIDAS_URL),getText(caUrl),getText(naUrl)]);
  const warnings=results.flatMap(r=>r.status==="rejected"?[String(r.reason)]:[]);
  const gnss=results[0].status==="fulfilled"?results[0].value:emptyNglGnssResult("NGL no disponible; no se sintetizan desplazamientos.");
  const poles=results[1].status==="fulfilled"?parsePoles(results[1].value):[];
  const global=results[2].status==="fulfilled"?parseMidas(results[2].value,now):[];
  for(const [index,code,url] of [[3,"CA",caUrl],[4,"NA",naUrl]] as const) {
    const result=results[index];
    if(result.status==="fulfilled") {const pole=recoverNglEuler(global,parseMidas(result.value,now,code,url),code);if(pole){const old=poles.findIndex(p=>p.plate===code);if(old>=0)poles.splice(old,1);poles.push(pole);}else warnings.push(`No se pudo reconstruir el Euler ${code} del marco NGL IGS20. Residual bloqueado si los marcos difieren.`);}
  }
  const velocities=global.filter(p=>Math.abs(p.lat-e.latitude)<=8 && Math.abs(p.lon-e.longitude)<=10);
  return NextResponse.json({gnss,gnssEventId:e.id,poles,velocities,warnings,provenance:[{name:"NGL IGS20, posiciones diarias; pretrend detrended ENU",url:"https://geodesy.unr.edu/PlugNPlayPortal.php",retrievedAt:now},{name:"GSRM 2014 Euler poles IGS08",url:GSRM_POLES_URL,retrievedAt:now},...[MIDAS_URL,caUrl,naUrl].map(url=>({name:"NGL MIDAS IGS20; periodos propios, contexto cinemático",url,retrievedAt:now}))]});
}
