import { model, type GeomagnetismModel } from "geomagnetism";

export type GeomagneticReferenceName = "WMM2025";

function decimalDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

let cachedDay = "";
let cachedModel: GeomagnetismModel | null = null;

function referenceModel(when: Date) {
  const key = decimalDayKey(when);
  if (cachedModel && cachedDay === key) return cachedModel;
  cachedModel = model(when, { allowOutOfBoundsModel: true });
  cachedDay = key;
  return cachedModel;
}

export function expectedMainFieldNt(latitude: number, longitude: number, altitudeKm = 0, when = new Date()) {
  const field = referenceModel(when).point([latitude, longitude, altitudeKm]);
  return Number.isFinite(field.f) ? field.f : null;
}

export function referenceMetadata(when = new Date()) {
  const reference = referenceModel(when);
  return {
    name: "WMM2025" as const,
    modelName: reference.name,
    epoch: reference.epoch,
    start: reference.start_date.toISOString(),
    end: reference.end_date.toISOString(),
  };
}
