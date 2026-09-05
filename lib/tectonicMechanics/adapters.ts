import type { EarthquakeEvent } from "../earthquakes/types";
import type { ActiveFaultCollection } from "../activeFaults";
import { representativeFaultPoint, receiverPlanesForFault } from "../coulombBalance";
import { buildTectonicStatePhase4Seed } from "../tectonicStatePhase4Bridge";
import type { TectonicStatePhase3Result } from "../tectonicStatePhase3";
import { greatCircleInterpolate } from "../tectonicStatePhase2";
import { localRayModel, traceRayFamilies } from "../localSeismicRayTracer";
import type { EarthScopeThreeComponentWaveforms } from "../earthscopeThreeComponent";
import type { EarthquakeStateChange, EulerPole, GnssVelocity, Location, MaterialAssumptions, Plane, RayPath, ReceiverFault, Tensor } from "./types";
import { cross, dot, doubleCouple, ecef, enuBasis, eulerVelocity, norm, rtpToENU } from "./physics";

const numeric = (value: unknown): number | null => value!==null && value!==undefined && value!=="" && Number.isFinite(Number(value)) ? Number(value) : null;
export const GSRM_POLES_URL = "https://geodesy.unr.edu/GSRM/poles.IGS08";
export const MIDAS_URL = "https://geodesy.unr.edu/gps_timeseries/IGS20/midas/midas.IGS.txt";
export function parsePoles(text: string): EulerPole[] {
  return text.trim().split(/\r?\n/).flatMap(row=>{
    const [lat,lon,rate,plate] = row.trim().split(/\s+/);
    return plate && [lat,lon,rate].every(v=>numeric(v)!==null) ? [{ plate,lat:Number(lat),lon:Number(lon),rateDegMa:Number(rate),frame:"IGS08",source:GSRM_POLES_URL }] : [];
  });
}
export function parseMidas(text: string, retrievedAt: string, frame="IGS20",source=MIDAS_URL): GnssVelocity[] {
  return text.trim().split(/\r?\n/).flatMap(row=>{
    const c = row.trim().split(/\s+/);
    if (c.length<27 || ![2,3,8,9,10,11,12,13,24,25].every(i=>numeric(c[i])!==null)) return [];
    return [{code:c[0],lat:Number(c[24]),lon:((Number(c[25])+540)%360)-180,depth:0,
      eastMmYr:Number(c[8])*1000,northMmYr:Number(c[9])*1000,upMmYr:Number(c[10])*1000,
      sigmaMmYr:[Number(c[11])*1000,Number(c[12])*1000,Number(c[13])*1000] as [number,number,number],
      frame,startYear:Number(c[2]),endYear:Number(c[3]),source,
      supportScore:Math.min(100,Number(c[4])/3*100),resolutionScore:Math.min(100,Number(c[4])/3*100),
      uncertainty:Math.hypot(Number(c[11]),Number(c[12]),Number(c[13]))*1000,
      sourceCount:1,lastUpdated:retrievedAt,confidenceKind:"observational" as const}];
  });
}
/** Recover the rotation actually subtracted by NGL from paired MIDAS products.
 * This fits reference-frame differences, not observed tectonic velocities. Withheld
 * rows must reproduce the published difference within 0.05 mm/yr before use.
 */
export function recoverNglEuler(global:GnssVelocity[],relative:GnssVelocity[],plate:string):EulerPole|null {
  const map=new Map(relative.map(s=>[s.code,s]));
  const pairs=global.flatMap(s=>{const r=map.get(s.code);return r && s.startYear===r.startYear && s.endYear===r.endYear?[{s,v:[s.eastMmYr-r.eastMmYr,s.northMmYr-r.northMmYr,0] as [number,number,number]}]:[];});
  if(pairs.length<20)return null;
  const normal=[[0,0,0],[0,0,0],[0,0,0]],rhs=[0,0,0];
  pairs.filter((_,i)=>i%2===0).forEach(({s,v})=>{
    const basis=enuBasis(s.lat,s.lon),r=ecef(s).map(x=>x/1e6) as [number,number,number];
    for(let axis=0;axis<2;axis++) {const row=cross(r,basis[axis]);for(let i=0;i<3;i++){rhs[i]+=row[i]*v[axis];for(let j=0;j<3;j++)normal[i][j]+=row[i]*row[j];}}
  });
  const augmented=normal.map((row,i)=>[...row,rhs[i]]);
  for(let col=0;col<3;col++) {
    const pivot=[col,...Array.from({length:2-col},(_,i)=>i+col+1)].sort((a,b)=>Math.abs(augmented[b][col])-Math.abs(augmented[a][col]))[0];
    [augmented[col],augmented[pivot]]=[augmented[pivot],augmented[col]];
    const denominator=augmented[col][col];if(Math.abs(denominator)<1e-8)return null;
    for(let k=col;k<4;k++)augmented[col][k]/=denominator;
    for(let row=0;row<3;row++)if(row!==col){const factor=augmented[row][col];for(let k=col;k<4;k++)augmented[row][k]-=factor*augmented[col][k];}
  }
  const w=augmented.map(row=>row[3]/1e9) as [number,number,number],rate=norm(w);
  const pole:EulerPole={plate,lat:Math.asin(w[2]/rate)*180/Math.PI,lon:Math.atan2(w[1],w[0])*180/Math.PI,rateDegMa:rate*1e6*180/Math.PI,frame:"IGS20",source:`NGL paired MIDAS IGS20 global minus ${plate}; Euler recovered from half the identical-epoch rows, checked on withheld rows. ${MIDAS_URL} + https://geodesy.unr.edu/gps_timeseries/IGS20/midas/midas.${plate}.txt`};
  const checks=pairs.filter((_,i)=>i%2===1).map(({s,v})=>{const model=eulerVelocity(pole,s);return Math.hypot(model[0]-v[0],model[1]-v[1]);});
  const rms=Math.sqrt(checks.reduce((s,x)=>s+x*x,0)/checks.length);
  if(!Number.isFinite(rms) || rms>0.05)return null;
  pole.source+=` Check RMS ${rms.toFixed(5)} mm/yr; ${checks.length} withheld stations. This reproduces NGL's frame definition, not independent plate calibration.`;
  return pole;
}
export function eventFromComcat(feature: Record<string, unknown>): EarthquakeEvent | null {
  const p = feature.properties as Record<string,unknown> | undefined;
  const c = (feature.geometry as {coordinates?:unknown[]}|undefined)?.coordinates;
  if (!p || !c || !feature.id || ![...c.slice(0,3),p.time,p.mag].every(v=>numeric(v)!==null)) return null;
  return {id:String(feature.id),externalId:String(feature.id),sourceCatalog:"USGS ComCat",timeUtc:new Date(Number(p.time)).toISOString(),updatedUtc:new Date(Number(p.updated??p.time)).toISOString(),
    latitude:Number(c[1]),longitude:Number(c[0]),depthKm:Number(c[2]),magnitude:Number(p.mag),magnitudeType:String(p.magType??"unknown"),place:String(p.place??feature.id),countryOrRegion:"Caribe",eventType:"earthquake",status:String(p.status??"unknown"),network:String(p.net??""),sourceUrl:String(p.url??"")};
}
function readPlane(p: Record<string,unknown>, index: number): Plane | null {
  const strike = numeric(p[`nodal-plane-${index}-strike`]), dip = numeric(p[`nodal-plane-${index}-dip`]), rake = numeric(p[`nodal-plane-${index}-rake`]);
  return strike!==null && dip!==null && rake!==null && dip>=0 && dip<=90 ? {strike,dip,rake} : null;
}
export function sourceFromComcat(detail: Record<string,unknown>, event: EarthquakeEvent): EarthquakeStateChange {
  const properties = detail.properties as Record<string,unknown> | undefined;
  const products = properties?.products as Record<string,Array<{ properties:Record<string,unknown>; preferredWeight?:number; updateTime?:number }>> | undefined;
  const preferred = [...(products?.["moment-tensor"]??[]),...(products?.["focal-mechanism"]??[])].sort((a,b)=>(b.preferredWeight??0)-(a.preferredWeight??0));
  const product = preferred.find(x=>["rr","tt","pp","rt","rp","tp"].every(k=>numeric(x.properties?.[`tensor-m${k}`])!==null)) ?? preferred.find(x=>readPlane(x.properties??{},1));
  const p = product?.properties??{}, plane = readPlane(p,1);
  const [rr,tt,pp,rt,rp,tp] = ["rr","tt","pp","rt","rp","tp"].map(k=>numeric(p[`tensor-m${k}`]));
  let tensor: Tensor | null = rr!==null && tt!==null && pp!==null && rt!==null && rp!==null && tp!==null ? rtpToENU([[rr,rt,rp],[rt,tt,tp],[rp,tp,pp]]) : null;
  let moment = numeric(p["scalar-moment"]);
  const assumptions: string[] = [];
  if (moment===null && tensor) moment = Math.sqrt(tensor.flat().reduce((s,x)=>s+x*x,0)/2);
  if (moment===null && /^mw/i.test(event.magnitudeType)) { moment=10**(1.5*event.magnitude+9.1); assumptions.push("M₀ derivado de Mw: log10 M₀ = 1.5 Mw + 9.1; N m."); }
  if (!tensor && plane && moment) { tensor=doubleCouple(moment,plane.strike,plane.dip,plane.rake); assumptions.push("Tensor doble par reconstruido desde NP1 y M₀."); }
  const mw = moment ? (Math.log10(moment)-9.1)/1.5 : null;
  const lengthKm = mw===null ? 0 : 10**(-2.44+0.59*mw), widthKm = mw===null ? 0 : 10**(-1.01+0.32*mw);
  const lat=numeric(p["derived-latitude"]),lon=numeric(p["derived-longitude"]),depth=numeric(p["derived-depth"]);
  const centroid = lat!==null && lon!==null && depth!==null ? {lat,lon,depth} : null;
  if (!centroid) assumptions.push("Fuente puntual situada en el hipocentro; centroide no disponible.");
  if (plane) assumptions.push("NP1 es un plano nodal candidato; el mecanismo focal no identifica por sí solo el plano que rompió.");
  return {eventId:event.externalId,originTime:event.timeUtc,sourceEpoch:product?.updateTime?new Date(product.updateTime).toISOString():event.updatedUtc,
    lat:event.latitude,lon:event.longitude,depth:event.depthKm,magnitude:event.magnitude,magnitudeType:event.magnitudeType,scalarMomentNm:moment,momentTensor:tensor,centroid,durationSec:numeric(p["sourcetime-duration"]),
    ruptureGeometry:plane && moment && lengthKm>0 ? {...plane,lengthKm,widthKm,slipM:moment/(30e9*lengthKm*widthKm*1e6),kind:"nodal-plane-assumption",alternativePlane:readPlane(p,2),provenance:"Wells & Coppersmith (1994), all-slip subsurface length/width scaling; μ=30 GPa for slip proxy. Dimensions are not a finite-fault inversion."} : null,
    staticStressChange:"Kelvin-full-space-point-moment-v1",dynamicStressEnvelope:"ray-arrival-visual-only",coseismicDisplacement:"Kelvin-full-space-point-moment-v1",postseismicRelaxation:"local-Maxwell-fixed-strain-assumption",provenance:event.sourceUrl??"USGS ComCat",assumptions};
}
export function faultReceivers(faults: ActiveFaultCollection | null, p: MaterialAssumptions, timestamp: string): ReceiverFault[] {
  return (faults?.features??[]).flatMap(fault=>{
    const point=representativeFaultPoint(fault);
    if (!point) return [];
    const candidate=receiverPlanesForFault(fault)[0];
    const plane=candidate?{strike:candidate.strikeDeg,dip:candidate.dipDeg,rake:candidate.rakeDeg}:null;
    return [{id:`fault:${fault.properties.id}`,name:fault.properties.name,lat:point.latitude,lon:point.longitude,depth:p.receiverDepthKm,plane,
      assumptions:[`Profundidad receptora ${p.receiverDepthKm} km asumida.`,...(candidate?.note?[candidate.note]:[]),...(!plane?["insufficient constraints: orientación receptora desconocida"]:[])],
      supportScore:plane?30:0,resolutionScore:plane?25:0,uncertainty:null,sourceCount:1,lastUpdated:timestamp,confidenceKind:"heuristic-model" as const}];
  });
}
/** Enforce phase stability independently: a stable P voxel must never import unstable S. */
export function acceptedTomography(phase3: TectonicStatePhase3Result | null) {
  if (!phase3) return [];
  const seed=buildTectonicStatePhase4Seed(phase3);
  return seed.constraints.map(v=>({...v,
    deltaVpPct:(v.pSignAgreement01??0)>=seed.minSignAgreement01 && v.deltaVpUncertaintyPct!==null?v.deltaVpPct:null,
    deltaVsPct:(v.sSignAgreement01??0)>=seed.minSignAgreement01 && v.deltaVsUncertaintyPct!==null?v.deltaVsPct:null,
  })).filter(v=>v.deltaVpPct!==null || v.deltaVsPct!==null);
}
export function observedGnssAt<T extends {series:Array<{timeUtc:string;eastMm:number;northMm:number;upMm:number}>}>(station:T,timestamp:string) {
  const time=Date.parse(timestamp);
  // A daily solution is not an instantaneous observation. Only past samples, <36h old.
  return station.series.filter(p=>Date.parse(p.timeUtc)<=time && time-Date.parse(p.timeUtc)<=36*3600000).sort((a,b)=>Date.parse(b.timeUtc)-Date.parse(a.timeUtc))[0]??null;
}
/** Existing iasp91 ray families, selected only for stations with actual waveforms. */
export function waveformRays(waveforms: EarthScopeThreeComponentWaveforms): RayPath[] {
  const source=waveforms.source;
  const families=traceRayFamilies("iasp91",source.depthKm);
  const model=localRayModel("iasp91");
  const speed=(depth:number,phase:string)=>{
    const knots=model.knots;
    let k=0; while(k<knots.length-1 && knots[k+1][0]<=depth) k++;
    const a=knots[k],b=knots[Math.min(k+1,knots.length-1)], f=b[0]>a[0]?(depth-a[0])/(b[0]-a[0]):0;
    const core=depth>=model.cmbDepthKm && depth<model.icbDepthKm;
    const j=phase.startsWith("S") && !core?2:1;
    return Math.max(0.1,a[j]+(b[j]-a[j])*f);
  };
  return waveforms.stations.flatMap(station=>["P","S","PcP","ScS","PKP","SKS","PKIKP"].flatMap(phase=>{
    const distanceDeg=station.distanceKm/6371*180/Math.PI;
    const ray=families.filter(r=>r.phase===phase).sort((a,b)=>Math.abs(a.distanceDeg-distanceDeg)-Math.abs(b.distanceDeg-distanceDeg))[0];
    if(!ray || Math.abs(ray.distanceDeg-distanceDeg)>1.5) return [];
    const end=ray.points.at(-1)!.thetaRad;
    let t=0;
    const points=ray.points.map((pt,i)=>{
      if(i) {
        const prev=ray.points[i-1],r=6371-(pt.depthKm+prev.depthKm)/2;
        t+=Math.hypot(pt.depthKm-prev.depthKm,r*(pt.thetaRad-prev.thetaRad))/speed((pt.depthKm+prev.depthKm)/2,phase);
      }
      const position=greatCircleInterpolate(source.latitude,source.longitude,station.latitude,station.longitude,pt.thetaRad/end);
      return {lat:position.latitude,lon:position.longitude,depth:pt.depthKm,travelSec:t};
    });
    return [{eventId:source.id,station:`${station.network}.${station.station}`,phase,travelTimeSec:ray.timeSec,points:points.map(p=>({...p,travelSec:t>0?p.travelSec*ray.timeSec/t:0})),timing:"integrated-1D-slowness" as const,provenance:"RDSISMOS iasp91 ray tracer; station endpoint mismatch ≤1.5°. Relative timing from integrated 1D slowness, scaled to ray travel time. No dynamic stress amplitude in Pa."}];
  }));
}
