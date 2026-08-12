import fs from 'node:fs';
import path from 'node:path';

function copyTree(source, destination, missingOnly = false) {
  if (!fs.existsSync(source)) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`immutable dist asset must not be a symlink: ${source}`);
  if (!stat.isDirectory()) {
    if (!missingOnly || !fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    return;
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    copyTree(path.join(source, name), path.join(destination, name), missingOnly);
  }
}

// A stale page and an already-running kernel are pinned to these immutable
// URLs. A deploy must add a generation; it must never erase an older one.
export function preserveImmutableAssets(dist, backup) {
  fs.mkdirSync(backup, { recursive: true });
  copyTree(path.join(dist, 'runtime'), path.join(backup, 'runtime'));
  copyTree(path.join(dist, 'packages', 'pool'), path.join(backup, 'packages', 'pool'));
  const osDir = path.join(dist, 'os');
  if (fs.existsSync(osDir)) {
    for (const name of fs.readdirSync(osDir)) {
      if (/^os-system\.[0-9a-f]{16}\.img$/.test(name)) {
        copyTree(path.join(osDir, name), path.join(backup, 'os', name));
      }
    }
  }
}

export function restoreImmutableAssets(dist, backup) {
  try {
    copyTree(backup, dist, true);
  } finally {
    fs.rmSync(backup, { recursive: true, force: true });
  }
}
