import type { TectonicStatePhase3Result } from "./tectonicStatePhase3";

export interface Phase4VelocityConstraint {
  voxelId: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  horizontalSizeDeg: number;
  depthSizeKm: number;
  deltaVpPct: number | null;
  deltaVsPct: number | null;
  deltaVpUncertaintyPct: number | null;
  deltaVsUncertaintyPct: number | null;
  pSignAgreement01: number | null;
  sSignAgreement01: number | null;
  supportScore: number;
  resolutionScore: number;
  stationCount: number;
}

export interface TectonicStatePhase4Seed {
  sourceEventId: string;
  phase3Version: "1.0";
  generatedAt: string;
  gatePassed: boolean;
  gateScore: number;
  minResolutionScore: number;
  minSignAgreement01: number;
  candidateConstraintCount: number;
  acceptedConstraintCount: number;
  constraints: Phase4VelocityConstraint[];
  note: string;
}

function phaseStable(value: number | null, agreement: number | null, minimumAgreement: number) {
  return value !== null && agreement !== null && agreement >= minimumAgreement;
}

/**
 * Strict hand-off between arrival-time tomography (Phase 3) and deformation
 * fusion (Phase 4). A failed event gate exports zero constraints on purpose:
 * Phase 4 must never silently ingest a weak tomographic solution.
 */
export function buildTectonicStatePhase4Seed(
  phase3: TectonicStatePhase3Result,
  options: { minResolutionScore?: number; minSignAgreement01?: number } = {},
): TectonicStatePhase4Seed {
  const minResolutionScore = Math.max(0, Math.min(100, options.minResolutionScore ?? 42));
  const minSignAgreement01 = Math.max(0.5, Math.min(1, options.minSignAgreement01 ?? 0.67));

  const candidates = phase3.voxels.filter((voxel) => {
    if (voxel.resolutionScore < minResolutionScore) return false;
    return phaseStable(voxel.deltaVpPct, voxel.pSignAgreement01, minSignAgreement01)
      || phaseStable(voxel.deltaVsPct, voxel.sSignAgreement01, minSignAgreement01);
  });

  const constraints: Phase4VelocityConstraint[] = phase3.readiness.readyForPhase4
    ? candidates.map((voxel) => ({
      voxelId: voxel.id,
      latitude: voxel.latitude,
      longitude: voxel.longitude,
      depthKm: voxel.depthKm,
      horizontalSizeDeg: voxel.horizontalSizeDeg,
      depthSizeKm: voxel.depthSizeKm,
      deltaVpPct: voxel.deltaVpPct,
      deltaVsPct: voxel.deltaVsPct,
      deltaVpUncertaintyPct: voxel.deltaVpUncertaintyPct,
      deltaVsUncertaintyPct: voxel.deltaVsUncertaintyPct,
      pSignAgreement01: voxel.pSignAgreement01,
      sSignAgreement01: voxel.sSignAgreement01,
      supportScore: voxel.supportScore,
      resolutionScore: voxel.resolutionScore,
      stationCount: voxel.stationCount,
    }))
    : [];

  return {
    sourceEventId: phase3.sourceEventId,
    phase3Version: phase3.version,
    generatedAt: new Date().toISOString(),
    gatePassed: phase3.readiness.readyForPhase4,
    gateScore: phase3.readiness.score,
    minResolutionScore,
    minSignAgreement01,
    candidateConstraintCount: candidates.length,
    acceptedConstraintCount: constraints.length,
    constraints,
    note: phase3.readiness.readyForPhase4
      ? "Constraints tomográficos v1 listos para fusionarse con observaciones de deformación GNSS/InSAR. No representan tensión ni probabilidad sísmica."
      : "Gate de Fase 3 no superado: se exportan cero constraints para impedir que una solución débil contamine Fase 4.",
  };
}
