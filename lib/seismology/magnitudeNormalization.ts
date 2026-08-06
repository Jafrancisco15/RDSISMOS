export type MagnitudeNormalizationMethod =
  | "reported_mw"
  | "scordilis_mb"
  | "scordilis_ms_low"
  | "scordilis_ms_high"
  | "unsupported";

export interface NormalizedMagnitude {
  mw: number | null;
  method: MagnitudeNormalizationMethod;
  uncertainty: number | null;
  withinCalibrationRange: boolean;
  sourceType: string;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Produces a transparent Mw estimate without silently treating every magnitude
 * scale as interchangeable. Reported moment-magnitude variants pass through.
 * Global Scordilis (2006) relations are applied only inside their published
 * calibration ranges for mb and Ms. ML, Md, mbLg and unknown scales remain
 * unconverted until a regional relation is explicitly calibrated.
 */
export function normalizeToMomentMagnitude(
  magnitude: number,
  magnitudeType: string | null | undefined,
): NormalizedMagnitude {
  const type = (magnitudeType ?? "").trim().toLowerCase().replaceAll("_", "");
  if (!Number.isFinite(magnitude)) {
    return {
      mw: null,
      method: "unsupported",
      uncertainty: null,
      withinCalibrationRange: false,
      sourceType: type || "unknown",
    };
  }

  if (["mw", "mww", "mwc", "mwr", "mwb", "mwp"].includes(type)) {
    return {
      mw: round(magnitude),
      method: "reported_mw",
      uncertainty: null,
      withinCalibrationRange: true,
      sourceType: type,
    };
  }

  if (type === "mb" && magnitude >= 3.5 && magnitude <= 6.2) {
    return {
      mw: round(0.85 * magnitude + 1.03),
      method: "scordilis_mb",
      uncertainty: 0.29,
      withinCalibrationRange: true,
      sourceType: type,
    };
  }

  if (type === "ms" && magnitude >= 3 && magnitude <= 6.1) {
    return {
      mw: round(0.67 * magnitude + 2.07),
      method: "scordilis_ms_low",
      uncertainty: 0.17,
      withinCalibrationRange: true,
      sourceType: type,
    };
  }

  if (type === "ms" && magnitude >= 6.2 && magnitude <= 8.2) {
    return {
      mw: round(0.99 * magnitude + 0.08),
      method: "scordilis_ms_high",
      uncertainty: 0.2,
      withinCalibrationRange: true,
      sourceType: type,
    };
  }

  return {
    mw: null,
    method: "unsupported",
    uncertainty: null,
    withinCalibrationRange: false,
    sourceType: type || "unknown",
  };
}

export function analysisMagnitude(
  magnitude: number,
  magnitudeType: string | null | undefined,
) {
  return normalizeToMomentMagnitude(magnitude, magnitudeType).mw ?? magnitude;
}
