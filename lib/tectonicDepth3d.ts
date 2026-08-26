import type { GeoFeatureCollection } from "./plateDynamics";

export interface SlabContour3D {
  id: string;
  region: string;
  depthKm: number;
  points: Array<{ lat: number; lng: number }>;
}

export interface TectonicDepth3DResponse {
  generatedAt: string;
  gplatesModel: string;
  platePolygons: GeoFeatureCollection;
  slabContours: SlabContour3D[];
  slabRegions: string[];
  slabDepthMinKm: number | null;
  slabDepthMaxKm: number | null;
  warnings: string[];
  sources: {
    plates: string;
    slabs: string;
  };
}
