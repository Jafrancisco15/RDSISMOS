import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "RDSISMOS | Observatorio experimental",
  description:
    "Mapa experimental de actividad sísmica y posibles patrones espaciales hacia República Dominicana.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
