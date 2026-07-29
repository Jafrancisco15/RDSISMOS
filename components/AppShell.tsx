"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { AutomaticCountryOutlookDashboard } from "./AutomaticCountryOutlookDashboard";
import { LearningStatusPanel } from "./LearningStatusPanel";

export function AppShell() {
  const [tab, setTab] = useState<"historical" | "forecast" | "events">("historical");
  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "historical" ? "active" : ""} onClick={() => setTab("historical")}>Proyección por país</button>
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Pronóstico regional</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
      </nav>
      {tab === "historical" && (
        <>
          <div className="learning-panel-wrap"><LearningStatusPanel /></div>
          <AutomaticCountryOutlookDashboard />
        </>
      )}
      {tab === "forecast" && <SeismicDashboard />}
      {tab === "events" && <EarthquakeEventsDashboard />}
    </>
  );
}
