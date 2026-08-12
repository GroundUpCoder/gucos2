import pathlib from 'path';
import { fileURLToPath } from 'url';

// os is stateless — no database, no data dir. The backend only needs to know
// where the built frontend lives so it can serve it single-origin in local
// development and acceptance tests. Production is Cloudflare Pages.
const HERE = pathlib.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = pathlib.resolve(HERE, '..', '..');
export const FRONTEND_DIR = pathlib.join(REPO_DIR, 'frontend');
export const FRONTEND_DIST_DIR =
  process.env.GUCOS2_DIST || pathlib.join(FRONTEND_DIR, 'dist');
