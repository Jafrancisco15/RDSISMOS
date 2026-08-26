export type ExtractionKind = "oil_gas" | "fracking" | "injection" | "mineral" | "reservoir" | "groundwater";

export interface ExtractionSite {
  id: string;
  name: string;
  kind: ExtractionKind;
  latitude: number;
  longitude: number;
  country: string;
  location?: string;
  operator?: string;
  status?: string;
  detail: string;
  source: string;
  sourceType: "official" | "research" | "reference";
  representative?: boolean;
  waterHeadM?: number;
  quantityValue?: number;
  quantityUnit?: string;
  quantityPeriod?: string;
  quantityYear?: number;
  quantityLabel?: string;
  quantitySource?: string;
}

export interface SpatialCoincidence {
  distanceKm: number;
  score: number;
  earthquakeId: string | null;
  earthquakeMagnitude: number | null;
  earthquakeDepthKm: number | null;
}

export const EXTRACTION_KIND_LABELS: Record<ExtractionKind, string> = {
  oil_gas: "Petróleo / gas",
  fracking: "Fracking",
  injection: "Inyección residual",
  mineral: "Minería / minerales",
  reservoir: "Embalse / carga de agua",
  groundwater: "Extracción de agua subterránea",
};

export const EXTRACTION_KIND_COLORS: Record<ExtractionKind, string> = {
  oil_gas: "#ff9f43",
  fracking: "#e056fd",
  injection: "#ff4757",
  mineral: "#ffd32a",
  reservoir: "#22d3ee",
  groundwater: "#74b9ff",
};

/**
 * Reference centroids used when a global, point-level public API is not available.
 * They are intentionally labelled representative and never presented as individual wells.
 */
export const REFERENCE_EXTRACTION_SITES: ExtractionSite[] = [
  { id: "oil-maracaibo", name: "Cuenca de Maracaibo", kind: "oil_gas", latitude: 10.15, longitude: -71.65, country: "Venezuela", location: "Zulia / Lago de Maracaibo", detail: "Área petrolera representativa de la cuenca de Maracaibo.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-orinoco", name: "Faja Petrolífera del Orinoco", kind: "oil_gas", latitude: 8.55, longitude: -64.65, country: "Venezuela", location: "Faja del Orinoco", detail: "Centroide representativo de la Faja del Orinoco; no representa un pozo individual.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-permian", name: "Permian Basin", kind: "oil_gas", latitude: 31.75, longitude: -102.45, country: "Estados Unidos", location: "Texas / New Mexico", detail: "Cuenca de producción de petróleo y gas; punto representativo.", source: "EIA / referencia regional", sourceType: "reference", representative: true },
  { id: "oil-ghawar", name: "Ghawar Field", kind: "oil_gas", latitude: 25.43, longitude: 49.62, country: "Arabia Saudita", location: "Eastern Province", detail: "Campo petrolero; ubicación representativa para análisis regional.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-burgan", name: "Greater Burgan", kind: "oil_gas", latitude: 29.08, longitude: 47.97, country: "Kuwait", location: "Al Ahmadi", detail: "Campo petrolero; ubicación representativa.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-north-sea", name: "Northern North Sea", kind: "oil_gas", latitude: 60.45, longitude: 2.25, country: "Mar del Norte", location: "Offshore", detail: "Cluster representativo de extracción costa afuera.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-west-siberia", name: "West Siberian Basin", kind: "oil_gas", latitude: 61.2, longitude: 73.1, country: "Rusia", location: "Siberia occidental", detail: "Cuenca de petróleo y gas; centroide representativo.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-niger-delta", name: "Niger Delta", kind: "oil_gas", latitude: 5.15, longitude: 6.4, country: "Nigeria", location: "Delta del Níger", detail: "Región de extracción de petróleo y gas; centroide representativo.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "oil-campos", name: "Campos Basin", kind: "oil_gas", latitude: -22.2, longitude: -40.3, country: "Brasil", location: "Offshore Río de Janeiro / Espírito Santo", detail: "Cuenca offshore de petróleo y gas; centroide representativo.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "frac-permian", name: "Permian / Delaware fracking cluster", kind: "fracking", latitude: 31.85, longitude: -103.55, country: "Estados Unidos", location: "Texas / New Mexico", detail: "Cluster regional representativo de completaciones hidráulicas.", source: "EIA / FracFocus context", sourceType: "reference", representative: true },
  { id: "frac-bakken", name: "Bakken", kind: "fracking", latitude: 48.1, longitude: -103.0, country: "Estados Unidos", location: "North Dakota / Montana", detail: "Área representativa de desarrollo no convencional.", source: "EIA / FracFocus context", sourceType: "reference", representative: true },
  { id: "frac-marcellus", name: "Marcellus", kind: "fracking", latitude: 40.9, longitude: -78.7, country: "Estados Unidos", location: "Appalachia", detail: "Área representativa de gas de lutitas.", source: "EIA / FracFocus context", sourceType: "reference", representative: true },
  { id: "frac-vaca-muerta", name: "Vaca Muerta", kind: "fracking", latitude: -38.3, longitude: -69.3, country: "Argentina", location: "Neuquén", detail: "Área representativa de desarrollo shale.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "frac-montney", name: "Montney Formation", kind: "fracking", latitude: 55.7, longitude: -121.4, country: "Canadá", location: "British Columbia / Alberta", detail: "Área representativa de desarrollo no convencional.", source: "Referencia regional de extracción", sourceType: "reference", representative: true },
  { id: "inj-oklahoma", name: "Oklahoma wastewater injection cluster", kind: "injection", latitude: 35.65, longitude: -97.45, country: "Estados Unidos", location: "Oklahoma", detail: "Cluster regional de pozos Class II / disposición de agua asociada a petróleo y gas.", source: "EPA UIC / USGS induced seismicity context", sourceType: "official", representative: true },
  { id: "inj-delaware", name: "Delaware Basin injection cluster", kind: "injection", latitude: 31.65, longitude: -103.85, country: "Estados Unidos", location: "Texas / New Mexico", detail: "Cluster regional representativo de inyección de agua residual.", source: "EPA UIC / reguladores estatales", sourceType: "official", representative: true },
  { id: "inj-kansas", name: "South-central Kansas injection cluster", kind: "injection", latitude: 37.25, longitude: -97.8, country: "Estados Unidos", location: "Kansas centro-sur", detail: "Cluster regional representativo de pozos de inyección relacionados con petróleo y gas.", source: "EPA UIC context", sourceType: "official", representative: true },
  { id: "res-koyna", name: "Koyna Reservoir", kind: "reservoir", latitude: 17.4, longitude: 73.75, country: "India", location: "Maharashtra", detail: "Embalse clásico en estudios de sismicidad asociada a carga/infiltración.", source: "Referencia geofísica", sourceType: "research", representative: true, waterHeadM: 103, quantityLabel: "Columna de agua de referencia: 103 m" },
  { id: "res-kariba", name: "Kariba Reservoir", kind: "reservoir", latitude: -16.52, longitude: 28.76, country: "Zambia / Zimbabue", location: "Río Zambezi", detail: "Gran embalse utilizado en estudios de carga cortical y sismicidad inducida.", source: "Referencia geofísica", sourceType: "research", representative: true, waterHeadM: 128, quantityLabel: "Columna de agua de referencia: 128 m" },
  { id: "res-three-gorges", name: "Three Gorges Reservoir", kind: "reservoir", latitude: 30.82, longitude: 111.0, country: "China", location: "Hubei / Yangtsé", detail: "Gran embalse; se representa la carga de agua como contexto geofísico.", source: "Referencia geofísica", sourceType: "research", representative: true, waterHeadM: 175, quantityLabel: "Columna de agua de referencia: 175 m" },
  { id: "res-zipingpu", name: "Zipingpu Reservoir", kind: "reservoir", latitude: 31.04, longitude: 103.57, country: "China", location: "Sichuan", detail: "Embalse estudiado por su relación temporal y mecánica con sismicidad regional.", source: "Referencia geofísica", sourceType: "research", representative: true, waterHeadM: 156, quantityLabel: "Columna de agua de referencia: 156 m" },
  { id: "res-guri", name: "Guri Reservoir", kind: "reservoir", latitude: 7.76, longitude: -62.99, country: "Venezuela", location: "Bolívar / río Caroní", detail: "Gran embalse; capa de carga superficial de agua.", source: "Referencia geográfica", sourceType: "reference", representative: true, waterHeadM: 162, quantityLabel: "Columna de agua de referencia: 162 m" },
  { id: "res-itaipu", name: "Itaipu Reservoir", kind: "reservoir", latitude: -25.41, longitude: -54.59, country: "Brasil / Paraguay", location: "Río Paraná", detail: "Gran embalse; capa de carga superficial de agua.", source: "Referencia geográfica", sourceType: "reference", representative: true, waterHeadM: 196, quantityLabel: "Columna de agua de referencia: 196 m" },
  { id: "gw-central-valley", name: "California Central Valley groundwater", kind: "groundwater", latitude: 36.3, longitude: -119.6, country: "Estados Unidos", location: "California Central Valley", detail: "Región representativa de extracción y variación de almacenamiento de agua subterránea.", source: "USGS groundwater context", sourceType: "official", representative: true },
  { id: "gw-jakarta", name: "Jakarta groundwater extraction", kind: "groundwater", latitude: -6.2, longitude: 106.82, country: "Indonesia", location: "Jakarta", detail: "Región representativa de extracción de agua subterránea y subsidencia.", source: "Referencia hidrogeológica", sourceType: "research", representative: true },
];

export function extractionQuantityText(site: ExtractionSite) {
  if (site.quantityLabel) return site.quantityLabel;
  if (site.quantityValue !== undefined && site.quantityUnit) {
    const amount = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 2 }).format(site.quantityValue);
    const period = site.quantityPeriod ? ` / ${site.quantityPeriod}` : "";
    const year = site.quantityYear ? ` · ${site.quantityYear}` : "";
    return `${amount} ${site.quantityUnit}${period}${year}`;
  }
  return "No disponible en la fuente cargada";
}

export function waterPressureMpa(headM: number) {
  return 1000 * 9.80665 * Math.max(0, headM) / 1_000_000;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusKm = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function coincidenceScore(distanceKm: number, depthKm: number, kind: ExtractionKind) {
  const distance = Math.exp(-Math.max(0, distanceKm) / 45);
  const shallow = Math.exp(-Math.max(0, depthKm) / 55);
  const kindWeight = kind === "injection" ? 1
    : kind === "fracking" ? 0.9
      : kind === "reservoir" ? 0.82
        : kind === "groundwater" ? 0.65
          : kind === "oil_gas" ? 0.55
            : 0.45;
  return Math.round(Math.min(100, 100 * distance * (0.42 + 0.58 * shallow) * kindWeight));
}
