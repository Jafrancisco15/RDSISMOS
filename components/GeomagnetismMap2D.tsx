"use client";

import dynamic from "next/dynamic";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";

export type GeomagneticMapStation = {
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevationM?: number | null;
  hasOneSecond?: boolean;
};

export type GeomagneticMapProps = {
  stations: GeomagneticMapStation[];
  targetCode: string;
  referenceCodes: string[];
  events: EarthquakeEvent[];
  selectedEventId: string;
  onStationSelect: (code: string) => void;
  onEventSelect: (event: EarthquakeEvent) => void;
};

const LeafletMap = dynamic(
  () => import("./GeomagnetismLeafletMap").then((module) => module.GeomagnetismLeafletMap),
  {
    ssr: false,
    loading: () => <div style={{ height: "clamp(430px,64vh,680px)", display: "grid", placeItems: "center", borderRadius: 14, background: "linear-gradient(#0b3550,#07131f)", color: "#bae6fd" }}>Cargando mapa topográfico…</div>,
  },
);

export function GeomagnetismMap2D(props: GeomagneticMapProps) {
  return <LeafletMap {...props} />;
}
