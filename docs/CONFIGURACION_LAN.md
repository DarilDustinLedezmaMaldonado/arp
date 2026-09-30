# Configuración LAN con tres computadoras

Esta guía usa un proceso y una base primaria por computadora:

| Computadora | Nodo | Motor | Puerto web |
|---|---|---|---|
| PC 1 | `NODE_NA` | SQL Server | `4001` |
| PC 2 | `NODE_EA` | SQL Server | `4002` |
| PC 3 | `NODE_SA` | MongoDB | `4003` |

Las tres computadoras deben tener una copia idéntica del proyecto, Node.js 18+
y estar conectadas al mismo router o punto de acceso. No se necesita Internet
durante la demostración.

## 1. Averiguar las IP de la LAN

En Linux:

```bash
hostname -I
```

En Windows:

```powershell
ipconfig
```

Ejemplo usado en el resto de la guía:

- PC 1: `192.168.1.10`
- PC 2: `192.168.1.11`
- PC 3: `192.168.1.12`

Conviene reservar estas direcciones en el router o configurarlas de forma
estática para que no cambien el día de la presentación.

## 2. Instalar y probar las bases

- PC 1 y PC 2: SQL Server debe aceptar conexiones TCP locales. Crear las bases
  `arp_NODE_NA` y `arp_NODE_EA`, respectivamente.
- PC 3: MongoDB debe escuchar localmente y tener disponible la base
  `arp_NODE_SA` (se crea al insertar los primeros datos).

La aplicación se conecta a la base de su misma computadora. No es necesario
abrir `1433` ni `27017` al resto de la LAN si el seed se ejecuta localmente.

## 3. Crear `.env` en cada computadora

En **las tres** computadoras añadir también:

```dotenv
BIND_HOST=0.0.0.0
ALLOW_INSECURE_LOCAL=false
SYNC_SECRET=REEMPLAZAR_POR_CLAVE_ALEATORIA_COMPARTIDA
ADMIN_SECRET=REEMPLAZAR_POR_OTRA_CLAVE_ALEATORIA
```

Generar dos claves distintas de al menos 32 caracteres (en Linux:
`openssl rand -hex 32`, una vez por clave). Copiar la misma `SYNC_SECRET` a las
tres PC. No usar literalmente los ejemplos ni compartir claves en capturas.
Administración pedirá `ADMIN_SECRET`; usar la misma `ADMIN_SECRET` en las tres
PC para que el apartado **Pasajes recientes** pueda consultar los tres nodos.
Usar solo una LAN de confianza:
este despliegue HTTP no cifra el tráfico.

PC 1 (`NODE_NA`):

```dotenv
NODE_ID=NODE_NA
PORT=4001
DB_DRIVER=mssql
MSSQL_SERVER=localhost
MSSQL_PORT=1433
MSSQL_DATABASE=arp_NODE_NA
MSSQL_USER=sa
MSSQL_PASSWORD=TU_CLAVE
MSSQL_ENCRYPT=false
MSSQL_TRUST_CERT=true
NODE_NA_HOST=192.168.1.10
NODE_EA_HOST=192.168.1.11
NODE_SA_HOST=192.168.1.12
```

PC 2 (`NODE_EA`): usar los mismos hosts, pero cambiar:

```dotenv
NODE_ID=NODE_EA
PORT=4002
DB_DRIVER=mssql
MSSQL_DATABASE=arp_NODE_EA
```

PC 3 (`NODE_SA`):

```dotenv
NODE_ID=NODE_SA
PORT=4003
DB_DRIVER=mongo
MONGO_URI=mongodb://localhost:27017
MONGO_DB=arp_NODE_SA
NODE_NA_HOST=192.168.1.10
NODE_EA_HOST=192.168.1.11
NODE_SA_HOST=192.168.1.12
```

## 4. Instalar y sembrar cada nodo

En cada computadora:

```bash
npm install
npm run vendor:assets
```

Después ejecutar únicamente el seed de esa computadora:

```bash
# PC 1
npm run seed -- --node=NODE_NA

# PC 2
npm run seed -- --node=NODE_EA

# PC 3
npm run seed -- --node=NODE_SA
```

## 5. Abrir el firewall de la aplicación

En Ubuntu con UFW:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 4001 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 4002 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 4003 proto tcp
```

Solo es imprescindible abrir el puerto correspondiente a cada PC. Se muestran
los tres comandos para facilitar una prueba donde se intercambien los roles.
Adaptar la subred al router real. No abrir estos puertos hacia Internet.

## 6. Iniciar los nodos

```bash
# PC 1
npm run node:na

# PC 2
npm run node:ea

# PC 3
npm run node:sa
```

Desde PC 1 deben responder:

```bash
curl http://192.168.1.10:4001/health
curl http://192.168.1.11:4002/health
curl http://192.168.1.12:4003/health
```

El campo `dbDriver` debe ser `mssql`, `mssql` y `mongo`, respectivamente.

## 7. Prueba de compra concurrente

1. Abrir la aplicación en dos navegadores/computadoras diferentes.
2. Elegir el mismo vuelo y el mismo asiento disponible.
3. Pulsar comprar casi simultáneamente.
4. El nodo dueño serializa ambas solicitudes: solo una queda `SOLD`; la otra
   queda `CONFLICT_LOST` o recibe que el asiento ya no está disponible.
5. Revisar la misma transacción en las tablas/colecciones
   `seat_transactions` de los tres motores. Los eventos confirmados se
   replican a las tres bases primarias.

Para probar tolerancia a fallos, aislar temporalmente el nodo dueño desde
Administración, comprar desde dos nodos y restaurarlo. Las dos solicitudes
pueden mostrarse provisionalmente como `LOCAL_PENDING`, pero al converger solo
una queda `SOLD` y la otra `CONFLICT_LOST`.

Mientras están pendientes **no son boletos confirmados**: no se permite QR,
PDF ni Wallet. No iniciar dos procesos con el mismo `NODE_ID`.
Repetir también devolución, liberación y reventa: el worker no debe liberar
la nueva venta. Detener una réplica, comprar y reiniciarla: la cola debe vaciarse
sin duplicados. Conservar los archivos SQLite de sistema (diario y cola durable)
incluso si la base primaria usa SQL Server o MongoDB.

Esta es replicación de eventos de aplicación, no replicación nativa entre
motores. Las pruebas automatizadas usan SQLite; realizar estas pruebas LAN
sobre los tres motores antes de dar por lista la entrega.

Para seguir las compras en vivo, abrir **Administración → Pasajes recientes** en
cualquier PC: muestra los últimos pasajes de los tres nodos y, en la columna
**Réplicas**, si cada nodo ya los recibió (`✓`), aún no (`⏳`) o no responde (`✗`).

## 8. Prueba de Dijkstra

Abrir `/#/planner`, elegir origen/destino y seleccionar `Menor costo` o
`Menor tiempo`. La respuesta muestra el camino, las escalas y el total.

Antes de la demostración ejecutar también:

```bash
npm test
```
