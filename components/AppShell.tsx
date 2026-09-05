"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AboutRdsismos } from "./AboutRdsismos";
import { AutoValidationPanel } from "./AutoValidationPanel";
import { BoundaryHistoryAboutNote } from "./BoundaryHistoryAboutNote";
import { BoundaryHistoryPanel } from "./BoundaryHistoryPanel";
import { HistoricalHeatmap } from "./HistoricalHeatmap";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { AutomaticCountryOutlookDashboard } from "./AutomaticCountryOutlookDashboard";
import { ExtractionDashboard } from "./ExtractionDashboard";
import { GeomagneticWorldObservation } from "./GeomagneticWorldObservation";
import { GeomagnetismDashboard } from "./GeomagnetismDashboard";
import { GeomagnetismWaveLab } from "./GeomagnetismWaveLab";
import { GeomagneticProjectionPanel } from "./GeomagneticProjectionPanel";
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
import { TectonicDepth3D } from "./TectonicDepth3D";
import { TectonicState4D } from "./TectonicState4D";
import { TectonicSimulator } from "./TectonicSimulator";
import { VolcanoActivityDashboard } from "./VolcanoActivityDashboard";

const LunarPhaseExperimental = dynamic(
  () => import("./LunarPhaseExperimental").then((module) => module.LunarPhaseExperimental),
  { ssr: false, loading: () => <div className="map-loading" style={{ margin: 28 }}>Inicializando globo lunar 3D…</div> },
);

const TectonicMechanics = dynamic(
  () => import("./TectonicMechanics").then((module) => module.TectonicMechanics),
  { ssr: false, loading: () => <div className="map-loading">Cargando laboratorio mecánico 3D…</div> },
);

type AppTab = "globe" | "depth3d" | "tectonic4d" | "mechanics4d" | "extractions" | "geomagnetism" | "volcano" | "scope" | "projection" | "validation" | "history" | "heatmap" | "events" | "plates" | "lunar" | "simulator" | "about";

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("globe");
  const [historicalProjectionOpen, setHistoricalProjectionOpen] = useState(false);
  const [eventsRefreshKey, setEventsRefreshKey] = useState(0);

  useEffect(() => {
    if (tab !== "events") return;
    const refresh = () => {
      if (document.visibilityState === "visible") setEventsRefreshKey((value) => value + 1);
    };
    const interval = window.setInterval(refresh, 5 * 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tab]);

  return (
    <>
      <nav className="main-tabs" aria-label="Navegación principal">
        <button className={tab === "globe" ? "active" : ""} onClick={() => setTab("globe")}>Mapa 3D</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Historial</button>
        <button className={tab === "scope" ? "active" : ""} onClick={() => setTab("scope")}>Scope Projection</button>
        <button className={tab === "projection" ? "active" : ""} onClick={() => setTab("projection")}>ETAS Projection</button>
        <button className={tab === "depth3d" ? "active" : ""} onClick={() => setTab("depth3d")}>Placas 3D</button>
        <button className={tab === "tectonic4d" ? "active" : ""} onClick={() => setTab("tectonic4d")}>Tectonic State 4D</button>
        <button className={tab === "mechanics4d" ? "active" : ""} onClick={() => setTab("mechanics4d")}>Estado mecánico 3D</button>
        <button className={tab === "extractions" ? "active" : ""} onClick={() => setTab("extractions")}>Extracciones</button>
        <button className={tab === "geomagnetism" ? "active" : ""} onClick={() => setTab("geomagnetism")}>Geomagnetismo</button>
        <button className={tab === "volcano" ? "active" : ""} onClick={() => setTab("volcano")}>Volcano activity</button>
        <button className={tab === "plates" ? "active" : ""} onClick={() => setTab("plates")}>GPlates</button>
        <button className={tab === "validation" ? "active" : ""} onClick={() => setTab("validation")}>Auto-Validación</button>
        <button className={tab === "heatmap" ? "active" : ""} onClick={() => setTab("heatmap")}>Mapa de Calor Histórico</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Eventos Sísmicos</button>
        <button className={tab === "lunar" ? "active" : ""} onClick={() => setTab("lunar")}>Lunar Phase Experimental</button>
        <button className={tab === "simulator" ? "active" : ""} onClick={() => setTab("simulator")}>Simulador</button>
        <button className={tab === "about" ? "active" : ""} onClick={() => setTab("about")}>Acerca</button>
      </nav>

      {tab === "globe" && (
        <>
          <SeismicGlobe3D />
          <RecentFulfilledProjections />
        </>
      )}

      {tab === "history" && <ProjectionHistoryPanel />}

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

      {tab === "depth3d" && <TectonicDepth3D />}
      {tab === "tectonic4d" && <TectonicState4D />}
      {tab === "mechanics4d" && <TectonicMechanics />}
      {tab === "extractions" && <ExtractionDashboard />}
      {tab === "geomagnetism" && <>
        <GeomagneticWorldObservation />
        <GeomagnetismDashboard />
        <GeomagnetismWaveLab />
        <GeomagneticProjectionPanel />
      </>}
      {tab === "volcano" && <VolcanoActivityDashboard />}
      {tab === "plates" && (
        <>
          <PlateDynamicsDashboard />
          <BoundaryHistoryPanel />
          <SlabContextExplorer />
        </>
      )}
      {tab === "validation" && <AutoValidationPanel />}
      {tab === "heatmap" && <HistoricalHeatmap />}
      {tab === "events" && <EarthquakeEventsDashboard key={eventsRefreshKey} />}
      {tab === "lunar" && <LunarPhaseExperimental />}
      {tab === "simulator" && <TectonicSimulator />}
      {tab === "about" && (
        <>
          <AboutRdsismos />
          <BoundaryHistoryAboutNote />
          <Slab2AboutNote />
        </>
      )}

      <ProjectionUpdateStatus />
    </>
  );
}
