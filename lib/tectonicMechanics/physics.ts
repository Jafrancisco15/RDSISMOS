import type { Confidence, EarthquakeStateChange, EulerPole, GnssVelocity, Location, MaterialAssumptions, MechanicsFrame, ReactionVector, ReceiverFault, Tensor, TectonicVoxel, Vec3 } from "./types";

const RAD = Math.PI / 180;
export const RADIUS_KM = 6371;
export const zero = (): Tensor => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
export const dot = (a: Vec3, b: Vec3) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const scale = (a: Vec3, k: number): Vec3 => a.map(v => v * k) as Vec3;
export const add = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v + b[i]) as Vec3;
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const norm = (a: Vec3) => Math.hypot(...a);
export const mv = (a: Tensor, v: Vec3): Vec3 => a.map(row => dot(row, v)) as Vec3;
export const transpose = (a: Tensor): Tensor => [0,1,2].map(i => a.map(row => row[i])) as Tensor;
export const mm = (a: Tensor, b: Tensor): Tensor => a.map(row => transpose(b).map(col => dot(row, col))) as Tensor;
export const tensorScale = (a: Tensor, k: number): Tensor => a.map(row => scale(row, k)) as Tensor;
export const tensorAdd = (a: Tensor, b: Tensor): Tensor => a.map((row, i) => add(row, b[i])) as Tensor;

/** Rows transform ECEF vectors into local ENU. Spherical geometry is declared. */
export function enuBasis(lat: number, lon: number): Tensor {
  const p = lat * RAD, l = lon * RAD;
  return [[-Math.sin(l), Math.cos(l), 0], [-Math.sin(p)*Math.cos(l), -Math.sin(p)*Math.sin(l), Math.cos(p)], [Math.cos(p)*Math.cos(l), Math.cos(p)*Math.sin(l), Math.sin(p)]];
}
export function ecef(point: Location): Vec3 {
  return scale(enuBasis(point.lat, point.lon)[2], (RADIUS_KM - point.depth) * 1000);
}
export function localOffset(source: Location, target: Location): Vec3 {
  return mv(enuBasis(source.lat, source.lon), add(ecef(target), scale(ecef(source), -1)));
}
export function planeVectors(strike: number, dip: number, rake: number) {
  const s = strike * RAD, d = dip * RAD, r = rake * RAD;
  const along: Vec3 = [Math.sin(s), Math.cos(s), 0];
  const down: Vec3 = [Math.cos(s)*Math.cos(d), -Math.sin(s)*Math.cos(d), -Math.sin(d)];
  const normal: Vec3 = [Math.cos(s)*Math.sin(d), -Math.sin(s)*Math.sin(d), Math.cos(d)];
  return { along, down, normal, slip: add(scale(along, Math.cos(r)), scale(down, -Math.sin(r))) };
}
export function doubleCouple(moment: number, strike: number, dip: number, rake: number): Tensor {
  const { normal, slip } = planeVectors(strike, dip, rake);
  return slip.map((v, i) => normal.map((n, j) => moment * (v*n + normal[i]*slip[j]))) as Tensor;
}
/** ComCat tensor basis is (r=Up, theta=South, phi=East), in N m. */
export function rtpToENU(rtp: Tensor): Tensor {
  const rotation: Tensor = [[0,0,1],[0,-1,0],[1,0,0]];
  return mm(mm(rotation, rtp), transpose(rotation));
}
export function eulerVelocity(pole: EulerPole, point: Location): Vec3 {
  const omega = scale(enuBasis(pole.lat, pole.lon)[2], pole.rateDegMa * RAD / 1e6);
  return scale(mv(enuBasis(point.lat, point.lon), cross(omega, ecef({ ...point, depth: 0 }))), 1000);
}
export function gnssResidual(station: GnssVelocity, pole: EulerPole): Vec3 | null {
  if (station.frame !== pole.frame) return null;
  return add([station.eastMmYr, station.northMmYr, station.upMmYr], scale(eulerVelocity(pole, station), -1));
}

/** u_i = -M_jk dG_ij/dx_k, Kelvin infinite homogeneous isotropic elastic medium.
 * No free surface or finite rupture correction; callers MUST enforce far-field bounds.
 */
export function kelvinDisplacement(r: Vec3, moment: Tensor, mu: number, nu: number): Vec3 {
  const radius = norm(r);
  if (!(mu > 0) || !(nu > -1 && nu < 0.5) || !(radius > 0)) throw new Error("Invalid Kelvin parameters");
  const c = 1 / (16*Math.PI*mu*(1-nu)), r3 = radius**3, r5 = radius**5;
  const out: Vec3 = [0,0,0];
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) {
    const derivative = c * (-(3-4*nu)*Number(i===j)*r[k]/r3 + (Number(i===k)*r[j]+Number(j===k)*r[i])/r3 - 3*r[i]*r[j]*r[k]/r5);
    out[i] -= moment[j][k] * derivative;
  }
  return out;
}
export function elasticKernel(r: Vec3, moment: Tensor, mu: number, nu: number) {
  const h = Math.max(0.5, norm(r) * 1e-4), gradient = zero();
  for (let j=0;j<3;j++) {
    const plus = [...r] as Vec3, minus = [...r] as Vec3;
    plus[j]+=h; minus[j]-=h;
    const a = kelvinDisplacement(plus, moment, mu, nu), b = kelvinDisplacement(minus, moment, mu, nu);
    for (let i=0;i<3;i++) gradient[i][j]=(a[i]-b[i])/(2*h);
  }
  const strain = gradient.map((row,i)=>row.map((v,j)=>(v+gradient[j][i])/2)) as Tensor;
  const trace = strain[0][0]+strain[1][1]+strain[2][2], lambda = 2*mu*nu/(1-2*nu);
  const stress = strain.map((row,i)=>row.map((v,j)=>2*mu*v+Number(i===j)*lambda*trace)) as Tensor;
  return { displacement: kelvinDisplacement(r,moment,mu,nu), strain, stress };
}
/** Positive normal tension means unclamping. Return Pa, never magnitude or probability. */
export function coulomb(stress: Tensor, plane: { strike: number; dip: number; rake: number }, friction: number) {
  const { normal, slip } = planeVectors(plane.strike, plane.dip, plane.rake);
  const traction = mv(stress,normal);
  return dot(slip,traction)+friction*dot(normal,traction);
}
export function maxwellTime(eta: number, mu: number) {
  if (!(eta>0) || !(mu>0) || !Number.isFinite(eta) || !Number.isFinite(mu)) throw new Error("η and μ must be finite and positive");
  return eta/mu;
}
/** Local fixed-total-strain experiment: deviatoric stress relaxes; bulk stress does not.
 * This is not a spatial equilibrium solver. It cannot create postseismic displacement.
 */
export function maxwellRelax(stress: Tensor, seconds: number, eta: number, mu: number) {
  const f = Math.exp(-Math.max(0,seconds)/maxwellTime(eta,mu));
  const mean = (stress[0][0]+stress[1][1]+stress[2][2])/3;
  return stress.map((row,i)=>row.map((v,j)=>(v-Number(i===j)*mean)*f+Number(i===j)*mean)) as Tensor;
}

interface Kernel {
  source: EarthquakeStateChange; displacement: Vec3; strain: Tensor; stress: Tensor;
}
export interface PreparedNode extends Location { id: string; kernels: Kernel[]; excluded: string[]; receiver?: ReceiverFault }
export function prepareNodes(locations: Array<Location & { id: string; receiver?: ReceiverFault }>, sources: EarthquakeStateChange[], p: MaterialAssumptions): PreparedNode[] {
  if(p.maxwell && p.afterslipFraction>0) throw new Error("Maxwell and prescribed afterslip require a convolution solver before they can be combined");
  return locations.map(point => {
    const kernels: Kernel[] = [], excluded: string[] = [];
    for (const source of sources) {
      if (!source.momentTensor || !source.ruptureGeometry) { excluded.push(source.eventId); continue; }
      const origin = source.centroid ?? source;
      const r = localOffset(origin,point), distanceKm = norm(r)/1000;
      // Conservative point-source validity mask; never regularize into fabricated near-field values.
      if (distanceKm < Math.max(15,2*source.ruptureGeometry.lengthKm) || distanceKm>700) { excluded.push(source.eventId); continue; }
      const kernel = elasticKernel(r,source.momentTensor,p.shearModulusPa,p.poissonRatio);
      const rotate = mm(enuBasis(point.lat,point.lon),transpose(enuBasis(origin.lat,origin.lon)));
      kernels.push({ source, displacement: mv(rotate,kernel.displacement), strain: mm(mm(rotate,kernel.strain),transpose(rotate)), stress: mm(mm(rotate,kernel.stress),transpose(rotate)) });
    }
    return { ...point, kernels, excluded };
  });
}
export function frameAt(nodes: PreparedNode[], sources: EarthquakeStateChange[], timestamp: string, p: MaterialAssumptions): MechanicsFrame {
  const time = Date.parse(timestamp);
  const activeSourceIds = sources.filter(s=>Date.parse(s.originTime)<=time).map(s=>s.eventId);
  const active = new Set(activeSourceIds), reactions: ReactionVector[] = [];
  const voxels = nodes.map(node => {
    let u: Vec3 = [0,0,0], strain = zero(), stress = zero(), viscous = zero();
    const sourceEvents: string[] = [];
    const missingActive = node.excluded.some(id=>active.has(id));
    for (const k of node.kernels) {
      const dt = (time-Date.parse(k.source.originTime))/1000;
      if (dt<0) continue;
      // A prescribed same-plane afterslip scenario, never inferred from tomography or GNSS.
      const after = p.afterslipFraction*(1-Math.exp(-dt/(p.afterslipDays*86400)));
      const base = tensorScale(k.stress,1+after);
      // Maxwell applies below the assumed lithosphere only. Afterslip increments require
      // a full convolution; prohibit mixing these two approximations in this MVP.
      const relaxed = p.maxwell && node.depth>=p.lithosphereKm ? maxwellRelax(base,dt,p.viscosityPaS,p.shearModulusPa) : base;
      u = add(u,scale(k.displacement,1+after));
      strain = tensorAdd(strain,tensorScale(k.strain,1+after));
      stress = tensorAdd(stress,relaxed);
      viscous = tensorAdd(viscous,tensorScale(tensorAdd(base,tensorScale(relaxed,-1)),1/(2*p.shearModulusPa)));
      sourceEvents.push(k.source.eventId);
    }
    const constrained = sourceEvents.length>0 && !missingActive;
    const confidence: Confidence = {
      supportScore: constrained ? 45 : 0, resolutionScore: constrained ? 30 : 0,
      uncertainty: null, sourceCount: sourceEvents.length,
      lastUpdated: sources.filter(s=>sourceEvents.includes(s.eventId)).map(s=>s.sourceEpoch).sort().at(-1) ?? timestamp,
      confidenceKind: constrained ? "heuristic-model" : "unknown",
    };
    const receiver = node.receiver;
    const usableReceiver = receiver?.plane && (!receiver.assumptions.length || p.allowAssumedReceivers);
    const deltaCFS = constrained && usableReceiver ? coulomb(stress,receiver.plane!,p.friction) : null;
    if (deltaCFS!==null && receiver?.plane) {
      const normal = planeVectors(receiver.plane.strike,receiver.plane.dip,receiver.plane.rake).normal;
      const induced = add(u,scale(normal,-dot(u,normal)));
      reactions.push({ lat:node.lat,lon:node.lon,depth:node.depth, ...confidence, id: receiver.id, dx: induced[0],dy:induced[1],dz:induced[2],magnitude:norm(induced),deltaCFS, sourceEvents, support:confidence.supportScore,definition:"modeled displacement projected onto receiver plane",receiver });
    }
    return {
      id:node.id,lat:node.lat,lon:node.lon,depth:node.depth,...confidence,
      vp:null,vs:null,deltaVp:null,deltaVs:null,
      ux:constrained?u[0]:null,uy:constrained?u[1]:null,uz:constrained?u[2]:null,
      strainTensor:constrained?strain:null,stressTensor:constrained?stress:null,
      viscousStrainTensor:constrained?viscous:null,deltaCFS,
      viscosity:p.viscosityPaS,rigidity:p.shearModulusPa,timestamp,sourceEvents,
      status: !active.size ? "before-source" : constrained ? "modeled" : "insufficient constraints",
    } satisfies TectonicVoxel;
  });
  return { timestamp,voxels,reactions,activeSourceIds,excludedSourceIds:sources.filter(s=>!s.momentTensor || !s.ruptureGeometry).map(s=>s.eventId) };
}
