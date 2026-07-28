"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";

export function AppShell() {
  const [tab, setTab] = useState<"forecast" | "events">("forecast");
  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Pronóstico sísmico</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
      </nav>
      {tab === "forecast" ? <SeismicDashboard /> : <EarthquakeEventsDashboard />}
    </>
  );
}
