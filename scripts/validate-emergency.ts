/**
 * validate-emergency.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-off guard: verifies that NO generated test-data entry references a unit
 * the live backend marks `isEmergencyUnit === false`.
 *
 * Such units have no gdud breakdown, so the product renders their value cells
 * disabled and the value-based tests can't set/read them. They must never
 * appear as a moved unit, a parent, a path node, or a claimed unit.
 *
 * Run: tsx scripts/validate-emergency.ts
 * Exit code 1 (and a per-entry report) if any violation is found.
 */

import * as fs from 'fs';
import * as path from 'path';
import { request as playwrightRequest } from '@playwright/test';
import { fetchHierarchyUnits } from '../src/api/dynamicHierarchyDiscovery';

const TEST_DATA_DIR = path.resolve(__dirname, '../src/testData');
const FILES = ['changeHierarchyData.json', 'regularTestsData.json'];

const PATH_FIELDS = ['unitsToExpand', 'newHierarchy', 'claimedUnits'];
const SCALAR_FIELDS = ['unitToMove', 'newParentUnit', 'oldParentUnit'];

async function main(): Promise<void> {
  const ctx = await playwrightRequest.newContext();
  let nonEmergency: Set<number>;
  try {
    const units = await fetchHierarchyUnits(ctx);
    nonEmergency = new Set(
      units.filter((u) => u.isEmergencyUnit === false).map((u) => u.id),
    );
    console.log(
      `[validate] Live tree: ${units.length} units, ${nonEmergency.size} non-emergency.`,
    );
  } finally {
    await ctx.dispose();
  }

  let violations = 0;

  for (const file of FILES) {
    const full = path.join(TEST_DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;

    for (const [arrayKey, arr] of Object.entries(data)) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr as Record<string, unknown>[]) {
        const offending = new Set<number>();

        for (const f of SCALAR_FIELDS) {
          const v = entry[f];
          if (typeof v === 'number' && nonEmergency.has(v)) offending.add(v);
        }
        for (const f of PATH_FIELDS) {
          const v = entry[f];
          if (Array.isArray(v)) {
            for (const id of v) if (typeof id === 'number' && nonEmergency.has(id)) offending.add(id);
          }
        }

        if (offending.size > 0) {
          violations += 1;
          console.error(
            `✗ [${file} → ${arrayKey}] "${entry.description ?? '(no description)'}" ` +
              `references non-emergency unit(s): [${[...offending].sort((a, b) => a - b).join(', ')}]`,
          );
        }
      }
    }
    console.log(`[validate] Checked ${file}.`);
  }

  if (violations > 0) {
    console.error(`\n[validate] FAILED — ${violations} entry(ies) reference non-emergency units.`);
    process.exit(1);
  }
  console.log('\n[validate] ✓ PASSED — no generated entry references a non-emergency unit.');
}

main().catch((err) => {
  console.error('[validate] FAILED:', err);
  process.exit(1);
});
