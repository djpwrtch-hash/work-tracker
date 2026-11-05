import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// `npm start` runs from the repo root, but the documented local env file lives at
// server/.env (dotenv inside the server bundle would otherwise read the root .env).
// Load it before importing the bundle. process.loadEnvFile is Node 20.12+/22.
for (const envFile of [path.join(here, 'server', '.env'), path.join(here, '.env')]) {
  try { process.loadEnvFile(envFile); } catch { /* file absent or Node < 20.12 */ }
}

const candidates = [
  // Prefer the workspace build over release/: release/ is gitignored and can be
  // stale (it previously shipped an older auth.service that leaked lock status).
  path.join(here, 'server', 'dist', 'server.js'),
  path.join(here, 'server', 'dist', 'src', 'server.js'),
  path.join(here, 'dist', 'server.js'),
  path.join(here, 'dist', 'src', 'server.js'),
  path.join(here, 'release', 'server.js'),
  path.join(here, 'release', 'src', 'server.js'),
];

const target = candidates.find((p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
});

if (!target) {
  console.error('[STARTUP] No server bundle found — run npm run build');
  process.exit(1);
}

await import(pathToFileURL(target).href);
