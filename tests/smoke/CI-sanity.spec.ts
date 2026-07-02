import { test, expect } from '../../src/fixtures';

// ============ Sanity Test: Always Passes ============
test('sanity_alwaysPass @smoke @no-lock', () => {
  expect(1).toBe(1);
});
