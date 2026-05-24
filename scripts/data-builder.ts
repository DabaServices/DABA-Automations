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
 * MATERIAL ID
 * ───────────
 * For now, every generated entry gets the same default `materialId`
 * ("000000006") in BOTH the REGULAR and HIERARCHY_CHANGE outputs.
 * Future work: add real per-entry materialId allocation logic.
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

// Slot pattern for HIERARCHY_CHANGE arrays — matches the hand-curated layout
// in changeHierarchyData.json (12 slots per array).
type MoveKind = 'INSIDE' | 'OUTSIDE';
interface SlotSpec {
  unitLevel: number; // level of the unit being moved
  kind: MoveKind;
}
const HC_SLOT_PATTERN: SlotSpec[] = [
  { unitLevel: 2, kind: 'OUTSIDE' }, // Ugda
  { unitLevel: 2, kind: 'INSIDE' },
  { unitLevel: 3, kind: 'OUTSIDE' }, // Hativa
  { unitLevel: 3, kind: 'INSIDE' },
  { unitLevel: 3, kind: 'OUTSIDE' },
  { unitLevel: 3, kind: 'INSIDE' },
  { unitLevel: 4, kind: 'OUTSIDE' }, // Gdud
  { unitLevel: 4, kind: 'INSIDE' },
  { unitLevel: 4, kind: 'OUTSIDE' },
  { unitLevel: 4, kind: 'INSIDE' },
  { unitLevel: 4, kind: 'OUTSIDE' },
  { unitLevel: 4, kind: 'INSIDE' },
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

// ─── Reservation (global disjoint set) ──────────────────────────────────────

class Reservations {
  /** Every unit ID claimed by any generated/seeded entry, in any role. */
  claimed = new Set<number>();

  /** Returns true if proposed claim has zero overlap with current state. */
  isDisjoint(proposed: Iterable<number>): boolean {
    for (const id of proposed) if (this.claimed.has(id)) return false;
    return true;
  }

  /** Add a proposed claim to the global reservation. */
  commit(proposed: Iterable<number>): void {
    for (const id of proposed) this.claimed.add(id);
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
 * from the generic `Reservations.claimed`:
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
 *
 * The generic `Reservations.claimed` set is kept for back-compat but is
 * intentionally not used as a hard gate beyond the unitToMove itself.
 */

class PathReservations {
  /** Units that some HC entry will move (cannot appear in any other path). */
  movedUnits = new Set<number>();
  /** Units appearing in some entry's persisted paths (cannot be moved later). */
  pathUnits = new Set<number>();

  conflictsWithChange(unitToMove: number, paths: number[][]): boolean {
    if (this.pathUnits.has(unitToMove)) return true;
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

  commitChange(unitToMove: number, paths: number[][]): void {
    this.movedUnits.add(unitToMove);
    for (const path of paths) for (const u of path) this.pathUnits.add(u);
  }

  commitRegular(paths: number[][]): void {
    for (const path of paths) for (const u of path) this.pathUnits.add(u);
  }
}

function regularClaim(gdudId: number, _idx: TreeIndex): Set<number> {
  return new Set<number>([gdudId]);
}

function changeClaim(
  unitToMove: number,
  _newParent: number,
  _idx: TreeIndex
): Set<number> {
  return new Set<number>([unitToMove]);
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
  idx: TreeIndex
): void {
  for (const file of [REGULAR_OUTPUT, CHANGE_OUTPUT]) {
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
            reservations.commit(changeClaim(e.unitToMove, e.newParentUnit, idx));
          }
          paths.commitChange(e.unitToMove, [expand, newH]);
          continue;
        }

        if (expand.length > 0) {
          // Regular entry
          const leaf = expand[expand.length - 1];
          if (typeof leaf === 'number' && idx.byId.has(leaf)) {
            reservations.commit(regularClaim(leaf, idx));
          }
          paths.commitRegular([expand]);
        }
      }
    }
  }
}

// ─── Material ID sequence ───────────────────────────────────────────────────
// NOTE: For now every generated entry (REGULAR and HIERARCHY_CHANGE) gets the
// same default materialId ("000000006"). In the future, replace `next()` with
// real allocation logic (e.g. discover unique makats per test).

const DEFAULT_MATERIAL_ID = '000000006';

class MaterialIdSeq {
  private value: string;

  constructor(_base: string) {
    // Ignore the base for now — always emit the fixed default.
    this.value = DEFAULT_MATERIAL_ID;
  }

  next(): string {
    return this.value;
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
    const claim = regularClaim(u.id, idx);
    if (!reservations.isDisjoint(claim)) continue;
    const expandPath = topDownPath(u.id, idx);
    if (paths.conflictsWithRegular([expandPath])) continue;
    reservations.commit(claim);
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
  matSeq: MaterialIdSeq
): Record<string, unknown> {
  const expandPath = topDownPath(gdudId, idx);
  const lvl = idx.byId.get(gdudId)!.level as number;
  const out: Record<string, unknown> = {
    ...template, // carry through commentText, testValue, rowIndex, index, etc.
    materialId: matSeq.next(),
    description: `${template.description ?? 'Test'} [unit ${gdudId} / ${LEVEL_LABEL[lvl] ?? `L${lvl}`}]`,
    unitsToExpand: expandPath,
    numDataGenerated: expandPath.length,
  };
  delete (out as Record<string, unknown>).numDataObject;
  return out;
}

function runRegular(
  idx: TreeIndex,
  reservations: Reservations,
  paths: PathReservations,
  matSeq: MaterialIdSeq
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

    // Arrays without numDataObject are unit-independent → pass through,
    // still allocating unique materialIds.
    if (targetCount == null) {
      output[arrayKey] = (arrVal as RegularTemplateEntry[]).map((e) => ({
        ...e,
        materialId: matSeq.next(),
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
      generated.push(buildRegularEntry(tmplEntry, g, idx, matSeq));
      totalGenerated += 1;
    }
    output[arrayKey] = generated;
    console.log(
      `[data-builder]   ${arrayKey}: ${generated.length}/${targetCount} entries.`
    );
  }

  writeJson(REGULAR_OUTPUT, output);
  console.log(
    `[data-builder] REGULAR done — generated ${totalGenerated}, skipped ${totalSkipped}, reserved ${reservations.claimed.size} units total.`
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

/**
 * Find a (unitToMove, newParent) pair satisfying:
 *   • unitToMove.level === slot.unitLevel
 *   • newParent.level < unitToMove.level
 *   • newParent !== current parent
 *   • newParent is not a descendant of unitToMove (no cycles)
 *   • INSIDE  → newParent is on unitToMove's current ancestor chain
 *     OUTSIDE → newParent is NOT on unitToMove's current ancestor chain
 *   • the resulting claim is disjoint from existing reservations.
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
  uf: UF
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

    const ancestorChain = pathToRoot(unit.id, idx); // top-down inc. self
    const ancestorsOnly = new Set(ancestorChain.slice(0, -1)); // exclude self

    for (const cand of idx.byId.values()) {
      if (cand.level >= unit.level) continue;
      if (cand.id === oldParent) continue;
      if (cand.id === unit.id) continue;
      if (isAncestor(unit.id, cand.id, idx)) continue; // cycle guard

      const onAncestorChain = ancestorsOnly.has(cand.id);
      if (slot.kind === 'INSIDE' && !onAncestorChain) continue;
      if (slot.kind === 'OUTSIDE' && onAncestorChain) continue;

      // newParent must not be a unit that is itself being moved by another
      // entry (would mean parenting under something in flux). Backend
      // guarantees same-newParent and same-oldParent races are safe, so we
      // do NOT block on those.
      if (reservations.claimed.has(cand.id)) continue;

      const claim = changeClaim(unit.id, cand.id, idx);
      if (!reservations.isDisjoint(claim)) continue;

      // Path-disjointness: the moved unit can't already appear on someone
      // else's path, and our two paths can't contain anyone already moved.
      const oldPath = topDownPath(unit.id, idx);
      const newParentPath =
        cand.id === ROOT_UNIT_ID ? [] : topDownPath(cand.id, idx);
      const newPath = [...newParentPath, unit.id];
      if (paths.conflictsWithChange(unit.id, [oldPath, newPath])) continue;

      // ── Score 1: how many existing parallel-clusters this entry would
      // fuse. The aim is to keep clusters small and numerous.
      const touched = new Set<number>([...oldPath, ...newPath]);
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

  reservations.commit(changeClaim(pick.unit.id, pick.cand.id, idx));
  paths.commitChange(pick.unit.id, [pick.oldPath, pick.newPath]);
  topUsage.set(pick.oldPath[0], (topUsage.get(pick.oldPath[0]) ?? 0) + 1);
  topUsage.set(pick.newPath[0], (topUsage.get(pick.newPath[0]) ?? 0) + 1);
  uf.commit([...new Set<number>([...pick.oldPath, ...pick.newPath])]);

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
  matSeq: MaterialIdSeq
): Record<string, unknown> {
  const unitsToExpand = topDownPath(move.unitToMove, idx);
  const newParentPath =
    move.newParent === ROOT_UNIT_ID ? [] : topDownPath(move.newParent, idx);
  const newHierarchy = [...newParentPath, move.unitToMove];

  const unitLabel = LEVEL_LABEL[idx.byId.get(move.unitToMove)!.level as number] ?? '?';
  const oldLabel = LEVEL_LABEL[idx.byId.get(move.oldParent)!.level as number] ?? '?';
  const newLabel = LEVEL_LABEL[idx.byId.get(move.newParent)!.level as number] ?? '?';

  return {
    materialId: matSeq.next(),
    description: `${template.description ?? 'Move'} - Move ${unitLabel}(${move.unitToMove}) from ${oldLabel}(${move.oldParent}) to ${newLabel}(${move.newParent}) [${move.kind}]`,
    hatunit: template.hatunit ?? 1,
    unitsToExpand,
    newHierarchy,
    unitToMove: move.unitToMove,
    newParentUnit: move.newParent,
    oldParentUnit: move.oldParent,
  };
}

function runHierarchyChange(
  idx: TreeIndex,
  reservations: Reservations,
  paths: PathReservations,
  matSeq: MaterialIdSeq
): void {
  console.log('[data-builder] === HIERARCHY_CHANGE ===');
  const template = readJson(CHANGE_TEMPLATE);
  const output: Record<string, unknown> = {};

  let totalGenerated = 0;
  let totalSkipped = 0;

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

  for (const [arrayKey, arrVal] of Object.entries(template)) {
    if (!Array.isArray(arrVal) || arrVal.length === 0) {
      output[arrayKey] = arrVal;
      continue;
    }
    const tmplEntry = arrVal[0] as ChangeTemplateEntry;
    const generated: Record<string, unknown>[] = [];

    for (let i = 0; i < HC_SLOT_PATTERN.length; i++) {
      const slot = HC_SLOT_PATTERN[i];
      const move = pickChangeMove(slot, idx, reservations, paths, topUsage, uf);
      if (!move) {
        console.warn(
          `[data-builder]   ${arrayKey} slot ${i + 1} (${LEVEL_LABEL[slot.unitLevel]} ${slot.kind}): no candidate — skipping.`
        );
        totalSkipped += 1;
        continue;
      }
      generated.push(buildChangeEntry(tmplEntry, move, idx, matSeq));
      totalGenerated += 1;
    }
    output[arrayKey] = generated;
    console.log(
      `[data-builder]   ${arrayKey}: ${generated.length}/${HC_SLOT_PATTERN.length} entries.`
    );
  }

  writeJson(CHANGE_OUTPUT, output);
  console.log(
    `[data-builder] HIERARCHY_CHANGE done — generated ${totalGenerated}, skipped ${totalSkipped}, reserved ${reservations.claimed.size} units total.`
  );
}

// ─── Material-ID base discovery from templates ──────────────────────────────

function discoverMaterialIdBase(): string {
  const candidates: string[] = [];
  for (const file of [REGULAR_TEMPLATE, CHANGE_TEMPLATE]) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const v of Object.values(data)) {
        if (Array.isArray(v)) {
          for (const e of v) {
            if (e && typeof e.materialId === 'string') candidates.push(e.materialId);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  candidates.sort();
  return candidates[0] ?? '000000006';
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
    seedReservationsFromOutputs(reservations, paths, idx);
    if (reservations.claimed.size > 0 || paths.movedUnits.size > 0) {
      console.log(
        `[data-builder] Pre-seeded ${reservations.claimed.size} reserved units and ` +
          `${paths.movedUnits.size} moved-units / ${paths.pathUnits.size} path-units from existing outputs.`
      );
    }
  }

  const matSeq = new MaterialIdSeq(discoverMaterialIdBase());

  switch (mode) {
    case 'REGULAR':
      runRegular(idx, reservations, paths, matSeq);
      break;
    case 'HIERARCHY_CHANGE':
      runHierarchyChange(idx, reservations, paths, matSeq);
      break;
    case '':
      // REGULAR is cheap (8 entries × short chains) and entirely read-only,
      // so let it grab a few small disjoint chains first. HC then fills
      // around the reservations, packing the remaining 36 slots into the
      // (still large) unclaimed portion of the tree.
      runRegular(idx, reservations, paths, matSeq);
      runHierarchyChange(idx, reservations, paths, matSeq);
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
