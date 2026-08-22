'use strict';

// 纯 Node 生成应用图标（PNG）：红色时钟表盘 + 白色指针
// 不依赖任何第三方库，zlib 为 Node 内置模块

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// ---------- 像素画布 ----------
const px = new Uint8Array(SIZE * SIZE * 4); // RGBA

function setPixel(x, y, r, g, b, a) {
  const i = (y * SIZE + x) * 4;
  // 简单 alpha 合成
  if (a >= 1) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  } else if (a > 0) {
    const na = a + (px[i + 3] / 255) * (1 - a);
    if (na > 0) {
      px[i] = Math.round((r * a + px[i] * (px[i + 3] / 255) * (1 - a)) / na);
      px[i + 1] = Math.round((g * a + px[i + 1] * (px[i + 3] / 255) * (1 - a)) / na);
      px[i + 2] = Math.round((b * a + px[i + 2] * (px[i + 3] / 255) * (1 - a)) / na);
      px[i + 3] = Math.round(na * 255);
    }
  }
}

const clamp01 = v => Math.max(0, Math.min(1, v));

// 点到线段的距离
function distToSeg(px0, py0, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px0 - ax) * dx + (py0 - ay) * dy) / len2;
  t = clamp01(t);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px0 - cx, py0 - cy);
}

const CX = 127.5, CY = 127.5;
const R_DISC = 122;      // 红色表盘半径
const R_RING_OUT = 102;  // 白圈外沿
const R_RING_IN = 90;    // 白圈内沿
const HAND_W = 10;       // 指针半宽
const R_DOT = 12;        // 中心圆点

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - CX, dy = y - CY;
    const r = Math.hypot(dx, dy);

    const discA = clamp01(R_DISC - r + 0.5); // 红色表盘（带 1px 抗锯齿）
    if (discA > 0) setPixel(x, y, 229, 57, 53, discA);

    const ringA = clamp01(Math.min(R_RING_OUT - r + 0.5, r - R_RING_IN + 0.5));
    if (ringA > 0) setPixel(x, y, 255, 255, 255, ringA);

    // 时针（指向 10 点方向）与分针（指向 2 点方向）
    const d1 = distToSeg(x, y, CX, CY, 80, 90);
    const d2 = distToSeg(x, y, CX, CY, 196, 106);
    const handA = clamp01(Math.max(HAND_W - Math.min(d1, d2) + 0.5, 0));
    if (handA > 0 && r < R_RING_IN) setPixel(x, y, 255, 255, 255, handA);

    const dotA = clamp01(R_DOT - r + 0.5);
    if (dotA > 0) setPixel(x, y, 255, 255, 255, dotA);
  }
}

// ---------- PNG 编码 ----------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
// 压缩/滤波/隔行均为 0，已默认

// 每行前加滤波器字节 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon.png written:', out, png.length, 'bytes');
