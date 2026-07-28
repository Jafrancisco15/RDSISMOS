import type { SeismicEvent, WatchedRegion } from "./types";

export const DOMINICAN_TARGET: WatchedRegion = {
  id: "dominican-region",
  name: "La Española, Canal de la Mona y entorno",
  latitude: 18.7357,
  longitude: -70.1627,
  radiusKm: 1_000,
  historicalNote:
    "Zona objetivo: falla Septentrional, sistema Enriquillo–Plantain Garden, Canal de la Mona y subducción al norte de La Española.",
};

export const WATCHED_REGIONS: WatchedRegion[] = [
  {
    id: "vanuatu",
    name: "Vanuatu / Nuevas Hébridas",
    latitude: -17.7,
    longitude: 168.3,
    radiusKm: 1_050,
    historicalNote: "Registró un M7.0 el 9 de julio de 1946, 26 días antes del gran sismo dominicano.",
  },
  {
    id: "mexico",
    name: "México y Veracruz",
    latitude: 19.2,
    longitude: -96.2,
    radiusKm: 1_350,
    historicalNote: "Veracruz registró un M7.1 el 11 de julio de 1946.",
  },
  {
    id: "alaska-aleutians",
    name: "Alaska e islas Aleutianas",
    latitude: 53.5,
    longitude: -166.5,
    radiusKm: 1_500,
    historicalNote: "Las islas Fox registraron un M6.8 el 12 de julio de 1946.",
  },
  {
    id: "chile",
    name: "Chile: Tarapacá y Atacama",
    latitude: -24.5,
    longitude: -70.3,
    radiusKm: 1_300,
    historicalNote: "Tarapacá y Atacama registraron M6.3 y M6.9 antes del evento de agosto de 1946.",
  },
  {
    id: "peru",
    name: "Perú y Arequipa",
    latitude: -16.4,
    longitude: -72.2,
    radiusKm: 1_100,
    historicalNote: "Arequipa registró un M6.8 el 5 de julio de 1943.",
  },
  {
    id: "java",
    name: "Java, Indonesia",
    latitude: -8.0,
    longitude: 110.5,
    radiusKm: 1_050,
    historicalNote: "El sur de Java registró un M7.0 seis días antes del evento del Canal de la Mona de 1943.",
  },
  {
    id: "flores",
    name: "Mar de Flores, Indonesia",
    latitude: -7.5,
    longitude: 122.0,
    radiusKm: 850,
    historicalNote: "El mar de Flores registró un M6.8 el 30 de junio de 1943.",
  },
  {
    id: "celebes",
    name: "Mar de Célebes",
    latitude: 3.0,
    longitude: 122.0,
    radiusKm: 900,
    historicalNote: "El mar de Célebes registró un M6.5 el 29 de junio de 1943.",
  },
  {
    id: "kermadec",
    name: "Kermadec y Tonga",
    latitude: -29.0,
    longitude: -177.0,
    radiusKm: 1_100,
    historicalNote: "El sur de Kermadec registró un M6.7 el 11 de julio de 1943.",
  },
];

const EARTH_RADIUS_KM = 6_371;

export function haversineKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(latitudeB - latitudeA);
  const dLon = toRadians(longitudeB - longitudeA);
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function regionForEvent(event: Pick<SeismicEvent, "latitude" | "longitude">) {
  return WATCHED_REGIONS.find(
    (region) =>
      haversineKm(event.latitude, event.longitude, region.latitude, region.longitude) <=
      region.radiusKm,
  );
}

export function isInDominicanRegion(
  event: Pick<SeismicEvent, "latitude" | "longitude">,
): boolean {
  return (
    haversineKm(
      event.latitude,
      event.longitude,
      DOMINICAN_TARGET.latitude,
      DOMINICAN_TARGET.longitude,
    ) <= DOMINICAN_TARGET.radiusKm
  );
}
