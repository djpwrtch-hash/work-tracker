import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'release');
const serverSourceBuild = path.join(projectRoot, 'server', 'dist');
const schemaFile = path.join(projectRoot, 'server', 'src', 'db', 'schema.sql');
const serverPackageFile = path.join(projectRoot, 'server', 'package.json');
const webDist = path.join(projectRoot, 'web', 'dist');
const webOut = path.join(projectRoot, 'web', 'out');
const webBuild = fs.existsSync(webDist) ? webDist : webOut;

for (const requiredPath of [serverSourceBuild, schemaFile, serverPackageFile, webBuild]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Missing build output: ${path.relative(projectRoot, requiredPath)}`);
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
for (const entry of fs.readdirSync(serverSourceBuild)) {
  fs.cpSync(path.join(serverSourceBuild, entry), path.join(outputDir, entry), { recursive: true });
}
const serverPackage = JSON.parse(fs.readFileSync(serverPackageFile, 'utf8'));
fs.writeFileSync(path.join(outputDir, 'package.json'), `${JSON.stringify({
  name: 'employee-work-tracker-runtime',
  version: serverPackage.version,
  private: true,
  type: 'module',
  scripts: { start: 'node server.js' },
  dependencies: serverPackage.dependencies,
}, null, 2)}\n`);
fs.mkdirSync(path.join(outputDir, 'src', 'db'), { recursive: true });
fs.copyFileSync(schemaFile, path.join(outputDir, 'src', 'db', 'schema.sql'));
fs.cpSync(webBuild, path.join(outputDir, 'web', webBuild.endsWith('dist') ? 'dist' : 'out'), { recursive: true });

console.log(`[DEPLOY] Packaged server and web output in ${path.relative(projectRoot, outputDir)}/ (server: flat dist, web: ${path.basename(webBuild)})`);