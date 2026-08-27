"use client";

import dynamic from "next/dynamic";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { VolcanoCatalogEntry } from "@/lib/volcanoActivity";

export interface VolcanoActivityMapProps {
  volcanoes: VolcanoCatalogEntry[];
  selectedId: string;
  events: EarthquakeEvent[];
  onVolcanoSelect: (id: string) => void;
}

const VolcanoActivityLeafletMap = dynamic(
  () => import("./VolcanoActivityLeafletMap").then((module) => module.VolcanoActivityLeafletMap),
  { ssr: false, loading: () => <div className="map-loading" style={{ minHeight: 480 }}>Cargando relieve volcánico…</div> },
);

export function VolcanoActivityMap(props: VolcanoActivityMapProps) {
  return <VolcanoActivityLeafletMap {...props} />;
}
