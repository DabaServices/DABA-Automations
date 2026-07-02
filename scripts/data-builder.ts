/**
 * data-builder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates DABA test-data JSON files from the LIVE backend hierarchy
 * (`GET /units/hierarchy`, via `fetchHierarchyUnits`).
 *
 * Modes (`TEST_TYPE` env var):
 *   • REGULAR          → src/testData/regularTestsData.json
 *   • HIERARCHY_CHANGE → src/testData/changeHierarchyData.json
 *   • <unset>          → BOTH
 *
 * Templates (hand-edited, never overwritten):
 *   • src/testData/regularDataTemplate.json
 *   • src/testData/changeHierarchyTemplate.json
 *
 * GLOBAL DISJOINTNESS GUARANTEE
 * ─────────────────────────────
 * Every generated entry "claims" a set of unit IDs:
 *   - the unit it operates on (moved unit / expanded gdud)
 *   - that unit's full set of descendants
 *   - that unit's ancestor chain (the units in `unitsToExpand`)
 *   - the new parent and its ancestor chain (`newHierarchy`)
 *
 * No two entries (across BOTH output files) may have any unit in common.
 * That makes parallel test runs safe: no two tests touch overlapping
 * subtrees, so aggregations / locks / moves can't interfere.
 *
 * Cross-file seeding: when running only ONE mode, the OTHER output file's
 * existing entries are read first and their claims pre-loaded into the
 * reservation set, so the two files stay disjoint even when generated
 * separately.
 *
 * MATERIAL ID (MAKAT) — live-pulled & scattered
 * ──────────────────────────────────────────────
 * Makats are fetched LIVE from the backend on every run (`GET /materials/excel`,
 * via `fetchMakatIds`). The HIERARCHY_CHANGE generator assigns a NEW makat every
 * `MAKAT_GROUP_SIZE` entries (default 10; override via env), so each "band" of
 * entries gets its own private value space. Because the parent-uniqueness
 * reservation is scoped PER MAKAT, two bands can safely reuse the same scarce
 * Pikud (level-1) parents — which is what lets a full 40-slot array fit inside a
 * tree that has only 9 Pikuds. REGULAR entries are read-only on aggregations, so
 * they all keep the single default makat.
 *
 * The templates no longer carry a `materialId` — the builder injects it.
 *
 * Run:
 *   npm run build:data              # both modes
 *   npm run build:data:regular      # REGULAR only
 *   npm run build:data:hierarchy    # HIERARCHY_CHANGE only
 */

import * as fs from 'fs';
import * as path from 'path';
import { request as playwrightRequest } from '@playwright/test';

import {
  fetchHierarchyUnits,
  HierarchyUnit,
} from '../src/api/dynamicHierarchyDiscovery';
import { fetchMakatIds } from '../src/api/dynamicMaterialDiscovery';

// ─── Constants ──────────────────────────────────────────────────────────────

const ROOT_UNIT_ID = 1; // Matkal — system root, dropped from top-down paths.

const TEST_DATA_DIR = path.resolve(__dirname, '../src/testData');

const REGULAR_TEMPLATE = path.join(TEST_DATA_DIR, 'regularDataTemplate.json');
const REGULAR_OUTPUT = path.join(TEST_DATA_DIR, 'regularTestsData.json');
const CHANGE_TEMPLATE = path.join(TEST_DATA_DIR, 'changeHierarchyTemplate.json');
const CHANGE_OUTPUT = path.join(TEST_DATA_DIR, 'changeHierarchyData.json');

const LEVEL_LABEL: Record<number, string> = {
  0: 'Matkal',
  1: 'Pikud',
  2: 'Ugda',
  3: 'Hativa',
  4: 'Gdud',
};

// Slot pattern for HIERARCHY_CHANGE arrays — a 40-scenario permutation matrix
// derived from the live 5-level org tree:
//   Level 0: Matkal (root) · 1: Pikud · 2: Ugda · 3: Hativa · 4: Gdud
//
// MoveKind dimensions:
//   INSIDE     → upward vertical move to a parent ON the unit's ancestor chain
//   OUTSIDE    → upward vertical move to a parent on a DIFFERENT branch
//   HORIZONTAL → re-parent under a DIFFERENT node at the SAME parent level
//   NO_OP      → re-parent onto the unit's CURRENT parent (idempotency probe)
//   TO_ROOT    → re-parent directly under Matkal (level 0)
type MoveKind = 'INSIDE' | 'OUTSIDE' | 'HORIZONTAL' | 'NO_OP' | 'TO_ROOT';

interface SlotSpec {
  unitLevel: number; // 1=Pikud, 2=Ugda, 3=Hativa, 4=Gdud
  kind: MoveKind;
  targetLevel?: number; // Optional explicit target (new-parent) level constraint
}

// Exactly 40 slots: 10 HORIZONTAL · 4 NO_OP · 6 TO_ROOT · 20 vertical.
const HC_SLOT_PATTERN: SlotSpec[] = [
  // ── 10 × HORIZONTAL (sibling-parent swap, same parent level) ─────────────
  { unitLevel: 4, kind: 'HORIZONTAL' }, // Gdud → another Hativa (×4)
  { unitLevel: 4, kind: 'HORIZONTAL' },
  { unitLevel: 4, kind: 'HORIZONTAL' },
  { unitLevel: 4, kind: 'HORIZONTAL' },
  { unitLevel: 3, kind: 'HORIZONTAL' }, // Hativa → another Ugda (×3)
  { unitLevel: 3, kind: 'HORIZONTAL' },
  { unitLevel: 3, kind: 'HORIZONTAL' },
  { unitLevel: 2, kind: 'HORIZONTAL' }, // Ugda → another Pikud (×3)
  { unitLevel: 2, kind: 'HORIZONTAL' },
  { unitLevel: 2, kind: 'HORIZONTAL' },

  // ── 4 × NO_OP (idempotency: one per entity level) ────────────────────────
  { unitLevel: 1, kind: 'NO_OP' }, // Pikud
  { unitLevel: 2, kind: 'NO_OP' }, // Ugda
  { unitLevel: 3, kind: 'NO_OP' }, // Hativa
  { unitLevel: 4, kind: 'NO_OP' }, // Gdud

  // ── 6 × TO_ROOT (re-parent under Matkal) ─────────────────────────────────
  { unitLevel: 4, kind: 'TO_ROOT' }, // Gdud → Matkal (×3)
  { unitLevel: 4, kind: 'TO_ROOT' },
  { unitLevel: 4, kind: 'TO_ROOT' },
  { unitLevel: 3, kind: 'TO_ROOT' }, // Hativa → Matkal (×2)
  { unitLevel: 3, kind: 'TO_ROOT' },
  { unitLevel: 2, kind: 'TO_ROOT' }, // Ugda → Matkal (×1)

  // ── 20 × vertical level-hopping (INSIDE / OUTSIDE) ───────────────────────
  // Gdud (level 4): 4 INSIDE + 6 OUTSIDE
  { unitLevel: 4, kind: 'INSIDE', targetLevel: 2 }, // Gdud → ancestor Ugda
  { unitLevel: 4, kind: 'INSIDE', targetLevel: 1 }, // Gdud → ancestor Pikud
  { unitLevel: 4, kind: 'INSIDE', targetLevel: 2 },
  { unitLevel: 4, kind: 'INSIDE', targetLevel: 1 },
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 3 }, // Gdud → other Hativa
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 2 }, // Gdud → other Ugda
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 1 }, // Gdud → other Pikud
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 3 },
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 2 },
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 1 },
  // Hativa (level 3): 2 INSIDE + 4 OUTSIDE
  { unitLevel: 3, kind: 'INSIDE', targetLevel: 1 }, // Hativa → ancestor Pikud
  { unitLevel: 3, kind: 'INSIDE', targetLevel: 1 },
  { unitLevel: 3, kind: 'OUTSIDE', targetLevel: 2 }, // Hativa → other Ugda
  { unitLevel: 3, kind: 'OUTSIDE', targetLevel: 1 }, // Hativa → other Pikud
  { unitLevel: 3, kind: 'OUTSIDE', targetLevel: 2 },
  { unitLevel: 3, kind: 'OUTSIDE', targetLevel: 1 },
  // Ugda (level 2): 2 OUTSIDE
  { unitLevel: 2, kind: 'OUTSIDE', targetLevel: 1 }, // Ugda → other Pikud
  { unitLevel: 2, kind: 'OUTSIDE', targetLevel: 1 },
  // 2 extra cross-branch hops to round out the 20
  { unitLevel: 4, kind: 'OUTSIDE', targetLevel: 2 },
  { unitLevel: 3, kind: 'OUTSIDE', targetLevel: 2 },
];

// ─── Live hierarchy fetch ───────────────────────────────────────────────────
// The DB changes frequently, so we always fetch the live tree from the
// backend — no on-disk cache.

async function loadLiveTree(): Promise<Map<number, HierarchyUnit>> {
  console.log('[data-builder] Fetching live hierarchy from backend...');
  const ctx = await playwrightRequest.newContext();
  let units: HierarchyUnit[];
  try {
    units = await Promise.race<HierarchyUnit[]>([
      fetchHierarchyUnits(ctx),
      new Promise<HierarchyUnit[]>((_, reject) =>
        setTimeout(() => reject(new Error('Hierarchy fetch timed out (15s)')), 15000)
      ),
    ]);
    console.log(`[data-builder] Fetched ${units.length} units.`);
  } finally {
    await ctx.dispose();
  }

  const byId = new Map<number, HierarchyUnit>();
  for (const u of units) byId.set(u.id, u);
  return byId;
}

// ─── Tree utilities ─────────────────────────────────────────────────────────

interface TreeIndex {
  byId: Map<number, HierarchyUnit>;
  childrenOf: Map<number, number[]>;
}

function buildTreeIndex(byId: Map<number, HierarchyUnit>): TreeIndex {
  const childrenOf = new Map<number, number[]>();
  for (const u of byId.values()) {
    const pid = (u.parent as { id: number } | null | undefined)?.id;
    if (pid == null || pid === u.id) continue;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)!.push(u.id);
  }
  return { byId, childrenOf };
}

/** Walk parent chain up to root. Returns top-down chain including the unit. */
function pathToRoot(unitId: number, idx: TreeIndex): number[] {
  const out: number[] = [];
  let cur = idx.byId.get(unitId);
  for (let i = 0; i < 32 && cur; i++) {
    out.unshift(cur.id);
    const pid = (cur.parent as { id: number } | null | undefined)?.id;
    if (!pid || pid === cur.id) break;
    cur = idx.byId.get(pid);
  }
  return out;
}

/** Top-down path used by tests: root chain with ROOT (Matkal) dropped. */
function topDownPath(unitId: number, idx: TreeIndex): number[] {
  const full = pathToRoot(unitId, idx);
  return full[0] === ROOT_UNIT_ID ? full.slice(1) : full;
}

/** All descendants of a unit (excluding the unit itself). */
function descendantsOf(unitId: number, idx: TreeIndex): number[] {
  const out: number[] = [];
  const stack = [...(idx.childrenOf.get(unitId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const kids = idx.childrenOf.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
}

/** Is `ancestorId` an ancestor of `unitId` (strictly, not equal)? */
function isAncestor(ancestorId: number, unitId: number, idx: TreeIndex): boolean {
  const chain = pathToRoot(unitId, idx);
  return chain.indexOf(ancestorId) >= 0 && ancestorId !== unitId;
}

// ─── Emergency-unit eligibility ─────────────────────────────────────────────
// A unit flagged `isEmergencyUnit === false` has NO gdud breakdown beneath it,
// so the product never exposes an editable value cell for it (its row renders
// disabled). The value-preservation / aggregation tests set and compare cell
// values, so they MUST NOT touch such a unit. We therefore exclude every
// non-emergency unit from the generated data entirely — it may never appear as
// a moved unit, a target parent, a path node (`unitsToExpand` / `newHierarchy`),
// or a claimed unit.

/**
 * True when the backend explicitly marks the unit non-emergency
 * (`isEmergencyUnit === false`). Read leniently: ONLY an explicit `false`
 * excludes a unit, so a single missing/unknown flag can never wipe the tree.
 */
function isNonEmergencyUnit(unit: HierarchyUnit | undefined): boolean {
  return unit?.isEmergencyUnit === false;
}

/**
 * True when `unitId` AND its entire ancestor chain up to the root are all
 * emergency units. Only such units may be referenced by generated data: if any
 * ancestor were non-emergency it would land in a persisted path and the test
 * would try to read/write a value on a value-less (disabled) unit.
 */
function isEmergencyEligible(unitId: number, idx: TreeIndex): boolean {
  for (const id of pathToRoot(unitId, idx)) {
    if (isNonEmergencyUnit(idx.byId.get(id))) return false;
  }
  return true;
}

// ─── Reservation (global pin + per-makat parent set) ────────────────────────
//
// Two distinct reservation scopes, because they protect against two DIFFERENT
// hazards:
//
//   • `pinned` — GLOBAL across every makat. A unit that some entry MOVES
//     (HC `unitToMove`) or a gdud a REGULAR entry exercises is pinned so no
//     other entry can move it. Moving a unit is a STRUCTURAL change to the org
//     tree shared by ALL makats, so this must never depend on the makat.
//
//   • `parentsByMakat` — PER-MAKAT. Two entries may not share an old/new parent
//     ONLY IF they use the SAME makat: each test sets values for its own makat,
//     so two children piled under one parent with the SAME makat corrupt that
//     parent's `Σchildren` for that makat. With DIFFERENT makats the value
//     spaces are independent, so the SAME scarce parent (e.g. one of the 9
//     Pikuds) can be safely reused. This is what lets every 10-slot band — each
//     assigned its own makat — fit inside the live tree.
class Reservations {
  /** Units pinned by being moved (HC) or exercised (REGULAR) — GLOBAL. */
  pinned = new Set<number>();

  /** Per-makat sets of reserved old/new parents (excludes Matkal root). */
  parentsByMakat = new Map<string, Set<number>>();

  /** True when `id` is already moved/exercised by some entry (any makat). */
  isPinned(id: number): boolean {
    return this.pinned.has(id);
  }

  /** Pin a unit so no other entry may move/claim it. */
  pin(id: number): void {
    this.pinned.add(id);
  }

  private parentsFor(makat: string): Set<number> {
    let s = this.parentsByMakat.get(makat);
    if (!s) {
      s = new Set<number>();
      this.parentsByMakat.set(makat, s);
    }
    return s;
  }

  /** True when none of `parents` are already reserved for THIS makat. */
  parentsAvailable(makat: string, parents: Iterable<number>): boolean {
    const s = this.parentsFor(makat);
    for (const p of parents) if (s.has(p)) return false;
    return true;
  }

  /** Reserve `parents` for THIS makat (idempotent). */
  reserveParents(makat: string, parents: Iterable<number>): void {
    const s = this.parentsFor(makat);
    for (const p of parents) s.add(p);
  }
}

/**
 * Claim model — minimal, parallel-safe.
 *
 * Backend concurrency contract (verified against backend code):
 *   • Two reparents into the SAME newParent:    SAFE (per-child rows).
 *   • Two reparents away from the SAME oldParent: SAFE (per-child rows).
 *   • Reads of aggregates during a move:         SAFE (READ COMMITTED;
 *                                                snapshot, may be stale).
 *   • Two reparents of the SAME unit:           NOT SAFE (no row-lock,
 *                                                duplicate-open relations).
 *
 * Therefore the only data-level contention we must prevent is:
 *   (a) Two HC entries moving the SAME unit.
 *   (b) An HC entry moving a unit that a REGULAR entry is also exercising
 *       (otherwise the unit may have moved out from under the REGULAR test
 *       between data-build time and test-run time).
 *
 * Per HC entry — claim:
 *     {unitToMove}                       // can't be reused as moved unit
 *
 * Per REGULAR entry — claim:
 *     {gdud}                             // can't be moved by HC, not picked twice
 *
 * Ancestor / descendant / parent reservation is intentionally OMITTED — the
 * backend's READ COMMITTED isolation makes those reads safe, and per-child
 * row writes make per-parent contention safe.
 */
/**
 * Claim model — path-aware.
 *
 * The cross-entry hazard is: once entry A moves unit X from its current
 * parent to somewhere else, any LATER entry B that has X anywhere on its
 * `unitsToExpand` / `newHierarchy` will fail to find X in its expected
 * location at run time. So we need two disjoint sets, tracked separately
 * from `Reservations` (which guards moved units + per-makat parents):
 *
 *   • movedUnits — every unit that some HC entry will move.
 *   • pathUnits  — every unit appearing in some entry's persisted paths
 *                  (unitsToExpand / newHierarchy) including the unitToMove
 *                  at its leaf positions.
 *
 * Conflict rules (enforced in pickChangeMove / pickNextGdud):
 *   • candidate `unitToMove` must NOT be in `pathUnits`
 *     (otherwise some other test will look for it where it used to be).
 *   • candidate's `unitsToExpand` ∪ `newHierarchy` must NOT intersect
 *     `movedUnits` (otherwise some prior test moved a unit we rely on).
 */

class PathReservations {
  /** Units that some HC entry will move (cannot appear in any other path). */
  movedUnits = new Set<number>();
  /** Units appearing in some entry's persisted paths (cannot be moved later). */
  pathUnits = new Set<number>();

  conflictsWithChange(
    unitToMove: number,
    paths: number[][],
    isNoOp = false
  ): boolean {
    // A NO_OP does NOT relocate the unit, so it being on OTHER entries' paths
    // is harmless — skip the `pathUnits` guard for it. (Without this, every
    // Pikud NO_OP is rejected because its unit sits atop dozens of real moves'
    // paths.) Real moves still respect it.
    if (!isNoOp && this.pathUnits.has(unitToMove)) return true;
    for (const path of paths) {
      for (const u of path) {
        if (this.movedUnits.has(u) && u !== unitToMove) return true;
      }
    }
    return false;
  }

  conflictsWithRegular(paths: number[][]): boolean {
    for (const path of paths) {
      for (const u of path) {
        if (this.movedUnits.has(u)) return true;
      }
    }
    return false;
  }

  commitChange(unitToMove: number, paths: number[][], isNoOp = false): void {
    // Only a REAL move pins the unit into `movedUnits` (so no later entry may
    // rely on it staying put). A NO_OP leaves the unit exactly where it is, so
    // recording it as "moved" would wrongly block every path through it.
    if (!isNoOp) this.movedUnits.add(unitToMove);
    for (const path of paths) for (const u of path) this.pathUnits.add(u);
  }

  commitRegular(paths: number[][]): void {
    for (const path of paths) for (const u of path) this.pathUnits.add(u);
  }
}

/**
 * Parents (old + new) a move reserves WITHIN its makat. Matkal (root) is never
 * reserved — it is every chain's terminus and shared by all moves.
 *
 * Separated from the moved unit (which is pinned GLOBALLY) because parents only
 * conflict when two entries share BOTH a parent AND a makat: each test sets
 * values for its own makat, so two children under one parent with DIFFERENT
 * makats don't corrupt that parent's `Σchildren`. Scoping parents per makat is
 * what lets each 10-slot band reuse the same scarce Pikud parents.
 */
function changeParents(
  newParent: number,
  oldParent?: number
): Set<number> {
  const parents = new Set<number>();
  if (newParent !== ROOT_UNIT_ID) parents.add(newParent);
  if (oldParent != null && oldParent !== ROOT_UNIT_ID) parents.add(oldParent);
  return parents;
}

// ─── Cross-file seeding ─────────────────────────────────────────────────────

/**
 * Pre-load reservations from any existing entries in BOTH output files.
 * This way:
 *  • running only one mode still respects the other file's claims;
 *  • re-running doesn't duplicate (existing entries are kept verbatim).
 */
function seedReservationsFromOutputs(
  reservations: Reservations,
  paths: PathReservations,
  idx: TreeIndex,
  mode: string
): void {
  // CRITICAL: only seed from the file we're NOT about to overwrite. A
  // single-mode rebuild rewrites its own output, so seeding from that same
  // (stale) file would double-book every unit against itself — collapsing a
  // full 118/120 run down to ~87 as freshly-picked units collide with their
  // own previous placements. Skip the file this mode is going to replace.
  const skipFile =
    mode === 'REGULAR'
      ? REGULAR_OUTPUT
      : mode === 'HIERARCHY_CHANGE'
        ? CHANGE_OUTPUT
        : null;

  for (const file of [REGULAR_OUTPUT, CHANGE_OUTPUT]) {
    if (file === skipFile) continue;
    if (!fs.existsSync(file)) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    for (const v of Object.values(data)) {
      if (!Array.isArray(v)) continue;
      for (const e of v as Record<string, unknown>[]) {
        const expand = Array.isArray(e.unitsToExpand)
          ? (e.unitsToExpand as number[]).filter((u) => typeof u === 'number')
          : [];
        const newH = Array.isArray(e.newHierarchy)
          ? (e.newHierarchy as number[]).filter((u) => typeof u === 'number')
          : [];

        if (
          typeof e.unitToMove === 'number' &&
          typeof e.newParentUnit === 'number'
        ) {
          // Hierarchy-change entry
          if (idx.byId.has(e.unitToMove) && idx.byId.has(e.newParentUnit)) {
            const oldP =
              typeof e.oldParentUnit === 'number' ? e.oldParentUnit : undefined;
            // Pin the moved unit globally; reserve its parents under the
            // entry's own makat so re-runs stay disjoint per makat.
            reservations.pin(e.unitToMove);
            const makat =
              typeof e.materialId === 'string' ? e.materialId : DEFAULT_MATERIAL_ID;
            reservations.reserveParents(
              makat,
              changeParents(e.newParentUnit, oldP)
            );
          }
          paths.commitChange(e.unitToMove, [expand, newH]);
          continue;
        }

        if (expand.length > 0) {
          // Regular entry
          const leaf = expand[expand.length - 1];
          if (typeof leaf === 'number' && idx.byId.has(leaf)) {
            reservations.pin(leaf);
          }
          paths.commitRegular([expand]);
        }
      }
    }
  }
}

// ─── Material ID allocation ─────────────────────────────────────────────────
// Makats are pulled LIVE from the backend (`GET /materials/excel`, via
// `fetchMakatIds`). Each HIERARCHY_CHANGE array assigns a NEW makat every
// `MAKAT_GROUP_SIZE` entries (a "band"), so each band has its own private value
// space. Because the parent-uniqueness reservation is scoped per makat, two
// bands can safely reuse the same scarce Pikud parents — which is what lets a
// full 40-slot array fit inside a tree with only 9 Pikuds.
//
// REGULAR entries are read-only on aggregations, so they all keep the single
// default makat for stable, low-diff output.

const DEFAULT_MATERIAL_ID = '000000006';

/** How many consecutive entries share one makat before rotating to the next. */
const MAKAT_GROUP_SIZE = Number(process.env.MAKAT_GROUP_SIZE ?? 10);

/**
 * Allocates makats in fixed-size bands. `bandIndex(i)` maps a 0-based entry
 * index to a makat; the same band index always yields the same makat, so the
 * three HC arrays line up band-for-band (and re-runs are deterministic).
 *
 * Falls back to the single default makat when the live list is unavailable, so
 * the builder still produces output (just with the old single-makat squeeze).
 */
class MakatAllocator {
  private makats: string[];
  private groupSize: number;

  constructor(makats: string[], groupSize: number = MAKAT_GROUP_SIZE) {
    this.makats = makats.length > 0 ? makats : [DEFAULT_MATERIAL_ID];
    this.groupSize = Math.max(1, groupSize);
  }

  /** Number of distinct makats available. */
  get size(): number {
    return this.makats.length;
  }

  /** The default (first) makat — used by REGULAR and as a safe fallback. */
  get default(): string {
    return this.makats[0];
  }

  /** Makat for the band containing 0-based entry index `i` (wraps if needed). */
  forIndex(i: number): string {
    const band = Math.floor(i / this.groupSize);
    return this.makats[band % this.makats.length];
  }
}

// ─── Template / output IO ───────────────────────────────────────────────────

function readJson(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf-8').trim();
  return raw ? JSON.parse(raw) : {};
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`[data-builder] Wrote ${path.relative(process.cwd(), file)}`);
}

// ─── REGULAR generation ─────────────────────────────────────────────────────

interface RegularTemplateEntry {
  materialId?: string;
  description?: string;
  numDataObject?: number;
  testValue?: number;
  commentText?: string;
  rowIndex?: number;
  index?: number;
}

function pickGdudLevel(idx: TreeIndex): number {
  let maxLvl = 1;
  for (const u of idx.byId.values()) {
    if (typeof u.level === 'number' && u.level > maxLvl) maxLvl = u.level;
  }
  return maxLvl;
}

/** Pick the next unclaimed gdud (deepest level). */
function pickNextGdud(
  idx: TreeIndex,
  reservations: Reservations,
  paths: PathReservations,
  alreadyPicked: Set<number>,
  gdudLevel: number
): number | null {
  for (const u of idx.byId.values()) {
    if (u.level !== gdudLevel) continue;
    if (alreadyPicked.has(u.id)) continue;
    // Skip non-emergency units (and any unit whose ancestor chain contains
    // one): they have no gdud breakdown, so their value cells are disabled and
    // the value-based tests can't set/read them.
    if (!isEmergencyEligible(u.id, idx)) continue;
    // A gdud REGULAR exercises must not be one any entry will MOVE.
    if (reservations.isPinned(u.id)) continue;
    const expandPath = topDownPath(u.id, idx);
    if (paths.conflictsWithRegular([expandPath])) continue;
    reservations.pin(u.id);
    paths.commitRegular([expandPath]);
    alreadyPicked.add(u.id);
    return u.id;
  }
  return null;
}

function buildRegularEntry(
  template: RegularTemplateEntry,
  gdudId: number,
  idx: TreeIndex,
  makat: string
): Record<string, unknown> {
  const expandPath = topDownPath(gdudId, idx);
  const lvl = idx.byId.get(gdudId)!.level as number;
  const out: Record<string, unknown> = {
    ...template, // carry through commentText, testValue, rowIndex, index, etc.
    materialId: makat,
    description: `${template.description ?? 'Test'} [unit ${gdudId} / ${LEVEL_LABEL[lvl] ?? `L${lvl}`}]`,
    unitsToExpand: expandPath,
  };
  delete (out as Record<string, unknown>).numDataObject;
  delete (out as Record<string, unknown>).numDataGenerated;
  return out;
}

function runRegular(
  idx: TreeIndex,
  reservations: Reservations,
  paths: PathReservations,
  makats: MakatAllocator
): void {
  console.log('[data-builder] === REGULAR ===');
  const template = readJson(REGULAR_TEMPLATE);
  const output: Record<string, unknown> = {};
  const gdudLevel = pickGdudLevel(idx);
  const pickedGduds = new Set<number>();
  let totalGenerated = 0;
  let totalSkipped = 0;

  // Carry through scalar settings (e.g. randomDataCount).
  for (const [k, v] of Object.entries(template)) {
    if (!Array.isArray(v)) output[k] = v;
  }

  for (const [arrayKey, arrVal] of Object.entries(template)) {
    if (!Array.isArray(arrVal) || arrVal.length === 0) continue;
    const tmplEntry = arrVal[0] as RegularTemplateEntry;
    const targetCount = tmplEntry.numDataObject;

    // Arrays without numDataObject are unit-independent → pass through on the
    // default makat (read-only, no parent contention).
    if (targetCount == null) {
      output[arrayKey] = (arrVal as RegularTemplateEntry[]).map((e) => ({
        ...e,
        materialId: makats.default,
      }));
      continue;
    }

    const generated: Record<string, unknown>[] = [];
    for (let i = 0; i < targetCount; i++) {
      const g = pickNextGdud(idx, reservations, paths, pickedGduds, gdudLevel);
      if (g == null) {
        console.warn(
          `[data-builder]   ${arrayKey} slot ${i + 1}/${targetCount}: no disjoint gdud available — skipping.`
        );
        totalSkipped += 1;
        continue;
      }
      // REGULAR is read-only on aggregations, so keep every entry on the single
      // default makat for stable, low-diff output.
      generated.push(buildRegularEntry(tmplEntry, g, idx, makats.default));
      totalGenerated += 1;
    }
    output[arrayKey] = generated;
    console.log(
      `[data-builder]   ${arrayKey}: ${generated.length}/${targetCount} entries.`
    );
  }

  writeJson(REGULAR_OUTPUT, output);
  console.log(
    `[data-builder] REGULAR done — generated ${totalGenerated}, skipped ${totalSkipped}, pinned ${reservations.pinned.size} units total.`
  );
}

// ─── HIERARCHY_CHANGE generation ────────────────────────────────────────────

interface ChangeTemplateEntry {
  materialId?: string;
  description?: string;
  hatunit?: number;
}

interface ChangeMove {
  unitToMove: number;
  oldParent: number;
  newParent: number;
  kind: MoveKind;
}

/**
 * Lightweight Union-Find used to track which units belong to which
 * "parallel-test component" across all entries generated so far. The
 * picker uses this to prefer moves that join FEWER existing components,
 * which directly maximises the number of independent clusters that
 * `groupByAllComponents` can later emit (= more parallel workers).
 */
class UF {
  parent = new Map<number, number>();
  size = new Map<number, number>();
  ensure(x: number) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.size.set(x, 1);
    }
  }
  find(x: number): number {
    this.ensure(x);
    let r = x;
    while (this.parent.get(r)! !== r) r = this.parent.get(r)!;
    let cur = x;
    while (this.parent.get(cur)! !== r) {
      const nxt = this.parent.get(cur)!;
      this.parent.set(cur, r);
      cur = nxt;
    }
    return r;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const sa = this.size.get(ra)!;
    const sb = this.size.get(rb)!;
    if (sa < sb) {
      this.parent.set(ra, rb);
      this.size.set(rb, sa + sb);
    } else {
      this.parent.set(rb, ra);
      this.size.set(ra, sa + sb);
    }
  }
  /** Distinct existing-component roots touched by `units`, plus their total size. */
  inspect(units: Iterable<number>): { roots: Set<number>; totalSize: number } {
    const roots = new Set<number>();
    let totalSize = 0;
    for (const u of units) {
      if (!this.parent.has(u)) continue;
      const r = this.find(u);
      if (!roots.has(r)) {
        roots.add(r);
        totalSize += this.size.get(r)!;
      }
    }
    return { roots, totalSize };
  }
  commit(units: number[]) {
    if (units.length === 0) return;
    units.forEach((u) => this.ensure(u));
    for (let i = 1; i < units.length; i++) this.union(units[0], units[i]);
  }
}

// ─── Write-set model (MUST mirror the consumer's clustering) ────────────────
// The test runner clusters entries with `groupByWriteSetComponents`
// (src/fixtures/parallelGroups.ts). Two entries are forced into the SAME
// serial cluster when either:
//   (a) their `claimedUnits` write-sets overlap, OR
//   (b) both mutate the system root's child set (move to/from Matkal=1) — all
//       such entries are fused via a shared ROOT_MUTATION_TOKEN.
//
// For the builder's parallelism scoring to be MEANINGFUL it must minimise the
// SAME fusion the consumer will later apply. So the picker keys its Union-Find
// on this identical write-set + root token, instead of the weaker
// `oldPath ∪ newPath` it used before.

/** Sentinel UF key shared by every root-child mutator. Real ids are positive,
 *  so a negative sentinel can never collide. Matches the consumer's token. */
const ROOT_MUTATION_TOKEN = -1;

/**
 * Full backend write-set for a move — IDENTICAL to the `claimedUnits` that
 * `buildChangeEntry` persists: the moved unit, its ENTIRE descendant subtree,
 * and BOTH the old- and new-parent chains. The system root (Matkal) is
 * excluded (every chain terminates there; including it would fuse everything).
 */
function writeSetOf(
  unitToMove: number,
  oldParent: number,
  newParent: number,
  idx: TreeIndex
): number[] {
  const set = new Set<number>([
    unitToMove,
    ...descendantsOf(unitToMove, idx),
    ...pathToRoot(oldParent, idx),
    ...pathToRoot(newParent, idx),
  ]);
  set.delete(ROOT_UNIT_ID);
  return [...set];
}

/**
 * Union-Find keys for a move: its full write-set, PLUS the shared root token
 * when the move adds or removes a top-level (root-child) unit. This is exactly
 * what the consumer's `groupByWriteSetComponents` keys on, so the builder's
 * cluster-minimisation now optimises the real run's parallelism.
 */
function ufKeysOf(
  unitToMove: number,
  oldParent: number,
  newParent: number,
  idx: TreeIndex
): number[] {
  const keys = writeSetOf(unitToMove, oldParent, newParent, idx);
  if (oldParent === ROOT_UNIT_ID || newParent === ROOT_UNIT_ID) {
    keys.push(ROOT_MUTATION_TOKEN);
  }
  return keys;
}

/**
 * Find a (unitToMove, newParent) pair satisfying:
 *   • unitToMove.level === slot.unitLevel
 *   • newParent is not a descendant of unitToMove (no cycles)
 *   • the per-kind placement rule (see below)
 *   • the resulting claim is disjoint from existing reservations.
 *
 * Per-kind placement rules:
 *   INSIDE     → newParent.level < unitToMove.level AND newParent !== current
 *                parent AND newParent IS on unitToMove's ancestor chain.
 *   OUTSIDE    → newParent.level < unitToMove.level AND newParent !== current
 *                parent AND newParent is NOT on the ancestor chain.
 *   HORIZONTAL → newParent.level === currentParent.level AND
 *                newParent.id !== currentParent.id (sibling-parent swap).
 *   NO_OP      → newParent.id === currentParent.id (idempotency probe);
 *                the unique-parent guard is intentionally bypassed.
 *   TO_ROOT    → newParent.level === 0 (Matkal).
 *   When slot.targetLevel is set, newParent.level must equal it (ignored for
 *   NO_OP / TO_ROOT, whose target level is implied by the rule itself).
 *
 * Parallelism guard: every variant still strictly respects the global
 * `reservations` + `paths` logic, so parallel test runs never collide.
 *
 * Scoring (lower = better):
 *   1. mergedComponents — how many existing parallel-clusters this entry
 *      would fuse together. 0 means a brand-new cluster (best); >1 means
 *      this entry bridges previously-independent components (worst).
 *   2. mergedSize       — total size of components being fused (tiebreak).
 *   3. topUsage         — spread top Pikuds evenly (legacy heuristic).
 *   4. matkalPenalty    — discourage Matkal as destination unless needed.
 */
function pickChangeMove(
  slot: SlotSpec,
  idx: TreeIndex,
  reservations: Reservations,
  paths: PathReservations,
  topUsage: Map<number, number>,
  uf: UF,
  makat: string
): ChangeMove | null {
  type Candidate = {
    unit: HierarchyUnit;
    cand: HierarchyUnit;
    oldParent: number;
    oldPath: number[];
    newPath: number[];
    mergedComponents: number;
    mergedSize: number;
    score: number;
  };

  const candidates: Candidate[] = [];

  for (const unit of idx.byId.values()) {
    if (unit.level !== slot.unitLevel) continue;
    const oldParent = (unit.parent as { id: number } | null | undefined)?.id;
    if (oldParent == null) continue;
    // The moved unit (and its whole ancestor chain → its `unitsToExpand`
    // path) must be all-emergency. A non-emergency unit has no gdud
    // breakdown, so its value cell renders disabled and the value-based
    // tests can't set/read it.
    if (!isEmergencyEligible(unit.id, idx)) continue;

    const ancestorChain = pathToRoot(unit.id, idx); // top-down inc. self
    const ancestorsOnly = new Set(ancestorChain.slice(0, -1)); // exclude self
    const oldParentLevel = idx.byId.get(oldParent)?.level;

    for (const cand of idx.byId.values()) {
      if (cand.id === unit.id) continue;
      if (isAncestor(unit.id, cand.id, idx)) continue; // cycle guard (always on)
      // The new parent (and its ancestor chain → the `newHierarchy` path)
      // must likewise be all-emergency, so the relocated unit lands under a
      // value-bearing branch.
      if (!isEmergencyEligible(cand.id, idx)) continue;

      // ── Per-kind placement rules ─────────────────────────────────────────
      // The legacy baseline guards (`cand.level < unit.level` and
      // `cand.id !== oldParent`) only hold for the vertical kinds; the new
      // kinds relax or invert them as documented above.
      const onAncestorChain = ancestorsOnly.has(cand.id);
      switch (slot.kind) {
        case 'INSIDE':
          if (cand.level >= unit.level) continue; // upward only
          if (cand.id === oldParent) continue; // must actually move
          if (!onAncestorChain) continue; // stay on own lineage
          break;
        case 'OUTSIDE':
          if (cand.level >= unit.level) continue; // upward only
          if (cand.id === oldParent) continue; // must actually move
          if (onAncestorChain) continue; // cross-branch only
          break;
        case 'HORIZONTAL':
          if (oldParentLevel == null) continue;
          if (cand.level !== oldParentLevel) continue; // same parent level
          if (cand.id === oldParent) continue; // different parent node
          break;
        case 'NO_OP':
          // Idempotency probe: force the unit's CURRENT parent. The unique
          // parent guard is intentionally bypassed (we WANT cand === oldParent).
          if (cand.id !== oldParent) continue;
          break;
        case 'TO_ROOT':
          if (cand.level !== 0) continue; // target Matkal directly
          break;
      }

      // Optional explicit target-level constraint (applies to the kinds that
      // can vary their destination level; NO_OP / TO_ROOT fix it implicitly).
      if (
        slot.targetLevel != null &&
        slot.kind !== 'NO_OP' &&
        slot.kind !== 'TO_ROOT' &&
        cand.level !== slot.targetLevel
      ) {
        continue;
      }

      // Parallelism guard: newParent must not be a unit that is itself being
      // MOVED by another entry (parenting under something in flux). This is a
      // STRUCTURAL hazard, so it is checked against the GLOBAL pin set,
      // independent of makat. NO_OP is exempt — its "newParent" is the unit's
      // own current parent, which the backend's per-child write model already
      // makes race-safe.
      if (slot.kind !== 'NO_OP' && reservations.isPinned(cand.id)) continue;

      // The moved unit itself must not already be moved/exercised by anyone —
      // this applies to NO_OP too. A NO_OP asserts the unit STAYS under its
      // current parent, so if any OTHER entry (e.g. a HORIZONTAL) also moves
      // that same unit, the NO_OP's precondition is destroyed at run time
      // (the unit is no longer where it started). Pinning is what prevents a
      // unit being claimed by both a real move AND a NO_OP. (NO_OP is still
      // exempt from the PATH-occupancy check below, since it doesn't relocate
      // the unit — that exemption is what fixed the original Pikud NO_OP skips.)
      if (reservations.isPinned(unit.id)) continue;

      // Parent-uniqueness, scoped PER MAKAT: two entries may share an old/new
      // parent only if they use DIFFERENT makats (independent value spaces).
      // NO_OP intentionally reuses the unit's current parent, so it is exempt.
      if (slot.kind !== 'NO_OP') {
        const parents = changeParents(cand.id, oldParent);
        if (!reservations.parentsAvailable(makat, parents)) continue;
      }

      // Path-disjointness: the moved unit can't already appear on someone
      // else's path, and our two paths can't contain anyone already moved.
      const oldPath = topDownPath(unit.id, idx);
      const newParentPath =
        cand.id === ROOT_UNIT_ID ? [] : topDownPath(cand.id, idx);
      const newPath = [...newParentPath, unit.id];
      if (paths.conflictsWithChange(unit.id, [oldPath, newPath], slot.kind === 'NO_OP'))
        continue;

      // ── Score 1: how many existing parallel-clusters this entry would
      // fuse. The aim is to keep clusters small and numerous. We inspect the
      // FULL write-set + root token (exactly what the consumer fuses on), not
      // just the explicit paths — otherwise the builder would minimise a
      // weaker overlap than the one that actually serialises tests at run time.
      const touched = new Set<number>(
        ufKeysOf(unit.id, oldParent, cand.id, idx)
      );
      const { roots, totalSize } = uf.inspect(touched);

      // ── Score 2: legacy top-Pikud spread (kept as a secondary signal).
      const oldTop = oldPath[0];
      const newTop = newPath[0];
      const oldCount = topUsage.get(oldTop) ?? 0;
      const newCount = topUsage.get(newTop) ?? 0;
      const matkalPenalty = cand.id === ROOT_UNIT_ID ? 2 : 0;
      const score = oldCount + newCount + matkalPenalty;

      candidates.push({
        unit,
        cand,
        oldParent,
        oldPath,
        newPath,
        mergedComponents: roots.size,
        mergedSize: totalSize,
        score,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort: fewest-merged-components first, then smallest-merged-size,
  // then Pikud spread, then deterministic ids.
  candidates.sort((a, b) => {
    if (a.mergedComponents !== b.mergedComponents)
      return a.mergedComponents - b.mergedComponents;
    if (a.mergedSize !== b.mergedSize) return a.mergedSize - b.mergedSize;
    if (a.score !== b.score) return a.score - b.score;
    if (a.unit.id !== b.unit.id) return a.unit.id - b.unit.id;
    return a.cand.id - b.cand.id;
  });

  const pick = candidates[0];

  // ALWAYS pin the chosen unit — including a NO_OP. A NO_OP probe asserts the
  // unit stays under its current parent, so no OTHER entry may move it; pinning
  // guarantees that (a real move and a NO_OP can never share a unit). A NO_OP
  // still does NOT reserve parents (it changes no parent's child set) and is
  // exempt from the path-occupancy commit (it doesn't relocate the unit), which
  // is what keeps the scarce Pikud NO_OP slots fillable.
  const isNoOp = slot.kind === 'NO_OP';
  reservations.pin(pick.unit.id);
  if (!isNoOp) {
    reservations.reserveParents(
      makat,
      changeParents(pick.cand.id, pick.oldParent)
    );
  }
  paths.commitChange(pick.unit.id, [pick.oldPath, pick.newPath], isNoOp);
  topUsage.set(pick.oldPath[0], (topUsage.get(pick.oldPath[0]) ?? 0) + 1);
  topUsage.set(pick.newPath[0], (topUsage.get(pick.newPath[0]) ?? 0) + 1);
  // Commit the SAME write-set + root token the consumer will fuse on, so the
  // next pick's `mergedComponents` score reflects the real run-time clustering.
  uf.commit(ufKeysOf(pick.unit.id, pick.oldParent, pick.cand.id, idx));

  return {
    unitToMove: pick.unit.id,
    oldParent: pick.oldParent,
    newParent: pick.cand.id,
    kind: slot.kind,
  };
}

function buildChangeEntry(
  template: ChangeTemplateEntry,
  move: ChangeMove,
  idx: TreeIndex,
  makat: string
): Record<string, unknown> {
  const unitsToExpand = topDownPath(move.unitToMove, idx);
  const newParentPath =
    move.newParent === ROOT_UNIT_ID ? [] : topDownPath(move.newParent, idx);
  const newHierarchy = [...newParentPath, move.unitToMove];

  const unitLabel = LEVEL_LABEL[idx.byId.get(move.unitToMove)!.level as number] ?? '?';
  const oldLabel = LEVEL_LABEL[idx.byId.get(move.oldParent)!.level as number] ?? '?';
  const newLabel = LEVEL_LABEL[idx.byId.get(move.newParent)!.level as number] ?? '?';

  // ── Full backend write-set for parallel-safe clustering ──────────────────
  // A move makes the backend read/write FAR more rows than the explicit
  // `unitsToExpand` / `newHierarchy` path units: the moved unit drags its
  // ENTIRE descendant subtree with it, and aggregation re-sums BOTH the old-
  // and new-parent chains. Two entries whose write-sets overlap MUST run
  // serially, so we emit the union here and the clusterer keys on it.
  //
  // The system ROOT (Matkal) is deliberately EXCLUDED: every chain terminates
  // at the root, so including it would fuse every entry into one giant serial
  // cluster and destroy parallelism. Root-CHILD mutations (moves in/out of the
  // root) are serialized separately by the clusterer via `oldParentUnit` /
  // `newParentUnit`, not by unioning the root here.
  const claimedSet = new Set<number>([
    move.unitToMove,
    ...descendantsOf(move.unitToMove, idx),
    ...pathToRoot(move.oldParent, idx),
    ...pathToRoot(move.newParent, idx),
  ]);
  claimedSet.delete(ROOT_UNIT_ID);
  const claimedUnits = [...claimedSet].sort((a, b) => a - b);

  return {
    materialId: makat,
    description: `${template.description ?? 'Move'} - Move ${unitLabel}(${move.unitToMove}) from ${oldLabel}(${move.oldParent}) to ${newLabel}(${move.newParent}) [${move.kind}]`,
    hatunit: template.hatunit ?? 1,
    unitsToExpand,
    newHierarchy,
    unitToMove: move.unitToMove,
    newParentUnit: move.newParent,
    oldParentUnit: move.oldParent,
    claimedUnits,
  };
}

/** Count how many live units exist at each level (for pre-flight guardrails). */
function countUnitsByLevel(idx: TreeIndex): Map<number, number> {
  const counts = new Map<number, number>();
  for (const u of idx.byId.values()) {
    if (typeof u.level === 'number') {
      // Only emergency-eligible units can ever be selected, so the pre-flight
      // feasibility check must count from that same pool — otherwise it could
      // green-light a slot the picker then silently skips for lack of an
      // emergency candidate.
      if (!isEmergencyEligible(u.id, idx)) continue;
      counts.set(u.level, (counts.get(u.level) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Pre-flight structural feasibility check for a single slot against the LIVE
 * tree, independent of reservation pressure. Throws a descriptive error if the
 * backend hierarchy simply can't host the slot's movement shape — e.g. a
 * HORIZONTAL move needs ≥2 distinct same-level parents, so a tree with a single
 * Pikud can't host a horizontal Ugda swap.
 *
 * (Running OUT of nodes mid-build due to reservations is a separate, softer
 * condition handled by the per-slot skip in the generation loop.)
 */
function assertSlotFeasible(
  slot: SlotSpec,
  index: number,
  counts: Map<number, number>
): void {
  const at = (lvl: number): number => counts.get(lvl) ?? 0;
  const fail = (entityLevel: number): never => {
    const entity = LEVEL_LABEL[entityLevel] ?? `L${entityLevel}`;
    throw new Error(
      `Data Generation Failed: Insufficient live seed data to satisfy slot ${index}. ` +
        `Missing unique ${entity} nodes.`
    );
  };

  // Every slot needs at least one unit at its own level to move.
  if (at(slot.unitLevel) < 1) fail(slot.unitLevel);

  switch (slot.kind) {
    case 'HORIZONTAL': {
      // Need ≥2 distinct parents at the parent level (L-1) to swap between.
      const parentLevel = slot.unitLevel - 1;
      if (at(parentLevel) < 2) fail(parentLevel);
      break;
    }
    case 'OUTSIDE': {
      // Need ≥2 nodes at the destination level so at least one is OFF the
      // unit's own ancestor chain (a genuine cross-branch target).
      const target = slot.targetLevel ?? slot.unitLevel - 1;
      if (at(target) < 2) fail(target);
      break;
    }
    case 'INSIDE': {
      // Need the ancestor destination level to exist above the unit.
      const target = slot.targetLevel ?? slot.unitLevel - 1;
      if (at(target) < 1) fail(target);
      break;
    }
    case 'TO_ROOT': {
      // Need the Matkal root (level 0) present as a destination.
      if (at(0) < 1) fail(0);
      break;
    }
    case 'NO_OP':
      // Only needs the unit itself (already checked); its current parent is
      // guaranteed to exist for any non-root node.
      break;
  }
}

function runHierarchyChange(
  idx: TreeIndex,
  reservations: Reservations,
  paths: PathReservations,
  makats: MakatAllocator
): void {
  console.log('[data-builder] === HIERARCHY_CHANGE ===');
  const template = readJson(CHANGE_TEMPLATE);
  const output: Record<string, unknown> = {};

  let totalGenerated = 0;
  let totalSkipped = 0;

  // Makat banding: assign a NEW makat every `MAKAT_GROUP_SIZE` slots, and give
  // each of the three arrays its OWN disjoint block of makats so two arrays
  // never share one. Parent-uniqueness is scoped per makat, so:
  //   • within an array, each 10-slot band reuses the scarce Pikud parents
  //     freely (its own makat), and
  //   • across arrays, no makat is shared, so their parent reservations never
  //     collide either.
  // This is what lets every array fill all 40 slots on a tree with only 9
  // Pikuds. `bandsPerArray * MAKAT_GROUP_SIZE` is the per-array index stride so
  // `makats.forIndex` maps (array, slot) → a globally unique band.
  const bandsPerArray = Math.ceil(HC_SLOT_PATTERN.length / MAKAT_GROUP_SIZE);
  const makatForSlot = (arrayIndex: number, slotIndex: number): string =>
    makats.forIndex(arrayIndex * bandsPerArray * MAKAT_GROUP_SIZE + slotIndex);

  // Track how often each top-of-path Pikud has been used. The picker uses
  // this to spread moves evenly across all Pikuds (instead of repeatedly
  // funnelling through Pikud(2)/Pikud(3)/Matkal). Shared across all three
  // HC arrays so the spreading is global.
  const topUsage = new Map<number, number>();
  for (const u of paths.pathUnits) {
    // Heuristic seeding: any unit already on someone's path counts once.
    topUsage.set(u, (topUsage.get(u) ?? 0) + 1);
  }

  // Component tracker: each generated entry's full path-union becomes a
  // single connected component; the picker minimises cluster-fusion across
  // entries. Seed from any pre-existing path units so re-runs respect
  // prior structure.
  const uf = new UF();
  if (paths.pathUnits.size > 0) {
    // We don't know which seed units belonged together, so be conservative
    // and treat each as its own singleton component (best case: no fusion
    // beyond what new entries cause).
    for (const u of paths.pathUnits) uf.ensure(u);
  }

  // ── Pre-flight data guardrail ────────────────────────────────────────────
  // Validate the LIVE tree can structurally host every slot in the 40-slot
  // matrix BEFORE generating anything. Fails fast with a descriptive error if
  // the seed hierarchy lacks enough unique entities/branches for a slot.
  const levelCounts = countUnitsByLevel(idx);
  for (let i = 0; i < HC_SLOT_PATTERN.length; i++) {
    assertSlotFeasible(HC_SLOT_PATTERN[i], i, levelCounts);
  }

  for (const [arrayIndex, [arrayKey, arrVal]] of Object.entries(
    template
  ).entries()) {
    if (!Array.isArray(arrVal) || arrVal.length === 0) {
      output[arrayKey] = arrVal;
      continue;
    }
    const tmplEntry = arrVal[0] as ChangeTemplateEntry;
    const generated: Record<string, unknown>[] = [];

    // ── Slot processing order: ROOT MOVES FIRST, NO_OP LAST ──────────────────
    // 1. TO_ROOT (and other root-child) moves are fused into ONE serial cluster
    //    by the consumer regardless of what else we pick. Committing their full
    //    write-sets to the UF *first* lets the `mergedComponents` score steer
    //    every later pick AWAY from the root moves' subtrees, keeping the
    //    non-root entries in small, independent (parallel) clusters.
    // 2. NO_OP slots are processed LAST. A NO_OP now pins its unit (so no real
    //    move can later relocate a unit a NO_OP probes — the same-parent
    //    assertion depends on it). Picking NO_OP units AFTER every real move has
    //    claimed its own unit means NO_OP draws from the leftover pool instead
    //    of competing for the scarce units the real moves need.
    // Output is still emitted in the original slot order for readability.
    const rank = (k: MoveKind): number =>
      k === 'TO_ROOT' ? 0 : k === 'NO_OP' ? 2 : 1;
    const order = HC_SLOT_PATTERN.map((_, i) => i).sort((a, b) => {
      const ra = rank(HC_SLOT_PATTERN[a].kind);
      const rb = rank(HC_SLOT_PATTERN[b].kind);
      return ra !== rb ? ra - rb : a - b;
    });
    const bySlot: (Record<string, unknown> | null)[] = HC_SLOT_PATTERN.map(
      () => null
    );

    for (const i of order) {
      const slot = HC_SLOT_PATTERN[i];
      // Makat for THIS slot's band — same band index across all three arrays
      // would collide on parents, so each array uses its own makat block (see
      // `makatForSlot`). The makat scopes the parent reservation in the picker.
      const makat = makatForSlot(arrayIndex, i);
      const move = pickChangeMove(
        slot,
        idx,
        reservations,
        paths,
        topUsage,
        uf,
        makat
      );
      if (!move) {
        console.warn(
          `[data-builder]   ${arrayKey} slot ${i + 1} (${LEVEL_LABEL[slot.unitLevel]} ${slot.kind}): no candidate — skipping.`
        );
        totalSkipped += 1;
        continue;
      }
      bySlot[i] = buildChangeEntry(tmplEntry, move, idx, makat);
      totalGenerated += 1;
    }
    // Emit in original slot order, dropping skipped slots.
    for (const entry of bySlot) if (entry) generated.push(entry);
    output[arrayKey] = generated;
    console.log(
      `[data-builder]   ${arrayKey}: ${generated.length}/${HC_SLOT_PATTERN.length} entries.`
    );
  }

  writeJson(CHANGE_OUTPUT, output);
  console.log(
    `[data-builder] HIERARCHY_CHANGE done — generated ${totalGenerated}, skipped ${totalSkipped}, pinned ${reservations.pinned.size} units, ${reservations.parentsByMakat.size} makat(s) used.`
  );
}

// ─── Live makat discovery ───────────────────────────────────────────────────

/**
 * Pull the live list of usable makats from the backend (`GET /materials/excel`).
 * The existing default makat is moved to the FRONT so REGULAR (and the first HC
 * band) keep using it — minimising churn in the generated output. Falls back to
 * the single default makat if the endpoint is unavailable.
 */
async function loadLiveMakats(): Promise<string[]> {
  console.log('[data-builder] Fetching live makats from backend...');
  const ctx = await playwrightRequest.newContext();
  try {
    const ids = await Promise.race<string[]>([
      fetchMakatIds(ctx, DEFAULT_MATERIAL_ID),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('Makat fetch timed out (15s)')), 15000)
      ),
    ]);
    console.log(
      `[data-builder] Fetched ${ids.length} usable makats (group size ${MAKAT_GROUP_SIZE}).`
    );
    return ids;
  } catch (err) {
    console.warn(
      `[data-builder] Makat fetch failed (${String((err as Error)?.message ?? err).slice(0, 120)}); ` +
        `falling back to single default makat ${DEFAULT_MATERIAL_ID}.`
    );
    return [DEFAULT_MATERIAL_ID];
  } finally {
    await ctx.dispose();
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  const mode = (process.env.TEST_TYPE || '').toUpperCase();
  console.log(`[data-builder] Starting (TEST_TYPE="${mode || '(both)'}")`);

  const byId = await loadLiveTree();
  const idx = buildTreeIndex(byId);
  console.log(`[data-builder] Indexed ${byId.size} units.`);

  const reservations = new Reservations();
  const paths = new PathReservations();

  // When generating only one mode, seed from the OTHER file's existing
  // entries so the two stay disjoint. When generating both, we start clean.
  if (mode === 'REGULAR' || mode === 'HIERARCHY_CHANGE') {
    seedReservationsFromOutputs(reservations, paths, idx, mode);
    if (reservations.pinned.size > 0 || paths.movedUnits.size > 0) {
      console.log(
        `[data-builder] Pre-seeded ${reservations.pinned.size} pinned units and ` +
          `${paths.movedUnits.size} moved-units / ${paths.pathUnits.size} path-units from existing outputs.`
      );
    }
  }

  const makats = new MakatAllocator(await loadLiveMakats());

  switch (mode) {
    case 'REGULAR':
      runRegular(idx, reservations, paths, makats);
      break;
    case 'HIERARCHY_CHANGE':
      runHierarchyChange(idx, reservations, paths, makats);
      break;
    case '':
      // REGULAR is cheap (8 entries × short chains) and entirely read-only,
      // so let it grab a few small disjoint chains first. HC then fills
      // around the reservations, packing the 40-slot matrix into the
      // (still large) unclaimed portion of the tree.
      runRegular(idx, reservations, paths, makats);
      runHierarchyChange(idx, reservations, paths, makats);
      break;
    default:
      throw new Error(
        `[data-builder] Unknown TEST_TYPE="${process.env.TEST_TYPE}". ` +
          `Expected REGULAR or HIERARCHY_CHANGE.`
      );
  }

  console.log(`[data-builder] Done in ${((Date.now() - t0) / 1000).toFixed(2)}s.`);
}

main().catch((err) => {
  console.error('[data-builder] FAILED:', err);
  process.exit(1);
});
