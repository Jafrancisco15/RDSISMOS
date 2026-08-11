"use client";

import { useState } from "react";
import { SeismicDashboard } from "./SeismicDashboard";
import { EarthquakeEventsDashboard } from "./EarthquakeEventsDashboard";
import { AutomaticCountryOutlookDashboard } from "./AutomaticCountryOutlookDashboard";
import { LearningStatusPanel } from "./LearningStatusPanel";
import { ProjectionHistoryPanel } from "./ProjectionHistoryPanel";
import { RecentFulfilledProjections } from "./RecentFulfilledProjections";
import { ScopeProjection } from "./ScopeProjection";
import { SeismicGlobe3D } from "./SeismicGlobe3D";
import { TectonicSimulator } from "./TectonicSimulator";
import { LanguageProvider, useLanguage } from "./LanguageProvider";

type AppTab = "globe" | "scope" | "projection" | "history" | "events" | "simulator";

function LocalizedAppShell() {
  const [tab, setTab] = useState<AppTab>("globe");
  const { locale, setLocale, translate } = useLanguage();

  return (
    <>
      <div
        role="group"
        aria-label={locale === "es" ? "Idioma del sitio" : "Site language"}
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px 6px",
          background: "#08131b",
          borderBottom: "1px solid rgba(125,211,252,.12)",
        }}
      >
        <span style={{ fontSize: 12, color: "#9fb4c1", marginRight: 3 }}>
          {locale === "es" ? "Idioma" : "Language"}
        </span>
        {(["es", "en"] as const).map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={locale === code}
            aria-label={code === "es" ? (locale === "es" ? "Usar español" : "Use Spanish") : (locale === "es" ? "Usar inglés" : "Use English")}
            onClick={() => setLocale(code)}
            style={{
              minWidth: 38,
              padding: "5px 9px",
              borderRadius: 999,
              border: locale === code ? "1px solid #38bdf8" : "1px solid rgba(148,163,184,.28)",
              background: locale === code ? "rgba(14,165,233,.16)" : "rgba(15,23,42,.45)",
              color: locale === code ? "#e0f2fe" : "#a8b8c4",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>

      <nav className="main-tabs" aria-label={translate("Navegación principal")}>
        <button className={tab === "globe" ? "active" : ""} onClick={() => setTab("globe")}>{translate("Mapa 3D")}</button>
        <button className={tab === "scope" ? "active" : ""} onClick={() => setTab("scope")}>{translate("Scope Projection")}</button>
        <button className={tab === "projection" ? "active" : ""} onClick={() => setTab("projection")}>{translate("Proyección")}</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>{translate("Historial")}</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>{translate("Eventos Sísmicos")}</button>
        <button className={tab === "simulator" ? "active" : ""} onClick={() => setTab("simulator")}>{translate("Simulador")}</button>
      </nav>

      {tab === "globe" && (
        <>
          <SeismicGlobe3D />
          <RecentFulfilledProjections />
        </>
      )}
      {tab === "scope" && <ScopeProjection />}
      {tab === "projection" && (
        <>
          <div className="learning-panel-wrap"><LearningStatusPanel /></div>
          <div className="unified-projection-intro">
            <div className="quality-warning">
              {translate("La vista principal combina la proyección histórica por país con el contexto regional. El análisis regional detallado queda disponible como sección complementaria para evitar duplicar controles y cifras.")}
            </div>
          </div>
          <AutomaticCountryOutlookDashboard />
          <details className="unified-regional-details">
            <summary>
              {translate("Abrir análisis regional complementario")}
              <span>{translate("ETAS espacio-tiempo, actividad local y evidencia técnica detallada.")}</span>
            </summary>
            <SeismicDashboard />
          </details>
        </>
      )}
      {tab === "history" && <ProjectionHistoryPanel />}
      {tab === "events" && <EarthquakeEventsDashboard />}
      {tab === "simulator" && <TectonicSimulator />}
    </>
  );
}

export function AppShell() {
  return (
    <LanguageProvider>
      <LocalizedAppShell />
    </LanguageProvider>
  );
}
