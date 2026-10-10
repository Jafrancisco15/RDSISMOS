"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AppNavigation, type AppTab } from "./AppNavigation";
import { AboutRdsismos } from "./AboutRdsismos";
import { AutoValidationPanel } from "./AutoValidationPanel";
import { BoundaryHistoryAboutNote } from "./BoundaryHistoryAboutNote";
import { BoundaryHistoryPanel } from "./BoundaryHistoryPanel";
import { CoreSeismicCouplingLab } from "./CoreSeismicCouplingLab";
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
  () => import("./LunarPhaseTemporalExperimental").then((module) => module.LunarPhaseTemporalExperimental),
  { ssr: false, loading: () => <div className="map-loading" style={{ margin: 28 }}>Inicializando globo lunar 3D…</div> },
);

const TectonicMechanics = dynamic(
  () => import("./TectonicMechanics").then((module) => module.TectonicMechanics),
  { ssr: false, loading: () => <div className="map-loading">Cargando laboratorio mecánico 3D…</div> },
);

const SeismicHypothesesLab = dynamic(
  () => import("./SeismicHypothesesLab").then((module) => module.SeismicHypothesesLab),
  { loading: () => <div className="map-loading" style={{ margin: 28 }}>Cargando laboratorio de hipótesis…</div> },
);


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
      <AppNavigation tab={tab} onSelect={setTab} />

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
      {tab === "coreseismic" && <CoreSeismicCouplingLab />}
      {tab === "hypotheses" && <SeismicHypothesesLab />}
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
