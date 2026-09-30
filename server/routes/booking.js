'use strict';

const express = require('express');

function buildBookingRouter(ctx) {
  const router = express.Router();

  router.post('/booking/:flightId/:seatNumber/action', async (req, res) => {
    const { flightId, seatNumber } = req.params;
    const { actionType, passengerName, passengerEmail, refTxId } = req.body;
    const valid = ['RESERVE', 'PURCHASE', 'CANCEL', 'REFUND', 'CHECKIN'];
    if (!valid.includes(actionType)) {
      return res.status(400).json({ error: 'BAD_ACTION', message: `actionType debe ser uno de: ${valid.join(', ')}` });
    }
    if ((actionType === 'RESERVE' || actionType === 'PURCHASE') && !passengerName) {
      return res.status(400).json({ error: 'MISSING_PASSENGER_NAME' });
    }
    try {
      const result = await ctx.bookingService.requestSeatAction({
        flightId,
        seatNumber,
        actionType,
        passengerName,
        passengerEmail,
        refTxId,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
    }
  });

  router.get('/booking/tx/:txId', (req, res) => {
    const tx = ctx.systemStore.getReplicaTxById(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'TX_NOT_FOUND' });
    const flight = ctx.flightCache.get(tx.flightId);
    const latest = ctx.bookingService.latestTxForSeat(tx.flightId, tx.seatNumber);
    res.json({ tx, flight, latest });
  });

  return router;
}

module.exports = { buildBookingRouter };
