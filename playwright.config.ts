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
  // at ~26 tests in its largest cluster spread over ~12 clusters.
  //
  // Capped at 3 locally: the hierarchy carousel is a SHARED UI resource that
  // renders every locked top unit across ALL workers. Too many parallel locks
  // bloat the carousel and push a test's target unit deep into pagination,
  // causing flaky BEFORE-capture timeouts on a loaded backend. 3 keeps the
  // carousel small enough to stay reliable while preserving useful parallelism.
  //
  // Lowered to 2 (from 3): at 3 workers a burst of concurrent heavy flows
  // (makat-add + carousel hierarchy fetch + lock/save) periodically overloaded
  // the backend, which surfaced as `[role="combobox"]` 30s timeouts and
  // "top unit never appeared on the carousel" (the freshly-locked unit was
  // missing from the carousel's hierarchy fetch entirely → "next gone after 0
  // clicks"). Those races caused both the flaky smoke retries and the
  // irreversible-move hard failures. 2 workers keeps the backend responsive
  // enough that the carousel and combobox render first time, while still
  // running clusters in parallel. Override with WORKERS env when needed.
  //
  // LOCAL default also lowered 5 → 2 (2026-06-25): a local 5-worker run hit the
  // exact saturation the CI note above describes — two value-preservation tests
  // hard-failed with "before-capture-incomplete" because their top unit (210, 4)
  // either timed out on hover or dropped off the carousel entirely while the
  // backend was flooded by 5 concurrent makat-add/lock/save flows (note the many
  // `[role="combobox"]` 30s timeouts in that run). Matching CI's proven value of
  // 2 keeps the shared carousel small and the backend responsive. Set WORKERS=5
  // explicitly only when pointed at an isolated/fast backend.
  //
  // LOCAL default re-lowered 4 → 2 (2026-06-30): a 4-worker full run produced 32
  // `[role="combobox"]` / `page.goto` 30s timeouts (all self-recovered, but they
  // bloated wall-time and risked the irreversible-move suite). The backend is a
  // SHARED resource here, so concurrency past 2 just trades reliability for a
  // little speed. 2 is the documented stable value for this backend; raise it
  // only via WORKERS when pointed at an isolated/fast environment.
  fullyParallel: true,
  workers: process.env.WORKERS
    ? Number(process.env.WORKERS)
    : process.env.CI
      ? 2
      : 4,

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
    
    // Add longer page load timeout for network requests. Raised 30s → 60s:
    // under multi-worker load the SPA's initial `page.goto` occasionally took
    // >30s to reach `domcontentloaded`, hard-failing the irreversible-move
    // suite at the pre-move "Add makat" phase. 60s absorbs that slow start.
    navigationTimeout: 60000,
    
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