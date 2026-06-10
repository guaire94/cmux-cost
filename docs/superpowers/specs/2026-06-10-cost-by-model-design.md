# Cost by model in the breakdown tree — design

## Goal

Show the cost contributed by each Claude model, at the leaf level of the report's
breakdown tree. Each transcript already records usage per model
(`Transcript.byModel: Map<rawModelId, Usage>`); today `buildSessionView` costs
that map into a single aggregate `CostResult` and discards the per-model detail.
This feature keeps the detail all the way to the tree so a user can expand any
teammate (lead included) and see which models it spent on.

## Scope

- Per-model rows appear **under each teammate node** in the breakdown tree
  (Account → Workspace → Session → Teammate → **Model**). The lead transcript is
  a teammate node too and gets the same treatment.
- **Always** render one model sub-row per model, even when a transcript used a
  single model (full consistency; a single row simply repeats the parent cost).
- HTML report only. The plain-text renderer (`render-text.ts`) is left unchanged
  for now.

Out of scope: a global "cost by model" panel, a per-account model leaderboard,
per-model coloring in the daily chart.

## Data model changes (`types.ts` / `aggregate.ts`)

New type (in `aggregate.ts`, next to the other view types):

```ts
export interface ModelCost {
  model: string;    // raw model id as reported (key of byModel)
  display: string;  // prettified label for the UI
  cost: CostResult; // cost + usage for this one model
}
```

New helpers:

- `modelCosts(byModel: Map<string, Usage>, prices: PriceTable): ModelCost[]`
  — one `CostResult` per model (reuse `costByModel` on a single-entry map so the
  `partial` / `unknownModels` flags stay correct), sorted by `cost.cost`
  descending. Empty input → `[]`.
- `prettyModel(raw: string): string` — strip a trailing 8-digit date stamp
  (`-?\d{8}$`) for readability, e.g. `claude-3-5-sonnet-20241022` →
  `claude-3-5-sonnet`. Otherwise return the id unchanged. (Mirrors the
  `stripDate` logic already in `model.ts`; kept local to display so it never
  affects pricing/normalization.)

View additions:

- `TeammateView` gains `models: ModelCost[]`.
- `SessionView` gains `mainModels: ModelCost[]` (the lead transcript's models).

`buildSessionView` populates both from the corresponding `byModel` maps using
`modelCosts`. Prices live in `aggregate`/`buildSessionView` already, so this is
the right layer.

## Tree changes (`aggregate.ts`)

- `TreeNode.level` union gains `"model"`.
- In `sessionNode`, the lead node and each teammate node receive
  `children: TreeNode[]` built from their `ModelCost[]`:

```ts
function modelNodes(models: ModelCost[], lastActivity: number, parentKey: string): TreeNode[] {
  return models.map((m) => ({
    key: `${parentKey}:md:${m.model}`,
    label: m.display,
    level: "model",
    cost: m.cost,
    lastActivity,            // reused from parent; the "when" column is blanked at render
    children: [],
  }));
}
```

Model nodes are leaves (`children: []`). They inherit the parent's
`lastActivity` only to satisfy the type; the renderer blanks the time column for
`level: "model"`.

## Render changes (`render-html.ts`)

`treeNode` is already generic over `children`, so:

- A teammate with model children automatically renders the caret and becomes
  expandable; the existing `.tnode-row.expandable` click handler binds to it with
  no JS change.
- For `n.level === "model"`, render the time-ago column empty (a per-model
  timestamp is meaningless). Small CSS rule `.level-model > .tnode-row` dims the
  label so model rows read as secondary to the teammate.
- No change to default expand state: workspaces stay open by default, teammates
  (and therefore their model rows) stay collapsed until clicked — this keeps the
  tree compact.

## Testing

In `aggregate.test.ts` (or a small new `model-cost` block):

- `modelCosts` returns one entry per model, sorted by cost descending.
- `modelCosts` marks an entry `partial` when its model price is missing, and
  leaves priced entries non-partial.
- `modelCosts({})` → `[]`.
- `prettyModel` strips an 8-digit date suffix and leaves other ids untouched.
- `buildSessionView` populates `mainModels` and each teammate's `models`, and the
  per-model costs sum to the teammate/lead aggregate cost.

## Risks / notes

- A transcript with many distinct models would add several rows, but only when
  expanded — collapsed by default, so no upfront bloat.
- `prettyModel` is display-only; pricing/normalization paths are untouched.
- Unknown-price models still surface (cost shows `—`/partial via existing
  `fmtCost`), so the per-model view degrades the same way the aggregate does.
