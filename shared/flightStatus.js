'use strict';

// Estados del dataset del ingeniero en los que un vuelo todavia se puede vender.
// BOARDING ya cerro la venta; DEPARTED / IN_FLIGHT / LANDED / ARRIVED ya salieron; CANCELLED no vuela.
const SELLABLE_STATUSES = ['SCHEDULED', 'DELAYED'];
const ALL_STATUSES = ['SCHEDULED', 'DELAYED', 'BOARDING', 'DEPARTED', 'IN_FLIGHT', 'LANDED', 'ARRIVED', 'CANCELLED'];
// Valor que el seed asigna cuando el CSV trae un estado que no existe (dato sucio).
const UNKNOWN_STATUS = 'UNKNOWN';

/** Un vuelo sin estado (datos de prueba) se trata como programado. */
function isSellable(status) {
  return !status || SELLABLE_STATUSES.includes(status);
}

module.exports = { SELLABLE_STATUSES, ALL_STATUSES, UNKNOWN_STATUS, isSellable };
