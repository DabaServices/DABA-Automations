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
 * MATERIAL ID UNIQUENESS
 * ──────────────────────
 * Every generated entry gets a unique `materialId`, allocated from a global
 * counter starting at the template's base materialId. This prevents two
 * tests from racing on the same makat row (comments, save values, etc.).
 *
 * Run:
 *   npm run build:data              # both modes
 *   npm run build:data:regular      # REGULAR only
 *   npm run build:data:hierarchy    # HIERARCHY_CHANGE only
 *   npm run build:data:refresh      # bypass hierarchy cache
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

// ─── Hierarchy cache (1h TTL) ───────────────────────────────────────────────
const CACHE_FILE = path.resolve(__dirname, '../.cache/hierarchy.json');
const CACHE_TTL_MS = 60 * 60 * 1000;

function shouldRefreshCache(): boolean {
  return (
    process.env.DATA_BUILDER_REFRESH === '1' ||
    process.argv.includes('--refresh')
  );
}

function readCachedUnits(): HierarchyUnit[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as {
      units?: HierarchyUnit[];
    };
    return Array.isArray(parsed.units) ? parsed.units : null;
  } catch {
    return null;
  }
}

function writeCachedUnits(units: HierarchyUnit[]): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ fetchedAt: new Date().toISOString(), units }, null, 2),
      'utf-8'
    );
  } catch (err) {
    console.warn('[data-builder] Cache write failed:', err);
  }
}

async function loadLiveTree(): Promise<Map<number, HierarchyUnit>> {
  let units: HierarchyUnit[] | null = null;

  if (!shouldRefreshCache()) {
    units = readCachedUnits();
    if (units) {
      console.log(
        `[data-builder] Using cached hierarchy (${units.length} units).`
      );
    }
  } else {
    console.log('[data-builder] Cache bypass requested → fetching fresh.');
  }

  if (!units) {
    console.log('[data-builder] Fetching live hierarchy from backend...');
    const ctx = await playwrightRequest.newContext();
    try {
      units = await Promise.race<HierarchyUnit[]>([
        fetchHierarchyUnits(ctx),
        new Promise<HierarchyUnit[]>((_, reject) =>
          setTimeout(() => reject(new Error('Hierarchy fetch timed out (15s)')), 15000)
        ),
      ]);
      writeCachedUnits(units);
      console.log(`[data-builder] Fetched & cached ${units.length} units.`);
    } finally {
      await ctx.dispose();
    }
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
  /** R2: parents already used as `newParentUnit` in some HC entry. */
  usedNewParents = new Set<number>();
  /** R2: parents already used as `oldParentUnit` in some HC entry. */
  usedOldParents = new Set<number>();

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
 * Claim model — STRICT but minimal (parallel-safe, slot-friendly).
 *
 * Goal: REGULAR and HIERARCHY_CHANGE tests can run simultaneously across
 * multiple Playwright workers without ANY two tests racing on the same
 * mutated state.
 *
 * Aggregations propagate UP the parent chain. A move from `oldParent` to
 * `newParent` only changes aggregated totals on ancestors that sit BELOW
 * the lowest common ancestor (LCA) of old & new — anything at or above the
 * LCA sees the same subtree-sum before and after the move (the unit just
 * relocates within the LCA's subtree). So we only need to claim:
 *
 *   HC entry:
 *     {unitToMove} ∪ descendants(unitToMove)              // moved subtree
 *     ∪ ancestors-from-oldParent-up-to-but-excluding-LCA  // change on remove
 *     ∪ ancestors-from-newParent-up-to-but-excluding-LCA  // change on add
 *     ∪ {newParent, oldParent}                            // child-list races
 *
 *   REGULAR entry (read-only on aggregations of the gdud's chain):
 *     {gdud} ∪ ancestors(gdud) excluding ROOT
 *
 * R2 side-sets enforce that no two HC entries share an oldParent or a
 * newParent — closes child-list races.
 *
 * ROOT (Matkal) is exempt from chain claims because every test trivially
 * shares it; aggregating to root isn't part of the test surface.
 */
function regularClaim(gdudId: number, idx: TreeIndex): Set<number> {
  const set = new Set<number>([gdudId]);
  for (const a of pathToRoot(gdudId, idx)) set.add(a);
  set.delete(ROOT_UNIT_ID);
  return set;
}

/** Lowest common ancestor of two unit IDs (returns ROOT_UNIT_ID if disjoint). */
function lca(a: number, b: number, idx: TreeIndex): number {
  const aChain = new Set(pathToRoot(a, idx));
  const bChain = pathToRoot(b, idx);
  for (let i = bChain.length - 1; i >= 0; i--) {
    if (aChain.has(bChain[i])) return bChain[i];
  }
  return ROOT_UNIT_ID;
}

function changeClaim(
  unitToMove: number,
  newParent: number,
  idx: TreeIndex
): Set<number> {
  const set = new Set<number>([unitToMove, newParent]);
  for (const d of descendantsOf(unitToMove, idx)) set.add(d);

  // Ancestors whose aggregated subtree-sum actually changes during this move
  // are exactly those strictly below the LCA of (oldParent, newParent).
  const oldParent =
    (idx.byId.get(unitToMove)!.parent as { id: number } | null | undefined)?.id ??
    ROOT_UNIT_ID;
  const sharedRoot = lca(oldParent, newParent, idx);

  // Walk old chain: unit's parent up the tree, stop when we hit sharedRoot.
  for (const a of pathToRoot(unitToMove, idx)) {
    if (a === unitToMove) continue;
    if (a === sharedRoot) break;
    set.add(a);
  }
  // Walk new chain: newParent up the tree, stop when we hit sharedRoot.
  for (const a of pathToRoot(newParent, idx)) {
    if (a === sharedRoot) break;
    set.add(a);
  }

  set.delete(ROOT_UNIT_ID);
  return set;
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
        // Hierarchy-change shape
        if (
          typeof e.unitToMove === 'number' &&
          typeof e.newParentUnit === 'number'
        ) {
          if (idx.byId.has(e.unitToMove) && idx.byId.has(e.newParentUnit)) {
            reservations.commit(changeClaim(e.unitToMove, e.newParentUnit, idx));
            reservations.usedNewParents.add(e.newParentUnit);
            if (typeof e.oldParentUnit === 'number') {
              reservations.usedOldParents.add(e.oldParentUnit);
            }
          }
        }
        // Regular gdud shape: take last unit of unitsToExpand if it exists.
        if (Array.isArray(e.unitsToExpand) && e.unitsToExpand.length > 0) {
          const leaf = e.unitsToExpand[e.unitsToExpand.length - 1] as number;
          if (typeof leaf === 'number' && idx.byId.has(leaf)) {
            reservations.commit(regularClaim(leaf, idx));
          }
        }
      }
    }
  }
}

// ─── Material ID sequence (global, unique per generated entry) ──────────────

class MaterialIdSeq {
  private counter: number;
  private width: number;

  constructor(base: string) {
    this.counter = parseInt(base, 10);
    this.width = base.length;
    if (Number.isNaN(this.counter)) {
      this.counter = 6;
      this.width = 9;
    }
  }

  next(): string {
    const id = String(this.counter).padStart(this.width, '0');
    this.counter += 1;
    return id;
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
  alreadyPicked: Set<number>,
  gdudLevel: number
): number | null {
  for (const u of idx.byId.values()) {
    if (u.level !== gdudLevel) continue;
    if (alreadyPicked.has(u.id)) continue;
    const claim = regularClaim(u.id, idx);
    if (reservations.isDisjoint(claim)) {
      reservations.commit(claim);
      alreadyPicked.add(u.id);
      return u.id;
    }
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
      const g = pickNextGdud(idx, reservations, pickedGduds, gdudLevel);
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
 * Find a (unitToMove, newParent) pair satisfying:
 *   • unitToMove.level === slot.unitLevel
 *   • newParent.level < unitToMove.level
 *   • newParent !== current parent
 *   • newParent is not a descendant of unitToMove (no cycles)
 *   • INSIDE  → newParent is on unitToMove's current ancestor chain
 *     OUTSIDE → newParent is NOT on unitToMove's current ancestor chain
 *   • the resulting claim is disjoint from existing reservations.
 */
function pickChangeMove(
  slot: SlotSpec,
  idx: TreeIndex,
  reservations: Reservations
): ChangeMove | null {
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

      // R2: each (oldParent, newParent) is used at most once across HC.
      // Two reparents into / away from the same parent would race on that
      // parent's child list and aggregated total.
      if (reservations.usedOldParents.has(oldParent)) continue;
      if (reservations.usedNewParents.has(cand.id)) continue;

      // newParent must not be inside a subtree already claimed for moving.
      if (reservations.claimed.has(cand.id)) continue;

      const claim = changeClaim(unit.id, cand.id, idx);
      if (!reservations.isDisjoint(claim)) continue;

      reservations.commit(claim);
      reservations.usedOldParents.add(oldParent);
      reservations.usedNewParents.add(cand.id);
      return {
        unitToMove: unit.id,
        oldParent,
        newParent: cand.id,
        kind: slot.kind,
      };
    }
  }
  return null;
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
  matSeq: MaterialIdSeq
): void {
  console.log('[data-builder] === HIERARCHY_CHANGE ===');
  const template = readJson(CHANGE_TEMPLATE);
  const output: Record<string, unknown> = {};

  let totalGenerated = 0;
  let totalSkipped = 0;

  for (const [arrayKey, arrVal] of Object.entries(template)) {
    if (!Array.isArray(arrVal) || arrVal.length === 0) {
      output[arrayKey] = arrVal;
      continue;
    }
    const tmplEntry = arrVal[0] as ChangeTemplateEntry;
    const generated: Record<string, unknown>[] = [];

    for (let i = 0; i < HC_SLOT_PATTERN.length; i++) {
      const slot = HC_SLOT_PATTERN[i];
      const move = pickChangeMove(slot, idx, reservations);
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

  // When generating only one mode, seed from the OTHER file's existing
  // entries so the two stay disjoint. When generating both, we start clean.
  if (mode === 'REGULAR' || mode === 'HIERARCHY_CHANGE') {
    seedReservationsFromOutputs(reservations, idx);
    if (reservations.claimed.size > 0) {
      console.log(
        `[data-builder] Pre-seeded ${reservations.claimed.size} reserved units from existing output files.`
      );
    }
  }

  const matSeq = new MaterialIdSeq(discoverMaterialIdBase());

  switch (mode) {
    case 'REGULAR':
      runRegular(idx, reservations, matSeq);
      break;
    case 'HIERARCHY_CHANGE':
      runHierarchyChange(idx, reservations, matSeq);
      break;
    case '':
      // HIERARCHY_CHANGE first — its slot constraints are tighter (each move
      // claims a wider blast radius), so satisfy them while the reservation
      // set is still small.
      runHierarchyChange(idx, reservations, matSeq);
      runRegular(idx, reservations, matSeq);
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
