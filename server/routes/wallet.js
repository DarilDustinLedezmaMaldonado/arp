'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFKit = require('pdfkit');
const QRCode = require('qrcode');
const airportsData = require('../../config/airports.json');

const BRAND = { primary: '#0B3D91', accent: '#F2A104', dark: '#0A1930', light: '#F5F7FA' };

function buildWalletRouter(ctx) {
  const router = express.Router();

  router.get(['/wallet/:txId/qrcode.png', '/wallet/:txId/pdf', '/wallet/:txId/pkpass', '/wallet/:txId/google', '/wallet/:txId/google-qrcode.png'], (req, res, next) => {
    const tx = ctx.systemStore.getReplicaTxById(req.params.txId);
    const latest = tx && ctx.bookingService.latestTxForSeat(tx.flightId, tx.seatNumber);
    if (!tx || tx.syncStatus !== 'SYNCED' || !['SOLD', 'RESERVED', 'CHECKED_IN'].includes(tx.status) || latest?.id !== tx.id) {
      return res.status(409).json({ error: 'TICKET_NOT_CONFIRMED', message: 'La solicitud no es un boleto vigente confirmado.' });
    }
    next();
  });

  function loadTxAndFlight(txId) {
    const tx = ctx.systemStore.getReplicaTxById(txId);
    if (!tx) return null;
    const flight = ctx.flightCache.get(tx.flightId);
    return { tx, flight };
  }

  router.get('/wallet/:txId/qrcode.png', async (req, res) => {
    const payload = `ARP|${req.params.txId}|${ctx.nodeId}`;
    const buffer = await QRCode.toBuffer(payload, { margin: 1, scale: 8, color: { dark: '#0A1930', light: '#FFFFFF' } });
    res.type('png').send(buffer);
  });

  router.get('/wallet/:txId/pdf', async (req, res) => {
    const found = loadTxAndFlight(req.params.txId);
    if (!found) return res.status(404).json({ error: 'TX_NOT_FOUND' });
    const { tx, flight } = found;
    if (!flight) return res.status(404).json({ error: 'FLIGHT_NOT_FOUND' });

    const originMeta = airportsData.airports[flight.origin];
    const destMeta = airportsData.airports[flight.destination];
    const qrBuffer = await QRCode.toBuffer(`ARP|${tx.id}|${ctx.nodeId}`, { margin: 0, scale: 6 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="boarding-pass-${tx.id}.pdf"`);

    const doc = new PDFKit({ size: [560, 260], margin: 0 });
    doc.pipe(res);

    const stubWidth = 400;
    // ---- Panel principal ----
    doc.rect(0, 0, stubWidth, 260).fill(BRAND.primary);
    doc.rect(0, 0, stubWidth, 6).fill(BRAND.accent);

    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14).text('AEROLINEAS RAFAEL PABON', 24, 20);
    doc.font('Helvetica').fontSize(8).fillColor('#CBD8F5').text('TARJETA DE EMBARQUE / BOARDING PASS', 24, 38);

    doc.font('Helvetica-Bold').fontSize(30).fillColor('#FFFFFF').text(flight.origin, 24, 64);
    doc.font('Helvetica').fontSize(8).fillColor('#CBD8F5').text((originMeta ? originMeta.city : ''), 24, 98, { width: 140 });

    doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND.accent).text('->', 168, 74);

    doc.font('Helvetica-Bold').fontSize(30).fillColor('#FFFFFF').text(flight.destination, 210, 64);
    doc.font('Helvetica').fontSize(8).fillColor('#CBD8F5').text((destMeta ? destMeta.city : ''), 210, 98, { width: 160 });

    const col1 = 24, col2 = 140, col3 = 256;
    const rowY = 132;
    function field(x, label, value) {
      doc.font('Helvetica').fontSize(7).fillColor('#9FB2E0').text(label, x, rowY);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF').text(value, x, rowY + 11);
    }
    field(col1, 'FECHA / DATE', flight.date);
    field(col2, 'HORA / TIME', flight.time);
    field(col3, 'PUERTA / GATE', flight.gate || '--');

    const rowY2 = 178;
    function field2(x, label, value) {
      doc.font('Helvetica').fontSize(7).fillColor('#9FB2E0').text(label, x, rowY2);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF').text(value, x, rowY2 + 11);
    }
    field2(col1, 'PASAJERO / PASSENGER', tx.passengerName || '-');
    field2(col3, 'CLASE / CLASS', tx.cabinClass === 'FIRST' ? 'PRIMERA' : 'TURISTA');

    const rowY3 = 224;
    function field3(x, label, value, big) {
      doc.font('Helvetica').fontSize(7).fillColor('#9FB2E0').text(label, x, rowY3);
      doc.font('Helvetica-Bold').fontSize(big ? 16 : 12).fillColor(BRAND.accent).text(value, x, rowY3 + 9);
    }
    field3(col1, 'ASIENTO / SEAT', tx.seatNumber, true);
    field3(col2, 'PNR', tx.pnr || '------');
    field3(col3, 'VUELO / FLIGHT', flight.id.replace('F-', 'RP'));

    // ---- Perforacion ----
    const perfX = stubWidth;
    for (let y = 6; y < 260; y += 12) {
      doc.circle(perfX, y, 3).fill('#FFFFFF');
    }

    // ---- Stub / talon ----
    doc.rect(stubWidth, 0, 560 - stubWidth, 260).fill(BRAND.dark);
    doc.image(qrBuffer, stubWidth + 22, 20, { width: 116 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF').text(flight.origin + ' -> ' + flight.destination, stubWidth + 22, 146, { width: 116, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor('#9FB2E0').text('Asiento ' + tx.seatNumber + ' · ' + (tx.cabinClass === 'FIRST' ? '1a Clase' : 'Turista'), stubWidth + 22, 160, { width: 116, align: 'center' });
    doc.font('Helvetica').fontSize(6).fillColor('#6B7DA8').text('Escanea para check-in', stubWidth + 22, 178, { width: 116, align: 'center' });
    doc.font('Helvetica').fontSize(6).fillColor('#6B7DA8').text(tx.id, stubWidth + 22, 236, { width: 116, align: 'center' });

    doc.end();
  });

  // ---- Apple Wallet (.pkpass real, firmado) ----
  // Requiere certificados de Apple Developer. Si no estan configurados, el
  // sistema sigue funcionando (PDF + pase digital web + QR), y este endpoint
  // responde 501 con instrucciones. Ver README, seccion "Wallet".
  function pkpassConfig() {
    const { PKPASS_WWDR, PKPASS_SIGNER_CERT, PKPASS_SIGNER_KEY, PKPASS_SIGNER_KEY_PASSPHRASE, PKPASS_PASS_TYPE_ID, PKPASS_TEAM_ID } = process.env;
    if (!PKPASS_WWDR || !PKPASS_SIGNER_CERT || !PKPASS_SIGNER_KEY || !PKPASS_PASS_TYPE_ID || !PKPASS_TEAM_ID) return null;
    return { PKPASS_WWDR, PKPASS_SIGNER_CERT, PKPASS_SIGNER_KEY, PKPASS_SIGNER_KEY_PASSPHRASE, PKPASS_PASS_TYPE_ID, PKPASS_TEAM_ID };
  }

  function googleWalletConfig() {
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
    let credentials;
    try {
      const credentialsPath = process.env.GOOGLE_WALLET_CREDENTIALS || path.join(process.cwd(), 'secrets', 'google-wallet-service-account.json');
      credentials = fs.existsSync(credentialsPath)
        ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
        : { client_email: process.env.GOOGLE_WALLET_CLIENT_EMAIL,
          private_key: String(process.env.GOOGLE_WALLET_PRIVATE_KEY || '').replace(/\\n/g, '\n') };
    } catch { return null; }
    if (!issuerId || !credentials.client_email || !credentials.private_key) return null;
    return { issuerId, clientEmail: credentials.client_email, privateKey: credentials.private_key };
  }

  function base64url(value) {
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  }

  function googleSaveUrl(tx, flight, cfg) {
    const clean = value => String(value).replace(/[^A-Za-z0-9._-]/g, '_');
    const classId = `${cfg.issuerId}.arp_generic`;
    const objectId = `${cfg.issuerId}.${clean(tx.id)}`;
    const localized = value => ({ defaultValue: { language: 'es-419', value: String(value) } });
    const departure = new Date(`${flight.date}T${flight.time}:00Z`);
    const arrival = new Date(departure.getTime() + Number(flight.timeHours || 1) * 3600000);
    const genericObject = {
      id: objectId, classId, state: 'ACTIVE',
      cardTitle: localized('Aerolíneas Rafael Pabón'),
      header: localized(`${flight.origin} → ${flight.destination}`),
      subheader: localized(`Vuelo ${flight.id.replace('F-', 'RP')}`),
      hexBackgroundColor: '#0B3D91',
      validTimeInterval: { start: { date: departure.toISOString() }, end: { date: arrival.toISOString() } },
      barcode: { type: 'QR_CODE', value: `ARP|${tx.id}|${ctx.nodeId}`, alternateText: tx.pnr || tx.id },
      textModulesData: [
        { id: 'passenger', header: 'PASAJERO', body: tx.passengerName || '-' },
        { id: 'flight', header: 'FECHA Y HORA', body: `${flight.date} ${flight.time}` },
        { id: 'seat', header: 'ASIENTO / PUERTA', body: `${tx.seatNumber} / ${flight.gate || '--'}` },
        { id: 'class', header: 'CLASE', body: tx.cabinClass === 'FIRST' ? 'Primera clase' : 'Económica' },
      ],
    };
    const claims = { iss: cfg.clientEmail, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), origins: [],
      payload: { genericClasses: [{ id: classId }], genericObjects: [genericObject] } };
    const encoded = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(claims)}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(encoded), cfg.privateKey).toString('base64url');
    return `https://pay.google.com/gp/v/save/${encoded}.${signature}`;
  }

  router.get('/wallet/status', (req, res) => {
    res.json({ applePkpass: !!pkpassConfig(), googleWallet: !!googleWalletConfig(), pdf: true, webPass: true });
  });

  router.get('/wallet/:txId/google', (req, res) => {
    const cfg = googleWalletConfig();
    if (!cfg) return res.status(501).json({ error: 'GOOGLE_WALLET_NOT_CONFIGURED',
      message: 'Google Wallet requiere GOOGLE_WALLET_ISSUER_ID y el JSON de una cuenta de servicio autorizada.' });
    const found = loadTxAndFlight(req.params.txId);
    if (!found || !found.flight) return res.status(404).json({ error: 'TX_NOT_FOUND' });
    try { return res.redirect(googleSaveUrl(found.tx, found.flight, cfg)); }
    catch (err) { return res.status(500).json({ error: 'GOOGLE_WALLET_ERROR', message: err.message }); }
  });

  router.get('/wallet/:txId/google-qrcode.png', async (req, res) => {
    const cfg = googleWalletConfig();
    if (!cfg) return res.status(501).json({ error: 'GOOGLE_WALLET_NOT_CONFIGURED' });
    const found = loadTxAndFlight(req.params.txId);
    if (!found || !found.flight) return res.status(404).json({ error: 'TX_NOT_FOUND' });
    try {
      const buffer = await QRCode.toBuffer(googleSaveUrl(found.tx, found.flight, cfg),
        { margin: 2, scale: 10, errorCorrectionLevel: 'L' });
      return res.type('png').send(buffer);
    } catch (err) { return res.status(500).json({ error: 'GOOGLE_WALLET_ERROR', message: err.message }); }
  });

  router.get('/wallet/:txId/pkpass', async (req, res) => {
    const cfg = pkpassConfig();
    if (!cfg) {
      return res.status(501).json({
        error: 'PKPASS_NOT_CONFIGURED',
        message: 'Faltan certificados de Apple Developer. Define PKPASS_WWDR, PKPASS_SIGNER_CERT, PKPASS_SIGNER_KEY, PKPASS_PASS_TYPE_ID y PKPASS_TEAM_ID en .env (ver README).',
      });
    }
    const found = loadTxAndFlight(req.params.txId);
    if (!found || !found.flight) return res.status(404).json({ error: 'TX_NOT_FOUND' });
    const { tx, flight } = found;
    try {
      const { PKPass } = require('passkit-generator');
      const fs = require('fs');
      const path = require('path');
      const o = airportsData.airports[flight.origin], d = airportsData.airports[flight.destination];
      const pass = await PKPass.from(
        {
          model: path.join(__dirname, '..', '..', 'wallet', 'arp.pass'),
          certificates: {
            wwdr: fs.readFileSync(cfg.PKPASS_WWDR),
            signerCert: fs.readFileSync(cfg.PKPASS_SIGNER_CERT),
            signerKey: fs.readFileSync(cfg.PKPASS_SIGNER_KEY),
            signerKeyPassphrase: cfg.PKPASS_SIGNER_KEY_PASSPHRASE || undefined,
          },
        },
        {
          serialNumber: tx.id,
          passTypeIdentifier: cfg.PKPASS_PASS_TYPE_ID,
          teamIdentifier: cfg.PKPASS_TEAM_ID,
          description: `Boarding pass ${flight.origin}-${flight.destination}`,
        }
      );
      pass.setBarcodes({ message: `ARP|${tx.id}|${ctx.nodeId}`, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' });
      pass.headerFields.push({ key: 'gate', label: 'GATE', value: flight.gate || '--' });
      pass.primaryFields.push(
        { key: 'origin', label: o ? o.city : flight.origin, value: flight.origin },
        { key: 'destination', label: d ? d.city : flight.destination, value: flight.destination }
      );
      pass.secondaryFields.push(
        { key: 'passenger', label: 'PASSENGER', value: tx.passengerName || '-' },
        { key: 'date', label: 'DATE', value: `${flight.date} ${flight.time}` }
      );
      pass.auxiliaryFields.push(
        { key: 'seat', label: 'SEAT', value: tx.seatNumber },
        { key: 'class', label: 'CLASS', value: tx.cabinClass === 'FIRST' ? 'First' : 'Economy' },
        { key: 'pnr', label: 'PNR', value: tx.pnr || '-' }
      );
      const buffer = pass.getAsBuffer();
      res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
      res.setHeader('Content-Disposition', `attachment; filename="boarding-pass-${tx.id}.pkpass"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: 'PKPASS_ERROR', message: err.message });
    }
  });

  router.post('/wallet/checkin', async (req, res) => {
    const { txId } = req.body;
    const found = loadTxAndFlight(txId);
    if (!found) return res.status(404).json({ error: 'TX_NOT_FOUND', message: 'Codigo QR no reconocido' });
    const { tx } = found;
    const latest = ctx.bookingService.latestTxForSeat(tx.flightId, tx.seatNumber);
    if (!latest || latest.id !== tx.id || tx.status !== 'SOLD' || tx.syncStatus !== 'SYNCED') {
      const state = latest && latest.id !== tx.id ? latest.status : tx.status;
      return res.status(409).json({ error: 'INVALID_STATE', message: `Este boleto esta en estado ${state}, no se puede hacer check-in.` });
    }
    try {
      const result = await ctx.bookingService.requestSeatAction({
        flightId: tx.flightId,
        seatNumber: tx.seatNumber,
        actionType: 'CHECKIN',
        refTxId: tx.id,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
    }
  });

  return router;
}

module.exports = { buildWalletRouter };
