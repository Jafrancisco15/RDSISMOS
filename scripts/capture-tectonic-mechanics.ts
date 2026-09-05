/** Rebuild the observed Puerto Rico case against a local RDSISMOS dev server.
 * npx tsx scripts/capture-tectonic-mechanics.ts [http://localhost:3000]
 * Data products remain independently attributed; SHA256 pins each response.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { MechanicsDataset } from "../lib/tectonicMechanics/types";
import { NextRequest } from "next/server";

async function main() {
  const base=process.argv[2];
  const at=new Date().toISOString(),warnings:string[]=[],provenance:MechanicsDataset["provenance"]=[];
  async function request(path:string,body?:unknown) {
    const options={signal:AbortSignal.timeout(59000),...(body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})};
    const req=new NextRequest(`${base??"http://localhost"}${path}`,options);
    const response=base?await fetch(req):path.startsWith("/api/tectonic-mechanics/catalog")?await (await import("../app/api/tectonic-mechanics/catalog/route")).GET(req):path.startsWith("/api/tectonic-mechanics/geodesy")?await (await import("../app/api/tectonic-mechanics/geodesy/route")).POST(req):path.startsWith("/api/faults")?await (await import("../app/api/faults/route")).GET(req):await (await import("../app/api/tectonic-depth-3d/route")).GET(req);
    const text=await response.text();
    if(!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0,180)}`);
    provenance.push({name:path,url:path,retrievedAt:at,sha256:createHash("sha256").update(text).digest("hex")});
    return JSON.parse(text);
  }
  const results=await Promise.allSettled([
    request("/api/tectonic-mechanics/catalog?start=2020-01-01&end=2020-01-31&bbox=-70,16,-64,20&min=4.2"),
    request("/api/tectonic-depth-3d"), request("/api/faults?bbox=-70,16,-64,20&limit=3000"),
  ]);
  const [catalogResult,structureResult,faultResult]=results;
  if(catalogResult.status!=="fulfilled") throw catalogResult.reason;
  const catalog=catalogResult.value;
  const event=[...catalog.events].sort((a,b)=>b.magnitude-a.magnitude)[0];
  const geodesy=await request("/api/tectonic-mechanics/geodesy",{event}).catch(e=>{warnings.push(String(e));return {};});
  results.forEach(r=>{if(r.status==="rejected") warnings.push(String(r.reason));});
  const structure: MechanicsDataset["structure"]=structureResult.status==="fulfilled"?structureResult.value:null;
  if(structure) {
    // Retain global polygons for geographic identity; only regional Slab2 contours.
    structure.slabContours=structure.slabContours.filter(c=>c.points.some(p=>p.lng>=-72&&p.lng<=-60&&p.lat>=12&&p.lat<=23));
    structure.slabRegions=[...new Set(structure.slabContours.map(c=>c.region))];
    structure.slabSurfaceTriangles=[];
  }
  const dataset:MechanicsDataset={version:"1.0",generatedAt:at,bounds:catalog.bounds,startTime:catalog.startTime,endTime:catalog.endTime,events:catalog.events,sources:catalog.sources,structure,faults:faultResult.status==="fulfilled"?faultResult.value:null,gnss:geodesy.gnss??null,gnssEventId:event.externalId,velocities:geodesy.velocities??[],poles:geodesy.poles??[],phase3:null,waveforms:null,rays:[],insar:[],warnings:[...warnings,...catalog.warnings,...(geodesy.warnings??[]),"Tomografía no precargada: ejecutar Fases 2/3; gate obligatorio. InSAR LOS no precargado."],provenance:[...provenance,...catalog.provenance,...(geodesy.provenance??[])]};
  await mkdir("public/tectonic-mechanics",{recursive:true});
  await writeFile("public/tectonic-mechanics/puerto-rico-2020.json",JSON.stringify(dataset));
  console.log(JSON.stringify({events:dataset.events.length,sources:dataset.sources.length,tensors:dataset.sources.filter(s=>s.momentTensor).length,gnss:dataset.gnss?.stationCount,velocities:dataset.velocities.length,plates:structure?.platePolygons.features.length,slabs:structure?.slabContours.length,faults:dataset.faults?.features.length,warnings:dataset.warnings}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
