// CLI wrapper: empty the test database between runs.
//   npm run test:reset-db -w server
import { resetTestDatabase } from './global-setup.js';

resetTestDatabase()
  .then((r) => {
    console.log(`[TestSetup] ${r.database} reset (cleared ${r.tables} tables)`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[TestSetup] Reset failed:', e.message);
    process.exit(1);
  });
