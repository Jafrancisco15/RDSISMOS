import { haversineKm } from "@/lib/regions";

export type TectonicRegime =
  | "subduction"
  | "strike_slip"
  | "rift_normal"
  | "collision"
  | "mixed";

export interface TectonicReceiverZone {
  id: string;
  name: string;
  regime: TectonicRegime;
  latitude: number;
  longitude: number;
  radiusKm: number;
  description: string;
}

export interface ReceiverZoneMatch {
  zone: TectonicReceiverZone;
  distanceKm: number;
  normalizedDistance: number;
  insideCore: boolean;
  confidence: "high" | "medium" | "low";
}

/**
 * Coarse global receiver corridors used only as a transition away from country
 * circles. They are not individual mapped faults and must not be interpreted as
 * a substitute for a 3-D fault mesh, focal mechanisms or Coulomb calculations.
 */
export const TECTONIC_RECEIVER_ZONES: TectonicReceiverZone[] = [
  {
    id: "caribbean-plate-boundary",
    name: "Límite de placa del Caribe",
    regime: "mixed",
    latitude: 18.2,
    longitude: -70.5,
    radiusKm: 1_650,
    description: "Arcos de las Antillas, Fosa de Puerto Rico, La Española y fallas transformantes caribeñas.",
  },
  {
    id: "middle-america-trench",
    name: "Fosa Mesoamericana y Centroamérica",
    regime: "subduction",
    latitude: 13.5,
    longitude: -91.5,
    radiusKm: 1_850,
    description: "Subducción de Cocos y Rivera bajo México y Centroamérica.",
  },
  {
    id: "northern-andes",
    name: "Andes septentrionales",
    regime: "mixed",
    latitude: 2,
    longitude: -77,
    radiusKm: 1_650,
    description: "Colombia, Ecuador y norte de Perú con subducción, fallas corticales y bloques tectónicos.",
  },
  {
    id: "central-southern-andes",
    name: "Andes centrales y meridionales",
    regime: "subduction",
    latitude: -25,
    longitude: -70.5,
    radiusKm: 2_650,
    description: "Subducción Nazca–Sudamérica desde Perú hasta Chile y Argentina occidental.",
  },
  {
    id: "alaska-aleutians",
    name: "Alaska y Aleutianas",
    regime: "subduction",
    latitude: 53,
    longitude: -166,
    radiusKm: 2_450,
    description: "Arco de subducción Alaska–Aleutianas y transición hacia Kamchatka.",
  },
  {
    id: "western-north-america",
    name: "Oeste de Norteamérica",
    regime: "mixed",
    latitude: 40,
    longitude: -123,
    radiusKm: 1_900,
    description: "San Andrés, Cascadia, Basin and Range y Baja California.",
  },
  {
    id: "japan-kuril-kamchatka",
    name: "Japón, Kuriles y Kamchatka",
    regime: "subduction",
    latitude: 40,
    longitude: 145,
    radiusKm: 2_250,
    description: "Trincheras de Japón, Kuriles y Kamchatka con fallamiento cortical asociado.",
  },
  {
    id: "philippines-taiwan-ryukyu",
    name: "Filipinas, Taiwán y Ryukyu",
    regime: "mixed",
    latitude: 18,
    longitude: 124,
    radiusKm: 1_950,
    description: "Sistemas de subducción y colisión del margen occidental del Pacífico.",
  },
  {
    id: "sunda-banda",
    name: "Sunda, Banda e Indonesia",
    regime: "subduction",
    latitude: -4,
    longitude: 119,
    radiusKm: 2_750,
    description: "Arcos de Sunda y Banda, Sumatra, Java, Célebes y Timor.",
  },
  {
    id: "southwest-pacific",
    name: "Pacífico suroccidental",
    regime: "subduction",
    latitude: -18,
    longitude: 174,
    radiusKm: 2_650,
    description: "Vanuatu, Salomón, Fiyi, Tonga y Nueva Caledonia.",
  },
  {
    id: "new-zealand-kermadec",
    name: "Nueva Zelanda y Kermadec",
    regime: "mixed",
    latitude: -35,
    longitude: 178,
    radiusKm: 2_050,
    description: "Hikurangi, Kermadec, Alpine Fault y transición de placas alrededor de Nueva Zelanda.",
  },
  {
    id: "mediterranean-anatolia",
    name: "Mediterráneo oriental y Anatolia",
    regime: "mixed",
    latitude: 38,
    longitude: 28,
    radiusKm: 2_150,
    description: "Arco Helénico, Anatolia, Egeo, Italia y Balcanes.",
  },
  {
    id: "iran-central-asia",
    name: "Irán y Asia central",
    regime: "collision",
    latitude: 34,
    longitude: 61,
    radiusKm: 2_250,
    description: "Zagros, Alborz, Hindu Kush, Pamir y sistemas intracontinentales de Asia central.",
  },
  {
    id: "himalaya-tibet",
    name: "Himalaya y Tíbet",
    regime: "collision",
    latitude: 29,
    longitude: 84,
    radiusKm: 1_950,
    description: "Colisión India–Eurasia, Himalaya, meseta tibetana y regiones vecinas.",
  },
  {
    id: "east-african-rift",
    name: "Rift de África oriental",
    regime: "rift_normal",
    latitude: -3,
    longitude: 35,
    radiusKm: 2_100,
    description: "Afar, rifts etíope, keniano y occidental, con volcanismo y fallamiento normal.",
  },
  {
    id: "mid-atlantic-ridge",
    name: "Dorsal Mesoatlántica",
    regime: "rift_normal",
    latitude: 5,
    longitude: -30,
    radiusKm: 3_100,
    description: "Límite divergente del Atlántico, incluyendo Islandia y fallas transformantes oceánicas.",
  },
];

function confidenceFor(normalizedDistance: number): ReceiverZoneMatch["confidence"] {
  if (normalizedDistance <= 0.65) return "high";
  if (normalizedDistance <= 1) return "medium";
  return "low";
}

export function matchTectonicReceiverZone(latitude: number, longitude: number): ReceiverZoneMatch {
  const matches = TECTONIC_RECEIVER_ZONES.map((zone) => {
    const distanceKm = haversineKm(latitude, longitude, zone.latitude, zone.longitude);
    const normalizedDistance = distanceKm / zone.radiusKm;
    return {
      zone,
      distanceKm,
      normalizedDistance,
      insideCore: normalizedDistance <= 1,
      confidence: confidenceFor(normalizedDistance),
    } satisfies ReceiverZoneMatch;
  });
  matches.sort((a, b) => a.normalizedDistance - b.normalizedDistance);
  return matches[0];
}
