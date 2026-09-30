'use strict';

/**
 * Genera wallet/arp.pass/ con pass.json e iconos PNG (fondo azul marino +
 * circulo ambar), usando solo zlib de Node. Es el "modelo" que usa
 * passkit-generator para armar el .pkpass real (ver server/routes/wallet.js).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'wallet', 'arp.pass');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.32;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const [R, G, B] = inCircle ? [242, 161, 4] : [10, 25, 48];
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon.png': png(29, 29), 'icon@2x.png': png(58, 58), 'icon@3x.png': png(87, 87),
  'logo.png': png(160, 50), 'logo@2x.png': png(320, 100),
};
for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), buf);

fs.writeFileSync(
  path.join(OUT, 'pass.json'),
  JSON.stringify(
    {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.rafaelpabon.boarding',
      teamIdentifier: 'XXXXXXXXXX',
      organizationName: 'Aerolineas Rafael Pabon',
      description: 'Tarjeta de embarque - Aerolineas Rafael Pabon',
      logoText: 'Rafael Pabon',
      foregroundColor: 'rgb(255,255,255)',
      backgroundColor: 'rgb(11,61,145)',
      labelColor: 'rgb(255,203,102)',
      boardingPass: { transitType: 'PKTransitTypeAir' },
    },
    null,
    2
  )
);
console.log('Assets de Wallet generados en', OUT);
