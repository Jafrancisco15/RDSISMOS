export interface FaultLoadScenarioInput {
  slipRateMinMmPerYear: number;
  slipRateMaxMmPerYear: number;
  elapsedYears: number;
  ruptureLengthKm: number;
  downDipWidthKm: number;
  rigidityGPa: number;
  couplingPct: number;
}

export interface FaultLoadScenarioResult {
  deficitMinM: number;
  deficitMaxM: number;
  momentMinNm: number;
  momentMaxNm: number;
  magnitudeMin: number;
  magnitudeMax: number;
}

/**
 * Calculates a fully released elastic-slip scenario from user-selected inputs.
 * This is not a time-dependent earthquake probability or a rupture forecast.
 */
export function calculateFaultLoadScenario(input: FaultLoadScenarioInput): FaultLoadScenarioResult {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Los parámetros del escenario deben ser números finitos no negativos.");
  }
  if (input.slipRateMinMmPerYear > input.slipRateMaxMmPerYear) {
    throw new Error("La tasa mínima no puede superar la tasa máxima.");
  }

  const deficitMinM = input.slipRateMinMmPerYear * input.elapsedYears / 1_000;
  const deficitMaxM = input.slipRateMaxMmPerYear * input.elapsedYears / 1_000;
  const areaM2 = input.ruptureLengthKm * 1_000 * input.downDipWidthKm * 1_000;
  const rigidityPa = input.rigidityGPa * 1e9;
  const coupling = input.couplingPct / 100;
  const momentMinNm = rigidityPa * areaM2 * deficitMinM * coupling;
  const momentMaxNm = rigidityPa * areaM2 * deficitMaxM * coupling;
  const mw = (moment: number) => moment > 0 ? (2 / 3) * (Math.log10(moment) - 9.1) : 0;

  return {
    deficitMinM,
    deficitMaxM,
    momentMinNm,
    momentMaxNm,
    magnitudeMin: mw(momentMinNm),
    magnitudeMax: mw(momentMaxNm),
  };
}
