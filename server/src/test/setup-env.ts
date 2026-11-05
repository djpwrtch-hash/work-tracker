// Runs in each test worker BEFORE test file imports.
// Points the app at the isolated test database (never the development DB) and
// leaves any CI-provided DATABASE_URL alone.
import { applyTestDbEnv } from './test-db.js';

applyTestDbEnv();
