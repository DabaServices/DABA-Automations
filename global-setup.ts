import { chromium, FullConfig } from '@playwright/test';

/**
 * Global warm-up: opens the app once before the suite starts so the very
 * first real test isn't racing the cold-start render of the Makat combobox.
 *
 * Without this, the first test in a fresh run frequently fails with a
 * 30s timeout on `getByRole('combobox', { name: /בחירת מק״ט/ })` because
 * the React tree is still mounting after the initial data fetch.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use?.baseURL || 'http://localhost:5173/';

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    console.info(`[globalSetup] Warming up app at ${baseURL}…`);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Wait until the combobox is actually present so we know the SPA finished
    // its first render. Long timeout because the very first cold start is slow.
    await page
      .getByRole('combobox', { name: /בחירת מק״ט/ })
      .waitFor({ state: 'visible', timeout: 60_000 })
      .catch((err) => {
        console.warn(
          `[globalSetup] Combobox not visible during warm-up (continuing): ${err}`
        );
      });

    console.info('[globalSetup] Warm-up complete.');
  } finally {
    await browser.close();
  }
}
