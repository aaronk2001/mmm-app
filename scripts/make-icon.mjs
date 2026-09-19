// Generates assets/icon.ico + assets/tray.png for the MMM mark (three ascending
// bars in the v3 "Precision instrument" accent->positive gradient, on a --bg
// tile — kept byte-for-byte in sync with docs/design/v3-tokens.md; see the
// note in src/components/money/shared/Logo.jsx for why these are hardcoded
// hex instead of var(--m-*)). Pure Node: software-rasterizes with 4x
// supersampling for smooth edges, PNG-encodes via zlib, packs the ICO with
// png-to-ico. No browser / native image deps.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#0f1115');   // --bg (dark)
const TEAL = hex('#2dd4bf'); // --accent (dark)
const MINT = hex('#4ade80'); // --positive (dark)
const lerp = (a, b, t) => a + (b - a) * t;

// Signed distance helpers in 32-unit design space.
function insideRoundRect(x, y, rx, ry, rw, rh, r) {
  const dx = Math.max(rx - x, 0, x - (rx + rw));
  const dy = Math.max(ry - y, 0, y - (ry + rh));
  // inside the straight edges
  if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
    // corner rounding
    const cxL = rx + r, cxR = rx + rw - r, cyT = ry + r, cyB = ry + rh - r;
    const px = x < cxL ? cxL : x > cxR ? cxR : x;
    const py = y < cyT ? cyT : y > cyB ? cyB : y;
    return Math.hypot(x - px, y - py) <= r + 1e-6;
  }
  return dx === 0 && dy === 0;
}

// Bars in 32-space: [x, y, w, h]
const BARS = [[8, 17, 4, 7], [14, 12, 4, 12], [20, 7, 4, 17]];
const BAR_TOP = 7, BAR_BOTTOM = 24; // gradient span

function sampleColor(x, y) {
  // returns [r,g,b,a] at design-space point, or null
  for (const [bx, by, bw, bh] of BARS) {
    if (insideRoundRect(x, y, bx, by, bw, bh, 2)) {
      const t = Math.min(1, Math.max(0, (y - BAR_TOP) / (BAR_BOTTOM - BAR_TOP)));
      return [Math.round(lerp(MINT[0], TEAL[0], t)), Math.round(lerp(MINT[1], TEAL[1], t)), Math.round(lerp(MINT[2], TEAL[2], t)), 255];
    }
  }
  if (insideRoundRect(x, y, 0.6, 0.6, 30.8, 30.8, 8)) return [...BG, 255];
  return [0, 0, 0, 0];
}

function raster(size) {
  const ss = 4; // supersample
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const dx = ((px + (sx + 0.5) / ss) / size) * 32;
          const dy = ((py + (sy + 0.5) / ss) / size) * 32;
          const c = sampleColor(dx, dy);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = ss * ss;
      const o = (py * size + px) * 4;
      const av = a / n;
      buf[o] = av ? Math.round(r / a) : 0;
      buf[o + 1] = av ? Math.round(g / a) : 0;
      buf[o + 2] = av ? Math.round(b / a) : 0;
      buf[o + 3] = Math.round(av);
    }
  }
  return buf;
}

// ── minimal PNG encoder (RGBA, no interlace) ─────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIZES = [256, 64, 48, 32, 16];
const pngs = SIZES.map((s) => encodePng(s, raster(s)));

fs.writeFileSync(path.join(ASSETS, 'tray.png'), encodePng(32, raster(32)));
fs.writeFileSync(path.join(ASSETS, 'icon-256.png'), pngs[0]);
const ico = await pngToIco(pngs);
fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
console.log(`[icon] wrote assets/icon.ico (${ico.length} bytes), tray.png, icon-256.png`);
