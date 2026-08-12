// gen-icons.mjs — synthesize the headless-os Ring Prompt PWA icon set.
//
// The open kernel ring and teal prompt replace the compositor/window metaphor
// used by full gucOS. The geometry is the 64-unit vector master selected from
// docs/logo-proposals/kimi; this pure-JS rasterizer keeps production builds
// deterministic and independent of a browser or native SVG tooling.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { encodePng } = require(path.join(HERE, '..', 'guc', 'tests', 'lib', 'png.js'));

const GROUND = [0x18, 0x18, 0x1b];
const RING = [0xfa, 0xfa, 0xfa];
const PROMPT = [0x2d, 0xd4, 0xbf];
const SAMPLES = 4;

const distanceToSegment = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};

function sampleMark(x, y, maskable) {
  const scale = maskable ? 0.9 : 1, offset = maskable ? 3.2 : 0;
  const ux = (x - offset) / scale, uy = (y - offset) / scale;
  const stroke = 7 / 2;
  const angle = Math.atan2(uy - 32, ux - 32) * 180 / Math.PI;
  const onArc = Math.abs(Math.hypot(ux - 32, uy - 32) - 19) <= stroke && Math.abs(angle) >= 50;
  const capTop = Math.hypot(ux - 44.21, uy - 17.45) <= stroke;
  const capBottom = Math.hypot(ux - 44.21, uy - 46.55) <= stroke;
  const onRing = onArc || capTop || capBottom;
  const onPrompt = distanceToSegment(ux, uy, 44.21, 17.45, 52.6, 32) <= stroke ||
    distanceToSegment(ux, uy, 52.6, 32, 44.21, 46.55) <= stroke;
  return onPrompt ? PROMPT : onRing ? RING : GROUND;
}

function makeIcon(size, { maskable = false } = {}) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const sums = [0, 0, 0];
    for (let sy = 0; sy < SAMPLES; sy++) for (let sx = 0; sx < SAMPLES; sx++) {
      const c = sampleMark((px + (sx + 0.5) / SAMPLES) * 64 / size, (py + (sy + 0.5) / SAMPLES) * 64 / size, maskable);
      sums[0] += c[0]; sums[1] += c[1]; sums[2] += c[2];
    }
    const o = (py * size + px) * 3, n = SAMPLES * SAMPLES;
    rgb[o] = Math.round(sums[0] / n); rgb[o + 1] = Math.round(sums[1] / n); rgb[o + 2] = Math.round(sums[2] / n);
  }
  return encodePng(size, size, rgb);
}

export function writeIcons(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon-192.png'), makeIcon(192));
  fs.writeFileSync(path.join(outDir, 'icon-512.png'), makeIcon(512));
  fs.writeFileSync(path.join(outDir, 'icon-512-maskable.png'), makeIcon(512, { maskable: true }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(HERE, '..', 'frontend', 'dist', 'icons');
  writeIcons(out);
  console.log(`Ring Prompt icons written to ${out}`);
}
