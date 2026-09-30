# ✈ Aerolíneas Rafael Pabón — Sistema de Reservas Distribuido

Práctica 3 · Sincronización de Procesos · Sistemas Distribuidos (UNIVALLE)

Sistema de reservas aéreas construido sobre **3 nodos geográficamente distribuidos**
(América, Europa/Asia, Sudamérica), cada uno con su propia base de datos primaria
(**SQL Server** para América y Europa/Asia, **MongoDB** para Sudamérica), sincronizados
mediante **relojes de Lamport y relojes vectoriales**, con **tolerancia a fallos**
(patrón *outbox*) y **consistencia eventual** real y demostrable.

> 📄 Para el diseño técnico completo lee [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md)
> y [`docs/SINCRONIZACION.md`](docs/SINCRONIZACION.md). Este README es la guía de
> instalación y uso.

---

## 1. Qué incluye

- **Backend** (Node.js/Express) — un proceso independiente por nodo, con:
  - Adaptador de base de datos intercambiable: `sqlite` (demo local), `mssql` (SQL Server real), `mongo` (MongoDB real) — misma interfaz para los tres.
  - Reloj de Lamport + reloj vectorial de 3 componentes por nodo.
  - Resolución determinista de conflictos (doble reserva) ante escrituras concurrentes.
  - Diario durable y *outbox*: si el dueño está caído, la solicitud se guarda pendiente, sin emitir boleto, hasta recibir su decisión.
  - Consistencia eventual real para devoluciones (`REFUNDED` → `AVAILABLE` con retraso configurable).
  - Algoritmo de **Dijkstra** (ruta más corta, multi-escala) y **TSP exacto (Held-Karp)** para visitar varios destinos.
  - Generación de boletos en **PDF**, código **QR**, pase de **wallet digital** y check-in por QR.
- **Frontend** (HTML/CSS/JS puro, sin build step) — buscador estilo tablero de salidas, mapa de asientos realista, 2 dashboards, planificador de rutas, editor de matrices "pega desde Excel", panel de administración con interruptores de falla, **5 idiomas** (es/en/pt/zh/fr).
- **Datos**: tus 60,000 vuelos + las 3 matrices (económica, primera clase, tiempos) que diste, con un script de *seed* que limpia y completa los datos (ver `data/data_quality_report.json` después de correrlo).

## 2. Requisitos

- **Node.js 18+** (probado con Node 22).
- Para la demo rápida: **nada más** (SQLite embebido, cero instalación).
- Para la entrega "de verdad" (la que califica los 10 puntos de "3 bases de datos"):
  acceso a una instancia de **SQL Server** (2 bases, una por nodo NODE_NA/NODE_EA) y una de **MongoDB** (NODE_SA).

## 3. Instalación

```bash
npm install
npm run vendor:assets    # copia Chart.js / html5-qrcode / fuentes a public/vendor (ya viene hecho en el repo)
```

---

## 4. Modo LOCAL — probar todo en 1 sola PC

Ideal para desarrollar o para la demo rápida sin instalar SQL Server ni MongoDB:
los 3 "nodos" corren como 3 procesos en `localhost` con puertos distintos, usando
SQLite como reemplazo de la base de datos primaria (misma lógica, mismo código).

```bash
# 1) Poblar las 3 bases (crea data/primary_NODE_*.sqlite)
npm run seed:local

# 2) Levantar los 3 nodos a la vez
npm run local:all
```

Abre en el navegador:

- Nodo América: http://localhost:4001
- Nodo Europa/Asia: http://localhost:4002
- Nodo Sudamérica: http://localhost:4003

Los tres sirven la misma interfaz. El selector **"Conectado a"** en el encabezado
cambia a cuál nodo le habla tu navegador (simula "desde qué país estás comprando").
Ve a **Administración** para simular caídas de base de datos o de red y observar
la tolerancia a fallos en vivo (ver sección 7).

## 5. Modo LAN — 3 PC reales (la entrega final)

> Guía paso a paso: [`docs/CONFIGURACION_LAN.md`](docs/CONFIGURACION_LAN.md)

Cada PC corre **un solo nodo**, con su base de datos real.

### 5.1 En cada PC

1. Instala SQL Server (PC de América y PC de Europa/Asia) o MongoDB (PC de Sudamérica). Puede ser Docker, instalación nativa, o una instancia en la nube alcanzable desde la LAN del salón.
2. Copia el proyecto (o clónalo) y corre `npm install`.
3. Copia `.env.example` a `.env` y completa:
   - `NODE_ID` (`NODE_NA`, `NODE_EA` o `NODE_SA` — uno distinto por PC).
   - `DB_DRIVER` (`mssql` o `mongo` según el nodo).
   - Las credenciales de tu SQL Server/MongoDB.
   - `BIND_HOST=0.0.0.0`, `ALLOW_INSECURE_LOCAL=false`, `SYNC_SECRET` compartida y `ADMIN_SECRET` distinta (al menos 32 caracteres cada una).
   - Las IPs de los **otros dos** nodos en la LAN (`NODE_XX_HOST` / `NODE_XX_PORT`) — mira `ipconfig`/`ifconfig` en cada máquina.
4. También edita `config/nodes.json` si prefieres fijar las IPs ahí en vez de por variables de entorno (útil para que el *mismo* archivo sirva en las 3 PC).

### 5.2 Poblar los datos (una vez en cada PC)

```bash
# PC América
npm run seed -- --node=NODE_NA

# PC Europa/Asia
npm run seed -- --node=NODE_EA

# PC Sudamérica
npm run seed -- --node=NODE_SA
```

Cada comando usa el driver y las credenciales del `.env` de esa computadora y
llena su base real con los 60,000 vuelos. También se puede ejecutar `npm run
seed` desde una máquina con acceso a las tres bases usando las variables de
credenciales específicas por nodo documentadas en `.env.example`.

### 5.3 Levantar cada nodo (uno por PC)

```bash
# PC 1 (América)
npm run node:na

# PC 2 (Europa/Asia)
npm run node:ea

# PC 3 (Sudamérica)
npm run node:sa
```

Cada quien abre `http://localhost:<su puerto>` en su propia máquina, o cualquiera
puede abrir `http://<IP-de-otra-PC>:<puerto>` para navegar "como si estuviera"
en otro nodo — y desde ahí usar el selector de nodo para comparar.

### 5.4 Verificar que los 3 nodos se ven entre sí

En **Panel global** (`/#/dashboard/global`) deberías ver las 3 tarjetas de nodo
en verde ("Reachable"). Si alguna sale roja, revisa firewall / IP / puerto.

---

## 6. Flujo de uso

1. **Buscar vuelos** — filtra por origen, destino y fechas.
2. Click en un vuelo → **mapa de asientos** real (primera clase / turista, pasillos).
   Elige un asiento, escribe el nombre del pasajero y **Reserva** o **Compra**.
3. Te lleva a tu **boleto** (estilo boarding pass) con QR, botón de **PDF** y
   **pase digital**. El navegador recuerda tus boletos (sin login) para volver a verlos desde el inicio.
4. **Check-in QR** — escanea el código (o pégalo manualmente) para marcar el boleto como abordado.
5. **Panel del vuelo** / **Panel global** — ocupación, ingresos, mapa de rutas animado, bitácora de eventos con sus timestamps de Lamport/vectorial.
6. **Planificador de rutas** — Dijkstra (ruta más barata/rápida, con escalas) y TSP (orden óptimo para visitar varios aeropuertos).
7. **Administración** — aquí está lo importante para la sustentación:
   - Interruptor **"Base de datos primaria caída"** por nodo → simula que ese SQL Server/Mongo se cayó.
   - Interruptor **"Nodo aislado de la red"** → simula una partición de red (ese nodo deja de responder a los otros nodos, aunque el usuario final sí lo pueda seguir usando).
   - Editor de matrices: pega una tabla 15×15 copiada de Excel (mismo formato que nos diste) y se guarda + sincroniza a los otros 2 nodos.
   - Botón para recalcular los precios de los 60,000 vuelos con las matrices actuales.
   - Reloj de Lamport/vectorial, cola de sincronización pendiente (*outbox*) y bitácora de eventos de este nodo.

## 7. Cómo demostrar la tolerancia a fallos (el escenario que pediste)

1. Ve a **Administración** en cualquier nodo y activa **"Base de datos primaria caída"**
   en el **Nodo Sudamérica**.
2. Desde **otro** nodo (por ejemplo, América), busca un vuelo con destino `SAO`
   y compra un asiento.
3. La solicitud **no se confirma aún**: queda pendiente localmente, sin QR,
   PDF ni pase válido, hasta recibir la decisión del dueño.
4. Ve al **Panel global** de cualquier nodo: verás el evento en la bitácora y el
   contador de "Eventos pendientes de sincronizar" en 1.
5. Vuelve a Administración y **desactiva** la caída simulada de Sudamérica.
   En unos segundos (el proceso reintenta cada 1s) el evento se entrega, el
   contador de pendientes baja a 0, y el boleto pasa a "✓ Sincronizado".
6. Consulta el mismo boleto desde el nodo Sudamérica: ya está ahí, en su base
   de datos real (Mongo), con el mismo `PNR`.

Para ver la **resolución de doble reserva**: repite el paso 1-2 pero compra el
**mismo asiento desde dos nodos distintos casi al mismo tiempo** mientras
Sudamérica sigue caída. Al reactivarla, gana la primera solicitud válida que
confirma el dueño y la otra queda `CONFLICT_LOST` — ambas solicitudes lo
reflejan automáticamente.

## 8. Wallet (PDF, pase digital, Apple Wallet)

- **Google Wallet genérico**: después de una configuración única del emisor,
  cada boleto confirmado muestra “Agregar a Google Wallet”. Define
  `GOOGLE_WALLET_ISSUER_ID` y coloca el JSON autorizado en
  `secrets/google-wallet-service-account.json` (otra ruta puede indicarse con
  `GOOGLE_WALLET_CREDENTIALS`). La aplicación crea la clase y el objeto
  al pulsar el botón; no se configura cada vuelo. Mientras el emisor esté en
  modo demostración, Google mostrará `[TEST ONLY]`.

- **PDF**: siempre disponible, sin configuración (usa `pdfkit`).
- **Pase digital (web)**: siempre disponible, con QR — es lo que se ve en `/#/pass/:id`.
- **Apple Wallet real (`.pkpass` firmado)**: requiere certificados de una cuenta
  de Apple Developer (`PKPASS_*` en `.env`, ver `.env.example`). Sin esos
  certificados el botón simplemente no aparece; el resto del sistema funciona
  igual. El *modelo* del pase (`wallet/arp.pass/`) ya está generado — solo
  falta la firma cuando alguien tenga certificados reales.
- **Google Wallet**: no incluido (requiere una cuenta de Google Cloud + Issuer ID
  propios); el pase digital web + QR cumple la misma función para la demo.

## 9. Estructura del proyecto

```
config/            Aeropuertos, aviones, matrices de precio/tiempo, topología de nodos
shared/             Algoritmos puros (Dijkstra, TSP, relojes, generación de asientos...)
server/
  db/               Adaptadores SQLite / SQL Server / MongoDB + almacén local (outbox, cache)
  services/         Lógica de negocio (reservas, sincronización, dashboards...)
  sync/             Cliente/worker de replicación entre nodos
  routes/           API REST
public/             Frontend (HTML/CSS/JS sin build step) + librerías vendorizadas
scripts/            seed.js (carga de datos), vendor_assets.js, make_wallet_assets.js
data/               CSV original + reporte de calidad de datos generado por el seed
docs/               Documentación técnica (arquitectura y sincronización)
```

## 10. Notas de integridad de datos

El dataset que diste solo trae `flight_date, flight_time, origin, destination,
aircraft_id, status, gate`. El script `scripts/seed.js`:

- Asigna `aircraft_id` → modelo de avión según los rangos de flota del PDF.
- Aplica la regla *"todo vuelo con fecha futura debe quedar SCHEDULED"*.
- Detecta (y reporta) aviones que "aparecen" en un aeropuerto distinto al que
  aterrizaron por última vez — ver `aircraftContinuityAnomalies` en el reporte.
  Dado que el dataset es sintético, casi todos los vuelos son eventos
  independientes (no rotaciones reales de un mismo avión); el validador queda
  disponible para auditar esto igual.
- Calcula precio y tiempo de cada vuelo desde tus matrices; cuando la ruta
  exacta no tiene tarifa directa (pasa en 28 de los 51 pares origen-destino
  reales del dataset), **estima el precio con Dijkstra** sobre la red conocida
  y lo marca `priceEstimated: true` para trazabilidad.
- El estado de ocupación (73%/3%/resto) **no se guarda por asiento** — se
  genera de forma determinística al vuelo (ver `docs/ARQUITECTURA.md`,
  sección "Por qué no materializamos 20 millones de asientos").
