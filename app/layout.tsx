import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./historical.css";
import "./historical-country.css";
import "./outlook-overrides.css";
import "./globe.css";
import "./globe-history.css";
import "./globe-geology.css";

export const metadata: Metadata = {
  title: "RDSISMOS | Observatorio experimental",
  description:
    "Mapa experimental de actividad sísmica, pronóstico probabilístico y recurrencias históricas por país.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
