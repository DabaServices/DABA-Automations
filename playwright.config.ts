import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Include all test files in tests folder (e2e, smoke, etc)
  testDir: './tests',
  
  // Match any .spec.ts or .test.ts files in any subdirectory
  testMatch: '**/*.spec.ts', 

  // Disable parallel execution to prevent page/browser closure issues between tests
  fullyParallel: false,

  // Run with only 1 worker (sequential execution)
  workers: 1,

  // 3. הגדרות בסיסיות לכל בדיקה
  use: {
    // הכתובת של האתר שלך 
    baseURL: 'http://162.55.55.124/', 

    // צילום מסך רק כשניסוי נכשל - חוסך מקום ומסדר את הדו"ח
    screenshot: 'only-on-failure',
    
    // מאפשר ל-Agent להקליט את הצעדים שלו לצורך ניתוח שגיאות
    trace: 'on-first-retry',

    headless: true,

    launchOptions: {
      slowMo: 600,
    },
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