import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./historical.css";

export const metadata: Metadata = {
  title: "RDSISMOS | Observatorio experimental",
  description:
    "Mapa experimental de actividad sísmica, pronóstico probabilístico y recurrencias históricas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
