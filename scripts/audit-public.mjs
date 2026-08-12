import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  new RegExp('net' + 'guc', 'i'),
  new RegExp('/Users/' + 'jku'),
  new RegExp('/home/' + 'ubuntu'),
  new RegExp('\\.guc' + 'chat'),
  new RegExp('joseph' + 'kimgpt', 'i'),
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /gho_[A-Za-z0-9]+/,
];
const ignored = new Set(['.git', 'node_modules', 'build']);
const findings = [];

function scanBytes(label, bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  for (const pattern of forbidden) if (pattern.test(text)) findings.push(`${label}: ${pattern}`);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) scanBytes(path.relative(root, full), fs.readFileSync(full));
  }
}

walk(root);
const pool = path.join(root, 'frontend', 'dist', 'packages', 'pool');
if (fs.existsSync(pool)) {
  for (const name of fs.readdirSync(pool)) {
    if (name.endsWith('.pkg.tar.gz')) scanBytes(`unpacked:${name}`, zlib.gunzipSync(fs.readFileSync(path.join(pool, name))));
  }
}

if (findings.length) {
  console.error('Public-boundary audit failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('public-boundary audit passed');
