import { NextRequest, NextResponse } from "next/server";
import { eventFromComcat, sourceFromComcat } from "@/lib/tectonicMechanics/adapters";
import type { EarthquakeStateChange } from "@/lib/tectonicMechanics/types";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
  const q=request.nextUrl.searchParams;
  const start=q.get("start")??"2020-01-01",end=q.get("end")??"2020-01-31";
  const box=(q.get("bbox")??"-70,16,-64,20").split(",").map(Number);
  const [west,south,east,north]=box,min=Number(q.get("min")??4.2);
  if(!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end)<Date.parse(start) || Date.parse(end)-Date.parse(start)>366*86400000 || box.length!==4 || !box.every(Number.isFinite) || west>=east || south>=north || west< -180 || east>180 || south< -89 || north>89 || !Number.isFinite(min) || min<4 || min>9) return NextResponse.json({error:"Periodo ≤366 días, magnitud 4–9 y región geográfica válidos requeridos; divida regiones que cruzan el antimeridiano."},{status:400});
  const params=new URLSearchParams({format:"geojson",starttime:start,endtime:`${end.slice(0,10)}T23:59:59.999Z`,minmagnitude:String(min),minlatitude:String(south),maxlatitude:String(north),minlongitude:String(west),maxlongitude:String(east),orderby:"time-asc",limit:"401"});
  const url=`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`;
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(52000)]);
  try {
    const response=await fetch(url,{signal,cache:"no-store"});
    if(!response.ok) throw new Error(`USGS HTTP ${response.status}`);
    const json=await response.json() as {features:Array<Record<string,unknown>>};
    const events=json.features.map(eventFromComcat).filter(e=>e!==null).slice(0,400);
    const sources:EarthquakeStateChange[]=[],warnings:string[]=[];
    const candidates=[...events].sort((a,b)=>b.magnitude-a.magnitude).slice(0,32);
    for(let i=0;i<candidates.length;i+=8) {
      const batch=await Promise.allSettled(candidates.slice(i,i+8).map(async event=>{
        const detail=await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(event.externalId)}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),cache:"no-store"});
        if(!detail.ok) throw new Error(`${event.externalId}: HTTP ${detail.status}`);
        return sourceFromComcat(await detail.json(),event);
      }));
      batch.forEach((r,j)=>{if(r.status==="fulfilled") sources.push(r.value);else warnings.push(`Sin producto de fuente: ${candidates[i+j].externalId}.`);});
    }
    if(json.features.length>400) warnings.push("Catálogo truncado a los primeros 400 eventos; reduzca el periodo o aumente la magnitud mínima.");
    if(events.length>32) warnings.push("Se consultaron productos físicos de los 32 eventos de mayor magnitud. El resto permanece como observación de catálogo.");
    const now=new Date().toISOString();
    return NextResponse.json({events,sources:sources.sort((a,b)=>Date.parse(a.originTime)-Date.parse(b.originTime)),generatedAt:now,startTime:start,endTime:end,bounds:{west,south,east,north},warnings,provenance:[{name:"USGS ComCat, catálogo y productos preferidos",url,retrievedAt:now}]});
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"USGS no disponible"},{status:502}); }
}
