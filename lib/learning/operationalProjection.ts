export const OPERATIONAL_MINIMUM_MAGNITUDE = 4.2;

export interface OperationalProjectionInput {
  probabilityPct: number;
  liftPct: number;
  magnitudeMax: number;
}

/**
 * A published migration forecast must contain signal above the estimated
 * background rate. Rows with zero/negative lift remain useful as controls for
 * research, but they are not operational projections and must not be counted,
 * rendered or scored as forecasts.
 */
export function projectionIsOperational(input: OperationalProjectionInput) {
  return Number.isFinite(input.probabilityPct)
    && Number.isFinite(input.liftPct)
    && Number.isFinite(input.magnitudeMax)
    && input.probabilityPct > 0
    && input.liftPct > 0
    && input.magnitudeMax >= OPERATIONAL_MINIMUM_MAGNITUDE;
}
