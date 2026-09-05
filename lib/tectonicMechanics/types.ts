import type { ActiveFaultCollection } from "../activeFaults";
import type { EarthquakeEvent } from "../earthquakes/types";
import type { EarthScopeThreeComponentWaveforms } from "../earthscopeThreeComponent";
import type { NglGnssResult } from "../nglGnss";
import type { TectonicDepth3DResponse } from "../tectonicDepth3d";
import type { TectonicStatePhase3Result } from "../tectonicStatePhase3";

/** SI mechanics, geographic depth in km; every vector/tensor is local East, North, Up. */
export type Vec3 = [number, number, number];
export type Tensor = [Vec3, Vec3, Vec3];
export interface Location { lat: number; lon: number; depth: number }
export interface Confidence {
  supportScore: number; resolutionScore: number; uncertainty: number | null;
  sourceCount: number; lastUpdated: string;
  confidenceKind: "observational" | "heuristic-model" | "unknown";
}
export interface Plane { strike: number; dip: number; rake: number }
export interface RuptureGeometry extends Plane {
  lengthKm: number; widthKm: number; slipM: number;
  kind: "nodal-plane-assumption" | "finite-fault";
  alternativePlane: Plane | null;
  provenance: string;
}
export interface EarthquakeStateChange extends Location {
  eventId: string; originTime: string; sourceEpoch: string;
  magnitude: number; magnitudeType: string; scalarMomentNm: number | null;
  momentTensor: Tensor | null; ruptureGeometry: RuptureGeometry | null;
  centroid: Location | null; durationSec: number | null;
  staticStressChange: "Kelvin-full-space-point-moment-v1";
  dynamicStressEnvelope: "ray-arrival-visual-only";
  coseismicDisplacement: "Kelvin-full-space-point-moment-v1";
  postseismicRelaxation: "local-Maxwell-fixed-strain-assumption";
  provenance: string; assumptions: string[];
}
export interface ReceiverFault extends Location, Confidence {
  id: string; name: string; plane: Plane | null; assumptions: string[];
}
export interface TectonicVoxel extends Location, Confidence {
  id: string; vp: number | null; vs: number | null;
  deltaVp: number | null; deltaVs: number | null;
  ux: number | null; uy: number | null; uz: number | null;
  strainTensor: Tensor | null; stressTensor: Tensor | null;
  viscousStrainTensor: Tensor | null; deltaCFS: number | null;
  viscosity: number; rigidity: number; timestamp: string;
  status: "modeled" | "before-source" | "insufficient constraints";
  sourceEvents: string[];
}
export interface ReactionVector extends Location, Confidence {
  id: string; dx: number; dy: number; dz: number; magnitude: number;
  deltaCFS: number; sourceEvents: string[]; support: number;
  definition: "modeled displacement projected onto receiver plane";
  receiver: ReceiverFault;
}
export interface MaterialAssumptions {
  shearModulusPa: number; poissonRatio: number; viscosityPaS: number;
  friction: number; crustKm: number; lithosphereKm: number;
  maxwell: boolean; afterslipFraction: number; afterslipDays: number;
  receiverDepthKm: number; receiverPlane: Plane;
  allowAssumedReceivers: boolean;
}
export interface EulerPole {
  plate: string; lat: number; lon: number; rateDegMa: number;
  frame: string; source: string;
}
export interface GnssVelocity extends Location, Confidence {
  code: string; eastMmYr: number; northMmYr: number; upMmYr: number;
  sigmaMmYr: Vec3; frame: string; startYear: number; endYear: number;
  source: string;
}
export interface RayPath {
  eventId: string; station: string; phase: string; travelTimeSec: number;
  points: Array<Location & { travelSec: number }>;
  timing: "integrated-1D-slowness" | "endpoint-scaled-path-length";
  provenance: string;
}
export interface InSarLos extends Location, Confidence {
  losM: number; lookENU: Vec3; referenceTime: string; time: string;
  positive: "toward-satellite"; source: string;
}
export interface MechanicsDataset {
  version: "1.0"; generatedAt: string;
  bounds: { west: number; south: number; east: number; north: number };
  startTime: string; endTime: string;
  events: EarthquakeEvent[]; sources: EarthquakeStateChange[];
  structure: TectonicDepth3DResponse | null;
  faults: ActiveFaultCollection | null;
  gnss: NglGnssResult | null; gnssEventId: string | null;
  velocities: GnssVelocity[]; poles: EulerPole[];
  phase3: TectonicStatePhase3Result | null;
  waveforms: EarthScopeThreeComponentWaveforms | null;
  rays: RayPath[]; insar: InSarLos[];
  warnings: string[]; provenance: Array<{ name: string; url: string; retrievedAt: string; sha256?: string }>;
}
export interface MechanicsFrame {
  timestamp: string; voxels: TectonicVoxel[]; reactions: ReactionVector[];
  activeSourceIds: string[]; excludedSourceIds: string[];
}
export const DEFAULT_ASSUMPTIONS: MaterialAssumptions = {
  shearModulusPa: 30e9, poissonRatio: 0.25, viscosityPaS: 1e18,
  friction: 0.4, crustKm: 30, lithosphereKm: 70,
  maxwell: false, afterslipFraction: 0, afterslipDays: 30,
  receiverDepthKm: 10, receiverPlane: { strike: 270, dip: 45, rake: -90 },
  allowAssumedReceivers: false,
};
export const TIME_STOPS = [
  { label: "Antes", seconds: -3600 }, { label: "t₀ / ruptura", seconds: 0 },
  { label: "+10 s", seconds: 10 }, { label: "+60 s", seconds: 60 },
  { label: "+10 min", seconds: 600 }, { label: "+1 h", seconds: 3600 },
  { label: "+1 día", seconds: 86400 }, { label: "+7 días", seconds: 604800 },
  { label: "+30 días", seconds: 2592000 }, { label: "+90 días", seconds: 7776000 },
  { label: "+1 año", seconds: 31557600 },
];
