# Sincronización y garantías

## Autoridad única por vuelo

Cada vuelo tiene un nodo dueño fijo. Ejecutar **un único proceso por NODE_ID**:
la exclusión mutua por asiento es local al proceso. No hay elección automática
de un nuevo dueño cuando el anterior falla.

El dueño serializa solicitudes y confirma la primera reclamación válida.
Una solicitud posterior no revoca un boleto confirmado aunque su reloj sea
menor: queda `CONFLICT_LOST`. Cancelación, devolución, compra de una reserva y
check-in deben referenciar el evento vigente mediante `basedOnTxId`; una
referencia obsoleta se rechaza. Las decisiones son idempotentes por ID.

Lamport y los vectores registran orden y causalidad. El dueño asigna los relojes
de confirmación para ordenar las transiciones. El desempate vectorial
retroactivo de la versión anterior ya no se usa para vender boletos.

## Pendiente no significa comprado

Antes de contactar al dueño, el nodo de entrada guarda atómicamente en su
SQLite de sistema la solicitud `PENDING / LOCAL_PENDING` y su mensaje de salida.
Si el dueño no responde, la solicitud queda en espera, **sin confirmar una
compra ni emitir QR, PDF o pase Wallet**. No ocupa el asiento como vendido.
Al recuperarse el dueño puede confirmarla o rechazarla si otro cliente ganó.
Se prioriza impedir doble venta sobre confirmar compras durante una partición.

## Recuperación y replicación

1. El dueño persiste una decisión preparada en su diario local SQLite (WAL,
   synchronous FULL), antes de escribir la base primaria.
2. Escribe la misma decisión por ID en SQL Server, MongoDB o SQLite.
3. En una transacción local guarda la caché, mensajes para las otras dos
   bases y la marca de decisión completada.
4. El worker reintenta cada segundo. Solo marca entregado después de que el
   receptor haya persistido. Una caída mantiene el mensaje pendiente.

Al reiniciar se reproducen decisiones preparadas con ID y resultado original,
antes de nuevas decisiones sobre el asiento. Esto cubre interrupciones entre
escritura primaria y creación de mensajes. No es una transacción distribuida
entre motores ni protege contra pérdida del disco o borrado del diario.
Conservar `data/system_NODE_*.sqlite` y sus archivos WAL.

Las réplicas solo aceptan decisiones confirmadas enviadas por el dueño.
Mensajes pendientes no degradan confirmaciones; mensajes atrasados no resucitan
transacciones rechazadas o perdedoras. El estado visible usa la última
transición efectiva del asiento, no la última solicitud rechazada.

La replicación es **de eventos de aplicación por HTTP**, no replicación nativa
de SQL Server hacia MongoDB. Las lecturas tienen consistencia eventual;
la autorización de venta y check-in pasa siempre por el dueño.

## Devoluciones

Solo el dueño procesa devoluciones vencidas y únicamente si `REFUNDED` sigue
siendo el estado vigente. La liberación tiene un ID determinista derivado de
la devolución. Reinicios y reintentos no liberan una reventa. El retraso
configurable y el tiempo de entrega producen la ventana eventual.

## Seguridad y alcance

En LAN, `SYNC_SECRET` compartida autentica la sincronización y otra
`ADMIN_SECRET` protege configuración, matrices y simulación de fallos.
Administración solicita su clave y la mantiene solo en memoria.
Los nodos con la clave compartida pertenecen al mismo dominio de confianza.
Los scripts `local:*` permiten demo sin claves únicamente en loopback y SQLite.

Usar una LAN de confianza: HTTP no cifra claves. Para Internet faltan TLS,
cuentas y autorización por pasajero, endurecimiento y copias de seguridad.
Los identificadores de transacción no sustituyen autenticación de pasajeros.

## Comprobación

`npm test` cubre carreras de 20 compras, solicitudes obsoletas, devoluciones,
reventas, recuperación de diario, mensajes atrasados, solicitudes pendientes,
autenticación, tres nodos HTTP con recuperación de réplica y optimalidad de
Dijkstra contra Floyd-Warshall en las matrices configuradas.

Las pruebas usan SQLite temporal. La aceptación en dos SQL Server y un MongoDB
en tres computadoras está pendiente hasta disponer del entorno; seguir
`CONFIGURACION_LAN.md`. No ejecutar seed para solucionar una caída:
puede reinicializar datos y no es un mecanismo de recuperación.
