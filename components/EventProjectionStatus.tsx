import type { EventProjection } from "@/lib/earthquakes/types";

const LABELS = {
  projected: "Sí · proyectado",
  outside_range: "Zona proyectada · fuera de magnitud",
  not_projected: "No consta en el archivo",
  unavailable: "Sin verificar",
};

export function EventProjectionStatus({ projection }: { projection?: EventProjection }) {
  const status = projection?.status ?? "unavailable";
  return <div className={`event-projection-status ${status}`}>
    <strong>{LABELS[status]}</strong>
    {projection?.matches.map((match) => <a key={match.id} href={match.href} target="_blank" rel="noreferrer"
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
      title={`Emitida ${match.generatedAt} · ${match.probabilityPct.toFixed(1)}% · M${match.magnitudeMin}–M${match.magnitudeMax}`}>
      Ver predicción · {match.countryName}{match.withinMagnitude ? "" : " (fuera de rango)"}
    </a>)}
  </div>;
}
