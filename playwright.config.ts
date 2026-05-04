import { defineConfig, devices } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Centralized URLs for the application under test.
// Override at runtime via environment variables, e.g.:
//   FRONTEND_URL=http://dev.162.55.55.124.nip.io/ npx playwright test
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

  // Disable parallel execution to prevent page/browser closure issues between tests
  fullyParallel: false,

  // Run with only 1 worker (sequential execution)
  workers: 1,

  // Warm up the app once before the suite to eliminate cold-start flakiness
  // on the very first test (the Makat combobox sometimes takes >30s to mount).
  globalSetup: require.resolve('./global-setup'),

  // Allow one retry to absorb transient UI hiccups (component remounts after
  // data fetches, network idle bouncing, etc.). CI gets a second retry.
  retries: process.env.CI ? 2 : 1,

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
      slowMo: 200,  // Increased from 1000ms to 1500ms for better headless rendering
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