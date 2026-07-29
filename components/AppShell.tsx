"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { HistoricalMigrationDashboard } from "./HistoricalMigrationDashboard";

export function AppShell() {
  const [tab, setTab] = useState<"forecast" | "historical" | "events">("forecast");
  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Pronóstico sísmico</button>
        <button className={tab === "historical" ? "active" : ""} onClick={() => setTab("historical")}>Migración histórica</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
      </nav>
      {tab === "forecast" && <SeismicDashboard />}
      {tab === "historical" && <HistoricalMigrationDashboard />}
      {tab === "events" && <EarthquakeEventsDashboard />}
    </>
  );
}
