"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { AutomaticCountryOutlookDashboard } from "./AutomaticCountryOutlookDashboard";
import { LearningStatusPanel } from "./LearningStatusPanel";
import { SeismicGlobe3D } from "./SeismicGlobe3D";

type AppTab = "historical" | "globe" | "forecast" | "events";

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("historical");
  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "historical" ? "active" : ""} onClick={() => setTab("historical")}>Proyección por país</button>
        <button className={tab === "globe" ? "active" : ""} onClick={() => setTab("globe")}>Mapa 3D</button>
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Pronóstico regional</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
      </nav>
      {tab === "historical" && (
        <>
          <div className="learning-panel-wrap"><LearningStatusPanel /></div>
          <AutomaticCountryOutlookDashboard />
        </>
      )}
      {tab === "globe" && <SeismicGlobe3D />}
      {tab === "forecast" && <SeismicDashboard />}
      {tab === "events" && <EarthquakeEventsDashboard />}
    </>
  );
}
