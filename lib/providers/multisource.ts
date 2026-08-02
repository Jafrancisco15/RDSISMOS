import { haversineKm } from "../regions";
import type { CatalogProvider, CountryTarget, SeismicEvent } from "../types";
import { fetchEmscEvents } from "./emsc";
import { fetchSeismicCatalog } from "./raspberryShake";

const SOURCE_PRIORITY: Record<string, number> = {
  "Raspberry Shake QuakeLink": 4,
  "EMSC SeismicPortal": 3,
  "USGS real-time": 2,
  "USGS ComCat": 1,
};

function priority(event: SeismicEvent) {
  return SOURCE_PRIORITY[event.source] ?? 0;
}

function sameEvent(a: SeismicEvent, b: SeismicEvent) {
  const seconds = Math.abs(new Date(a.time).getTime() - new Date(b.time).getTime()) / 1_000;
  if (seconds > 120) return false;
  if (Math.abs(a.magnitude - b.magnitude) > 0.35) return false;
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) <= 85;
}

export function mergeProviderEvents(events: SeismicEvent[]) {
  const chronological = [...events].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  );
  const result: SeismicEvent[] = [];

  for (const event of chronological) {
    const duplicateIndex = result.findIndex((existing) => sameEvent(existing, event));
    if (duplicateIndex < 0) {
      result.push(event);
      continue;
    }

    const existing = result[duplicateIndex];
    if (priority(event) > priority(existing)) {
      result[duplicateIndex] = event;
    }
  }

  return result.sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  );
}

function providerName(baseProvider: CatalogProvider, emscAvailable: boolean): CatalogProvider {
  if (!emscAvailable) return baseProvider;
  if (baseProvider === "Raspberry Shake + USGS") return "Raspberry Shake + USGS + EMSC";
  if (baseProvider === "Raspberry Shake") return "Raspberry Shake + EMSC";
  if (baseProvider === "USGS") return "USGS + EMSC";
  return baseProvider;
}

export async function fetchExpandedSeismicCatalog(
  start: Date,
  end: Date,
  target: CountryTarget,
  minimumEmscMagnitude = 4.2,
): Promise<{
  events: SeismicEvent[];
  provider: CatalogProvider;
  providerStatus: string[];
  warning?: string;
}> {
  const [baseResult, emscResult] = await Promise.allSettled([
    fetchSeismicCatalog(start, end, target),
    fetchEmscEvents({
      start,
      end,
      minMagnitude: minimumEmscMagnitude,
      limit: 20_000,
    }, target),
  ]);

  const base = baseResult.status === "fulfilled"
    ? baseResult.value
    : null;
  const emscEvents = emscResult.status === "fulfilled" ? emscResult.value : [];
  const events = mergeProviderEvents([...(base?.events ?? []), ...emscEvents]);
  if (!events.length) {
    const details = [
      baseResult.status === "rejected" && (baseResult.reason instanceof Error ? baseResult.reason.message : "catálogo base falló"),
      emscResult.status === "rejected" && (emscResult.reason instanceof Error ? emscResult.reason.message : "EMSC falló"),
    ].filter(Boolean).join("; ");
    throw new Error(details || "Ningún proveedor devolvió eventos utilizables.");
  }

  const providerStatus = [
    ...(base?.providerStatus ?? [
      `Raspberry Shake + USGS: no disponible (${baseResult.status === "rejected" && baseResult.reason instanceof Error ? baseResult.reason.message : "error"})`,
    ]),
    emscResult.status === "fulfilled"
      ? `EMSC SeismicPortal global: ${emscEvents.length} eventos M${minimumEmscMagnitude.toFixed(1)}+`
      : `EMSC SeismicPortal: no disponible (${emscResult.reason instanceof Error ? emscResult.reason.message : "error"})`,
  ];
  const warnings = [
    base?.warning,
    baseResult.status === "rejected" ? "Raspberry Shake y USGS no estuvieron disponibles." : undefined,
    emscResult.status === "rejected" ? "EMSC SeismicPortal no estuvo disponible." : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    events,
    provider: base ? providerName(base.provider, emscResult.status === "fulfilled") : "EMSC",
    providerStatus,
    warning: warnings.length ? warnings.join(" · ") : undefined,
  };
}
