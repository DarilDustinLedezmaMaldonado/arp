'use strict';

function partitionGuard(ctx) {
  return (req, res, next) => {
    if (ctx.faultService.isNetworkPartitioned()) {
      return res.status(503).json({ error: 'NETWORK_PARTITIONED', message: `El nodo ${ctx.nodeId} esta simulando estar aislado de la red.` });
    }
    next();
  };
}

module.exports = { partitionGuard };
