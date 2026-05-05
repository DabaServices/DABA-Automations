import { APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../../playwright.config';

/**
 * hierarchyHelper.ts
 *
 * Helper utilities for dynamically discovering hierarchy data from the live
 * backend instead of relying on hardcoded unit IDs in test data files.
 *
 * Exported symbols:
 *   - HierarchyUnit                 – the shape of a single unit in the API response
 *   - fetchHierarchyUnits           – GET /units/hierarchy → flat unit list
 *   - selectRandomGdudimWithLineage – pick X random level-4 leaves and return
 *                                     their full lineage paths [L1 → L2 → L3 → L4]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single unit as returned by GET /units/hierarchy. */
export interface HierarchyUnit {
  id: number;
  level: number;
  parent?: { id: number } | null;
  // The API returns more fields (name, etc.) – we only type what we use.
  [key: string]: unknown;
}

/**
 * A full lineage for a "gdud" (level-4 leaf), top → bottom:
 *   path[0] = level-1 unit
 *   path[1] = level-2 unit
 *   path[2] = level-3 unit
 *   path[3] = level-4 unit (the gdud itself)
 */
export interface GdudLineage {
  /** The level-4 unit id (the gdud). */
  gdudId: number;
  /** Ordered ancestors from level 1 down to the gdud (inclusive). */
  path: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

const HIERARCHY_URL = `${BACKEND_URL}/units/hierarchy`;
const DEFAULT_USER = 'S9107544';
const DEFAULT_ROOT_UNIT = '1';

/** YYYY-MM-DD for the screenDate header. */
const todayIso = (): string => new Date().toISOString().split('T')[0];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the full flat list of units from GET /units/hierarchy.
 *
 * Sends the headers required by the backend:
 *   - screenDate : today's date (YYYY-MM-DD) unless overridden
 *   - unit       : root unit id (default: 1)
 *   - user       : default automation user
 *
 * @param request    - Playwright APIRequestContext
 * @param user       - User header value (default: S9107544)
 * @param screenDate - Date header value (default: today)
 * @param rootUnit   - Unit header value (default: 1)
 */
export async function fetchHierarchyUnits(
  request: APIRequestContext,
  user: string = DEFAULT_USER,
  screenDate: string = todayIso(),
  rootUnit: string = DEFAULT_ROOT_UNIT
): Promise<HierarchyUnit[]> {
  const url = `${HIERARCHY_URL}?user=${encodeURIComponent(user)}`;
  const response = await request.get(url, {
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer',
      unit: rootUnit,
      screendate: screenDate,
      user,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `[fetchHierarchyUnits] GET ${url} failed with status ${response.status()}`
    );
  }

  const body = await response.json();
  const units: HierarchyUnit[] = body?.body?.data ?? body?.data ?? [];
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error(`[fetchHierarchyUnits] Hierarchy response contained no units`);
  }
  console.info(`[fetchHierarchyUnits] Fetched ${units.length} units`);
  return units;
}

/**
 * Pick `count` random level-4 leaves ("gdudim") from the live hierarchy and
 * return their full ancestry chains, root → leaf (i.e. [L1, L2, L3, L4]).
 *
 * Steps:
 *   1. Fetch flat unit list via {@link fetchHierarchyUnits}.
 *   2. Filter where `level === 4`.
 *   3. Randomly pick `count` of them (without replacement).
 *   4. For each, walk parent → parent → parent until level 1 is reached.
 *
 * Throws if there aren't enough level-4 units, or if a lineage cannot be
 * fully resolved up to level 1.
 *
 * @param request - Playwright APIRequestContext
 * @param count   - Number of distinct gdudim to return
 */
export async function selectRandomGdudimWithLineage(
  request: APIRequestContext,
  count: number
): Promise<GdudLineage[]> {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`[selectRandomGdudimWithLineage] count must be a positive integer (got ${count})`);
  }

  const units = await fetchHierarchyUnits(request);

  // Build a quick lookup by id
  const byId = new Map<number, HierarchyUnit>();
  for (const u of units) byId.set(u.id, u);

  const gdudim = units.filter((u) => u.level === 4);
  if (gdudim.length < count) {
    throw new Error(
      `[selectRandomGdudimWithLineage] Requested ${count} gdudim but only ${gdudim.length} level-4 units exist`
    );
  }

  // Fisher-Yates shuffle, take first `count`
  const shuffled = [...gdudim];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = shuffled.slice(0, count);

  // Walk parents up to level 1 for each pick
  const lineages: GdudLineage[] = picked.map((leaf) => {
    const path: number[] = [leaf.id];
    let current: HierarchyUnit | undefined = leaf;
    const guard = 10; // sanity stop – levels should never exceed this

    for (let step = 0; step < guard; step++) {
      if (current?.level === 1) break;
      const parentId = current?.parent?.id;
      if (!parentId) {
        throw new Error(
          `[selectRandomGdudimWithLineage] Unit ${current?.id} has no parent but level=${current?.level}`
        );
      }
      const parent = byId.get(parentId);
      if (!parent) {
        throw new Error(
          `[selectRandomGdudimWithLineage] Parent ${parentId} of unit ${current?.id} not found in response`
        );
      }
      path.unshift(parent.id);
      current = parent;
    }

    if (current?.level !== 1) {
      throw new Error(
        `[selectRandomGdudimWithLineage] Could not resolve full lineage for gdud ${leaf.id}`
      );
    }

    return { gdudId: leaf.id, path };
  });

  console.info(
    `[selectRandomGdudimWithLineage] Selected ${lineages.length} gdud lineage(s):\n` +
      lineages.map((l) => `  • ${l.path.join(' → ')}`).join('\n')
  );

  return lineages;
}
