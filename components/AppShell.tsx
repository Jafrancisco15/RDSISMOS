"use client";

import { useState } from "react";
import { AboutRdsismos } from "./AboutRdsismos";
import { AutoValidationPanel } from "./AutoValidationPanel";
import { BoundaryHistoryPanel } from "./BoundaryHistoryPanel";
import { HistoricalHeatmap } from "./HistoricalHeatmap";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { AutomaticCountryOutlookDashboard } from "./AutomaticCountryOutlookDashboard";
import { LearningStatusPanel } from "./LearningStatusPanel";
import { PlateDynamicsDashboard } from "./PlateDynamicsDashboard";
import { ProjectionHistoryPanel } from "./ProjectionHistoryPanel";
import { ProjectionUpdateStatus } from "./ProjectionUpdateStatus";
import { RecentFulfilledProjections } from "./RecentFulfilledProjections";
import { ScopeActiveCountrySearch } from "./ScopeActiveCountrySearch";
import { ScopeProjection } from "./ScopeProjection";
import { SeismicGlobe3D } from "./SeismicGlobe3D";
import { Slab2AboutNote } from "./Slab2AboutNote";
import { SlabContextExplorer } from "./SlabContextExplorer";
import { TectonicSimulator } from "./TectonicSimulator";

type AppTab = "globe" | "scope" | "projection" | "validation" | "history" | "heatmap" | "events" | "plates" | "simulator" | "about";

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("globe");
  const [historicalProjectionOpen, setHistoricalProjectionOpen] = useState(false);

  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "globe" ? "active" : ""} onClick={() => setTab("globe")}>Mapa 3D</button>
        <button className={tab === "scope" ? "active" : ""} onClick={() => setTab("scope")}>Scope Projection</button>
        <button className={tab === "projection" ? "active" : ""} onClick={() => setTab("projection")}>ETAS Projection</button>
        <button className={tab === "validation" ? "active" : ""} onClick={() => setTab("validation")}>Auto-Validación</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Historial</button>
        <button className={tab === "heatmap" ? "active" : ""} onClick={() => setTab("heatmap")}>Mapa de Calor Histórico</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
        <button className={tab === "plates" ? "active" : ""} onClick={() => setTab("plates")}>GPlates</button>
        <button className={tab === "simulator" ? "active" : ""} onClick={() => setTab("simulator")}>Simulador</button>
        <button className={tab === "about" ? "active" : ""} onClick={() => setTab("about")}>Acerca</button>
      </nav>

      {tab === "globe" && (
        <>
          <SeismicGlobe3D />
          <RecentFulfilledProjections />
        </>
      )}

      {tab === "scope" && (
        <>
          <ScopeProjection />
          <ScopeActiveCountrySearch />
        </>
      )}

      {tab === "projection" && (
        <>
          <div className="unified-projection-intro">
            <div className="quality-warning">
              <strong>ETAS Projection</strong> es la vista operacional de agrupamiento espacio-tiempo. Usa ETAS, Omori–Utsu y Gutenberg–Richter para estimar cómo cambia temporalmente la tasa de actividad alrededor de eventos precedentes. No depende de la memoria histórica de Supabase para poder funcionar.
            </div>
          </div>

          <SeismicDashboard />

          <details
            className="unified-regional-details"
            onToggle={(event) => setHistoricalProjectionOpen(event.currentTarget.open)}
          >
            <summary>
              Abrir proyección histórica por país
              <span>Modelo de migración histórica, memoria persistente, recurrencia, línea base y evaluación.</span>
            </summary>
            {historicalProjectionOpen && (
              <>
                <div className="learning-panel-wrap"><LearningStatusPanel /></div>
                <div className="unified-projection-intro">
                  <div className="quality-warning">
                    Este módulo es independiente de ETAS. Usa cápsulas históricas persistidas y compara recurrencia posterior contra ventanas de control. Una falla temporal de la base no debe interpretarse como cero proyecciones ni como pérdida de datos.
                  </div>
                </div>
                <AutomaticCountryOutlookDashboard />
              </>
            )}
          </details>
        </>
      )}

      {tab === "validation" && <AutoValidationPanel />}
      {tab === "history" && <ProjectionHistoryPanel />}
      {tab === "heatmap" && <HistoricalHeatmap />}
      {tab === "events" && <EarthquakeEventsDashboard />}
      {tab === "plates" && (
        <>
          <PlateDynamicsDashboard />
          <BoundaryHistoryPanel />
          <SlabContextExplorer />
        </>
      )}
      {tab === "simulator" && <TectonicSimulator />}
      {tab === "about" && (
        <>
          <AboutRdsismos />
          <Slab2AboutNote />
        </>
      )}

      <ProjectionUpdateStatus />
    </>
  );
}
