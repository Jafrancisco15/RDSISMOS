"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { AutomaticCountryOutlookDashboard } from "./AutomaticCountryOutlookDashboard";
import { HistoricalBacktestPanel } from "./HistoricalBacktestPanel";
import { HybridModelFoundationPanel } from "./HybridModelFoundationPanel";
import { LearningStatusPanel } from "./LearningStatusPanel";
import { ProjectionHistoryPanel } from "./ProjectionHistoryPanel";
import { SeismicGlobe3D } from "./SeismicGlobe3D";

type AppTab = "globe" | "projection" | "history" | "events";

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("globe");
  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "globe" ? "active" : ""} onClick={() => setTab("globe")}>Mapa 3D</button>
        <button className={tab === "projection" ? "active" : ""} onClick={() => setTab("projection")}>Proyección</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Historial</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
      </nav>
      {tab === "globe" && <SeismicGlobe3D />}
      {tab === "projection" && (
        <>
          <HybridModelFoundationPanel />
          <div className="learning-panel-wrap"><LearningStatusPanel /></div>
          <div className="unified-projection-intro">
            <div className="quality-warning">
              La vista principal combina la proyección histórica por país con el contexto regional. El análisis regional detallado queda disponible como sección complementaria para evitar duplicar controles y cifras.
            </div>
          </div>
          <AutomaticCountryOutlookDashboard />
          <details className="unified-regional-details">
            <summary>
              Abrir análisis regional complementario
              <span>ETAS espacio-tiempo, actividad local y evidencia técnica detallada.</span>
            </summary>
            <SeismicDashboard />
          </details>
        </>
      )}
      {tab === "history" && (
        <>
          <div className="learning-panel-wrap"><HistoricalBacktestPanel /></div>
          <ProjectionHistoryPanel />
        </>
      )}
      {tab === "events" && <EarthquakeEventsDashboard />}
    </>
  );
}
