// Playwright global setup: prepare the isolated test database and seed the E2E user.
//
// Without this, "director logs in" and the attendance test failed on a clean machine
// because nothing ever created the hr_test database or the e2e-director user.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const serverDir = path.join(projectRoot, 'server');

function run(args: string[], label: string) {
  try {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', args.join(' ')], {
      cwd: serverDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: '',
        MYSQL_DATABASE: 'hr_test',
        TEST_DB_NAME: 'hr_test',
        NODE_ENV: 'test',
        ADMIN_EMAIL: 'e2e-director@example.com',
        ADMIN_PASSWORD: 'E2ePassword123!',
        JWT_ACCESS_SECRET: 'e2e-access-secret-32chars-min-abc123XYZ!',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-32chars-min-xyz789ABC!',
      },
    });
    console.log(`[E2E setup] ${label} ok`);
  } catch (e: any) {
    const detail = (e.stderr ? e.stderr.toString() : '') || e.message;
    throw new Error(`[E2E setup] ${label} failed: ${detail}`);
  }
}

export default async function globalSetup() {
  // 1. Create + empty hr_test (keeps schema/migrations, clears rows and rate limits)
  run(['npx', 'tsx', 'src/test/reset-db-cli.ts'], 'reset hr_test');
  // 2. Seed the director used by the specs
  run(['npx', 'tsx', 'src/test/e2e-seed.ts'], 'seed e2e director');
}
