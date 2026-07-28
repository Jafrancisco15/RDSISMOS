# RDSISMOS

Aplicación web experimental que consulta cada minuto el catálogo público **Raspberry Shake QuakeLink**, conserva una ventana móvil de 90 días y muestra en un mapa mundial:

- actividad sísmica en el entorno de República Dominicana;
- eventos en zonas donde hubo sismos fuertes antes de los eventos dominicanos de 1943 y 1946;
- un índice exploratorio de posible migración basado en tasas, magnitudes, proximidad y tendencia espacial;
- la fuente, fecha y magnitud del evento que más contribuye al índice.

> **Advertencia:** RDSISMOS no predice terremotos, no demuestra causalidad entre placas diferentes y no sustituye al Centro Nacional de Sismología, COE, Defensa Civil ni otras autoridades.

## Fuente de datos

La aplicación usa por defecto:

```text
https://quakelink.raspberryshake.org/events/query
```

No hace falta una clave API para la primera versión. El servidor de Raspberry Shake ofrece el catálogo QuakeLink públicamente. El servicio FDSN de formas de onda de Raspberry Shake no soporta `fdsnws-event` y entrega datos históricos con aproximadamente 30 minutos de retraso; por eso esta aplicación usa QuakeLink para eventos.

Si QuakeLink no responde temporalmente, la aplicación puede usar el catálogo USGS ComCat como respaldo y lo indica claramente en pantalla.

## Desarrollo local

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Variables de entorno

Copie `.env.example` a `.env.local` solo si necesita cambiar el comportamiento predeterminado:

```env
RASPBERRY_SHAKE_EVENTS_URL=https://quakelink.raspberryshake.org/events/query
ALLOW_USGS_FALLBACK=true
```

## Despliegue en Vercel

1. Importe este repositorio en Vercel.
2. Mantenga el framework detectado como Next.js.
3. No necesita variables de entorno para el despliegue inicial.
4. Despliegue. La ruta `/api/events` consulta y normaliza el catálogo del lado del servidor y mantiene caché de 60 segundos.

## Modelo experimental

El índice 0–100 combina:

- tasa de actividad de los últimos 30 días en las zonas históricas frente a los 60 días anteriores;
- tasa de actividad de los últimos 14 días alrededor de La Española frente a los 76 días anteriores;
- magnitud máxima reciente;
- tendencia lineal de la distancia de eventos M5+ hacia República Dominicana;
- longitud de una cadena cronológica con distancias decrecientes.

Los niveles son descriptivos:

- 0–34: verde;
- 35–54: amarillo;
- 55–74: naranja;
- 75–100: rojo, “Posible actividad sísmica”.

El rojo sigue siendo una señal estadística experimental y **no** una alerta oficial ni una predicción.
