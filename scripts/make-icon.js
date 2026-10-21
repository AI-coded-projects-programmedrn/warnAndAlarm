'use strict';
/**
 * 외부 의존성 없이 앱 아이콘(PNG + ICO)을 생성한다.
 * 디자인: 앰버색 라운드 스퀘어 + 진한 체크마크 (작은 트레이 크기에서도 식별 가능)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// build/  : 설치본·exe 아이콘용 (패키징 리소스, 앱 안에는 들어가지 않음)
// src/assets/ : 창·트레이·알림에서 실행 중에 쓰는 아이콘 (앱에 포함됨)
const OUT = path.join(__dirname, '..', 'build');
const RUNTIME = path.join(__dirname, '..', 'src', 'assets');

/* ---------- PNG 인코딩 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 래스터라이저 ---------- */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// 라운드 스퀘어 내부 여부 (0..1 정규화 좌표)
function inRoundedRect(x, y, inset, radius) {
  const min = inset, max = 1 - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

const CHECK = [
  [0.28, 0.52, 0.44, 0.68],
  [0.44, 0.68, 0.74, 0.33],
];

function shade(x, y) {
  // 체크마크가 먼저 (배경 위에 그려짐)
  const stroke = 0.075;
  for (const [ax, ay, bx, by] of CHECK) {
    if (distToSegment(x, y, ax, ay, bx, by) <= stroke) return [0x1a, 0x1d, 0x24, 255];
  }
  if (inRoundedRect(x, y, 0.06, 0.19)) {
    // 위 -> 아래로 살짝 그라데이션
    const t = (y - 0.06) / 0.88;
    const r = Math.round(0xf5 - 22 * t);
    const g = Math.round(0xbb - 26 * t);
    const b = Math.round(0x4a - 12 * t);
    return [r, g, b, 255];
  }
  return [0, 0, 0, 0];
}

/* ---------- 취침 준비 아이콘 (초승달) ---------- */

// 4갈래 반짝임: (|dx|/r)^0.5 + (|dy|/r)^0.5 <= 1
function inSparkle(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx) / r;
  const dy = Math.abs(y - cy) / r;
  if (dx > 1 || dy > 1) return false;
  return Math.sqrt(dx) + Math.sqrt(dy) <= 1;
}

const MOON = { cx: 0.55, cy: 0.47, r: 0.27, bx: 0.68, by: 0.33, br: 0.25 };

function shadeBedtime(x, y) {
  const cream = [0xf4, 0xe8, 0xc6, 255];
  // 초승달: 큰 원에서 살짝 어긋난 원을 빼낸다
  if (
    Math.hypot(x - MOON.cx, y - MOON.cy) <= MOON.r &&
    Math.hypot(x - MOON.bx, y - MOON.by) > MOON.br
  ) return cream;
  if (inSparkle(x, y, 0.26, 0.70, 0.085)) return cream;
  if (inSparkle(x, y, 0.30, 0.30, 0.055)) return cream;
  if (inRoundedRect(x, y, 0.06, 0.19)) {
    const t = (y - 0.06) / 0.88;
    return [
      Math.round(0x46 - 0x1e * t),
      Math.round(0x49 - 0x21 * t),
      Math.round(0x8e - 0x3a * t),
      255,
    ];
  }
  return [0, 0, 0, 0];
}

function render(size, shader) {
  const SS = 4; // 슈퍼샘플링
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = (shader || shade)(x, y);
          const af = c[3] / 255;
          r += c[0] * af; g += c[1] * af; b += c[2] * af; a += af;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return buf;
}

/* ---------- ICO 컨테이너 (PNG 페이로드) ---------- */
function buildICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir[o] = p.size >= 256 ? 0 : p.size;
    dir[o + 1] = p.size >= 256 ? 0 : p.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(p.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(RUNTIME, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((size) => ({ size, data: encodePNG(render(size), size) }));
  const at = (n) => pngs.find((p) => p.size === n).data;
  const ico = buildICO(pngs);

  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
  fs.writeFileSync(path.join(RUNTIME, 'icon.ico'), ico);
  fs.writeFileSync(path.join(RUNTIME, 'icon.png'), at(256));
  fs.writeFileSync(path.join(RUNTIME, 'tray.png'), at(32));
  fs.writeFileSync(path.join(RUNTIME, 'tray@2x.png'), at(64));

  // 취침 준비 알림용 (스트레칭 알림과 눈에 띄게 구분되도록 색과 형태를 다르게)
  for (const size of [64, 128, 256]) {
    fs.writeFileSync(
      path.join(RUNTIME, size === 256 ? 'bedtime.png' : `bedtime-${size}.png`),
      encodePNG(render(size, shadeBedtime), size)
    );
  }
  console.log('icons written: build/icon.ico + src/assets/(icon.ico, icon.png, tray.png, tray@2x.png, bedtime*.png)');
}

main();
