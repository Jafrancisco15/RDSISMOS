import type { MechanicsDataset, MechanicsFrame } from "./types";

export interface InspectionContext {
  frame: MechanicsFrame;
  data: MechanicsDataset | null;
  plateCode: string;
}

export interface InspectionSelection extends InspectionContext {
  value: Record<string, unknown>;
}

/** Resolve a selection against the displayed state, never against a past pick. */
export function resolveInspection(selection: InspectionSelection | null, current: InspectionContext): Record<string, unknown> | null {
  if (!selection || selection.data !== current.data) return null;
  const { value } = selection;
  if (value.layer === "Voxel mecánico · SI") {
    const voxel = current.frame.voxels.find(node => node.id === value.id);
    return voxel ? { layer: value.layer, ...voxel } : null;
  }
  if (value.layer === "Reaction Vector · m / Pa") {
    const reaction = current.frame.reactions.find(vector => vector.id === value.id);
    return reaction ? { layer: value.layer, ...reaction } : null;
  }
  // Observations and structural picks can depend on epoch, source or plate.
  // Require a fresh pick if that context changed rather than retain stale ENU.
  if (selection.frame !== current.frame || selection.plateCode !== current.plateCode) return null;
  return value;
}
