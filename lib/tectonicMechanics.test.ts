import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coulomb, doubleCouple, elasticKernel, enuBasis, eulerVelocity, frameAt, gnssResidual, kelvinDisplacement, maxwellRelax, maxwellTime, norm, planeVectors, prepareNodes, rtpToENU, tensorScale } from "./tectonicMechanics/physics";
import { DEFAULT_ASSUMPTIONS, type EarthquakeStateChange, type EulerPole, type GnssVelocity, type MechanicsDataset, type Tensor } from "./tectonicMechanics/types";
import { acceptedTomography, observedGnssAt, parseMidas, recoverNglEuler, sourceFromComcat } from "./tectonicMechanics/adapters";
import { classificationMetrics, evaluateRetrospective, type ValidationInput } from "./tectonicMechanics/validation";
import type { TectonicStatePhase3Result } from "./tectonicStatePhase3";
import { plateAt } from "./tectonicMechanics/geometry";
const close=(a:number,b:number,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)),`${a} ≠ ${b}`);
const caseData=JSON.parse(readFileSync(new URL("../public/tectonic-mechanics/puerto-rico-2020.json",import.meta.url),"utf8")) as MechanicsDataset;
const source=caseData.sources.find(s=>s.magnitude===6.4)!;
const params={...DEFAULT_ASSUMPTIONS,allowAssumedReceivers:true};

test("Kelvin displacement and stress agree with the closed-form isotropic moment solution",()=>{
  const mu=30e9,nu=.25,M=1e18,R=1e5;
  const tensor:Tensor=[[M,0,0],[0,M,0],[0,0,M]];
  const a=M*(1-2*nu)/(8*Math.PI*mu*(1-nu));
  const kernel=elasticKernel([R,0,0],tensor,mu,nu);
  close(kernel.displacement[0],a/R**2,1e-10);close(kernel.displacement[1],0,1e-12);
  close(kernel.stress[0][0],-4*mu*a/R**3,1e-6);close(kernel.stress[1][1],2*mu*a/R**3,1e-6);
  close(kernel.stress[2][2],kernel.stress[1][1],1e-9);
});
test("Elastic source respects M0 superposition, inverse-square displacement and inverse-cube stress",()=>{
  const m=doubleCouple(1e18,45,60,-90);
  const a=elasticKernel([1e5,2e5,3e4],m,30e9,.25),b=elasticKernel([2e5,4e5,6e4],m,30e9,.25);
  close(norm(a.displacement),4*norm(b.displacement),1e-10);
  a.stress.forEach((row,i)=>row.forEach((v,j)=>close(v,b.stress[i][j]*8)));
  const c=kelvinDisplacement([1e5,2e5,3e4],tensorScale(m,2),30e9,.25);c.forEach((v,i)=>close(v,2*a.displacement[i],1e-10));
});
test("ENU handedness, nodal plane orientation and RTP tensor conversion are explicit",()=>{
  enuBasis(0,0).flat().forEach((v,i)=>close(v,[0,1,0,0,0,1,1,0,0][i],1e-12));
  const vectors=planeVectors(0,90,0);close(vectors.normal[0],1);close(vectors.slip[1],1);
  assert.deepEqual(rtpToENU([[1,4,5],[4,2,6],[5,6,3]]),[[3,-6,5],[-6,2,-4],[5,-4,1]]);
});
test("Coulomb uses tension-positive unclamping and receiver rake, in Pa",()=>{
  const s:Tensor=[[100,30,0],[30,0,0],[0,0,0]];
  close(coulomb(s,{strike:0,dip:90,rake:0},.4),70);
  close(coulomb(s,{strike:0,dip:90,rake:180},.4),10);
  close(coulomb(s,{strike:0,dip:90,rake:0},0),30);
});
test("Maxwell conserves bulk stress and relaxes deviator by exp(-t/τ); no retroactive update",()=>{
  const eta=3e18,mu=30e9,tau=maxwellTime(eta,mu),s:Tensor=[[60,20,0],[20,0,0],[0,0,30]];
  const relaxed=maxwellRelax(s,tau,eta,mu);
  close(relaxed[0][1],20/Math.E);close(relaxed[0][0]+relaxed[1][1]+relaxed[2][2],90);
  assert.deepEqual(maxwellRelax(s,-10,eta,mu),s);
  assert.throws(()=>maxwellTime(0,mu));
  assert.throws(()=>prepareNodes([],[],{...params,maxwell:true,afterslipFraction:.1}),/convolution/);
});
test("Time composition excludes future events and masks singular or incomplete source domains",()=>{
  const node={id:"far",lat:18,lon:-65,depth:10};
  const second:EarthquakeStateChange={...source,eventId:"later",originTime:"2020-01-10T00:00:00Z"};
  const prepared=prepareNodes([node],[source,second],params);
  const before=frameAt(prepared,[source,second],"2020-01-01T00:00:00Z",params);
  assert.equal(before.voxels[0].status,"before-source");assert.equal(before.voxels[0].ux,null);
  const first=frameAt(prepared,[source,second],"2020-01-08T00:00:00Z",params),both=frameAt(prepared,[source,second],"2020-01-11T00:00:00Z",params);
  assert.equal(first.activeSourceIds.length,1);assert.equal(both.activeSourceIds.length,2);close(both.voxels[0].ux!,2*first.voxels[0].ux!,1e-10);
  const center=prepareNodes([{...source.centroid!,id:"center"}],[source],params);
  assert.equal(frameAt(center,[source],"2020-01-08T00:00:00Z",params).voxels[0].status,"insufficient constraints");
  const unknown={...second,momentTensor:null};
  const incomplete=prepareNodes([node],[source,unknown],params);
  assert.equal(frameAt(incomplete,[source,unknown],"2020-01-11T00:00:00Z",params).voxels[0].ux,null);
});
test("Published ComCat tensor is preserved, not multiplied by percent-double-couple",()=>{
  const event=caseData.events.find(e=>e.magnitude===6.4)!;
  const result=sourceFromComcat({properties:{products:{"moment-tensor":[{properties:{"tensor-mrr":"1e18","tensor-mtt":"-1e18","tensor-mpp":"0","tensor-mrt":"0","tensor-mrp":"0","tensor-mtp":"0","percent-double-couple":"0.5194"}}]}}},event);
  close(result.momentTensor![2][2],1e18);close(result.scalarMomentNm!,1e18);
});
test("Euler cross-product produces tangential mm/yr; mismatched GNSS frames cannot be subtracted",()=>{
  const pole:EulerPole={plate:"test",lat:90,lon:0,rateDegMa:1,frame:"IGS20",source:"analytic fixture"};
  const velocity=eulerVelocity(pole,{lat:0,lon:0,depth:0});close(velocity[0],111.1949266446);close(velocity[2],0);
  const station={lat:0,lon:0,depth:0,eastMmYr:120,northMmYr:0,upMmYr:0,frame:"IGS08"} as GnssVelocity;
  assert.equal(gnssResidual(station,pole),null);
  close(gnssResidual({...station,frame:"IGS20"},pole)![0],120-velocity[0]);
});
test("Paired NGL frame recovery passes independent withheld stations and refuses unpaired epochs",()=>{
  const pole:EulerPole={plate:"CA",lat:36,lon:-99,rateDegMa:.27,frame:"IGS20",source:"analytic fixture"};
  const global=Array.from({length:50},(_,i)=>({code:`s${i}`,lat:-60+(i%13)*10,lon:-170+i*7,depth:0,startYear:2010,endYear:2020,frame:"IGS20",eastMmYr:15,northMmYr:-4,upMmYr:2} as GnssVelocity));
  const relative=global.map(s=>{const v=eulerVelocity(pole,s);return {...s,eastMmYr:s.eastMmYr-v[0],northMmYr:s.northMmYr-v[1]};});
  const recovered=recoverNglEuler(global,relative,"CA");assert.ok(recovered);close(recovered.lat,pole.lat);close(recovered.lon,pole.lon);close(recovered.rateDegMa,pole.rateDegMa);
  assert.equal(recoverNglEuler(global,relative.map(s=>({...s,startYear:2011})),"CA"),null);
});
test("GNSS daily observation never comes from a future sample or artificial long extrapolation",()=>{
  const station={series:[{timeUtc:"2020-01-08T00:00:00Z",eastMm:3,northMm:4,upMm:5}]};
  assert.equal(observedGnssAt(station,"2020-01-07T23:00:00Z"),null);
  assert.equal(observedGnssAt(station,"2020-01-08T12:00:00Z")?.eastMm,3);
  assert.equal(observedGnssAt(station,"2020-01-10T12:00:00Z"),null);
});
test("Tomography gate handles P/S sign stability independently and never mutates GNSS",()=>{
  const phase={sourceEventId:"test",version:"1.0",readiness:{readyForPhase4:true,score:80},voxels:[{id:"v",latitude:0,longitude:0,depthKm:50,horizontalSizeDeg:4,depthSizeKm:50,resolutionScore:80,supportScore:80,stationCount:5,deltaVpPct:1,deltaVsPct:-2,pSignAgreement01:1,sSignAgreement01:.2,deltaVpUncertaintyPct:.3,deltaVsUncertaintyPct:.4}]} as TectonicStatePhase3Result;
  const accepted=acceptedTomography(phase);assert.equal(accepted[0].deltaVpPct,1);assert.equal(accepted[0].deltaVsPct,null);
  assert.equal(acceptedTomography({...phase,readiness:{...phase.readiness,readyForPhase4:false}}).length,0);
});
test("ROC/PR handles tied scores, empty classes and event leakage",()=>{
  const metrics=classificationMetrics([.5,.5],[true,false],.5);close(metrics.rocAuc!,.5);close(metrics.averagePrecision!,.5);
  assert.equal(classificationMetrics([.5],[true],.5).rocAuc,null);
  const input:ValidationInput={calibration:{start:"2020-01-02",end:"2020-01-03"},validation:{start:"2020-01-03",end:"2020-01-04"},control:{start:"2019-12-01",end:"2020-01-01"},sourceEventIds:["source"],sourceOriginTimes:["2020-01-01"],calibrationEventIds:["a"],validationEventIds:["b"],controlEventIds:[],bins:[],excludedEvents:0};
  assert.equal(evaluateRetrospective(input).status,"insufficient constraints");
  assert.throws(()=>evaluateRetrospective({...input,validationEventIds:["a"]}),/Fuga/);
  assert.throws(()=>evaluateRetrospective({...input,sourceOriginTimes:["2020-01-03"]}),/Fuga temporal/);
  assert.throws(()=>evaluateRetrospective({...input,validation:input.calibration}),/disjuntos/);
});
test("Frozen observed case has real catalog, slabs, fault traces and independent GNSS products",()=>{
  assert.ok(caseData.events.length>20);assert.ok(caseData.sources.some(s=>s.magnitude===6.4&&s.momentTensor));assert.ok(caseData.gnss && caseData.gnss.stations.length>=3);
  assert.ok(caseData.structure && caseData.structure.slabContours.length>0);assert.ok(caseData.faults && caseData.faults.features.length>0);
  assert.ok(plateAt(caseData.structure!.platePolygons,{lat:17.5,lon:-67,depth:0}));
  assert.ok(caseData.poles.some(p=>p.plate==="CA"&&p.frame==="IGS20"));
  assert.ok(caseData.velocities.length>0);assert.equal(caseData.phase3,null);
});
