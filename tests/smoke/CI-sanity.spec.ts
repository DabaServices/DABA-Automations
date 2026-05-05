import { test, expect } from '../../src/fixtures';
import { unlockCompleteHierarchy, lockCompleteHierarchy } from '../../src/api/apiHelpers';
import { updateUnitHierarchy } from '../../src/api/hierarchychange';
import {
  fetchHierarchyUnits,
  selectRandomGdudimWithLineage,
} from '../../src/api/hierarchyHelper';
import smokeData from '../../src/testData/smokeData.json';

// ============ Sanity Test: Always Passes ============
test('sanity_alwaysPass @smoke', () => {
  expect(1).toBe(1);
});

// ============ Sanity Test: Dynamic Hierarchy Helper ============
//
// Proves the new HierarchyHelper works end-to-end against the live backend
// BEFORE we wire it into the global beforeEach hook:
//   1. GET /units/hierarchy returns a non-empty unit list
//   2. There is at least one level-4 "gdud" leaf
//   3. selectRandomGdudimWithLineage picks `randomDataCount` (from smokeData.json)
//      distinct level-4 units and resolves their full lineage [L1 → L2 → L3 → L4]
//
// This test does NOT depend on the beforeEach setup, and uses a raw
// `request` fixture so we can run it in isolation.
test('hierarchyHelper_dynamicDataDiscovery @smoke', async ({ request }) => {
  const count = (smokeData as { randomDataCount?: number }).randomDataCount ?? 1;
  console.info(`[sanity] randomDataCount from smokeData.json = ${count}`);

  // 1. Raw fetch sanity
  const units = await fetchHierarchyUnits(request);
  expect(Array.isArray(units)).toBe(true);
  expect(units.length).toBeGreaterThan(0);

  const gdudim = units.filter((u) => u.level === 4);
  console.info(`[sanity] Found ${gdudim.length} level-4 gdudim in response`);
  expect(gdudim.length).toBeGreaterThanOrEqual(count);

  // 2. Random selection + full lineage resolution
  const lineages = await selectRandomGdudimWithLineage(request, count);
  expect(lineages).toHaveLength(count);

  // All gdud ids must be unique
  const ids = lineages.map((l) => l.gdudId);
  expect(new Set(ids).size).toBe(ids.length);

  for (const lineage of lineages) {
    console.info(`[sanity] gdud ${lineage.gdudId} lineage: [${lineage.path.join(' → ')}]`);

    // Path must contain exactly 4 levels: L1 → L2 → L3 → L4
    expect(lineage.path).toHaveLength(4);

    // The last element of the path is the gdud itself
    expect(lineage.path[lineage.path.length - 1]).toBe(lineage.gdudId);

    // Each ancestor must exist in the response and have the expected level
    const byId = new Map(units.map((u) => [u.id, u]));
    for (let i = 0; i < lineage.path.length; i++) {
      const node = byId.get(lineage.path[i]);
      expect(node, `unit ${lineage.path[i]} should be present in /units/hierarchy`).toBeTruthy();
      expect(node!.level).toBe(i + 1);
    }

    // Parent links between consecutive levels must match
    for (let i = 1; i < lineage.path.length; i++) {
      const child = byId.get(lineage.path[i])!;
      expect(child.parent?.id).toBe(lineage.path[i - 1]);
    }
  }
});

