// "THE WORLD IN ONE PAGE" — Monday 23 November 2026.
// A program that draws a newspaper front page summing up the day's world news
// and writes it to /output/entry.png. Node 22, standard library only:
// a hand-rolled rasterizer (framebuffer + primitives + a 5x7 bitmap font)
// and a hand-rolled PNG encoder (zlib + CRC32). No network, no assets,
// no randomness, no clock — the same bytes come out of every run.
//
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- canvas ---
const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 4); // RGBA framebuffer
const px32 = new Uint32Array(px.buffer); // same memory, one word per pixel

type RGB = [number, number, number];

const PAPER: RGB = [247, 243, 232]; // newsprint cream
const INK: RGB = [20, 22, 26];      // near-black
const NAVY: RGB = [18, 33, 61];     // masthead navy
const NAVY2: RGB = [28, 48, 84];    // lighter navy
const GOLD: RGB = [198, 155, 51];   // masthead gold rule
const RED: RGB = [178, 34, 34];     // alert red
const TEAL: RGB = [16, 94, 94];     // section teal
const SKY: RGB = [141, 190, 214];   // sky blue
const SUN: RGB = [232, 164, 42];    // sun amber
const LEAF: RGB = [46, 125, 50];    // green
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [105, 105, 100];
const LIGHT: RGB = [235, 229, 214]; // panel tint
const ORANGE: RGB = [224, 106, 24]; // flame orange
const DARKRED: RGB = [122, 20, 20];

// Pack an RGB colour into one little-endian RGBA word (alpha 255).
function word(c: RGB): number {
  return (0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

function set(x: number, y: number, c: RGB): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  px32[iy * W + ix] = word(c);
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return;
  const v = word(c);
  for (let yy = y0; yy < y1; yy++) px32.fill(v, yy * W + x0, yy * W + x1);
}

function hline(x: number, y: number, w: number, c: RGB): void {
  rect(x, y, w, 1, c);
}

function vline(x: number, y: number, h: number, c: RGB): void {
  rect(x, y, 1, h, c);
}

// Bresenham line, thickness t (square brush). Endpoints are rounded to
// integers first and the loop is bounded by step count, so it always ends.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx - dy;
  const r = Math.floor(t / 2);
  const steps = Math.max(dx, dy) + 1;
  for (let i = 0; i < steps; i++) {
    rect(ax - r, ay - r, t, t, c);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; ax += sx; }
    if (e2 < dx) { err += dx; ay += sy; }
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -half; x <= half; x++) set(cx + x, cy + y, c);
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      set(Math.round(cx + (r + k) * Math.cos(rad)), Math.round(cy + (r + k) * Math.sin(rad)), c);
    }
  }
}

// Filled ellipse.
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = -ry; y <= ry; y++) {
    const half = Math.floor(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
    for (let x = -half; x <= half; x++) set(cx + x, cy + y, c);
  }
}

// Filled polygon (scanline fill).
function poly(points: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) set(x, y, c);
    }
  }
}

// ------------------------------------------------------------------ font ---
// 5x7 bitmap font, authored here. '#' = ink pixel, '.' = empty.
// Uppercase letters, digits and the punctuation the page needs.
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '%': ['#...#', '#..#.', '...#.', '..#..', '.#...', '#..#.', '#...#'],
  '&': ['.##..', '#..#.', '#..#.', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '$': ['..#..', '.####', '#.#.#', '.###.', '..#.#', '####.', '..#..'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '*': ['.....', '.#.#.', '..#..', '#####', '..#..', '.#.#.', '.....'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
};

// Width of one character cell (5 pixels + 1 spacing) at a given scale.
function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

// Draw text left-aligned at (x, y); returns the width drawn.
function text(x: number, y: number, s: string, scale: number, c: RGB): number {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT['?'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === '#') rect(cx + col * scale, y + row * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
  return cx - x - scale;
}

function textCentered(cx: number, y: number, s: string, scale: number, c: RGB): void {
  text(cx - Math.floor(textWidth(s, scale) / 2), y, s, scale, c);
}

// Word-wrap plain text to a pixel width; returns lines (already uppercased).
function wrap(s: string, maxW: number, scale: number): string[] {
  const words = s.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (textWidth(next, scale) <= maxW || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw wrapped lines; returns the y after the last line.
function textBlock(x: number, y: number, s: string, scale: number, c: RGB, maxW: number, leading: number): number {
  const lines = wrap(s, maxW, scale);
  let yy = y;
  for (const ln of lines) {
    text(x, yy, ln, scale, c);
    yy += leading;
  }
  return yy;
}

// ------------------------------------------------------------------- png ---
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    raw.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------- illustrations
// Small flat pictograms, drawn with the same primitives. Each lives inside
// a square box (x, y, size) and reads at a glance.

// Cracked globe: the climate story. Blue sphere, green land blobs, a jagged
// red crack across it, orange sun behind, grey smoke curls above.
function drawGlobe(x: number, y: number, s: number): void {
  circle(x + s / 2, y + s / 2, Math.floor(s * 0.30), SUN); // sun behind
  circle(x + s * 0.52, y + s * 0.55, Math.floor(s * 0.34), [52, 120, 178]); // globe
  // land blobs (flat green shapes)
  ellipse(x + s * 0.44, y + s * 0.44, Math.floor(s * 0.13), Math.floor(s * 0.09), LEAF);
  ellipse(x + s * 0.62, y + s * 0.66, Math.floor(s * 0.11), Math.floor(s * 0.08), LEAF);
  ellipse(x + s * 0.60, y + s * 0.40, Math.floor(s * 0.07), Math.floor(s * 0.05), LEAF);
  // latitude / longitude hints
  ring(x + s * 0.52, y + s * 0.55, Math.floor(s * 0.34), 2, [30, 80, 130]);
  ellipse(x + s * 0.52, y + s * 0.55, Math.floor(s * 0.10), Math.floor(s * 0.34), [30, 80, 130]);
  // the crack: jagged red polyline across the globe
  const cx = x + s * 0.52;
  const cy = y + s * 0.55;
  const r = Math.floor(s * 0.34);
  line(cx - r + 8, cy - r + 30, cx - 20, cy - 12, RED, 5);
  line(cx - 20, cy - 12, cx + 6, cy + 8, RED, 5);
  line(cx + 6, cy + 8, cx + 26, cy + 34, RED, 5);
  line(cx + 26, cy + 34, cx + r - 6, cy + r - 24, RED, 5);
  // smoke curls
  circle(x + s * 0.30, y + s * 0.14, Math.floor(s * 0.07), GREY);
  circle(x + s * 0.40, y + s * 0.08, Math.floor(s * 0.05), GREY);
  circle(x + s * 0.72, y + s * 0.12, Math.floor(s * 0.06), GREY);
}

// US Capitol dome: white dome on a navy disc, columns, flag.
function drawCapitol(x: number, y: number, s: number): void {
  circle(x + s / 2, y + s / 2, Math.floor(s * 0.42), NAVY2);
  const cx = x + s / 2;
  const base = y + s * 0.78;
  // dome
  ellipse(cx, y + s * 0.52, Math.floor(s * 0.20), Math.floor(s * 0.14), WHITE);
  rect(cx - Math.floor(s * 0.20), y + s * 0.50, Math.floor(s * 0.40), Math.floor(s * 0.04), WHITE);
  // drum + columns
  rect(cx - Math.floor(s * 0.16), y + s * 0.54, Math.floor(s * 0.32), Math.floor(s * 0.24), WHITE);
  for (let i = 0; i < 5; i++) {
    rect(cx - Math.floor(s * 0.14) + i * Math.floor(s * 0.065), y + s * 0.56, 3, Math.floor(s * 0.20), NAVY2);
  }
  rect(cx - Math.floor(s * 0.18), base, Math.floor(s * 0.36), Math.floor(s * 0.04), WHITE);
  // flag pole + flag
  vline(cx, y + s * 0.24, Math.floor(s * 0.14), WHITE);
  poly([[cx, y + s * 0.24], [cx + Math.floor(s * 0.10), y + s * 0.27], [cx, y + s * 0.30]], RED);
}

// Cartel capture: a gold star badge on red, handcuff link below.
function drawBadge(x: number, y: number, s: number): void {
  circle(x + s / 2, y + s / 2, Math.floor(s * 0.42), RED);
  const cx = x + s / 2;
  const cy = y + s * 0.46;
  const R = Math.floor(s * 0.26);
  const r = Math.floor(s * 0.11);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const ang = (-Math.PI / 2 + (i * Math.PI) / 5);
    const rad = i % 2 === 0 ? R : r;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  poly(pts, GOLD);
  // handcuffs: two rings + chain
  ring(x + s * 0.30, y + s * 0.80, Math.floor(s * 0.07), 4, INK);
  ring(x + s * 0.70, y + s * 0.80, Math.floor(s * 0.07), 4, INK);
  line(x + s * 0.37, y + s * 0.80, x + s * 0.63, y + s * 0.80, INK, 4);
}

// Kyiv under attack: skyline silhouettes, a drone, a flame.
function drawKyiv(x: number, y: number, s: number): void {
  const base = y + s * 0.82;
  rect(x + s * 0.06, base, Math.floor(s * 0.88), Math.floor(s * 0.06), INK); // ground
  // skyline blocks
  rect(x + s * 0.08, y + s * 0.48, Math.floor(s * 0.16), base - (y + s * 0.48), NAVY2);
  rect(x + s * 0.28, y + s * 0.34, Math.floor(s * 0.14), base - (y + s * 0.34), NAVY2);
  rect(x + s * 0.46, y + s * 0.56, Math.floor(s * 0.18), base - (y + s * 0.56), NAVY2);
  rect(x + s * 0.68, y + s * 0.42, Math.floor(s * 0.16), base - (y + s * 0.42), NAVY2);
  // lit windows
  for (let i = 0; i < 4; i++) rect(x + s * 0.31 + i * 6, y + s * 0.42, 3, 4, GOLD);
  for (let i = 0; i < 3; i++) rect(x + s * 0.50 + i * 8, y + s * 0.62, 3, 4, GOLD);
  // drone: body + 4 rotors
  const dx = x + s * 0.62;
  const dy = y + s * 0.18;
  rect(dx - 10, dy - 4, 20, 8, INK);
  circle(dx - 14, dy - 6, 5, INK);
  circle(dx + 14, dy - 6, 5, INK);
  hline(dx - 22, dy - 8, 16, INK);
  hline(dx + 6, dy - 8, 16, INK);
  // flame on the right block
  poly([[x + s * 0.74, y + s * 0.42], [x + s * 0.70, y + s * 0.30], [x + s * 0.76, y + s * 0.36], [x + s * 0.80, y + s * 0.26], [x + s * 0.84, y + s * 0.42]], ORANGE);
  poly([[x + s * 0.75, y + s * 0.42], [x + s * 0.77, y + s * 0.34], [x + s * 0.80, y + s * 0.42]], [255, 200, 40]);
}

// Factory fire: factory silhouette, flame, smoke.
function drawFactory(x: number, y: number, s: number): void {
  const base = y + s * 0.80;
  rect(x + s * 0.10, y + s * 0.52, Math.floor(s * 0.55), base - (y + s * 0.52), NAVY2);
  rect(x + s * 0.68, y + s * 0.30, Math.floor(s * 0.10), base - (y + s * 0.30), NAVY2);
  rect(x + s * 0.10, base, Math.floor(s * 0.72), Math.floor(s * 0.05), INK);
  poly([[x + s * 0.24, y + s * 0.52], [x + s * 0.18, y + s * 0.32], [x + s * 0.28, y + s * 0.40], [x + s * 0.34, y + s * 0.28], [x + s * 0.42, y + s * 0.52]], ORANGE);
  circle(x + s * 0.74, y + s * 0.18, Math.floor(s * 0.07), GREY);
  circle(x + s * 0.82, y + s * 0.10, Math.floor(s * 0.05), GREY);
}

// Graduation cap over a podium: the exam-cheating resignation.
function drawCap(x: number, y: number, s: number): void {
  const cx = x + s / 2;
  // cap board (diamond) + skull
  poly([[cx - Math.floor(s * 0.30), y + s * 0.34], [cx, y + s * 0.20], [cx + Math.floor(s * 0.30), y + s * 0.34], [cx, y + s * 0.48]], INK);
  poly([[cx - Math.floor(s * 0.14), y + s * 0.40], [cx, y + s * 0.34], [cx + Math.floor(s * 0.14), y + s * 0.40], [cx + Math.floor(s * 0.14), y + s * 0.52], [cx - Math.floor(s * 0.14), y + s * 0.52]], TEAL);
  line(cx + Math.floor(s * 0.30), y + s * 0.34, cx + Math.floor(s * 0.30), y + s * 0.56, GOLD, 3);
  circle(cx + Math.floor(s * 0.30), y + s * 0.58, 4, GOLD);
  // podium
  rect(cx - Math.floor(s * 0.26), y + s * 0.62, Math.floor(s * 0.52), Math.floor(s * 0.16), NAVY2);
}

// Trophy: sport.
function drawTrophy(x: number, y: number, s: number): void {
  const cx = x + s / 2;
  // cup
  poly([[cx - Math.floor(s * 0.20), y + s * 0.22], [cx + Math.floor(s * 0.20), y + s * 0.22], [cx + Math.floor(s * 0.14), y + s * 0.50], [cx - Math.floor(s * 0.14), y + s * 0.50]], GOLD);
  // handles
  ring(cx - Math.floor(s * 0.22), y + s * 0.32, Math.floor(s * 0.08), 4, GOLD);
  ring(cx + Math.floor(s * 0.22), y + s * 0.32, Math.floor(s * 0.08), 4, GOLD);
  // stem + base
  rect(cx - 4, y + s * 0.50, 8, Math.floor(s * 0.12), GOLD);
  rect(cx - Math.floor(s * 0.16), y + s * 0.62, Math.floor(s * 0.32), Math.floor(s * 0.06), GOLD);
  rect(cx - Math.floor(s * 0.20), y + s * 0.68, Math.floor(s * 0.40), Math.floor(s * 0.06), GOLD);
}

// ------------------------------------------------------------------ layout ---
function drawPage(): void {
  rect(0, 0, W, H, PAPER);
  // outer frame
  rect(0, 0, W, 10, NAVY);
  rect(0, H - 10, W, 10, NAVY);
  rect(0, 0, 10, H, NAVY);
  rect(W - 10, 0, 10, H, NAVY);

  // ---- masthead ------------------------------------------------------
  rect(10, 10, W - 20, 108, NAVY);
  rect(10, 114, W - 20, 4, GOLD);
  textCentered(W / 2, 26, 'THE WORLD IN ONE PAGE', 7, WHITE);
  textCentered(W / 2, 82, 'MONDAY 23 NOVEMBER 2026', 4, GOLD);

  // ---- lead story: COP31 --------------------------------------------
  const leadY = 138;
  const leadH = 300;
  rect(24, leadY, W - 48, leadH, LIGHT);
  rect(24, leadY, W - 48, 4, RED);
  // globe illustration, left
  drawGlobe(40, leadY + 30, 240);
  // kicker + headline, right of the globe
  const tx = 300;
  text(tx, leadY + 18, 'CLIMATE  -  ANTALYA, TURKEY', 3, RED);
  text(tx, leadY + 46, 'COP31', 9, INK);
  text(tx, leadY + 124, 'COLLAPSES', 9, INK);
  text(tx, leadY + 206, 'NO DEAL AFTER LONGEST', 4, INK);
  text(tx, leadY + 236, 'SUMMIT ON RECORD', 4, INK);
  // ---- deck strip ----------------------------------------------------
  const deckY2 = 452;
  textBlock(24, deckY2, 'EU AND OTHERS REJECT THE FINAL DRAFT WITH NO MENTION OF FOSSIL FUELS. FIRST CLIMATE TALKS TO FAIL SINCE COPENHAGEN 2009.', 2, INK, W - 48, 24);

  // ---- middle row: three stories -------------------------------------
  // Each column: pictogram top-left, kicker beside it, headline full-width
  // below, body under that. Headlines wrap to at most 2 lines, bodies to 3.
  const midY = 512;
  const midH = 240;
  const colW = 312;
  const gap = 16;
  const colX = [24, 24 + colW + gap, 24 + 2 * (colW + gap)];

  // column 1 — USA
  rect(colX[0], midY, colW, midH, WHITE);
  rect(colX[0], midY, colW, 4, NAVY);
  drawCapitol(colX[0] + 16, midY + 12, 96);
  text(colX[0] + 124, midY + 20, 'USA', 3, NAVY);
  textBlock(colX[0] + 16, midY + 116, 'DEMOCRATS WIN 258 HOUSE SEATS', 3, INK, colW - 32, 26);
  textBlock(colX[0] + 16, midY + 172, 'BIGGEST MAJORITY SINCE 1992 AS HUBBARD FLIPS N. CAROLINA SEAT.', 2, GREY, colW - 32, 20);

  // column 2 — Mexico
  rect(colX[1], midY, colW, midH, WHITE);
  rect(colX[1], midY, colW, 4, RED);
  drawBadge(colX[1] + 16, midY + 12, 96);
  text(colX[1] + 124, midY + 20, 'MEXICO', 3, RED);
  textBlock(colX[1] + 16, midY + 116, "MEXICO SEIZES 'CHAPO ISIDRO'", 3, INK, colW - 32, 26);
  textBlock(colX[1] + 16, midY + 172, 'FBI MOST-WANTED CARTEL BOSS CAPTURED IN SINALOA. 11 KILLED IN GUN BATTLES.', 2, GREY, colW - 32, 20);

  // column 3 — Ukraine
  rect(colX[2], midY, colW, midH, WHITE);
  rect(colX[2], midY, colW, 4, TEAL);
  drawKyiv(colX[2] + 16, midY + 12, 96);
  text(colX[2] + 124, midY + 20, 'UKRAINE', 3, TEAL);
  textBlock(colX[2] + 16, midY + 116, 'KYIV HIT AS SHIP BURNS', 3, INK, colW - 32, 26);
  textBlock(colX[2] + 16, midY + 172, '14 MISSING AFTER RUSSIAN DRONE STRIKE. RUSSIAN SHIP ABLAZE OFF FINLAND.', 2, GREY, colW - 32, 20);

  // ---- bottom row: three more stories --------------------------------
  const botY = 768;
  const botH = 170;
  // Indonesia
  rect(24, botY, colW, botH, WHITE);
  rect(24, botY, colW, 4, ORANGE);
  drawFactory(40, botY + 12, 96);
  text(152, botY + 18, 'INDONESIA', 3, ORANGE);
  textBlock(152, botY + 48, 'FACTORY FIRE: 3 DEAD, DOZENS MISSING', 2, INK, colW - 140, 20);
  textBlock(40, botY + 116, 'SEVEN BODIES FOUND, 50 UNACCOUNTED FOR AFTER BLAZE AT CANDY PLANT.', 2, GREY, colW - 32, 19);

  // South Korea
  rect(colX[1], botY, colW, botH, WHITE);
  rect(colX[1], botY, colW, 4, TEAL);
  drawCap(colX[1] + 16, botY + 12, 96);
  text(colX[1] + 128, botY + 18, 'S. KOREA', 3, TEAL);
  textBlock(colX[1] + 128, botY + 48, 'MINISTER QUITS OVER AI EXAM CHEATING', 2, INK, colW - 116, 20);
  textBlock(colX[1] + 16, botY + 116, 'EDUCATION MINISTER RESIGNS AS AI CHEATING SCANDAL ROCKS EXAMS.', 2, GREY, colW - 32, 19);

  // Sport
  rect(colX[2], botY, colW, botH, WHITE);
  rect(colX[2], botY, colW, 4, LEAF);
  drawTrophy(colX[2] + 16, botY + 12, 96);
  text(colX[2] + 128, botY + 18, 'SPORT', 3, LEAF);
  textBlock(colX[2] + 128, botY + 48, 'INDIA 720/9: RECORD TEST TOTAL', 2, INK, colW - 116, 20);
  textBlock(colX[2] + 16, botY + 116, 'VERSTAPPEN WINS CHAOTIC LAS VEGAS GP. HUNGER GAMES PREQUEL OPENS WITH $120M.', 2, GREY, colW - 32, 19);

  // ---- footer ---------------------------------------------------------
  const footY = 950;
  rect(24, footY, W - 48, 3, GOLD);
  textCentered(W / 2, footY + 14, 'MONDAY 23 NOVEMBER 2026  -  THE WORLD IN ONE PAGE', 3, INK);
  textCentered(W / 2, footY + 40, 'CLIMATE  -  US MIDTERMS  -  MEXICO  -  UKRAINE  -  INDONESIA  -  SPORT', 2, GREY);
}

// -------------------------------------------------------------------- main ---
function main(): void {
  drawPage();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG());
}

main();
