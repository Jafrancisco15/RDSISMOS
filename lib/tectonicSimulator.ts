import { haversineKm } from "./regions";
import type { GlobeMapPath, GlobeMapPoint } from "./globeLayers";

const DEG = Math.PI / 180;
const STATIC_STRESS_REFERENCE_KPA = 10;
const EFFECTIVE_FRICTION = 0.4;

export type TectonicMechanism = "strike-slip" | "reverse" | "normal";
export type TectonicInteractionKind = "active-fault" | "plate-boundary";
export type TectonicStressState = "promoted" | "inhibited" | "neutral";

export interface TectonicSimulationInput {
  latitude: number;
  longitude: number;
  magnitude: number;
  depthKm: number;
  mechanism: TectonicMechanism;
  strikeDeg: number;
  dipDeg?: number;
  rakeDeg?: number;
}

export interface TectonicInteractionMetadata {
  slipType?: string | null;
  dipDeg?: number | null;
  rakeDeg?: number | null;
  dipDirection?: string | null;
  activityConfidence?: number | null;
  reference?: string | null;
  plateA?: string | null;
  plateB?: string | null;
  boundaryType?: string | null;
}

export interface TectonicInteraction {
  id: string;
  kind: TectonicInteractionKind;
  name: string;
  points: GlobeMapPoint[];
  closestPoint: GlobeMapPoint;
  distanceKm: number;
  azimuthDeg: number;
  strikeDeg: number;
  receiverDipDeg: number;
  receiverRakeDeg: number;
  stressState: TectonicStressState;
  stressProxyKpa: number;
  responseScore: number;
  evidenceQuality: "high" | "medium" | "low";
  metadata: TectonicInteractionMetadata;
  interpretation: string;
}

export interface TectonicSimulationResponse {
  generatedAt: string;
  input: Required<TectonicSimulationInput>;
  source: {
    seismicMomentNm: number;
    ruptureAreaKm2: number;
    ruptureLengthKm: number;
    ruptureWidthKm: number;
    interactionRadiusKm: number;
    effectiveFriction: number;
    stressReferenceKpa: number;
  };
  interactions: TectonicInteraction[];
  counts: {
    total: number;
    promoted: number;
    inhibited: number;
    neutral: number;
    faults: number;
    plateBoundaries: number;
  };
  warnings: string[];
  methodology: string[];
  sources: Array<{ label: string; citation: string }>;
}

interface GeoJsonFeature {
  properties?: Record<string, unknown>;
}

interface GeoJsonFeatureCollection {
  features?: GeoJsonFeature[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize360(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function angularDifference(left: number, right: number) {
  const difference = Math.abs(normalize360(left) - normalize360(right));
  return Math.min(difference, 360 - difference);
}

function parseTuplePrimary(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[()\[\]]/g, "");
  const first = cleaned.split(",").map((part) => part.trim()).find(Boolean);
  if (!first) return null;
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : null;
}

function propertyString(properties: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function propertyNumber(properties: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = properties?.[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function featureIndex(path: GlobeMapPath) {
  const parts = path.id.split(":");
  const parsed = Number(parts[1]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function propertiesForPath(path: GlobeMapPath, payload: unknown) {
  const index = featureIndex(path);
  if (index === null || !payload || typeof payload !== "object") return undefined;
  const features = (payload as GeoJsonFeatureCollection).features ?? [];
  return features[index]?.properties;
}

function faultMetadata(path: GlobeMapPath, payload: unknown): TectonicInteractionMetadata {
  const properties = propertiesForPath(path, payload);
  return {
    slipType: propertyString(properties, "slip_type", "slipType"),
    dipDeg: parseTuplePrimary(properties?.dip),
    rakeDeg: parseTuplePrimary(properties?.average_rake ?? properties?.rake),
    dipDirection: propertyString(properties, "dip_dir", "dip_direction"),
    activityConfidence: propertyNumber(properties, "activity_confidence"),
    reference: propertyString(properties, "reference", "references", "source"),
  };
}

function plateMetadata(path: GlobeMapPath, payload: unknown): TectonicInteractionMetadata {
  const properties = propertiesForPath(path, payload);
  return {
    plateA: propertyString(properties, "PlateA", "plate_a", "PLATE_A"),
    plateB: propertyString(properties, "PlateB", "plate_b", "PLATE_B"),
    boundaryType: propertyString(properties, "Type", "type", "LAYER"),
    reference: propertyString(properties, "Source", "source"),
  };
}

function bearingDeg(from: GlobeMapPoint, to: GlobeMapPoint) {
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const deltaLng = (to.lng - from.lng) * DEG;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalize360(Math.atan2(y, x) / DEG);
}

function nearestGeometry(source: GlobeMapPoint, path: GlobeMapPath) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  path.points.forEach((point, index) => {
    const distance = haversineKm(source.lat, source.lng, point.lat, point.lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  const closestPoint = path.points[bestIndex] ?? path.points[0];
  const previous = path.points[Math.max(0, bestIndex - 1)] ?? closestPoint;
  const next = path.points[Math.min(path.points.length - 1, bestIndex + 1)] ?? closestPoint;
  const strikeDeg = previous === next ? 0 : bearingDeg(previous, next);
  return {
    closestPoint,
    distanceKm: bestDistance,
    strikeDeg,
    azimuthDeg: bearingDeg(source, closestPoint),
  };
}

export function defaultDipForMechanism(mechanism: TectonicMechanism) {
  if (mechanism === "reverse") return 30;
  if (mechanism === "normal") return 60;
  return 90;
}

export function defaultRakeForMechanism(mechanism: TectonicMechanism) {
  if (mechanism === "reverse") return 90;
  if (mechanism === "normal") return -90;
  return 0;
}

function mechanismFromText(value?: string | null): TectonicMechanism | null {
  const text = value?.toLowerCase() ?? "";
  if (!text) return null;
  if (/normal|diverg|ridge|spreading|extens/.test(text)) return "normal";
  if (/reverse|thrust|subduct|converg|compress/.test(text)) return "reverse";
  if (/dextral|sinistral|strike|transform|transcurrent|lateral/.test(text)) return "strike-slip";
  return null;
}

function receiverGeometry(
  kind: TectonicInteractionKind,
  metadata: TectonicInteractionMetadata,
  sourceMechanism: TectonicMechanism,
) {
  const inferred = mechanismFromText(metadata.slipType)
    ?? mechanismFromText(metadata.boundaryType)
    ?? sourceMechanism;
  return {
    mechanism: inferred,
    dipDeg: metadata.dipDeg ?? defaultDipForMechanism(inferred),
    rakeDeg: metadata.rakeDeg ?? defaultRakeForMechanism(inferred),
    metadataKnown: kind === "active-fault" && metadata.dipDeg !== null && metadata.rakeDeg !== null,
  };
}

export function seismicMomentNm(magnitude: number) {
  return 10 ** (1.5 * magnitude + 9.1);
}

export function ruptureDimensionsKm(magnitude: number) {
  // Wells & Coppersmith (1994), all rupture types. Median empirical scaling.
  const areaKm2 = 10 ** (-3.49 + 0.91 * magnitude);
  const lengthKm = 10 ** (-2.44 + 0.59 * magnitude);
  const widthKm = areaKm2 / Math.max(lengthKm, 0.001);
  return { areaKm2, lengthKm, widthKm };
}

function sourceLobe(mechanism: TectonicMechanism, relativeAzimuthRad: number) {
  if (mechanism === "strike-slip") return Math.cos(2 * relativeAzimuthRad);
  const thrustLike = Math.cos(relativeAzimuthRad) ** 2 * 2 - 1;
  return mechanism === "reverse" ? thrustLike : -thrustLike;
}

function coulombGeometryFactor(
  input: Required<TectonicSimulationInput>,
  receiverStrikeDeg: number,
  receiverDipDeg: number,
  receiverRakeDeg: number,
  azimuthDeg: number,
) {
  const relativeAzimuth = (azimuthDeg - input.strikeDeg) * DEG;
  const sourcePattern = sourceLobe(input.mechanism, relativeAzimuth);
  const strikeCompatibility = Math.cos(2 * angularDifference(receiverStrikeDeg, input.strikeDeg) * DEG);
  const rakeCompatibility = Math.cos((receiverRakeDeg - input.rakeDeg) * DEG);
  const receiverNormalRelation = Math.sin(receiverDipDeg * DEG)
    * Math.cos((azimuthDeg - receiverStrikeDeg) * DEG);
  return clamp(
    0.5 * sourcePattern * strikeCompatibility
      + 0.3 * rakeCompatibility
      + 0.2 * EFFECTIVE_FRICTION * receiverNormalRelation,
    -1,
    1,
  );
}

function stressProxyKpa(
  input: Required<TectonicSimulationInput>,
  distanceKm: number,
  ruptureLengthKm: number,
  geometryFactor: number,
) {
  // Far-field elastic static stress scales approximately as M0 / r^3. A finite
  // source term avoids the point-source singularity close to the rupture.
  const horizontalM = distanceKm * 1_000;
  const depthM = input.depthKm * 1_000;
  const finiteSourceM = Math.max(1_000, ruptureLengthKm * 500);
  const effectiveDistanceM = Math.sqrt(
    horizontalM ** 2 + depthM ** 2 + finiteSourceM ** 2,
  );
  const scalarPa = seismicMomentNm(input.magnitude)
    / (4 * Math.PI * effectiveDistanceM ** 3);
  return clamp((scalarPa * geometryFactor) / 1_000, -5_000, 5_000);
}

function evidenceQuality(
  kind: TectonicInteractionKind,
  metadataKnown: boolean,
  distanceKm: number,
  ruptureLengthKm: number,
): "high" | "medium" | "low" {
  const relativeDistance = distanceKm / Math.max(ruptureLengthKm, 1);
  if (kind === "active-fault" && metadataKnown && relativeDistance <= 8) return "high";
  if ((kind === "active-fault" && relativeDistance <= 18) || relativeDistance <= 8) return "medium";
  return "low";
}

function stressState(stressKpa: number): TectonicStressState {
  if (stressKpa >= STATIC_STRESS_REFERENCE_KPA) return "promoted";
  if (stressKpa <= -STATIC_STRESS_REFERENCE_KPA) return "inhibited";
  return "neutral";
}

function interpretation(state: TectonicStressState, kind: TectonicInteractionKind) {
  const subject = kind === "active-fault" ? "plano de falla" : "segmento de límite de placa";
  if (state === "promoted") {
    return `El ${subject} queda en una geometría relativamente favorecida por el cambio estático simplificado. No implica que vaya a romper.`;
  }
  if (state === "inhibited") {
    return `El ${subject} cae en una zona de sombra relativa de esfuerzo dentro del modelo simplificado. No elimina su peligro sísmico.`;
  }
  return `El cambio estático estimado sobre este ${subject} es pequeño o geométricamente ambiguo respecto al umbral de visualización.`;
}

function interactionRadiusKm(ruptureLengthKm: number) {
  return Math.round(clamp(ruptureLengthKm * 35, 250, 3_000));
}

function buildInteraction(
  input: Required<TectonicSimulationInput>,
  path: GlobeMapPath,
  kind: TectonicInteractionKind,
  metadata: TectonicInteractionMetadata,
  radiusKm: number,
  ruptureLengthKm: number,
): TectonicInteraction | null {
  if (path.points.length < 2) return null;
  const source = { lat: input.latitude, lng: input.longitude };
  const geometry = nearestGeometry(source, path);
  if (!Number.isFinite(geometry.distanceKm) || geometry.distanceKm > radiusKm) return null;
  const receiver = receiverGeometry(kind, metadata, input.mechanism);
  const factor = coulombGeometryFactor(
    input,
    geometry.strikeDeg,
    receiver.dipDeg,
    receiver.rakeDeg,
    geometry.azimuthDeg,
  );
  const stressKpa = stressProxyKpa(input, geometry.distanceKm, ruptureLengthKm, factor);
  const state = stressState(stressKpa);
  const responseScore = Math.round(100 * (1 - Math.exp(-Math.abs(stressKpa) / 50)));
  return {
    id: path.id,
    kind,
    name: path.name,
    points: path.points,
    closestPoint: geometry.closestPoint,
    distanceKm: Number(geometry.distanceKm.toFixed(1)),
    azimuthDeg: Number(geometry.azimuthDeg.toFixed(1)),
    strikeDeg: Number(geometry.strikeDeg.toFixed(1)),
    receiverDipDeg: Number(receiver.dipDeg.toFixed(1)),
    receiverRakeDeg: Number(receiver.rakeDeg.toFixed(1)),
    stressState: state,
    stressProxyKpa: Number(stressKpa.toFixed(2)),
    responseScore,
    evidenceQuality: evidenceQuality(kind, receiver.metadataKnown, geometry.distanceKm, ruptureLengthKm),
    metadata,
    interpretation: interpretation(state, kind),
  };
}

export function normalizeSimulationInput(input: TectonicSimulationInput): Required<TectonicSimulationInput> {
  const latitude = clamp(Number(input.latitude), -90, 90);
  const longitude = clamp(Number(input.longitude), -180, 180);
  const magnitude = clamp(Number(input.magnitude), 4, 9.5);
  const depthKm = clamp(Number(input.depthKm), 0, 700);
  const mechanism = input.mechanism;
  const strikeDeg = normalize360(Number(input.strikeDeg));
  const dipDeg = clamp(Number(input.dipDeg ?? defaultDipForMechanism(mechanism)), 1, 90);
  const rakeDeg = clamp(Number(input.rakeDeg ?? defaultRakeForMechanism(mechanism)), -180, 180);
  return { latitude, longitude, magnitude, depthKm, mechanism, strikeDeg, dipDeg, rakeDeg };
}

export function simulateTectonicInteractions(
  rawInput: TectonicSimulationInput,
  platePaths: GlobeMapPath[],
  faultPaths: GlobeMapPath[],
  platePayload?: unknown,
  faultPayload?: unknown,
): TectonicSimulationResponse {
  const input = normalizeSimulationInput(rawInput);
  const rupture = ruptureDimensionsKm(input.magnitude);
  const radiusKm = interactionRadiusKm(rupture.lengthKm);

  const faults = faultPaths
    .map((path) => buildInteraction(
      input,
      path,
      "active-fault",
      faultMetadata(path, faultPayload),
      radiusKm,
      rupture.lengthKm,
    ))
    .filter((item): item is TectonicInteraction => Boolean(item))
    .sort((a, b) => Math.abs(b.stressProxyKpa) - Math.abs(a.stressProxyKpa) || a.distanceKm - b.distanceKm)
    .slice(0, 42);

  const plates = platePaths
    .map((path) => buildInteraction(
      input,
      path,
      "plate-boundary",
      plateMetadata(path, platePayload),
      radiusKm,
      rupture.lengthKm,
    ))
    .filter((item): item is TectonicInteraction => Boolean(item))
    .sort((a, b) => Math.abs(b.stressProxyKpa) - Math.abs(a.stressProxyKpa) || a.distanceKm - b.distanceKm)
    .slice(0, 28);

  const interactions = [...faults, ...plates]
    .sort((a, b) => Math.abs(b.stressProxyKpa) - Math.abs(a.stressProxyKpa) || a.distanceKm - b.distanceKm);

  return {
    generatedAt: new Date().toISOString(),
    input,
    source: {
      seismicMomentNm: seismicMomentNm(input.magnitude),
      ruptureAreaKm2: Number(rupture.areaKm2.toFixed(1)),
      ruptureLengthKm: Number(rupture.lengthKm.toFixed(1)),
      ruptureWidthKm: Number(rupture.widthKm.toFixed(1)),
      interactionRadiusKm: radiusKm,
      effectiveFriction: EFFECTIVE_FRICTION,
      stressReferenceKpa: STATIC_STRESS_REFERENCE_KPA,
    },
    interactions,
    counts: {
      total: interactions.length,
      promoted: interactions.filter((item) => item.stressState === "promoted").length,
      inhibited: interactions.filter((item) => item.stressState === "inhibited").length,
      neutral: interactions.filter((item) => item.stressState === "neutral").length,
      faults: faults.length,
      plateBoundaries: plates.length,
    },
    warnings: [
      "El valor ΔCFS mostrado es un proxy elástico de primer orden, no una solución Okada/Coulomb 3.3 de falla finita.",
      "Sin un mecanismo focal observado y geometría 3D completa de cada falla, el signo y amplitud pueden cambiar sustancialmente.",
      "El simulador estima interacción estática; no modela ondas dinámicas, presión de poros ni una fecha de ocurrencia futura.",
    ],
    methodology: [
      "Mw se convierte a momento sísmico con la relación de Hanks–Kanamori usada por USGS.",
      "El tamaño mediano de ruptura usa las relaciones empíricas globales de Wells & Coppersmith (1994).",
      "La amplitud estática se aproxima con la caída M0/r³ de un campo elástico y se resuelve sobre la orientación receptora mediante un proxy tipo Coulomb con fricción efectiva 0.4.",
      "La geometría y cinemática de fallas provienen de GEM GAF-DB cuando esos atributos existen; los límites de placa proceden de PB2002 de Bird (2003).",
      "±10 kPa se usa solo como referencia visual de sensibilidad; estudios de transferencia de esfuerzos muestran que cambios de ese orden pueden ser relevantes, pero no constituyen un umbral universal de disparo.",
    ],
    sources: [
      { label: "King, Stein & Lin (1994)", citation: "Static stress changes and the triggering of earthquakes, BSSA 84, 935–953." },
      { label: "Toda et al. / USGS Coulomb 3.3", citation: "Coulomb 3.3 user guide, USGS OFR 2011-1060." },
      { label: "Wells & Coppersmith (1994)", citation: "Empirical magnitude–rupture dimensions, BSSA 84, 974–1002." },
      { label: "Styron & Pagani (2020)", citation: "GEM Global Active Faults Database, Earthquake Spectra 36." },
      { label: "Bird (2003)", citation: "Updated digital model of plate boundaries, G3 4, 1027." },
      { label: "Lin et al. / northern Caribbean", citation: "3D static Coulomb interaction between subduction earthquakes and forearc strike-slip faults." },
    ],
  };
}
