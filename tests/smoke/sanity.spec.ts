import { test, expect } from '@playwright/test';

// ============ Sanity Test: Always Passes ============
test('sanity_alwaysPass @smoke', () => {
  expect(1).toBe(1);
});
