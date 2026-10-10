"use client";

import { useEffect, useRef } from "react";

export type AppTab = "globe" | "depth3d" | "tectonic4d" | "mechanics4d" | "coreseismic" | "hypotheses" | "extractions" | "geomagnetism" | "volcano" | "scope" | "projection" | "validation" | "history" | "heatmap" | "events" | "plates" | "lunar" | "simulator" | "about";

const PRIMARY_TABS: Array<{ id: AppTab; label: string }> = [
  { id: "globe", label: "Mapa 3D" },
  { id: "scope", label: "Scope Projection" },
  { id: "history", label: "Historial" },
  { id: "events", label: "Eventos Sísmicos" },
];
const OTHER_TABS: Array<{ id: AppTab; label: string }> = [
  { id: "depth3d", label: "Caribe 3D" },
  { id: "projection", label: "ETAS Projection" },
  { id: "tectonic4d", label: "Tectonic State 4D" },
  { id: "mechanics4d", label: "Estado mecánico 3D" },
  { id: "coreseismic", label: "Núcleo–Sismicidad" },
  { id: "hypotheses", label: "Hipótesis Sísmicas" },
  { id: "extractions", label: "Extracciones" },
  { id: "geomagnetism", label: "Geomagnetismo" },
  { id: "volcano", label: "Volcano activity" },
  { id: "plates", label: "GPlates" },
  { id: "validation", label: "Auto-Validación" },
  { id: "heatmap", label: "Mapa de Calor Histórico" },
  { id: "lunar", label: "Lunar Phase Experimental" },
  { id: "simulator", label: "Simulador" },
  { id: "about", label: "Acerca" },
];

export function AppNavigation({ tab, onSelect }: { tab: AppTab; onSelect: (tab: AppTab) => void }) {
  const otherRef = useRef<HTMLDetailsElement>(null);
  const otherSelected = OTHER_TABS.some((item) => item.id === tab);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && otherRef.current && !otherRef.current.contains(event.target)) {
        otherRef.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  function select(next: AppTab) {
    if (otherRef.current) otherRef.current.open = false;
    onSelect(next);
  }

  return <nav className="main-tabs" aria-label="Navegación principal">
    {PRIMARY_TABS.map((item) => <button key={item.id} type="button"
      className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined}
      onClick={() => select(item.id)}>{item.label}</button>)}
    <details ref={otherRef} className={`other-tabs${otherSelected ? " active" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && otherRef.current) {
          otherRef.current.open = false;
          otherRef.current.querySelector("summary")?.focus();
        }
      }} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && otherRef.current) otherRef.current.open = false;
      }}>
      <summary>Otros <span aria-hidden="true">▾</span></summary>
      <div className="other-tabs-submenu" aria-label="Otros módulos">
        {OTHER_TABS.map((item) => <button key={item.id} type="button"
          className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined}
          onClick={() => select(item.id)}>{item.label}</button>)}
      </div>
    </details>
  </nav>;
}
