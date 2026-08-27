import { queryEarthquakes } from "@/lib/earthquakes/usgs";
import { updateGeomagneticWeights } from "@/lib/geomagneticProbabilistic";
import {
  finalizeProbabilisticGeomagForecast,
  getProbabilisticGeomagModel,
  listDueProbabilisticGeomagForecasts,
} from "@/lib/geomagneticProbabilisticStore";

export async function runProbabilisticGeomagEvaluation(options: { limit?: number; signal?: AbortSignal } = {}) {
  const limit = Math.max(1, Math.min(50, options.limit ?? 12));
  const due = await listDueProbabilisticGeomagForecasts(limit);
  let model = await getProbabilisticGeomagModel();
  const results: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (const forecast of due) {
    try {
      const page = await queryEarthquakes({
        startTime: forecast.windowStart,
        endTime: forecast.windowEnd,
        minMagnitude: forecast.magnitudeMin,
        latitude: forecast.latitude,
        longitude: forecast.longitude,
        maxRadiusKm: forecast.radiusKm,
        limit: 2_000,
        offset: 1,
        orderBy: "time-asc",
      }, options.signal);
      const occurred = page.events.length > 0;

      // The probability and feature vector are frozen at issuance. The label
      // arrives seven days later, so the gradient uses that frozen probability
      // even if other forecasts have already updated the current weights.
      const update = updateGeomagneticWeights({
        weights: model.weights,
        features: forecast.features.vector,
        baselineProbability: forecast.baselineProbability,
        frozenCombinedProbability: forecast.combinedProbability,
        occurred,
        learningRate: model.learningRate,
        l2: model.l2,
      });
      const nextVersion = model.version + 1;
      const reason = [
        `${forecast.id} resuelto prospectivamente: ${occurred ? "ocurrió" : "no ocurrió"} M${forecast.magnitudeMin.toFixed(1)}+ en ${forecast.radiusKm} km.`,
        `P_ETAS congelada ${(forecast.baselineProbability * 100).toFixed(2)}%; P_ETAS+Geomag congelada ${(forecast.combinedProbability * 100).toFixed(2)}%.`,
        `Actualización SGD regularizada aplicada solo a pesos futuros.`,
      ].join(" ");

      const finalized = await finalizeProbabilisticGeomagForecast({
        forecast,
        events: page.events,
        nextWeights: update.weights,
        modelVersion: nextVersion,
        updateReason: reason,
      });

      model = {
        ...model,
        version: nextVersion,
        weights: update.weights,
        evaluatedForecasts: model.evaluatedForecasts + 1,
        updatedAt: new Date().toISOString(),
        lastUpdateReason: reason,
      };
      results.push({
        id: forecast.id,
        occurred,
        eventCount: page.events.length,
        strongestMagnitude: page.events.length ? Math.max(...page.events.map((event) => event.magnitude)) : null,
        brierEtas: finalized.brierBaseline,
        brierCombined: finalized.brierCombined,
        informationGainBits: finalized.informationGainBits,
        nextModelVersion: nextVersion,
      });
    } catch (error) {
      warnings.push(`${forecast.id}: ${error instanceof Error ? error.message : "falló la evaluación"}`);
    }
  }

  return {
    evaluatedAt: new Date().toISOString(),
    dueCount: due.length,
    evaluatedCount: results.length,
    model,
    results,
    warnings,
  };
}
