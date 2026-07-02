import { APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../../playwright.config';

/**
 * dynamicMaterialDiscovery.ts
 *
 * Helper to dynamically discover the list of valid makats (materials) from the
 * live backend (`GET /materials/excel`) instead of hardcoding a single makat
 * in the generated test data.
 *
 * Why this matters for the data-builder:
 *   The HIERARCHY_CHANGE aggregation tests require that no two entries SHARING
 *   THE SAME MAKAT also share a parent unit (old or new) — otherwise the
 *   parent's `Σchildren` for that makat mixes two tests' values and the
 *   `parent = Σ(children)` invariant fails. The live tree only has 9 Pikud
 *   (level-1) parents, but a single 40-slot array needs ~19 unique ones. By
 *   assigning DIFFERENT makats to different groups of entries, each group gets
 *   its OWN private value space, so the same scarce parents can be safely
 *   reused across groups. That is what unblocks all 40 slots.
 */

/** A single material as returned by GET /materials/excel. */
export interface Material {
  id: string;
  description?: string;
  unitOfMeasure?: string;
  multiply?: string | number;
  nickname?: string;
  category?: string;
  /** "ITEM" for normal makats, "TOOL" for group/tool rows (excluded). */
  type?: string;
  [key: string]: unknown;
}

const MATERIALS_URL = `${BACKEND_URL}/materials/excel`;
const DEFAULT_USER = 'S9107544';
const DEFAULT_ROOT_UNIT = '1';

/** YYYY-MM-DD for the screenDate header. */
const todayIso = (): string => new Date().toISOString().split('T')[0];

/**
 * Fetch the full list of materials from GET /materials/excel.
 *
 * Sends the same headers the backend expects elsewhere:
 *   - screendate : today's date (YYYY-MM-DD) unless overridden
 *   - username   : default automation user
 *   - unit       : root unit id (default: 1)
 *
 * Retries transient network/5xx errors with exponential backoff.
 */
export async function fetchMaterials(
  request: APIRequestContext,
  user: string = DEFAULT_USER,
  screenDate: string = todayIso(),
  rootUnit: string = DEFAULT_ROOT_UNIT,
): Promise<Material[]> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request.get(MATERIALS_URL, {
        headers: {
          screendate: screenDate,
          username: user,
          unit: rootUnit,
        },
        timeout: 20_000,
      });

      if (!response.ok()) {
        let bodyPreview: string;
        try {
          bodyPreview = JSON.stringify(await response.json()).slice(0, 200);
        } catch {
          bodyPreview = (await response.text().catch(() => '<unreadable body>')).slice(0, 200);
        }
        throw new Error(
          `[fetchMaterials] GET ${MATERIALS_URL} failed with status ${response.status()}. Body: ${bodyPreview}`,
        );
      }

      const body = await response.json();
      const materials: Material[] = body?.body?.data ?? body?.data ?? [];
      if (!Array.isArray(materials) || materials.length === 0) {
        throw new Error(`[fetchMaterials] Materials response contained no items`);
      }
      console.info(`[fetchMaterials] Fetched ${materials.length} materials`);
      return materials;
    } catch (e) {
      lastError = e;
      const msg = String((e as Error)?.message ?? e);
      const isTransient =
        msg.includes('ENOTFOUND') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('socket hang up') ||
        /\b5\d\d\b/.test(msg);
      if (attempt === maxAttempts || !isTransient) throw e;
      const wait = 1000 * attempt; // 1s, 2s, 3s
      console.warn(
        `[fetchMaterials] attempt ${attempt}/${maxAttempts} failed (${msg.slice(0, 120)}); retrying in ${wait}ms…`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

/**
 * Fetch only the usable makat IDs (type === "ITEM"), de-duplicated and in the
 * backend's own order. TOOL/group rows (e.g. "GRP000001") are excluded because
 * they don't render editable value cells.
 *
 * @param preferredFirst  When provided, this makat is moved to the FRONT of the
 *                        list if present (so the existing default makat keeps
 *                        being used first for stable, low-diff output).
 */
export async function fetchMakatIds(
  request: APIRequestContext,
  preferredFirst?: string,
): Promise<string[]> {
  const materials = await fetchMaterials(request);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of materials) {
    if (m.type && m.type !== 'ITEM') continue; // skip TOOL / groups
    if (typeof m.id !== 'string' || m.id.length === 0) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    ids.push(m.id);
  }
  if (preferredFirst && seen.has(preferredFirst)) {
    const rest = ids.filter((id) => id !== preferredFirst);
    return [preferredFirst, ...rest];
  }
  return ids;
}
