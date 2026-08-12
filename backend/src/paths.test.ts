import assert from 'node:assert/strict';
import pathlib from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRONTEND_DIR, REPO_DIR } from './paths.js';

const expected = pathlib.resolve(pathlib.dirname(fileURLToPath(import.meta.url)), '..', '..');
assert.equal(REPO_DIR, expected);
assert.equal(FRONTEND_DIR, pathlib.join(expected, 'frontend'));
