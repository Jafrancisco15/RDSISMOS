import type { CatalogProvider, CountryTarget, SeismicEvent } from "../types";
import { deduplicateProviderEvents } from "./eventDedupe";
import { fetchEmscEvents } from "./emsc";
import { fetchSeismicCatalog } from "./raspberryShake";

export function mergeProviderEvents(events: SeismicEvent[]) {
  return deduplicateProviderEvents(events);
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
  const rawEvents = [...(base?.events ?? []), ...emscEvents];
  const events = mergeProviderEvents(rawEvents);
  if (!events.length) {
    const details = [
      baseResult.status === "rejected" && (baseResult.reason instanceof Error ? baseResult.reason.message : "catálogo base falló"),
      emscResult.status === "rejected" && (emscResult.reason instanceof Error ? emscResult.reason.message : "EMSC falló"),
    ].filter(Boolean).join("; ");
    throw new Error(details || "Ningún proveedor devolvió eventos utilizables.");
  }

  const duplicateReports = events.reduce((sum, event) => sum + (event.duplicateReports ?? 0), 0);
  const providerStatus = [
    ...(base?.providerStatus ?? [
      `Raspberry Shake + USGS: no disponible (${baseResult.status === "rejected" && baseResult.reason instanceof Error ? baseResult.reason.message : "error"})`,
    ]),
    emscResult.status === "fulfilled"
      ? `EMSC SeismicPortal global: ${emscEvents.length} reportes M${minimumEmscMagnitude.toFixed(1)}+`
      : `EMSC SeismicPortal: no disponible (${emscResult.reason instanceof Error ? emscResult.reason.message : "error"})`,
    `Consolidación multifuente: ${events.length} eventos únicos; ${duplicateReports} reportes duplicados absorbidos`,
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
