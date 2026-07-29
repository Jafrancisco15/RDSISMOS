"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { HistoricalMigrationDashboardV2 } from "./HistoricalMigrationDashboardV2";

export function AppShell() {
  const [tab, setTab] = useState<"historical" | "forecast" | "events">("historical");
  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "historical" ? "active" : ""} onClick={() => setTab("historical")}>Migración histórica</button>
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Pronóstico sísmico</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
      </nav>
      {tab === "historical" && <HistoricalMigrationDashboardV2 />}
      {tab === "forecast" && <SeismicDashboard />}
      {tab === "events" && <EarthquakeEventsDashboard />}
    </>
  );
}
