Refactor the `data-builder.ts` file to expand our test matrix from 12 simple slots to a robust 40-scenario permutation matrix based on our live backend hierarchy.

### 1. Domain Hierarchy Context
We use a 5-level organizational tree with the following terminology and level numbers:
- Level 0: Matkal (Root)
- Level 1: Pikud
- Level 2: Ogda
- Level 3: Chativa
- Level 4: Gdud

### 2. Required Code Changes (Modify exactly these 3 spots)

#### SPOT 1: Update `MoveKind` Type and `SlotSpec` Interface
Extend `MoveKind` and `SlotSpec` to support the new movement dimensions:
```typescript
type MoveKind = 'INSIDE' | 'OUTSIDE' | 'HORIZONTAL' | 'NO_OP' | 'TO_ROOT';

interface SlotSpec {
  unitLevel: number;    // 1=Pikud, 2=Ogda, 3=Chativa, 4=Gdud
  kind: MoveKind;       
  targetLevel?: number; // Optional explicit target level constraint
}





SPOT 2: Update Candidate Filter Logic in pickChangeMove()
Modify the validation rules inside pickChangeMove() to accommodate the new behaviors. Relax or override the legacy baseline guards (such as newParent.level < unitToMove.level and newParent !== currentParent) depending on the active kind:

'HORIZONTAL': Ensure newParent.level === currentParent.level AND newParent.id !== currentParent.id.

'NO_OP': Force newParent.id === currentParent.id (moving the unit to its exact current parent to test idempotency). Bypass the unique parent guard here.

'TO_ROOT': Force newParent.level === 0 (targeting Matkal directly).

'INSIDE' / 'OUTSIDE': Keep existing legacy behavior (upward vertical movement, checking the ancestor chain).

Parallelism Guard: Ensure all variants still strictly respect the existing reservations + paths logic so parallel test runs never collide.

SPOT 3: Rebuild HC_SLOT_PATTERN to yield exactly 40 Test Cases
Replace the current 12-item array with an expanded matrix of exactly 40 SlotSpec configurations:

10 Horizontal Slots: Mixed across Gdud-to-Gdud-parent, Chativa-to-Chativa-parent, Ogda-to-Ogda-parent.

4 Idempotent (NO_OP) Slots: Exactly 1 slot for each entity level (Pikud, Ogda, Chativa, Gdud).

6 Root (TO_ROOT) Slots: Moving units directly under Level 0 (Matkal) -> 3 slots for Gdud, 2 for Chativa, 1 for Ogda.

20 Vertical Slots: Upward/Downward level hopping combinations (e.g., Gdud -> Ogda, Gdud -> Pikud, Chativa -> Pikud), mapping out 'INSIDE' and 'OUTSIDE' branches.

3. Pre-Flight Data Guardrail
Inside the initialization loop (runHierarchyChange), add a check against the live backend hierarchy tree. If the fetched seed data does not contain enough unique entities/branches to satisfy a specific slot constraint (e.g., trying to generate a HORIZONTAL Pikud move when there is only 1 Pikud node in the tree), the builder must throw a descriptive error:
"Data Generation Failed: Insufficient live seed data to satisfy slot [Index]. Missing unique [Entity Type] nodes."

Please generate the updated TypeScript definitions, the 40-slot pattern array, and the updated filtering logic for pickChangeMove().