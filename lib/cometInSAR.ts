import type { GnssEventSource } from "./nglGnss";

export type CometInSarObservation = "Coseismic" | "Postseismic" | "Preseismic";

export interface CometInSarProduct {
  frameId: string;
  track: number;
  direction: "A" | "D";
  observation: CometInSarObservation;
  pair: string;
  startUtc: string;
  endUtc: string;
  candidateUnwrappedUrl: string;
  candidateCoherenceUrl: string;
  numericDisplacementAvailable: false;
}

export interface CometInSarCatalog {
  provider: "COMET LiCSAR";
  available: boolean;
  generatedAt: string;
  eventPage: string | null;
  products: CometInSarProduct[];
  coseismicCount: number;
  numericRasterCount: 0;
  note: string;
  warnings: string[];
}

function htmlText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function dateFromCompact(value: string) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function productUrls(frameId: string, pair: string) {
  const track = Number.parseInt(frameId.slice(0, 3), 10);
  const base = `https://gws-access.jasmin.ac.uk/public/nceo_geohazards/LiCSAR_products/${track}/${frameId}/interferograms/${pair}`;
  return {
    track,
    candidateUnwrappedUrl: `${base}/${pair}.geo.unw.tif`,
    candidateCoherenceUrl: `${base}/${pair}.geo.cc.tif`,
  };
}

export function parseCometInSarHtml(html: string): CometInSarProduct[] {
  const text = htmlText(html);
  const regex = /(\d{3}[AD]_\d{5}_\d{6})\s+([AD])\s+(Coseismic|Postseismic|Preseismic)\s+(\d{8}_\d{8})/gi;
  const found: CometInSarProduct[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(regex)) {
    const frameId = (match[1] ?? "").toUpperCase();
    const direction = (match[2] ?? "").toUpperCase() as "A" | "D";
    const observationRaw = match[3] ?? "";
    const observation = `${observationRaw[0]?.toUpperCase() ?? ""}${observationRaw.slice(1).toLowerCase()}` as CometInSarObservation;
    const pair = match[4] ?? "";
    const [startCompact, endCompact] = pair.split("_");
    const startUtc = dateFromCompact(startCompact ?? "");
    const endUtc = dateFromCompact(endCompact ?? "");
    if (!frameId || !pair || !startUtc || !endUtc) continue;
    const key = `${frameId}:${observation}:${pair}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const urls = productUrls(frameId, pair);
    found.push({
      frameId,
      track: urls.track,
      direction,
      observation,
      pair,
      startUtc,
      endUtc,
      candidateUnwrappedUrl: urls.candidateUnwrappedUrl,
      candidateCoherenceUrl: urls.candidateCoherenceUrl,
      numericDisplacementAvailable: false,
    });
  }
  return found.sort((a, b) => {
    const priority = (value: CometInSarObservation) => value === "Coseismic" ? 0 : value === "Postseismic" ? 1 : 2;
    return priority(a.observation) - priority(b.observation) || Date.parse(a.startUtc) - Date.parse(b.startUtc);
  });
}

export function emptyCometInSarCatalog(warning?: string): CometInSarCatalog {
  return {
    provider: "COMET LiCSAR",
    available: false,
    generatedAt: new Date().toISOString(),
    eventPage: null,
    products: [],
    coseismicCount: 0,
    numericRasterCount: 0,
    note: "Sin catálogo LiCSAR asociado o no disponible. La ausencia de producto no implica ausencia de deformación.",
    warnings: warning ? [warning] : [],
  };
}

export async function loadCometInSarCatalog(source: GnssEventSource, signal?: AbortSignal): Promise<CometInSarCatalog> {
  if (!/^us[0-9a-z]+$/i.test(source.id)) {
    return emptyCometInSarCatalog("El evento no tiene un ID USGS compatible con el catálogo COMET LiCSAR.");
  }
  const eventPage = `https://comet.nerc.ac.uk/earthquakes/${encodeURIComponent(source.id)}.html`;
  try {
    const response = await fetch(eventPage, {
      signal,
      cache: "no-store",
      headers: { Accept: "text/html", "User-Agent": "RDSISMOS/1.5 Phase4-InSAR" },
    });
    if (!response.ok) {
      return { ...emptyCometInSarCatalog(`COMET LiCSAR HTTP ${response.status}.`), eventPage };
    }
    const products = parseCometInSarHtml(await response.text());
    const warnings: string[] = [];
    if (!products.length) warnings.push("La página del evento no expuso productos LiCSAR reconocibles para este parser.");
    return {
      provider: "COMET LiCSAR",
      available: products.length > 0,
      generatedAt: new Date().toISOString(),
      eventPage,
      products,
      coseismicCount: products.filter((product) => product.observation === "Coseismic").length,
      numericRasterCount: 0,
      note: "Fase 4 v0.1 descubre interferogramas y conserva sus pares/frames. El raster LOS no entra todavía al campo numérico Ux/Uy/Uz hasta validar lectura GeoTIFF, fase y geometría de mirada.",
      warnings,
    };
  } catch (error) {
    return { ...emptyCometInSarCatalog(error instanceof Error ? error.message : "COMET LiCSAR no disponible."), eventPage };
  }
}
