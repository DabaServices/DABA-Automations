import { defineConfig, devices } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Centralized URLs for the application under test.
// Override at runtime via environment variables, e.g.:
//   FRONTEND_URL=http://localhost:5173/ npx playwright test
//   BACKEND_URL=http://localhost:3000 npx playwright test
// ─────────────────────────────────────────────────────────────────────────────
export const FRONTEND_URL =
  process.env.FRONTEND_URL || 'http://auto.162.55.55.124.nip.io/';
// Backend API
export const BACKEND_URL =
  process.env.BACKEND_URL || 'http://auto-api.162.55.55.124.nip.io';

export default defineConfig({
  // Include all test files in tests folder (e2e, smoke, etc)
  testDir: './tests',
  
  // Match any .spec.ts or .test.ts files in any subdirectory
  testMatch: '**/*.spec.ts', 

  // Parallel execution is safe when tests share NO top-level unit. Each spec
  // groups its data into `describe.serial` clusters keyed by disjoint top
  // units (see src/fixtures/parallelGroups.ts), so different clusters can
  // safely run in parallel across workers without lock / move / aggregation
  // contention. Tune workers down to 1 if you need fully sequential debug.
  //
  // Worker count is bounded by the LARGEST serial cluster: wall-time can't go
  // below the biggest `describe.serial` block (it runs on one worker). After
  // the write-set-aware data-builder change, the hierarchy-change suite peaks
  // at ~26 tests in its largest cluster spread over ~12 clusters, so 5 local
  // workers saturate the available parallelism; more would sit idle.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 5,

  // Allow one retry to absorb transient UI hiccups (component remounts after
  // data fetches, network idle bouncing, etc.). CI gets a second retry.
  retries: process.env.CI ? 2 : 1,

  // Reporters: keep the human-readable list output in the terminal, the
  // built-in HTML report, and add Allure for rich, shareable reports.
  // Generate the Allure report after a run with:
  //   npx allure generate allure-results --clean -o allure-report
  //   npx allure open allure-report
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
  ],

  // 3. הגדרות בסיסיות לכל בדיקה
  use: {
    // הכתובת של האתר שלך 
    baseURL: FRONTEND_URL,

    // צילום מסך רק כשניסוי נכשל - חוסך מקום ומסדר את הדו"ח
    screenshot: 'only-on-failure',
    
    // Keep traces for any failed test (including retries) so flakes are debuggable.
    trace: 'retain-on-failure',

    headless: true,

    launchOptions: {
      // Slow-mo delay between actions (ms). Override via SLOW_MO env var.
      // Default 0 — no artificial delay. Pagination, network and React
      // render time alone provide plenty of "observation latency" in
      // headed mode. Set SLOW_MO=50 (or higher) when you want to watch a
      // run step-by-step.
      slowMo: Number(process.env.SLOW_MO ?? 0),
    },
    
    // Add longer page load timeout for network requests
    navigationTimeout: 30000,
    
    // Ensure elements are interactive before attempting actions
    actionTimeout: 10000,
  },

  // 4. הגדרת הדפדפנים שה-Agent יפעיל
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Test timeout set to 300 seconds (increased for complex hierarchical operations)
  timeout: 300000,
});