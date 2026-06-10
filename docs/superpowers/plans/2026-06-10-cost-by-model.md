# Cost by Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-model cost as leaf rows under each teammate (and the lead) in the HTML report's breakdown tree.

**Architecture:** Keep the per-model usage (`Transcript.byModel`) that `buildSessionView` currently collapses into a single cost. New `aggregate.ts` helpers cost each model separately (`modelCosts`) and prettify its id (`prettyModel`); views carry a `ModelCost[]`; `sessionNode` turns those into `level:"model"` leaf children. `render-html.ts` renders them via the already-generic `treeNode`, blanking the time column for model rows.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest. Run tests with `npx vitest run`, typecheck with `npx tsc --noEmit`.

---

## File Structure

- `src/aggregate.ts` — add `ModelCost` type, `modelCosts()`, `prettyModel()`; extend `TeammateView`/`SessionView`/`TreeNode`; build model children in `sessionNode`. (primary)
- `src/aggregate.test.ts` — add tests for the new helpers and view wiring.
- `src/render-html.ts` — blank the time column for `level:"model"`; add a dim CSS rule for model rows.

New fields `SessionView.mainModels` and `TeammateView.models` are **optional** (`?`) so the existing test helpers that build these objects as literals keep compiling; tree code treats `undefined` as `[]`.

---

## Task 1: `prettyModel` display helper

**Files:**
- Modify: `src/aggregate.ts` (add exported function near `prettyProject`, ~line 144)
- Test: `src/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/aggregate.test.ts`. First extend the import from `./aggregate.js` to include `prettyModel`:

```ts
describe("prettyModel", () => {
  it("strips a trailing 8-digit date stamp", () => {
    expect(prettyModel("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet");
  });
  it("leaves ids without a date stamp untouched", () => {
    expect(prettyModel("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(prettyModel("<synthetic>")).toBe("<synthetic>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/aggregate.test.ts -t prettyModel`
Expected: FAIL — `prettyModel is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Add to `src/aggregate.ts`:

```ts
/** Display-only model label: drop a trailing 8-digit date stamp. */
export function prettyModel(raw: string): string {
  return raw.replace(/-?\d{8}$/, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/aggregate.test.ts -t prettyModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aggregate.ts src/aggregate.test.ts
git commit -m "feat: prettyModel display helper"
```

---

## Task 2: `ModelCost` type + `modelCosts` helper

**Files:**
- Modify: `src/aggregate.ts` (add type near other view interfaces ~line 5; add helper after `buildSessionView`)
- Test: `src/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

Add `modelCosts` to the `./aggregate.js` import, and `type Usage` is already imported in the test file. Add:

```ts
describe("modelCosts", () => {
  const pt = new PriceTable(
    parseOpenRouterModels({
      data: [
        { id: "anthropic/claude-sonnet-4.6", pricing: { prompt: "0.000003", completion: "0.000015" } },
      ],
    }),
  );

  it("returns one priced entry per model, sorted by cost desc", () => {
    const byModel = new Map<string, Usage>([
      ["claude-sonnet-4-6", usage({ input: 1000 })], // 1000 * 3e-6 = 0.003
      ["claude-sonnet-4-6-cheap", usage({ input: 1 })],
    ]);
    // distinct keys both normalize to the same priced model
    const res = modelCosts(byModel, pt);
    expect(res.map((m) => m.model)).toEqual(["claude-sonnet-4-6", "claude-sonnet-4-6-cheap"]);
    expect(res[0]!.cost.cost).toBeGreaterThan(res[1]!.cost.cost);
    expect(res[0]!.display).toBe("claude-sonnet-4-6");
  });

  it("marks an entry partial when its price is unknown", () => {
    const res = modelCosts(new Map([["mystery-model", usage({ input: 5 })]]), pt);
    expect(res).toHaveLength(1);
    expect(res[0]!.cost.partial).toBe(true);
    expect(res[0]!.cost.cost).toBe(0);
  });

  it("returns [] for an empty map", () => {
    expect(modelCosts(new Map(), pt)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/aggregate.test.ts -t modelCosts`
Expected: FAIL — `modelCosts is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/aggregate.ts`, the existing import already brings in `costByModel`; add `ModelCost` type near the other interfaces (after `TeammateView`):

```ts
export interface ModelCost {
  model: string; // raw model id (key of byModel)
  display: string; // prettified label for the UI
  cost: CostResult; // cost + usage for this one model
}
```

And add the helper (after `buildSessionView`):

```ts
/** Cost each model in a usage map separately, highest cost first. */
export function modelCosts(byModel: Map<string, Usage>, prices: PriceTable): ModelCost[] {
  return [...byModel.entries()]
    .map(([model, u]) => ({
      model,
      display: prettyModel(model),
      cost: costByModel(new Map([[model, u]]), prices),
    }))
    .sort((a, b) => b.cost.cost - a.cost.cost);
}
```

This needs `Usage` imported. Update the type import at the top of `src/aggregate.ts`:

```ts
import type { Account, CostResult, Session, Usage, Workspace } from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/aggregate.test.ts -t modelCosts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/aggregate.ts src/aggregate.test.ts
git commit -m "feat: modelCosts helper + ModelCost type"
```

---

## Task 3: Carry per-model costs into the views

**Files:**
- Modify: `src/aggregate.ts` (`TeammateView` ~line 5, `SessionView` ~line 13, `buildSessionView` ~line 45)
- Test: `src/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the existing `buildSessionView` test block in `src/aggregate.test.ts` with a new case (the helpers `session`, `usage`, `prices` already exist in the file):

```ts
it("exposes per-model costs for the lead and each teammate", () => {
  const s = session({
    main: {
      id: "s1",
      path: "/x/s1.jsonl",
      byModel: new Map([["claude-sonnet-4-6", usage({ input: 1000 })]]),
    },
    teammates: [
      {
        id: "t",
        path: "/x/s1/subagents/agent-t.jsonl",
        name: "dev",
        label: "dev — t",
        byModel: new Map([
          ["claude-sonnet-4-6", usage({ output: 100 })],
          ["claude-sonnet-4-6-x", usage({ output: 50 })],
        ]),
      },
    ],
  });
  const v = buildSessionView(s, prices);
  expect(v.mainModels?.map((m) => m.model)).toEqual(["claude-sonnet-4-6"]);
  expect(v.teammates[0]!.models?.map((m) => m.model)).toEqual([
    "claude-sonnet-4-6",
    "claude-sonnet-4-6-x",
  ]);
  // per-model costs sum to the teammate aggregate
  const sum = v.teammates[0]!.models!.reduce((n, m) => n + m.cost.cost, 0);
  expect(sum).toBeCloseTo(v.teammates[0]!.cost.cost, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/aggregate.test.ts -t "per-model costs for the lead"`
Expected: FAIL — `v.mainModels` is `undefined` (property does not exist yet → TS error, then assertion fails).

- [ ] **Step 3: Write minimal implementation**

In `src/aggregate.ts` add the optional fields. To `TeammateView`:

```ts
export interface TeammateView {
  id: string;
  name?: string;
  label: string;
  cost: CostResult;
  models?: ModelCost[];
}
```

To `SessionView` add after `teammates`:

```ts
  teammates: TeammateView[];
  mainModels?: ModelCost[];
```

In `buildSessionView`, populate them. Change the teammate map and the return:

```ts
  const teammates: TeammateView[] = session.teammates
    .map((t) => ({
      id: t.id,
      name: t.name,
      label: t.label ?? t.id,
      cost: costByModel(t.byModel, prices),
      models: modelCosts(t.byModel, prices),
    }))
    .sort((a, b) => b.cost.cost - a.cost.cost);
```

and add to the returned object (after `mainCost`):

```ts
    mainCost: costByModel(session.main.byModel, prices),
    mainModels: modelCosts(session.main.byModel, prices),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/aggregate.test.ts -t "per-model costs for the lead"`
Expected: PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (optional fields keep existing literals valid).

- [ ] **Step 6: Commit**

```bash
git add src/aggregate.ts src/aggregate.test.ts
git commit -m "feat: carry per-model costs into session/teammate views"
```

---

## Task 4: Model leaf nodes in the tree

**Files:**
- Modify: `src/aggregate.ts` (`TreeNode` ~line 149, `sessionNode` ~line 253)
- Test: `src/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new describe block. `buildTree` and the `mkView`/`cost` helpers already exist; this test builds a view with `mainModels` and a teammate with `models`:

```ts
describe("model nodes in the tree", () => {
  const tala: Account = { dir: "/h/.claude-talabat", label: "Talabat" };
  const ws: Workspace = { id: "W1", title: "WS" };

  it("adds level:'model' leaves under the lead and each teammate", () => {
    const mc = (model: string, c: number): import("./aggregate.js").ModelCost => ({
      model,
      display: model,
      cost: cost(c),
    });
    const v: SessionView = {
      ...mkView("s1", tala, ws, 10),
      mainModels: [mc("claude-opus-4-8", 6)],
      teammates: [
        { id: "t", name: "dev", label: "dev", cost: cost(4), models: [mc("claude-opus-4-8", 3), mc("claude-haiku", 1)] },
      ],
    };
    const tree = buildTree([v]);
    const sessionNode = tree[0]!.children[0]!.children[0]!;
    const lead = sessionNode.children.find((n) => n.label === "lead")!;
    expect(lead.children.map((n) => [n.level, n.label])).toEqual([["model", "claude-opus-4-8"]]);
    const dev = sessionNode.children.find((n) => n.label === "dev")!;
    expect(dev.children.map((n) => n.level)).toEqual(["model", "model"]);
    // sorted by the ModelCost order they were given (already cost-desc)
    expect(dev.children.map((n) => n.label)).toEqual(["claude-opus-4-8", "claude-haiku"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/aggregate.test.ts -t "model nodes in the tree"`
Expected: FAIL — lead/teammate nodes have `children: []` (length 0), and `level` type rejects `"model"`.

- [ ] **Step 3: Write minimal implementation**

In `src/aggregate.ts`, widen `TreeNode.level`:

```ts
export interface TreeNode {
  key: string;
  label: string;
  level: "account" | "workspace" | "session" | "teammate" | "model";
  cost: CostResult;
  lastActivity: number;
  children: TreeNode[];
}
```

Add a helper above `sessionNode`:

```ts
function modelNodes(models: ModelCost[] | undefined, lastActivity: number, parentKey: string): TreeNode[] {
  return (models ?? []).map((m) => ({
    key: `${parentKey}:md:${m.model}`,
    label: m.display,
    level: "model" as const,
    cost: m.cost,
    lastActivity,
    children: [],
  }));
}
```

In `sessionNode`, give the lead and each teammate their model children. Replace the `mates` array construction:

```ts
  const leadKey = `tm:${v.id}:lead`;
  const mates: TreeNode[] = [
    {
      key: leadKey,
      label: "lead",
      level: "teammate",
      cost: v.mainCost,
      lastActivity: v.lastActivity,
      children: modelNodes(v.mainModels, v.lastActivity, leadKey),
    },
    ...v.teammates.map((t): TreeNode => {
      const key = `tm:${v.id}:${t.id}`;
      return {
        key,
        label: t.name ?? t.label,
        level: "teammate",
        cost: t.cost,
        lastActivity: v.lastActivity,
        children: modelNodes(t.models, v.lastActivity, key),
      };
    }),
  ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/aggregate.test.ts -t "model nodes in the tree"`
Expected: PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. (Existing `buildTree` tests build views without model fields → lead/teammate children stay `[]`, so their assertions are unaffected.)

- [ ] **Step 6: Commit**

```bash
git add src/aggregate.ts src/aggregate.test.ts
git commit -m "feat: per-model leaf nodes under lead and teammates in the tree"
```

---

## Task 5: Render model rows in the HTML report

**Files:**
- Modify: `src/render-html.ts` (`treeNode` ~line 160; `CSS` block ~line 203)

- [ ] **Step 1: Blank the time column for model rows**

In `src/render-html.ts`, inside `treeNode`, the row currently always renders `fmtTimeAgo(...)`. Replace the `<span class="tnode-when ...>` line so model rows show nothing there:

```ts
      <span class="tnode-cost">${esc(fmtCost(n.cost, currency))}</span>
      <span class="tnode-tokens dim">${esc(fmtTokens(n.cost.tokens))}</span>
      <span class="tnode-when dim">${n.level === "model" ? "" : esc(fmtTimeAgo(n.lastActivity, now))}</span>
```

- [ ] **Step 2: Add a dim style for model rows**

In the `CSS` template string, add after the `.level-workspace>...` rule (~line 259):

```css
.level-model>.tnode-row .tnode-label{color:var(--dim);font-weight:400}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `dist/` rebuilds.

- [ ] **Step 4: Manual smoke check of the generated HTML**

Generate a report against real data and confirm a teammate now expands to model rows:

Run: `node dist/cli.js report` (or the project's report command — check `src/cli.ts` for the exact subcommand)
Then open the printed report path, expand a session → a teammate, and verify:
- the teammate row shows a caret and is expandable,
- each model appears as a dim sub-row with a cost + tokens,
- the time-ago column is blank on model rows.

If the report command name differs, run `node dist/cli.js --help` to find it.

- [ ] **Step 5: Commit**

```bash
git add src/render-html.ts dist
git commit -m "feat: render per-model rows under teammates in the HTML report"
```

---

## Self-Review Notes

- **Spec coverage:** `ModelCost`/`modelCosts`/`prettyModel` (Tasks 1–2), `TeammateView.models` + `SessionView.mainModels` (Task 3), `TreeNode.level` `"model"` + leaf children always rendered (Task 4), HTML blanked-time column + dim CSS (Task 5). `render-text.ts` left unchanged per spec.
- **Always sub-rows:** `modelNodes` maps every `ModelCost` with no count threshold, matching the approved "always sub-rows" decision.
- **Type consistency:** `modelCosts`/`prettyModel`/`ModelCost`/`modelNodes` names are used identically across tasks. New view fields are optional, so the pre-existing test literals in `aggregate.test.ts` (`mkView`, `view`, `withMate`, the `buildSessionView` baseline) remain valid.
