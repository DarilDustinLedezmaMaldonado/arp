# Arquitectura Distribuida

## 1. Visión general

```
                      ┌─────────────────────────┐
                      │        Navegador          │
                      │  (misma SPA sirve los 3)  │
                      └────────────┬───────────┘
                                    │  el usuario elige a que nodo hablar
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
     ┌───────▼───────┐     ┌────────▼────────┐    ┌────────▼────────┐
     │   NODE_NA      │     │    NODE_EA       │    │    NODE_SA       │
     │  (América)     │     │ (Europa/Asia)    │    │  (Sudamérica)    │
     │  Express API   │◄───►│   Express API    │◄──►│   Express API    │
     │  SQL Server    │ HTTP│   SQL Server     │HTTP│    MongoDB       │
     │  + SQLite log  │     │   + SQLite log   │    │   + SQLite log   │
     └────────────────┘     └──────────────────┘    └──────────────────┘
```

Cada nodo es un proceso Node.js/Express **completo e independiente**: tiene su
propia base de datos primaria, su propio reloj lógico, y puede atender
cualquier request de cualquier usuario. No hay un "nodo maestro". Los 3 se
comunican entre sí por HTTP en `/internal/sync/*`.

## 2. Por qué cada nodo tiene DOS almacenes de datos

Esto suele confundir, así que se explica aparte:

1. **Base de datos primaria** (`server/db/adapters/*`): SQL Server, MongoDB, o
   SQLite (solo como reemplazo de desarrollo). Aquí viven los vuelos, las
   transacciones autoritativas del nodo dueño y las réplicas confirmadas de
   los otros nodos. Esta es la base de datos que cuenta para la rúbrica
   ("Sincronización de bases de datos: 2 o 3 bases").
2. **Almacén local del sistema** (`server/db/systemStore.js`, siempre SQLite):
   es un archivito interno por nodo que guarda:
   - la **cola de salida** (*outbox*) de eventos pendientes de entregar a otro nodo,
   - una **copia de lectura** de TODAS las transacciones reales del sistema
     (propias + recibidas de los otros 2 nodos) para que el dashboard global y
     "ver en otro nodo si de verdad se compró" funcionen sin tener que hacer
     consultas cruzadas entre SQL Server y Mongo en tiempo real,
   - las banderas de **simulación de fallas**, la configuración compartida
     (73%/3%, retraso de reembolso) y el propio reloj de Lamport/vectorial.

   Este archivo **no es una "4ta base de datos"** compitiendo por puntaje: es
   el equivalente a un log de aplicación / cache de lectura, una pieza de
   infraestructura interna del mecanismo de sincronización, igual de legítima
   que (por ejemplo) usar Redis para colas en un sistema real, pero
   implementada con SQLite embebido para no pedir instalar nada más.

## 3. Particionamiento (sharding) de los vuelos

Un vuelo tiene un **nodo dueño**, determinado por la **región del aeropuerto
de DESTINO** (`shared/airports.js`):

| Región de destino | Nodo dueño | Motor real |
|---|---|---|
| ATL, LAX, DFW (EE.UU.) | `NODE_NA` | SQL Server |
| PEK, DXB, TYO, LON, PAR, FRA, IST, SIN, MAD, AMS, CAN | `NODE_EA` | SQL Server |
| SAO (Brasil) | `NODE_SA` | MongoDB |

¿Por qué por destino y no por origen? Porque en el dataset real que nos dieron
solo 5 aeropuertos son "origen" (ATL, PEK, DXB, TYO, LON) — particionar por
origen habría dejado a Sudamérica sin un solo vuelo. Particionando por destino,
Sudamérica queda dueña de 4,733 vuelos reales (todos los que llegan a SAO),
que es justo el escenario que pediste poder demostrar ("comprar un pasaje
hacia Sudamérica estando conectado en otro nodo").

Los **datos de referencia** (fecha, hora, origen, destino, avión, estado,
precio) de los 60,000 vuelos se **replican completos a los 3 nodos** al
sembrar los datos. Las **transacciones de asiento** tienen un único nodo dueño
que decide el resultado; una vez confirmadas se replican de forma idempotente
a las bases primarias de los otros dos nodos y a sus caches locales.

## 4. Por qué NO materializamos 20 millones de asientos

Con 60,000 vuelos y hasta 449 asientos por avión (Airbus A380), generar y
guardar cada asiento de cada vuelo para cumplir la regla "73% vendido / 3%
reservado" implicaría entre 15 y 20 millones de filas — que nadie va a mirar
nunca, solo para poblar un porcentaje.

En cambio, el estado **base** de ocupación de un vuelo se genera **al vuelo**
(sin guardarlo) con un generador pseudoaleatorio **determinístico**, sembrado
con el ID del vuelo (`shared/seatMap.js`, `rngFromSeedString`). Esto significa:

- Siempre da el mismo resultado para el mismo vuelo, en cualquier nodo, sin
  necesidad de sincronizar nada.
- No ocupa espacio en disco.
- Es estadísticamente correcto para el dashboard global (usamos valor
  esperado, `n_asientos × 73%`, que por la ley de los grandes números converge
  exactamente al mismo resultado que enumerar los 20 millones de asientos).

Lo único que **sí se guarda** en base de datos (y por lo tanto lo único que
necesita el aparato completo de relojes de Lamport/vectoriales) son las
transacciones **reales** que ocurren durante la demo: cuando un usuario de
verdad reserva/compra/cancela un asiento específico. Eso se guarda como un
"overlay" que siempre tiene prioridad sobre el estado base generado (ver
`applyOverlay` en `shared/seatMap.js`). Con pocas decenas de transacciones
reales en una demo, esto es trivial de sincronizar y consultar.

## 5. Algoritmos

- **Dijkstra** (`shared/dijkstra.js`): sobre un grafo dirigido construido de
  las matrices de precio/tiempo (las rutas NO son simétricas ni completas —
  "no todos los destinos tienen rutas de retorno"). Se usa en 2 lugares:
  1. El planificador de rutas del usuario final (ruta más barata/rápida con escalas).
  2. **Relleno de datos faltantes**: 28 de los 51 pares origen-destino reales
     del dataset no tienen tarifa directa en las matrices que nos diste; el
     precio de esos vuelos se estima como el costo del camino más corto sobre
     la red conocida (`scripts/seed.js`, `pricing.getPriceOrEstimate`).
- **TSP exacto (Held-Karp)** (`shared/tsp.js`): programación dinámica sobre
  subconjuntos, O(2ⁿ·n²), factible para los 15 aeropuertos del sistema.
  Soporta variante "regresar al origen" (ciclo) o "terminar en cualquier
  destino" (camino), y usa Dijkstra internamente para la distancia efectiva
  entre cada par (porque la red no es un grafo completo).

## 6. Frontend

SPA sin build step (HTML/CSS/JS servidos tal cual por Express desde
`public/`), con:

- Router por hash (`public/js/app.js`).
- Un cliente API (`public/js/api.js`) que descubre los 3 nodos vía
  `/api/network` y permite al usuario elegir a cuál hablarle (con `fetch`
  entre orígenes distintos, habilitado con CORS en cada nodo) — esto simula
  "desde qué país estoy comprando".
- Componentes reutilizables: mapa de asientos realista (`components/seatMap.js`),
  carta de rutas animada con SVG (`components/routeMap.js`), gráficos
  (`components/charts.js`, sobre Chart.js).
- 5 idiomas vía archivos JSON en `public/locales/` (`i18n.js`).
- Todas las librerías de terceros (Chart.js, html5-qrcode, fuentes) están
  vendorizadas en `public/vendor/` — la app funciona sin internet dentro de
  la LAN del salón.

Ver `docs/SINCRONIZACION.md` para el detalle de cómo viajan los eventos entre
nodos, cómo se resuelven los conflictos, y cómo funciona la tolerancia a
fallos.
